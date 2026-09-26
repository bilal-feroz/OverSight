/**
 * Turns free-form approval text (pasted from an agent, a ticket, a PR) into
 * a structured ApprovalRequest with stable block ids, so the same semantic
 * analysis and attention measurement apply to custom requests.
 */
import type { ApprovalRequest, ContentBlock } from "@/types/approval";
import { uid } from "@/lib/utils";

export interface CustomRequestInput {
  title?: string;
  agentName?: string;
  actionType?: string;
  environment?: string;
  body: string;
}

const BULLET = /^\s*(?:[-*•▪◦]|\d+[.)])\s+/;
const CHANGE_LINE = /^\s*([\w .\-/]{2,40}):\s*(.+?)\s*(?:→|->|=>)\s*(.+)$/;
const CONSEQUENCE_CUE =
  /\b(will|would|cannot|can't|permanently|delete|grant|expose|transfer|send|revoke|fail|irreversibl\w*|warning|expired?)\b/i;

/** Splits prose into sentences without breaking on decimals or version numbers. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseCustomRequest(input: CustomRequestInput): ApprovalRequest {
  const lines = input.body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let title = input.title?.trim() ?? "";
  if (!title && lines.length > 0 && lines[0].length <= 90 && !/[.!?]$/.test(lines[0])) {
    title = lines.shift() ?? "";
  }
  if (!title) title = "Custom approval request";

  const blocks: ContentBlock[] = [];
  let summary = "";
  let detailIndex = 0;
  let changeIndex = 0;

  for (const line of lines) {
    const change = CHANGE_LINE.exec(line.replace(BULLET, ""));
    if (change) {
      changeIndex += 1;
      const [, label, from, to] = change;
      blocks.push({
        id: `chg-${changeIndex}`,
        kind: "change",
        label: label.trim(),
        from: from.trim(),
        to: to.trim(),
        text: `${label.trim()}: ${from.trim()} → ${to.trim()}`,
      });
      continue;
    }
    const isBullet = BULLET.test(line);
    const content = line.replace(BULLET, "");
    const sentences = isBullet ? [content] : splitSentences(content);
    for (const sentence of sentences) {
      if (!summary && !isBullet) {
        summary = sentence;
        continue;
      }
      detailIndex += 1;
      blocks.push({
        id: `detail-${detailIndex}`,
        kind: CONSEQUENCE_CUE.test(sentence) ? "consequence" : "detail",
        text: sentence,
      });
    }
  }

  if (!summary) {
    const first = blocks.find((b) => b.kind !== "change");
    summary = first ? first.text : title;
    if (first) blocks.splice(blocks.indexOf(first), 1);
  }

  return {
    id: uid("custom"),
    source: "custom",
    agent: {
      name: input.agentName?.trim() || "External agent",
      handle: (input.agentName?.trim() || "external-agent").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    },
    actionType: input.actionType?.trim() || "custom.action",
    environment: input.environment?.trim() || "unspecified",
    title,
    summary,
    blocks,
    requestedAgo: "just now",
  };
}

export const CUSTOM_EXAMPLES: Array<{ label: string; input: CustomRequestInput }> = [
  {
    label: "S3 bucket policy",
    input: {
      title: "Update storage bucket policy for partner uploads",
      agentName: "Storage Agent",
      actionType: "storage.bucket.policy.update",
      environment: "production",
      body: [
        "Allow the logistics partner to upload delivery manifests directly.",
        "- Bucket: acme-prod-exports",
        "- Policy: s3:PutObject for partner role",
        "- The policy also sets the bucket to publicly readable so the partner portal can list files.",
        "- Existing lifecycle rules are unchanged.",
      ].join("\n"),
    },
  },
  {
    label: "MFA exception",
    input: {
      title: "Disable MFA for contractor accounts",
      agentName: "Identity Agent",
      actionType: "iam.policy.exception",
      environment: "production",
      body: [
        "Temporarily disable multi-factor authentication for 12 contractor accounts to unblock the SSO migration.",
        "- Accounts can sign in with a password only until MFA is re-enabled.",
        "- The exception is logged in the IAM change history.",
      ].join("\n"),
    },
  },
  {
    label: "Refund batch",
    input: {
      title: "Issue refund batch for delayed orders",
      agentName: "Support Agent",
      actionType: "payments.refund.batch",
      environment: "production",
      body: [
        "Refund 212 orders delayed by the carrier outage.",
        "- Total: USD 18,440",
        "- Refunds are sent to the original payment method.",
        "- Refunds cannot be reversed once processed by the card network.",
        "- Customers receive an automated apology email.",
      ].join("\n"),
    },
  },
];
