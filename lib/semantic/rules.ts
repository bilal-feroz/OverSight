/**
 * Deterministic semantic risk engine.
 *
 * Runs with no network and no API key. It scans every content block of an
 * approval request with explainable rules, grades each block's severity and
 * selects the few blocks that materially affect the decision ("attention
 * targets"). When an AI provider is configured, its output is merged on top
 * of this result and can escalate, but never de-escalate, what these rules
 * found (see analyzer.ts).
 */
import type { ApprovalRequest, BlockKind, ContentBlock, RiskLevel } from "@/types/approval";
import { RISK_ORDER } from "@/types/approval";
import type { CriticalRegion, RiskCategory, SemanticAnalysis } from "@/types/semantic";

export interface RuleContext {
  request: ApprovalRequest;
  fullText: string;
  isProduction: boolean;
  isExternal: boolean;
  isPayment: boolean;
  amounts: MoneyAmount[];
}

export interface RuleHit {
  ruleId: string;
  category: RiskCategory;
  severity: RiskLevel;
  reason: string;
  phrase: string;
  statement: string;
  /** Number of distinct cues matched; used to rank equally severe blocks. */
  strength: number;
}

interface Rule {
  id: string;
  category: RiskCategory;
  evaluate(block: ContentBlock, ctx: RuleContext): Omit<RuleHit, "ruleId" | "category"> | null;
}

export interface MoneyAmount {
  value: number;
  currency: string;
  display: string;
}

/** Block kinds that may be selected as attention targets. Title and summary are always read. */
export const TARGET_KINDS: readonly BlockKind[] = [
  "consequence",
  "detail",
  "change",
  "resource",
  "reasoning",
];

const KIND_PREFERENCE: Record<BlockKind, number> = {
  consequence: 0,
  detail: 1,
  change: 2,
  resource: 3,
  reasoning: 4,
  summary: 5,
  title: 6,
  metadata: 7,
};

export const MAX_TARGETS = 2;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const MONEY =
  /\b(AED|USD|EUR|GBP|SAR|QAR|INR|CHF|JPY|CAD|AUD)\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|million|thousand|bn|billion)\b)?|([$€£])\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|million|thousand|bn|billion)\b)?/gi;

export function parseMoney(text: string): MoneyAmount[] {
  const out: MoneyAmount[] = [];
  for (const m of text.matchAll(MONEY)) {
    const currency = (m[1] ?? m[4] ?? "").toUpperCase();
    const raw = m[2] ?? m[5] ?? "0";
    const unit = (m[3] ?? m[6] ?? "").toLowerCase();
    let value = Number.parseFloat(raw.replace(/,/g, ""));
    if (unit === "k" || unit === "thousand") value *= 1e3;
    if (unit === "m" || unit === "million") value *= 1e6;
    if (unit === "bn" || unit === "billion") value *= 1e9;
    if (!Number.isFinite(value)) continue;
    const trimmed = raw.replace(/\.0+$/, "");
    const display = /^[$€£]$/.test(currency)
      ? `${currency}${trimmed}${unit ? ` ${unit}` : ""}`
      : `${currency} ${trimmed}${unit ? ` ${unit}` : ""}`;
    out.push({ value, currency, display });
  }
  return out;
}

/** True when a cue is directly preceded (<= 2 words) by a negation, e.g. "No downtime". */
export function isNegated(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 40), index);
  return (
    /\b(no|not|never|without|zero|none)\s+(?:[\w-]+\s+){0,2}$/i.test(before) ||
    /n't\s+(?:[\w-]+\s+){0,2}$/i.test(before)
  );
}

/** The sentence of `text` containing character `index`. */
export function sentenceAt(text: string, index: number): string {
  const starts = [...text.slice(0, index).matchAll(/[.!?](?:\s+|$)/g)];
  const start = starts.length ? (starts[starts.length - 1].index ?? 0) + starts[starts.length - 1][0].length : 0;
  const endMatch = /[.!?](?:\s|$)/.exec(text.slice(index));
  const end = endMatch ? index + endMatch.index + 1 : text.length;
  return text.slice(start, end).trim();
}

