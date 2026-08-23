import type { CultDatabase } from "./db.js";
import { audit } from "./audit.js";
import { Cult4Error, id, now, json } from "./domain.js";
import { grantApproval, rejectGate } from "./approval.js";

export interface HumanRequestInput {
  businessId?: string;
  workItemId?: string;
  gateId?: string;
  type:
    | "APPROVAL"
    | "DECISION"
    | "INFORMATION"
    | "PHYSICAL_ACTION"
    | "IDENTITY_VERIFICATION"
    | "AESTHETIC_REVIEW"
    | "LEGAL_REVIEW"
    | "PHYSICAL_INSPECTION"
    | "CULTURAL_JUDGMENT"
    | "LOCAL_LANGUAGE_JUDGMENT"
    | "BRAND_RISK_JUDGMENT";
  requestedResponsibility?: string;
  subjectType: string;
  subjectId: string;
  subjectVersion: string;
  title: string;
  context: string;
  recommendation?: string;
  options?: unknown;
  remindAt?: string;
  expiresAt?: string;
}
export function createHumanRequest(
  db: CultDatabase,
  input: HumanRequestInput,
): string {
  const requestId = id("human");
  db.transaction(() => {
    db.prepare(
      `INSERT INTO human_request(id,business_id,work_item_id,gate_id,type,requested_responsibility,subject_type,subject_id,subject_version,title,context,recommendation,options_json,status,requested_at,remind_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',?,?,?)`,
    ).run(
      requestId,
      input.businessId ?? null,
      input.workItemId ?? null,
      input.gateId ?? null,
      input.type,
      input.requestedResponsibility ?? null,
      input.subjectType,
      input.subjectId,
      input.subjectVersion,
      input.title,
      input.context,
      input.recommendation ?? null,
      input.options === undefined ? null : json(input.options),
      now(),
      input.remindAt ?? null,
      input.expiresAt ?? null,
    );
    if (input.workItemId)
      db.prepare(
        "UPDATE work_item SET status='WAITING_HUMAN',updated_at=? WHERE id=? AND status IN ('READY','RUNNING','WAITING_GATE')",
      ).run(now(), input.workItemId);
    audit(db, {
      type: "HUMAN_REQUEST_CREATED",
      actorId: "system",
      businessId: input.businessId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectVersion: input.subjectVersion,
      data: { requestId, gateId: input.gateId, type: input.type },
    });
  })();
  return requestId;
}
export function listPendingHumanRequests(db: CultDatabase): unknown[] {
  return db
    .prepare(
      "SELECT * FROM human_request WHERE status IN ('PENDING','REMINDER_DUE','OVERDUE') ORDER BY requested_at",
    )
    .all();
}
export function getHumanRequest(db: CultDatabase, requestId: string): unknown {
  const row = db
    .prepare("SELECT * FROM human_request WHERE id=?")
    .get(requestId);
  if (!row)
    throw new Cult4Error("Human request not found.", "HUMAN_REQUEST_NOT_FOUND");
  return row;
}
export function resolveHumanRequest(
  db: CultDatabase,
  requestId: string,
  actorId: string,
  approve: boolean,
  notes?: string,
): void {
  const request = db
    .prepare("SELECT * FROM human_request WHERE id=?")
    .get(requestId) as Record<string, unknown> | undefined;
  if (!request)
    throw new Cult4Error("Human request not found.", "HUMAN_REQUEST_NOT_FOUND");
  if (!["PENDING", "REMINDER_DUE", "OVERDUE"].includes(String(request.status)))
    throw new Cult4Error(
      "Human request is not pending.",
      "HUMAN_REQUEST_NOT_PENDING",
    );
  if (request.expires_at && String(request.expires_at) <= now())
    throw new Cult4Error(
      "Human request expired; create a new request.",
      "HUMAN_REQUEST_EXPIRED",
    );
  db.transaction(() => {
    if (request.gate_id) {
      if (approve) grantApproval(db, String(request.gate_id), actorId, notes);
      else {
        rejectGate(db, String(request.gate_id), actorId, notes);
        db.prepare(
          "UPDATE spend_request SET status='DENIED',updated_at=? WHERE gate_id=? AND status='WAITING_APPROVAL'",
        ).run(now(), request.gate_id);
      }
    }
    db.prepare(
      "UPDATE human_request SET status=?,resolved_at=?,resolved_by=? WHERE id=?",
    ).run(approve ? "RESOLVED" : "REJECTED", now(), actorId, requestId);
    audit(db, {
      type: "HUMAN_REQUEST_RESOLVED",
      actorId,
      businessId: request.business_id ? String(request.business_id) : undefined,
      subjectType: String(request.subject_type),
      subjectId: String(request.subject_id),
      subjectVersion: String(request.subject_version),
      data: { requestId, decision: approve ? "APPROVE" : "REJECT", notes },
    });
  })();
}
export function cancelHumanRequest(db: CultDatabase, requestId: string): void {
  const result = db
    .prepare(
      "UPDATE human_request SET status='CANCELLED',resolved_at=? WHERE id=? AND status IN ('PENDING','REMINDER_DUE','OVERDUE')",
    )
    .run(now(), requestId);
  if (!result.changes)
    throw new Cult4Error(
      "Human request is not pending.",
      "HUMAN_REQUEST_NOT_PENDING",
    );
}
export function processHumanRequestTimers(
  db: CultDatabase,
  at = now(),
): { reminded: number; overdue: number; expired: number } {
  const expired = db
    .prepare(
      "UPDATE human_request SET status='EXPIRED',resolved_at=? WHERE status IN ('PENDING','REMINDER_DUE','OVERDUE') AND expires_at IS NOT NULL AND expires_at<=?",
    )
    .run(at, at).changes;
  const overdue = db
    .prepare(
      "UPDATE human_request SET status='OVERDUE' WHERE status='REMINDER_DUE' AND remind_at IS NOT NULL AND remind_at<=? AND (expires_at IS NULL OR expires_at>?)",
    )
    .run(at, at).changes;
  const reminded = db
    .prepare(
      "UPDATE human_request SET status='REMINDER_DUE' WHERE status='PENDING' AND remind_at IS NOT NULL AND remind_at<=? AND (expires_at IS NULL OR expires_at>?)",
    )
    .run(at, at).changes;
  return { reminded, overdue, expired };
}
