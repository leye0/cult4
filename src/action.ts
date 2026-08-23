import type { CultDatabase } from "./db.js";
import { audit } from "./audit.js";
import { Cult4Error, id, type ActionIntent } from "./domain.js";
import { evaluateAction } from "./policy.js";

export interface ExternalActionResult {
  externalReference: string;
  data?: Record<string, unknown>;
}
export interface ExternalActionAdapter {
  execute(
    intent: ActionIntent,
    idempotencyKey: string,
  ): Promise<ExternalActionResult>;
}

export async function executeAuthorizedAction(
  db: CultDatabase,
  intent: ActionIntent,
  adapter: ExternalActionAdapter,
  idempotencyKey = id("action-key"),
): Promise<ExternalActionResult> {
  const decision = evaluateAction(db, intent, true);
  if (!decision.allowed)
    throw new Cult4Error(
      `Sensitive action is ${decision.outcome}.`,
      decision.outcome === "DENY" ? "ACTION_DENIED" : "ACTION_BLOCKED",
      decision,
    );
  const result = await adapter.execute(intent, idempotencyKey);
  if (!result.externalReference)
    throw new Cult4Error(
      "Adapter did not return an external reference; state remains unchanged.",
      "ADAPTER_RESULT_INVALID",
    );
  db.transaction(() => {
    if (
      intent.actionType === "PUBLISH_PRODUCT" &&
      intent.subjectType === "PRODUCT_VERSION"
    ) {
      const changed = db
        .prepare(
          "UPDATE product_version SET status='RELEASED' WHERE id=? AND content_hash=? AND status IN ('DRAFT','VALIDATING','READY')",
        )
        .run(intent.subjectId, intent.subjectVersion);
      if (!changed.changes)
        throw new Cult4Error(
          "Exact product version is not releasable.",
          "SUBJECT_VERSION_MISMATCH",
        );
      audit(db, {
        type: "PRODUCT_RELEASED",
        actorId: intent.actorId,
        businessId: intent.businessId,
        subjectType: intent.subjectType,
        subjectId: intent.subjectId,
        subjectVersion: intent.subjectVersion,
        data: {
          externalReference: result.externalReference,
          idempotencyKey,
          policies: decision.applicablePolicies,
        },
      });
    } else
      audit(db, {
        type:
          intent.actionType === "FOUNDATION_CHANGE"
            ? "FOUNDATION_CHANGE"
            : "SENSITIVE_ACTION_EXECUTED",
        actorId: intent.actorId,
        businessId: intent.businessId,
        subjectType: intent.subjectType,
        subjectId: intent.subjectId,
        subjectVersion: intent.subjectVersion,
        data: {
          actionType: intent.actionType,
          externalReference: result.externalReference,
          idempotencyKey,
          policies: decision.applicablePolicies,
        },
      });
  })();
  return result;
}