/** Plain-language statement from raw text: strips "WARNING:" style prefixes, capitalizes, adds a period. */
export function cleanStatement(text: string): string {
  let s = text.trim().replace(/^(warning|note|important|caution|attention|notice)\s*[:\-–—]\s*/i, "");
  s = s.replace(/\s+/g, " ");
  if (!s) return s;
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function trimPhrase(s: string): string {
  return s.trim().replace(/[.;,:]+$/, "");
}

const DATA_NOUN =
  /\b(records?|rows?|data|tables?|databases?|customers?|accounts?|users?|files?|objects?|documents?|backups?|entries|snapshots?|buckets?)\b/i;
const COUNT_NOUN =
  /(\d[\d,]*)\s+((?:[a-z][a-z-]*\s+){0,3}?(?:records|rows|accounts|customers|users|files|objects|documents|entries|backups|snapshots|tables|buckets))\b/i;

// ---------------------------------------------------------------------------
// Rules (priority order: earlier rules win ties when choosing targets)
// ---------------------------------------------------------------------------

const PERMANENT_DELETE =
  /\b(permanently|irreversibly|irrecoverably)\s+(?:be\s+)?(?:delet|remov|eras|destroy|purg|drop|wip)\w*/i;
const HARD_DELETE = /\b(hard[- ]delet\w*|purge[sd]?|truncat\w*|drop\s+(?:table|database|schema|bucket))\b/i;
// Greedy word run so "2,431 customer records" is captured whole, not cut at "customer".
const PERMANENT_PHRASE =
  /(permanently|irreversibly|irrecoverably)\s+(?:be\s+)?(?:delet|remov|eras|destroy|purg|drop|wip)\w*(?:\s+(?:all\s+)?(?:\d[\d,]*\s+)?(?:[a-z-]+\s+){0,3}(?:records?|rows?|data|tables?|databases?|customers?|accounts?|users?|files?|objects?|documents?|backups?|entries|snapshots?|buckets?)\b)?/i;

const permanentDeletion: Rule = {
  id: "permanent-deletion",
  category: "data_destruction",
  evaluate(block) {
    const m = PERMANENT_DELETE.exec(block.text) ?? HARD_DELETE.exec(block.text);
    if (!m || !DATA_NOUN.test(block.text) || isNegated(block.text, m.index)) return null;
    const phrase = PERMANENT_PHRASE.exec(block.text)?.[0] ?? m[0];
    const count = COUNT_NOUN.exec(block.text);
    const statement = count
      ? `${count[1]} ${count[2].trim()} will be permanently deleted.`
      : "Data will be permanently deleted and cannot be recovered.";
    return {
      severity: "CRITICAL",
      reason: "irreversible data deletion",
      phrase: trimPhrase(phrase),
      statement,
      strength: 2,
    };
  },
};

const PUBLIC =
  /(0\.0\.0\.0\/0|::\/0|\bpublic internet\b|\bany ip(?: address)?\b|\bpublicly (?:accessible|reachable|exposed|readable|listed)\b|\bopen to the (?:internet|world|public)\b|\banonymous (?:public )?access\b|\bworld[- ]readable\b|\ballow all inbound\b)/i;
const SENSITIVE_SERVICE =
  /\b(postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|redis|elasticsearch|database|rds|ssh|rdp)\b|\b(5432|3306|27017|6379|9200|3389)\b/i;
const SERVICE_NAMES: Array<[RegExp, string]> = [
  [/postgres(?:ql)?/i, "PostgreSQL"],
  [/mysql/i, "MySQL"],
  [/mariadb/i, "MariaDB"],
  [/mongo(?:db)?/i, "MongoDB"],
  [/redis/i, "Redis"],
  [/elasticsearch/i, "Elasticsearch"],
  [/\bssh\b/i, "SSH"],
  [/\brdp\b/i, "RDP"],
];

const publicExposure: Rule = {
  id: "public-exposure",
  category: "public_exposure",
  evaluate(block, ctx) {
    const m = PUBLIC.exec(block.text);
    if (!m || isNegated(block.text, m.index)) return null;
    const sensitive = SENSITIVE_SERVICE.test(block.text) || SENSITIVE_SERVICE.test(ctx.fullText);
    const service = SERVICE_NAMES.find(([re]) => re.test(block.text))?.[1] ??
      SERVICE_NAMES.find(([re]) => re.test(ctx.fullText))?.[1];
    const port =
      /\b(?:port|tcp|udp)\s+(\d{2,5})\b/i.exec(block.text)?.[1] ??
      /\b(?:port|tcp|udp)\s+(\d{2,5})\b/i.exec(ctx.fullText)?.[1];
    const statement = service
      ? `${service}${port ? ` port ${port}` : ""} will be reachable from the public internet.`
      : "This resource will be reachable from the public internet.";
    const phrase =
      /(?:reachable|accessible|exposed|open|available)\b[^.]{0,60}(?:public internet|any ip(?: address)?|0\.0\.0\.0\/0|the internet)/i.exec(
        block.text,
      )?.[0] ?? m[0];
    return {
      severity: sensitive ? "CRITICAL" : "HIGH",
      reason: sensitive ? "database exposed to the public internet" : "public internet exposure",
      phrase: trimPhrase(phrase),
      statement,
      strength: sensitive ? 2 : 1,
    };
  },
};

const BENEFICIARY = /\b(beneficiary|bank account|bank details|iban|payee|remittance (?:details|account))\b/i;
const CHANGED = /\b(changed|updated|modified|replaced|switched)\b/i;

const beneficiaryChange: Rule = {
  id: "beneficiary-change",
  category: "fraud_indicator",
  evaluate(block, ctx) {
    const b = BENEFICIARY.exec(block.text);
    if (!b) return null;
    const sentence = sentenceAt(block.text, b.index);
    const c = CHANGED.exec(sentence);
    if (!c || isNegated(sentence, c.index)) return null;
    const unverified = /\bunverified\b|\bnot (?:been )?(?:verified|confirmed)\b/i.test(sentence);
    const ago = /(\d+\s+(?:minute|hour|day|week)s?\s+ago)/i.exec(sentence)?.[1];
    const amount = [...ctx.amounts].sort((a, b2) => b2.value - a.value)[0];
    const statement = `${amount ? amount.display : "The payment"} will be sent to a bank account that was changed ${
      ago ?? "recently"
    }${unverified ? " and has not been verified" : ""}.`;
    const startInSentence = sentence.search(BENEFICIARY);
    return {
      severity: ctx.isPayment || unverified ? "CRITICAL" : "HIGH",
      reason: unverified ? "recently changed, unverified beneficiary account" : "beneficiary account changed",
      phrase: trimPhrase(sentence.slice(Math.max(0, startInSentence))),
      statement,
      strength: unverified ? 3 : 2,
    };
  },
};

const SENSITIVE_TYPES: Array<[RegExp, string]> = [
  [/national id(?: numbers?)?/i, "national ID numbers"],
  [/passport(?: numbers?)?/i, "passport numbers"],
  [/social security(?: numbers?)?|\bssns?\b/i, "social security numbers"],
  [/tax id(?: numbers?)?/i, "tax ID numbers"],
  [/dates? of birth/i, "dates of birth"],
  [/phone numbers?/i, "phone numbers"],
  [/home address(?:es)?/i, "home addresses"],
  [/health (?:records|data)|medical records?/i, "health records"],
  [/(?:credit )?card numbers?/i, "card numbers"],
  [/biometric/i, "biometric data"],
  [/salar(?:y|ies)/i, "salary data"],
  [/personal data|\bpii\b/i, "personal data"],
];
const UNMASKED = /\b(unmasked|unencrypted|plain[- ]?text|unredacted|raw)\b/i;
const EXTERNAL = /\b(external|third[- ]party|vendor|outside|partner|integration|sftp)\b/i;

const sensitiveData: Rule = {
  id: "sensitive-data",
  category: "sensitive_data_sharing",
  evaluate(block, ctx) {
    const types = SENSITIVE_TYPES.filter(([re]) => re.test(block.text)).map(([, label]) => label);
    if (types.length === 0) return null;
    const firstIdx = Math.min(
      ...SENSITIVE_TYPES.map(([re]) => block.text.search(re)).filter((i) => i >= 0),
    );
    if (isNegated(block.text, firstIdx)) return null;
    const unmasked = UNMASKED.test(block.text);
    const external = ctx.isExternal || EXTERNAL.test(block.text);
    const count =
      /(\d[\d,]*)\s+(customers|users|people|patients|employees|accounts|individuals)\b/i.exec(block.text) ??
      /(\d[\d,]*)\s+(customers|users|people|patients|employees|accounts|individuals)\b/i.exec(ctx.fullText);
    const recipient = /\bvendor\b/i.test(ctx.fullText)
      ? "an external vendor"
      : /\bpartner\b/i.test(ctx.fullText)
        ? "an external partner"
        : "an external party";
    const typeText = types.join(" and ");
    const subject = unmasked ? `Unmasked ${typeText}` : capitalize(typeText);
    const statement = external
      ? `${subject}${count ? ` for ${count[1]} ${count[2]}` : ""} will be sent to ${recipient}.`
      : `${subject}${count ? ` for ${count[1]} ${count[2]}` : ""} will be exposed.`;
    const phraseStart = unmasked ? block.text.search(UNMASKED) : firstIdx;
    const phraseEnd = /[.;](?:\s|$)/.exec(block.text.slice(phraseStart));
    const phrase = block.text.slice(phraseStart, phraseEnd ? phraseStart + phraseEnd.index : undefined);
    return {
      severity: unmasked || external ? "CRITICAL" : "HIGH",
      reason: external ? "unmasked personal data leaves the organization" : "sensitive personal data",
      phrase: trimPhrase(phrase),
      statement,
      strength: types.length + (unmasked ? 1 : 0),
    };
  },
};

const DELETE = /\b(delet(?:e|es|ed|ing|ion)|remov(?:e|es|ed|ing)|eras(?:e|es|ed|ing)|wip(?:e|es|ed|ing))\b/i;
const RECOVERABLE = /\b(soft[- ]delet\w*|recycle bin|trash|can be restored|recoverable|restorable)\b/i;

const dataDeletion: Rule = {
  id: "data-deletion",
  category: "data_destruction",
  evaluate(block, ctx) {
    const m = DELETE.exec(block.text);
    if (!m || !DATA_NOUN.test(block.text) || RECOVERABLE.test(block.text)) return null;
    if (isNegated(block.text, m.index)) return null;
    const count = COUNT_NOUN.exec(block.text);
    // Deletion that the request itself says is recoverable elsewhere (trash, soft delete) is notable, not destructive.
    const recoverable = RECOVERABLE.test(ctx.fullText);
    return {
      severity: recoverable ? "MEDIUM" : "HIGH",
      reason: recoverable ? "recoverable data deletion" : "data deletion",
      phrase: trimPhrase(sentenceAt(block.text, m.index)),
      statement: count ? `${count[1]} ${count[2].trim()} will be deleted.` : cleanStatement(sentenceAt(block.text, m.index)),
      strength: 1,
    };
  },
};

const OUTAGE =
  /\b(will fail|fails to|failed (?:payments|requests|orders|logins|checkouts|transactions)|outage|downtime|unavailable|service interruption|cannot (?:process|serve|accept)|rejects? (?:all )?(?:requests|connections|payments))\b/i;

const serviceOutage: Rule = {
  id: "service-outage",
  category: "service_disruption",
  evaluate(block, ctx) {
    const m = OUTAGE.exec(block.text);
    if (!m || isNegated(block.text, m.index)) return null;
    const duration = /(\d+)\s*(seconds?|minutes?|hours?)/i.exec(block.text);
    const failed = /failed ([a-z]+)/i.exec(block.text)?.[1];
    const service = /\b([a-z0-9]+(?:-[a-z0-9]+)*-(?:api|service|svc|worker|app|db|gateway))\b/i.exec(block.text)?.[1];
    const impactful =
      ctx.isProduction ||
      /\b(payments?|checkout|customers?|orders?|logins?)\b/i.test(block.text) ||
      (duration !== null && !/seconds?/i.test(duration[2]));
    const statement =
      service && duration
        ? `${service} will fail for about ${duration[1]} ${duration[2]}${failed ? `, causing failed ${failed}` : ""}.`
        : cleanStatement(sentenceAt(block.text, m.index));
    return {
      severity: impactful ? "HIGH" : "MEDIUM",
      reason: failed ? `service outage causing failed ${failed}` : "service outage",
      phrase: trimPhrase(block.text.slice(m.index, (/[.;](?:\s|$)/.exec(block.text.slice(m.index))?.index ?? block.text.length - m.index) + m.index)),
      statement,
      strength: failed ? 2 : 1,
    };
  },
};

const WRITE_PERM =
  /(read\s*(?:&|and|\/)\s*write|\bwrite access\b|\bwrite permissions?\b|\badmin(?:istrator)? access\b|\bowner access\b|\bfull access\b|\bpush access\b|→\s*write\b|->\s*write\b)/i;

const writePermission: Rule = {
  id: "write-permission",
  category: "permission_escalation",
  evaluate(block, ctx) {
    const m = WRITE_PERM.exec(block.text);
    if (!m || isNegated(block.text, m.index)) return null;
    const broad = /\ball\s+(?:\d+\s+)?repositories\b|\borg(?:anization)?[- ]wide\b/i.test(ctx.fullText);
    const scope = /write access to ([^.;]+)/i.exec(block.text)?.[1]?.split(/,\s*including|\s+—\s+/i)[0]?.trim();
    const statement = scope
      ? `${ctx.isExternal ? "An external app" : "A new principal"} will get write access to ${scope}.`
      : ctx.isExternal
        ? "An external integration will get write access."
        : "Write access will be granted.";
    const phrase = /(?:gets?|granted|receives?|will have)?\s*write access[^.,;]*/i.exec(block.text)?.[0] ?? m[0];
    return {
      severity: ctx.isExternal || broad ? "HIGH" : "MEDIUM",
      reason: ctx.isExternal ? "write access for an external integration" : "permission escalation",
      phrase: trimPhrase(phrase),
      statement,
      strength: scope ? 2 : 1,
    };
  },
};

const WEAKEN_CONTROL =
  /\b(?:disabl\w*|turn(?:s|ing)? off|bypass\w*|suspend\w*|remov\w*|skip\w*)\b[^.]{0,50}?\b(multi-factor authentication|mfa|2fa|two-factor|single sign-on|encryption|firewall|audit log(?:ging|s)?|logging|monitoring|alerting|backups?|code review|branch protection)\b/i;

const securityControl: Rule = {
  id: "security-control",
  category: "security_control",
  evaluate(block, ctx) {
    const m = WEAKEN_CONTROL.exec(block.text);
    if (!m || isNegated(block.text, m.index)) return null;
    const control = m[1];
    return {
      severity: ctx.isProduction || /\baccounts?|users?|all\b/i.test(block.text) ? "HIGH" : "MEDIUM",
      reason: `security control disabled (${control.toLowerCase()})`,
      phrase: trimPhrase(m[0]),
      statement: cleanStatement(sentenceAt(block.text, m.index)),
      strength: 2,
    };
  },
};

const TRANSFER_VERB = /\b(transfer\w*|wire\w*|pay|pays|paying|payment|remit\w*|disburse\w*|send\w*)\b/i;

const financialTransfer: Rule = {
  id: "financial-transfer",
  category: "financial_transfer",
  evaluate(block, ctx) {
    const amounts = parseMoney(block.text);
    if (amounts.length === 0) return null;
    const largest = amounts.sort((a, b) => b.value - a.value)[0];
    if (largest.value < 1000) return null;
    if (!ctx.isPayment && !TRANSFER_VERB.test(block.text)) return null;
    return {
      severity: "HIGH",
      reason: `funds transfer of ${largest.display}`,
      phrase: largest.display,
      statement: `${largest.display} will be transferred.`,
      strength: 1,
    };
  },
};

const IRREVERSIBLE =
  /\b(?:cannot|can't|can not|could not|won't) be (?:recalled|reversed|undone|refunded|cancell?ed|restored|recovered|retracted)\b|\b(?:irreversible|non-reversible)\b|\b(?:is|are) final\b|\bno rollback\b|\brollback: none\b/i;

const irreversible: Rule = {
  id: "irreversible",
  category: "irreversible",
  evaluate(block, ctx) {
    const m = IRREVERSIBLE.exec(block.text);
    if (!m) return null;
    const financial = ctx.isPayment || /\b(wire|transfer|funds|payment)\b/i.test(block.text);
    return {
      severity: financial ? "HIGH" : "MEDIUM",
      reason: financial ? "irreversible funds transfer" : "irreversible action",
      phrase: trimPhrase(sentenceAt(block.text, m.index)),
      statement: cleanStatement(sentenceAt(block.text, m.index)),
      strength: 1,
    };
  },
};

const AGREEMENT_LAPSED =
  /\b(data processing agreement|dpa|contract|nda|baa|agreement|licen[cs]e|certification)\b[^.]{0,60}\b(expired|lapsed|terminated|not signed|unsigned|revoked)\b|\b(expired|lapsed)\b[^.]{0,40}\b(agreement|dpa|contract|licen[cs]e)\b/i;
const REVIEW_PENDING = /\bsecurity review:?\s*(pending|not started|incomplete|outstanding)\b/i;

const compliance: Rule = {
  id: "compliance",
  category: "compliance",
  evaluate(block) {
    const m = AGREEMENT_LAPSED.exec(block.text);
    if (m) {
      return {
        severity: "HIGH",
        reason: "legal agreement has lapsed",
        phrase: trimPhrase(sentenceAt(block.text, m.index)),
        statement: cleanStatement(sentenceAt(block.text, m.index)),
        strength: 1,
      };
    }
    const r = REVIEW_PENDING.exec(block.text);
    if (r) {
      return {
        severity: "MEDIUM",
        reason: "vendor security review incomplete",
        phrase: trimPhrase(r[0]),
        statement: "The vendor security review has not been completed.",
        strength: 1,
      };
    }
    return null;
  },
};

const CREDENTIAL =
  /\b(?:revok|invalidat|rotat|disabl)\w*\b[^.]{0,40}\b(?:credentials?|keys?|tokens?|secrets?|passwords?|sessions?)\b|\b(?:credentials?|keys?|tokens?|secrets?|passwords?|sessions?)\b[^.]{0,40}\b(?:revoked|invalidated|rotated|disabled)\b/i;

const credentialChange: Rule = {
  id: "credential-change",
  category: "credential_change",
  evaluate(block) {
    const m = CREDENTIAL.exec(block.text);
    if (!m || isNegated(block.text, m.index)) return null;
    return {
      severity: "MEDIUM",
      reason: "credentials revoked or rotated",
      phrase: trimPhrase(m[0]),
      statement: cleanStatement(sentenceAt(block.text, m.index)),
      strength: 1,
    };
  },
};

const SCHEMA = /\b(migration|schema change|alter table|drop column|rename column|backfill)\b/i;

const schemaChange: Rule = {
  id: "schema-change",
  category: "schema_change",
  evaluate(block, ctx) {
    const m = SCHEMA.exec(block.text);
    if (!m || !ctx.isProduction || isNegated(block.text, m.index)) return null;
    if (!/\b(schema|database|db|tables?|columns?|sql|postgres(?:ql)?|mysql)\b/i.test(ctx.fullText)) return null;
    if (/\b(?:sso|identity|account|user|plan|cloud|data ?center|email)\s+migration\b/i.test(block.text)) return null;
    return {
      severity: "MEDIUM",
      reason: "production schema migration",
      phrase: trimPhrase(m[0]),
      statement: cleanStatement(sentenceAt(block.text, m.index)),
      strength: 1,
    };
  },
};

const OUTBOUND =
  /\b(?:send|sends|sending|sent|email|emails|emailed|notify|notifies|notified|message|messages|sms|push notifications?)\b[^.]{0,60}?\b(?:\d[\d,]*\s+)?(?:external\s+)?(?:customers?|users?|recipients?|subscribers?|clients?|members?)\b/i;

const externalCommunication: Rule = {
  id: "external-communication",
  category: "external_communication",
  evaluate(block) {
    const m = OUTBOUND.exec(block.text);
    if (!m || isNegated(block.text, m.index)) return null;
    if (/\bnot\s+(?:be\s+)?re-?notified\b/i.test(block.text)) return null;
    return {
      severity: "MEDIUM",
      reason: "external customer communication",
      phrase: trimPhrase(m[0]),
      statement: cleanStatement(sentenceAt(block.text, m.index)),
      strength: 1,
    };
  },
};

const ROUTINE_CUES =
  /\b(will be replaced|replaced|overwrit\w*|returns? 50\d|until|redeploy\w*|restarts?|reconnect\w*|rolls? out|canary|rollback|roll back|served within|stays? (?:active|available)|valid until|takes effect|scheduled)\b/gi;

const routineEffect: Rule = {
  id: "routine-effect",
  category: "routine_effect",
  evaluate(block) {
    const cues = [...block.text.matchAll(ROUTINE_CUES)];
    if (cues.length === 0) return null;
    return {
      severity: "LOW",
      reason: "primary operational effect",
      phrase: trimPhrase(block.text),
      statement: cleanStatement(block.text),
      strength: cues.length,
    };
  },
};

export const RULES: Rule[] = [
  permanentDeletion,
  publicExposure,
  beneficiaryChange,
  sensitiveData,
  dataDeletion,
  serviceOutage,
  writePermission,
  securityControl,
  financialTransfer,
  irreversible,
  compliance,
  credentialChange,
  schemaChange,
  externalCommunication,
  routineEffect,
];

const CATEGORY_PRIORITY = new Map<RiskCategory, number>();
RULES.forEach((rule, i) => {
  if (!CATEGORY_PRIORITY.has(rule.category)) CATEGORY_PRIORITY.set(rule.category, i);
});
export function categoryPriority(category: RiskCategory): number {
  return CATEGORY_PRIORITY.get(category) ?? RULES.length;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function allBlocks(request: ApprovalRequest): ContentBlock[] {
  return [
    { id: "title", kind: "title", text: request.title },
    { id: "summary", kind: "summary", text: request.summary },
    ...request.blocks,
  ];
}

export function buildContext(request: ApprovalRequest): RuleContext {
  const fullText = allBlocks(request)
    .map((b) => b.text)
    .join(" \n ");
  return {
    request,
    fullText,
    isProduction: /\bprod(?:uction)?\b/i.test(`${request.environment} ${fullText}`),
    isExternal: EXTERNAL.test(fullText),
    isPayment:
      /pay|wire|transfer|remit/i.test(request.actionType) ||
      (/\b(?:pay|pays|paying|payment|wire|transfer|remit)\w*\b/i.test(`${request.title} ${request.summary}`) &&
        parseMoney(`${request.title} ${request.summary}`).length > 0),
    amounts: parseMoney(fullText),
  };
}

export interface BlockAssessment {
  block: ContentBlock;
  order: number;
  hits: RuleHit[];
  /** Highest-severity hit (ties broken by rule priority). */
  top: RuleHit | null;
}

export function assessBlocks(request: ApprovalRequest): BlockAssessment[] {
  const ctx = buildContext(request);
  return allBlocks(request).map((block, order) => {
    const byCategory = new Map<RiskCategory, RuleHit>();
    for (const rule of RULES) {
      const hit = rule.evaluate(block, ctx);
      if (!hit) continue;
      const existing = byCategory.get(rule.category);
      if (!existing || RISK_ORDER[hit.severity] > RISK_ORDER[existing.severity]) {
        byCategory.set(rule.category, { ...hit, ruleId: rule.id, category: rule.category });
      }
    }
    const hits = [...byCategory.values()].sort(
      (a, b) =>
        RISK_ORDER[b.severity] - RISK_ORDER[a.severity] ||
        categoryPriority(a.category) - categoryPriority(b.category),
    );
    return { block, order, hits, top: hits[0] ?? null };
  });
}

/** A candidate attention region, independent of whether rules or AI produced it. */
export interface RegionCandidate {
  block: ContentBlock;
  order: number;
  severity: RiskLevel;
  category: RiskCategory;
  reason: string;
  phrase: string;
  statement: string;
  strength: number;
  source: "rules" | "ai";
}

function compareCandidates(a: RegionCandidate, b: RegionCandidate): number {
  return (
    KIND_PREFERENCE[a.block.kind] - KIND_PREFERENCE[b.block.kind] ||
    b.strength - a.strength ||
    a.order - b.order
  );
}

/**
 * Picks the attention targets: blocks at the highest severity present, one
 * per risk category (preferring the plain-language consequence over a raw
 * setting that expresses the same risk), at most MAX_TARGETS (1 for routine
 * requests). Keeping targets few is what keeps OverSight from demanding that
 * users stare at everything.
 */
export function selectTargets(candidates: RegionCandidate[]): RegionCandidate[] {
  let eligible = candidates.filter((c) => TARGET_KINDS.includes(c.block.kind));
  // If the most severe consequence is stated only in the summary (or, failing
  // that, the title or metadata), that block is the decision-critical region;
  // otherwise OverSight would demand attention on a routine line while the real
  // risk sits elsewhere, or have nothing to re-review at all.
  const context = candidates.filter((c) => !TARGET_KINDS.includes(c.block.kind));
  const maxEligible = eligible.reduce((acc, c) => Math.max(acc, RISK_ORDER[c.severity]), -1);
  const maxContext = context.reduce((acc, c) => Math.max(acc, RISK_ORDER[c.severity]), -1);
  if (maxContext > maxEligible && maxContext >= RISK_ORDER.MEDIUM) eligible = [...eligible, ...context];
  if (eligible.length === 0) return [];
  const maxSev = Math.max(...eligible.map((c) => RISK_ORDER[c.severity]));
  const top = eligible.filter((c) => RISK_ORDER[c.severity] === maxSev);
  const byCategory = new Map<RiskCategory, RegionCandidate[]>();
  for (const c of top) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }
  const categories = [...byCategory.keys()].sort((a, b) => categoryPriority(a) - categoryPriority(b));
  const limit = maxSev === RISK_ORDER.LOW ? 1 : MAX_TARGETS;
  const picked: RegionCandidate[] = [];
  for (const category of categories) {
    const best = [...(byCategory.get(category) ?? [])].sort(compareCandidates)[0];
    if (best && !picked.some((p) => p.block.id === best.block.id)) picked.push(best);
    if (picked.length >= limit) break;
  }
  return picked;
}

export function toCriticalRegion(c: RegionCandidate): CriticalRegion {
  return {
    fieldId: c.block.id,
    severity: c.severity,
    category: c.category,
    reason: c.reason,
    phrase: c.phrase,
    statement: c.statement,
    source: c.source,
  };
}

export function riskFromOrder(order: number): RiskLevel {
  return (Object.keys(RISK_ORDER) as RiskLevel[]).find((k) => RISK_ORDER[k] === order) ?? "LOW";
}

export function candidatesFromAssessments(assessments: BlockAssessment[]): RegionCandidate[] {
  const out: RegionCandidate[] = [];
  for (const a of assessments) {
    for (const hit of a.hits) {
      out.push({
        block: a.block,
        order: a.order,
        severity: hit.severity,
        category: hit.category,
        reason: hit.reason,
        phrase: hit.phrase,
        statement: hit.statement,
        strength: hit.strength,
        source: "rules",
      });
    }
  }
  return out;
}

/**
 * Builds a SemanticAnalysis from region candidates. Shared by the rules-only
 * path and the AI-merge path so both select targets identically.
 */
export function composeAnalysis(
  request: ApprovalRequest,
  candidates: RegionCandidate[],
  options: { overallFloor?: RiskLevel; provider: SemanticAnalysis["provider"]; extraRationale?: string },
): SemanticAnalysis {
  let targets = selectTargets(candidates);

  // Routine requests with no rule hits in eligible blocks: fall back to the
  // first consequence so there is still a "key detail" to measure.
  if (targets.length === 0) {
    const firstConsequence = request.blocks.find((b) => b.kind === "consequence" || b.kind === "detail");
    if (firstConsequence) {
      const order = request.blocks.indexOf(firstConsequence) + 2;
      targets = [
        {
          block: firstConsequence,
          order,
          severity: "LOW",
          category: "routine_effect",
          reason: "primary consequence",
          phrase: trimPhrase(firstConsequence.text),
          statement: cleanStatement(firstConsequence.text),
          strength: 0,
          source: "rules",
        },
      ];
    }
  }

  const maxCandidate = candidates.reduce((acc, c) => Math.max(acc, RISK_ORDER[c.severity]), 0);
  const overallOrder = Math.max(
    maxCandidate,
    ...targets.map((t) => RISK_ORDER[t.severity]),
    options.overallFloor ? RISK_ORDER[options.overallFloor] : 0,
  );
  const overallRisk = riskFromOrder(overallOrder);

  const targetIds = new Set(targets.map((t) => t.block.id));
  const notableMap = new Map<string, RegionCandidate>();
  for (const c of candidates) {
    if (targetIds.has(c.block.id) || RISK_ORDER[c.severity] < RISK_ORDER.MEDIUM) continue;
    const existing = notableMap.get(c.block.id);
    if (!existing || RISK_ORDER[c.severity] > RISK_ORDER[existing.severity]) notableMap.set(c.block.id, c);
  }
  const notables = [...notableMap.values()].sort(
    (a, b) => RISK_ORDER[b.severity] - RISK_ORDER[a.severity] || a.order - b.order,
  );

  const reasonFloor = Math.max(RISK_ORDER.MEDIUM, overallOrder - 1);
  const riskReasons = [
    ...new Set(
      [...targets, ...notables]
        .filter((c) => RISK_ORDER[c.severity] >= reasonFloor)
        .sort((a, b) => RISK_ORDER[b.severity] - RISK_ORDER[a.severity])
        .map((c) => c.reason),
    ),
  ];

  const reversible = !candidates.some(
    (c) =>
      (c.category === "data_destruction" && c.severity === "CRITICAL") ||
      c.category === "irreversible" ||
      /cannot be (?:recalled|undone|reversed)|permanently/i.test(c.block.text),
  );

  const consequences = [...targets, ...notables].map((c) => c.statement);
  const rationale = buildRationale(overallRisk, targets, reversible, options.extraRationale);

  return {
    requestId: request.id,
    summary: request.summary || request.title,
    overallRisk,
    riskReasons: riskReasons.length ? riskReasons : ["no high-impact consequences detected"],
    criticalRegions: targets.map(toCriticalRegion),
    notableRegions: notables.map(toCriticalRegion),
    consequences,
    reversible,
    rationale,
    provider: options.provider,
    analyzedAt: Date.now(),
  };
}

function buildRationale(
  risk: RiskLevel,
  targets: RegionCandidate[],
  reversible: boolean,
  extra?: string,
): string {
  if (extra) return extra;
  if (targets.length === 0) return "No decision-critical content identified.";
  if (risk === "LOW") {
    return `Routine operation. Key detail to confirm: ${targets[0].statement}`;
  }
  const count = targets.length === 1 ? "One decision-critical consequence" : `${targets.length} decision-critical consequences`;
  const reasons = targets.map((t) => t.reason).join("; ");
  return `${count}: ${reasons}.${reversible ? "" : " This action cannot be fully undone."}`;
}

/** Deterministic analysis. Pure, synchronous, no network. */
export function analyzeWithRules(request: ApprovalRequest): SemanticAnalysis {
  const assessments = assessBlocks(request);
  return composeAnalysis(request, candidatesFromAssessments(assessments), {
    provider: { kind: "rules" },
  });
}
