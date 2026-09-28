/** Version of the app, recorded with collected data (keep in sync with package.json). */
export const APP_VERSION = "0.2.0";

/**
 * Version of the deterministic decision policy (thresholds, trust fusion,
 * pattern rules). Recorded with collected data so an evaluation can tell which
 * policy produced the stored decisions; bump it when decisions can change.
 */
export const POLICY_VERSION = "2.0";
