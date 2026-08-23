import type { CultDatabase } from "./db.js";
import { audit } from "./audit.js";
import { Cult4Error, id, now, type GateRequirement } from "./domain.js";
import { validateMarketStudyForGate } from "./market.js";

export interface RequireGateInput extends GateRequirement {
  workItemId?: string;
  subjectType: string;
  subjectId: string;
  subjectVersion: string;
  producerActorId?: string;
  expiresAt?: string;
}

export function requireGate(db: CultDatabase, input: RequireGateInput): string {
  const responsibility = db
    .prepare("SELECT id FROM responsibility WHERE slug=?")
    .get(input.responsibility) as { id: string } | undefined;
  const authority = db
    .prepare("SELECT id FROM authority WHERE slug=?")
    .get(input.authority) as { id: string } | undefined;
  if (!responsibility || !authority)
    throw new Cult4Error(
      "Unknown responsibility or authority in policy.",
      "POLICY_CONFIGURATION_ERROR",
    );
  const existing = db
    .prepare(
      `SELECT id FROM gate WHERE responsibility_id=? AND subject_type=? AND subject_id=? AND subject_version=? AND policy_id=? AND policy_version=?`,
    )
    .get(
      responsibility.id,
      input.subjectType,
      input.subjectId,
      input.subjectVersion,
      input.policyId,
      input.policyVersion,
    ) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE gate SET market_study_id=COALESCE(?,market_study_id),expires_at=COALESCE(?,expires_at),status=CASE WHEN status IN ('EXPIRED','INVALIDATED') THEN 'PENDING' ELSE status END,satisfied_by_approval_id=CASE WHEN status IN ('EXPIRED','INVALIDATED') THEN NULL ELSE satisfied_by_approval_id END,created_at=CASE WHEN status IN ('EXPIRED','INVALIDATED') THEN ? ELSE created_at END WHERE id=?",
    ).run(
      input.marketStudyId ?? null,
      input.expiresAt ?? null,
      now(),
      existing.id,
    );
    return existing.id;
  }
  const gateId = id("gate");
  db.transaction(() => {
    db.prepare(
      `INSERT INTO gate(id,work_item_id,responsibility_id,authority_id,subject_type,subject_id,subject_version,policy_id,policy_version,status,human_only,independent,producer_actor_id,created_at,expires_at,repository_id,market_study_id)
    VALUES(?,?,?,?,?,?,?,?,?,'PENDING',?,?,?,?,?,?,?)`,
    ).run(
      gateId,
      input.workItemId ?? null,
      responsibility.id,
      authority.id,
      input.subjectType,
      input.subjectId,
      input.subjectVersion,
      input.policyId,
      input.policyVersion,
      input.humanOnly ? 1 : 0,
      input.independent ? 1 : 0,
      input.producerActorId ?? null,
      now(),
      input.expiresAt ?? null,
      input.repositoryId ?? null,
      input.marketStudyId ?? null,
    );
    audit(db, {
      type: "GATE_REQUIRED",
      actorId: "system",
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectVersion: input.subjectVersion,
      data: {
        gateId,
        policy: `${input.policyId}@${input.policyVersion}`,
        responsibility: input.responsibility,
      },
    });
  })();
  return gateId;
}

