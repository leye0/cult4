import type { CultDatabase } from "./db.js";
import { audit } from "./audit.js";
import { Cult4Error, id, now } from "./domain.js";

export function configureBusinessFinancialThresholds(
  db: CultDatabase,
  input: {
    businessId: string;
    currency: string;
    autoMax: number;
    treasurerMax: number;
    createdBy: string;
  },
): string {
  if (
    !Number.isInteger(input.autoMax) ||
    !Number.isInteger(input.treasurerMax) ||
    input.autoMax < 0 ||
    input.treasurerMax < input.autoMax
  )
    throw new Cult4Error(
      "Invalid financial thresholds.",
      "INVALID_FINANCIAL_THRESHOLDS",
    );
  const foundation = db
    .prepare(
      "SELECT auto_max,treasurer_max FROM financial_threshold WHERE scope_type='ORGANIZATION' AND scope_id='organization' AND currency=? AND active=1 ORDER BY version DESC LIMIT 1",
    )
    .get(input.currency) as
    { auto_max: number; treasurer_max: number } | undefined;
  if (!foundation)
    throw new Cult4Error(
      "No Foundation financial threshold for currency.",
      "FINANCIAL_THRESHOLD_MISSING",
    );
  if (
    input.autoMax > foundation.auto_max ||
    input.treasurerMax > foundation.treasurer_max
  )
    throw new Cult4Error(
      "Business thresholds may be stricter, never more permissive than Foundation.",
      "POLICY_WEAKENING_FORBIDDEN",
    );
  const version =
    ((
      db
        .prepare(
          "SELECT max(version) version FROM financial_threshold WHERE scope_type='BUSINESS' AND scope_id=? AND currency=?",
        )
        .get(input.businessId, input.currency) as { version: number | null }
    ).version ?? 0) + 1;
  const thresholdId = id("threshold");
  db.transaction(() => {
    db.prepare(
      "UPDATE financial_threshold SET active=0 WHERE scope_type='BUSINESS' AND scope_id=? AND currency=? AND active=1",
    ).run(input.businessId, input.currency);
    db.prepare(
      "INSERT INTO financial_threshold(id,scope_type,scope_id,currency,auto_max,treasurer_max,version,active,created_by,created_at) VALUES(?,'BUSINESS',?,?,?,?,?,1,?,?)",
    ).run(
      thresholdId,
      input.businessId,
      input.currency,
      input.autoMax,
      input.treasurerMax,
      version,
      input.createdBy,
      now(),
    );
    audit(db, {
      type: "FINANCIAL_THRESHOLD_CHANGED",
      actorId: input.createdBy,
      businessId: input.businessId,
      subjectType: "FINANCIAL_THRESHOLD",
      subjectId: thresholdId,
      subjectVersion: String(version),
      data: {
        currency: input.currency,
        autoMax: input.autoMax,
        treasurerMax: input.treasurerMax,
      },
    });
  })();
  return thresholdId;
}
