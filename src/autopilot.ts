import type { CultDatabase } from "./db.js";

export type AutopilotRequest = {
  maxDurationMinutes: number;
  maxWorkItems: number;
  maxCostCents: number;
};

export function resumableAutopilotRequest(
  db: CultDatabase,
  businessId: string,
): AutopilotRequest | undefined {
  const lifecycle = db
    .prepare(
      `SELECT type,data_json FROM audit_event
       WHERE business_id=? AND type IN (
         'BUSINESS_AUTOPILOT_HANDOFF_REQUESTED',
         'BUSINESS_AUTOPILOT_COMPLETED',
         'BUSINESS_AUTOPILOT_INTERVENED'
       ) ORDER BY id DESC LIMIT 1`,
    )
    .get(businessId) as { type: string; data_json: string } | undefined;
  if (lifecycle?.type !== "BUSINESS_AUTOPILOT_HANDOFF_REQUESTED")
    return undefined;
  const limits = JSON.parse(lifecycle.data_json) as Partial<AutopilotRequest>;
  if (
    !Number.isInteger(limits.maxDurationMinutes) ||
    !Number.isInteger(limits.maxWorkItems) ||
    !Number.isInteger(limits.maxCostCents)
  )
    return undefined;
  return limits as AutopilotRequest;
}