export function canActorSatisfy(
  db: CultDatabase,
  gateId: string,
  actorId: string,
  at = now(),
): { ok: boolean; reason?: string; authorityId?: string } {
  const gate = db
    .prepare(
      `SELECT g.*,a.slug authority_slug FROM gate g JOIN authority a ON a.id=g.authority_id WHERE g.id=?`,
    )
    .get(gateId) as Record<string, unknown> | undefined;
  if (!gate) return { ok: false, reason: "GATE_NOT_FOUND" };
  if (!["PENDING", "REQUIRED"].includes(String(gate.status)))
    return { ok: false, reason: "GATE_NOT_PENDING" };
  if (gate.expires_at && String(gate.expires_at) <= at)
    return { ok: false, reason: "GATE_EXPIRED" };
  const actor = db
    .prepare("SELECT kind,status FROM actor WHERE id=?")
    .get(actorId) as { kind: string; status: string } | undefined;
  if (!actor || actor.status !== "ACTIVE")
    return { ok: false, reason: "ACTOR_NOT_ACTIVE" };
  if (Number(gate.human_only) && actor.kind !== "HUMAN")
    return { ok: false, reason: "HUMAN_REQUIRED" };
  if (Number(gate.independent) && gate.producer_actor_id === actorId)
    return { ok: false, reason: "SELF_REVIEW_FORBIDDEN" };
  const owned = db
    .prepare(
      "SELECT 1 FROM responsibility_owner WHERE responsibility_id=? AND actor_id=? AND active=1 AND (business_id IS NULL OR business_id=(SELECT business_id FROM work_item WHERE id=?))",
    )
    .get(gate.responsibility_id, actorId, gate.work_item_id);
  if (!owned) return { ok: false, reason: "RESPONSIBILITY_NOT_OWNED" };
  const authorization = db
    .prepare(
      "SELECT authority_id FROM actor_authority WHERE actor_id=? AND authority_id=? AND active=1 AND (business_id IS NULL OR business_id=(SELECT business_id FROM work_item WHERE id=?))",
    )
    .get(actorId, gate.authority_id, gate.work_item_id) as
    { authority_id: string } | undefined;
  return authorization
    ? { ok: true, authorityId: authorization.authority_id }
    : { ok: false, reason: "AUTHORITY_MISSING" };
}

export function grantApproval(
  db: CultDatabase,
  gateId: string,
  actorId: string,
  notes?: string,
  expiresAt?: string,
): string {
  const permission = canActorSatisfy(db, gateId, actorId);
  if (!permission.ok || !permission.authorityId)
    throw new Cult4Error(
      `Actor cannot satisfy gate: ${permission.reason}`,
      permission.reason ?? "APPROVAL_DENIED",
    );
  const gate = db
    .prepare("SELECT * FROM gate WHERE id=?")
    .get(gateId) as Record<string, unknown>;
  if (
    gate.policy_id === "MARKET_RELEVANCE_REQUIRED" &&
    !validateMarketStudyForGate(
      db,
      gate.market_study_id ? String(gate.market_study_id) : undefined,
    )
  )
    throw new Cult4Error(
      "Market relevance requires a current structurally complete MarketStudy.",
      "MARKET_RELEVANCE_UNSATISFIED",
    );
  const approvalId = id("approval");
  db.transaction(() => {
    db.prepare(
      `INSERT INTO approval(id,gate_id,actor_id,authority_id,subject_type,subject_id,subject_version,decision,notes,created_at,expires_at,policy_id,policy_version,repository_id) VALUES(?,?,?,?,?,?,?,'APPROVE',?,?,?,?,?,?)`,
    ).run(
      approvalId,
      gateId,
      actorId,
      permission.authorityId,
      gate.subject_type,
      gate.subject_id,
      gate.subject_version,
      notes ?? null,
      now(),
      expiresAt ?? null,
      gate.policy_id,
      gate.policy_version,
      gate.repository_id ?? null,
    );
    db.prepare(
      "UPDATE gate SET status='SATISFIED',satisfied_by_approval_id=? WHERE id=?",
    ).run(approvalId, gateId);
    audit(db, {
      type: "APPROVAL_GRANTED",
      actorId,
      subjectType: String(gate.subject_type),
      subjectId: String(gate.subject_id),
      subjectVersion: String(gate.subject_version),
      data: {
        gateId,
        approvalId,
        policy: `${gate.policy_id}@${gate.policy_version}`,
      },
    });
  })();
  return approvalId;
}

export function rejectGate(
  db: CultDatabase,
  gateId: string,
  actorId: string,
  notes?: string,
): string {
  const permission = canActorSatisfy(db, gateId, actorId);
  if (!permission.ok || !permission.authorityId)
    throw new Cult4Error(
      `Actor cannot reject gate: ${permission.reason}`,
      permission.reason ?? "APPROVAL_DENIED",
    );
  const gate = db
    .prepare("SELECT * FROM gate WHERE id=?")
    .get(gateId) as Record<string, unknown>;
  const approvalId = id("approval");
  db.transaction(() => {
    db.prepare(
      `INSERT INTO approval(id,gate_id,actor_id,authority_id,subject_type,subject_id,subject_version,decision,notes,created_at,policy_id,policy_version,repository_id) VALUES(?,?,?,?,?,?,?,'REJECT',?,?,?,?,?)`,
    ).run(
      approvalId,
      gateId,
      actorId,
      permission.authorityId,
      gate.subject_type,
      gate.subject_id,
      gate.subject_version,
      notes ?? null,
      now(),
      gate.policy_id,
      gate.policy_version,
      gate.repository_id ?? null,
    );
    db.prepare(
      "UPDATE gate SET status='REJECTED',satisfied_by_approval_id=NULL WHERE id=?",
    ).run(gateId);
    audit(db, {
      type: "APPROVAL_REJECTED",
      actorId,
      subjectType: String(gate.subject_type),
      subjectId: String(gate.subject_id),
      subjectVersion: String(gate.subject_version),
      data: { gateId, approvalId },
    });
  })();
  return approvalId;
}

export function validateApproval(
  db: CultDatabase,
  gateId: string,
  subjectVersion: string,
  at = now(),
): boolean {
  const row = db
    .prepare(
      `SELECT g.status,g.subject_version,g.repository_id,g.expires_at,g.policy_id,g.market_study_id,a.expires_at approval_expires,a.subject_version approval_version,a.repository_id approval_repository_id,a.decision
    FROM gate g LEFT JOIN approval a ON a.id=g.satisfied_by_approval_id WHERE g.id=?`,
    )
    .get(gateId) as Record<string, unknown> | undefined;
  if (
    !row ||
    row.status !== "SATISFIED" ||
    row.decision !== "APPROVE" ||
    row.subject_version !== subjectVersion ||
    row.approval_version !== subjectVersion ||
    row.repository_id !== row.approval_repository_id
  )
    return false;
  return (
    !(row.expires_at && String(row.expires_at) <= at) &&
    !(row.approval_expires && String(row.approval_expires) <= at) &&
    (row.policy_id !== "MARKET_RELEVANCE_REQUIRED" ||
      validateMarketStudyForGate(
        db,
        row.market_study_id ? String(row.market_study_id) : undefined,
      ))
  );
}

export function invalidateSubjectApprovals(
  db: CultDatabase,
  subjectType: string,
  subjectId: string,
  currentVersion: string,
): number {
  const rows = db
    .prepare(
      "SELECT id,subject_version FROM gate WHERE subject_type=? AND subject_id=? AND subject_version<>? AND status='SATISFIED'",
    )
    .all(subjectType, subjectId, currentVersion) as Array<{
    id: string;
    subject_version: string;
  }>;
  db.transaction(() => {
    for (const row of rows) {
      db.prepare(
        "UPDATE gate SET status='INVALIDATED',satisfied_by_approval_id=NULL WHERE id=?",
      ).run(row.id);
      audit(db, {
        type: "APPROVAL_INVALIDATED",
        actorId: "system",
        subjectType,
        subjectId,
        subjectVersion: row.subject_version,
        data: { gateId: row.id, newVersion: currentVersion },
      });
    }
  })();
  return rows.length;
}

export function expireApprovals(db: CultDatabase, at = now()): number {
  const rows = db
    .prepare(
      `SELECT DISTINCT g.id FROM gate g JOIN approval a ON a.id=g.satisfied_by_approval_id WHERE g.status='SATISFIED' AND ((a.expires_at IS NOT NULL AND a.expires_at<=?) OR (g.expires_at IS NOT NULL AND g.expires_at<=?))`,
    )
    .all(at, at) as Array<{ id: string }>;
  db.transaction(() => {
    for (const row of rows)
      db.prepare(
        "UPDATE gate SET status='EXPIRED',satisfied_by_approval_id=NULL WHERE id=?",
      ).run(row.id);
  })();
  return rows.length;
}
