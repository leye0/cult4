import type { CultDatabase } from "./db.js";
import { Cult4Error, id, now } from "./domain.js";
import { audit } from "./audit.js";

type ScopeType = "organization" | "employee" | "business" | "employee_business";
type MemoryKind =
  | "observation"
  | "hypothesis"
  | "verified_fact"
  | "external_evidence"
  | "procedure"
  | "postmortem"
  | "decision"
  | "warning";
export interface RememberInput {
  scopeType: ScopeType;
  scopeId: string;
  kind: MemoryKind;
  title: string;
  content: string;
  sourceRef?: string;
  confidence?: number;
  createdBy: string;
  lastVerifiedAt?: string;
  expiresAt?: string;
}
function enforceScope(input: RememberInput): void {
  if (input.scopeType === "organization" && input.kind === "verified_fact")
    throw new Cult4Error(
      "Organization verified facts require knowledge promotion.",
      "KNOWLEDGE_PROMOTION_REQUIRED",
    );
  if (
    ["verified_fact", "external_evidence"].includes(input.kind) &&
    !input.sourceRef
  )
    throw new Cult4Error(
      "Provenance is required for verified knowledge.",
      "MEMORY_PROVENANCE_REQUIRED",
    );
  if (input.kind === "verified_fact" && !input.lastVerifiedAt)
    throw new Cult4Error(
      "Verified facts require verification time.",
      "MEMORY_VERIFICATION_REQUIRED",
    );
}
export function remember(db: CultDatabase, input: RememberInput): string {
  enforceScope(input);
  const memoryId = id("memory");
  db.prepare(
    `INSERT INTO memory(id,scope_type,scope_id,kind,title,content,source_ref,confidence,status,created_by,created_at,last_verified_at,expires_at) VALUES(?,?,?,?,?,?,?,?,'active',?,?,?,?)`,
  ).run(
    memoryId,
    input.scopeType,
    input.scopeId,
    input.kind,
    input.title,
    input.content,
    input.sourceRef ?? null,
    input.confidence ?? null,
    input.createdBy,
    now(),
    input.lastVerifiedAt ?? null,
    input.expiresAt ?? null,
  );
  return memoryId;
}
export interface MemoryContext {
  employeeId: string;
  businessId: string;
}
export function searchMemory(
  db: CultDatabase,
  query: string,
  context: MemoryContext,
  limit = 10,
): unknown[] {
  if (!query.trim()) return [];
  return db
    .prepare(
      `SELECT m.*,CASE WHEN m.expires_at IS NOT NULL AND m.expires_at<=? THEN 1 ELSE 0 END stale,bm25(memory_fts) fts_rank,CASE m.scope_type WHEN 'employee_business' THEN 4 WHEN 'business' THEN 3 WHEN 'employee' THEN 2 ELSE 1 END scope_rank
  FROM memory_fts JOIN memory m ON m.id=memory_fts.memory_id WHERE memory_fts MATCH ? AND m.status IN ('active','revalidate') AND ((m.scope_type='organization' AND m.scope_id='organization') OR (m.scope_type='employee' AND m.scope_id=?) OR (m.scope_type='business' AND m.scope_id=?) OR (m.scope_type='employee_business' AND m.scope_id=?)) ORDER BY stale,CASE m.status WHEN 'active' THEN 0 ELSE 1 END,CASE m.kind WHEN 'verified_fact' THEN 0 WHEN 'warning' THEN 1 WHEN 'external_evidence' THEN 2 ELSE 3 END,CASE WHEN m.expires_at IS NULL THEN 1 ELSE 0 END,m.last_verified_at DESC,fts_rank,scope_rank DESC LIMIT ?`,
    )
    .all(
      now(),
      query,
      context.employeeId,
      context.businessId,
      `${context.employeeId}:${context.businessId}`,
      limit,
    );
}
export function supersedeMemory(
  db: CultDatabase,
  oldId: string,
  input: RememberInput,
): string {
  const old = db
    .prepare("SELECT * FROM memory WHERE id=? AND status='active'")
    .get(oldId);
  if (!old)
    throw new Cult4Error("Active memory not found.", "MEMORY_NOT_FOUND");
  const newId = remember(db, input);
  db.transaction(() => {
    db.prepare("UPDATE memory SET status='superseded' WHERE id=?").run(oldId);
    db.prepare("UPDATE memory SET supersedes_id=? WHERE id=?").run(
      oldId,
      newId,
    );
  })();
  return newId;
}
export function verifyMemory(
  db: CultDatabase,
  memoryId: string,
  sourceRef: string,
): void {
  if (!sourceRef)
    throw new Cult4Error(
      "Verification requires provenance.",
      "MEMORY_PROVENANCE_REQUIRED",
    );
  const result = db
    .prepare(
      "UPDATE memory SET kind='verified_fact',source_ref=?,last_verified_at=?,status='active' WHERE id=? AND scope_type<>'organization'",
    )
    .run(sourceRef, now(), memoryId);
  if (!result.changes)
    throw new Cult4Error(
      "Memory cannot be directly verified in this scope.",
      "MEMORY_VERIFICATION_DENIED",
    );
}
export function proposePromotion(
  db: CultDatabase,
  sourceMemoryId: string,
  proposedBy: string,
  rationale: string,
): string {
  const source = db
    .prepare("SELECT scope_type FROM memory WHERE id=? AND status='active'")
    .get(sourceMemoryId) as { scope_type: string } | undefined;
  if (!source || source.scope_type === "organization")
    throw new Cult4Error(
      "Only active local memory can be promoted.",
      "PROMOTION_INVALID_SOURCE",
    );
  const promotionId = id("promotion");
  db.prepare(
    "INSERT INTO knowledge_promotion(id,source_memory_id,proposed_by,status,rationale,created_at) VALUES(?,?,?,'PROPOSED',?,?)",
  ).run(promotionId, sourceMemoryId, proposedBy, rationale, now());
  return promotionId;
}
export function approvePromotion(
  db: CultDatabase,
  promotionId: string,
  reviewedBy: string,
): string {
  const promotion = db
    .prepare(
      `SELECT kp.*,m.* FROM knowledge_promotion kp JOIN memory m ON m.id=kp.source_memory_id WHERE kp.id=? AND kp.status='PROPOSED'`,
    )
    .get(promotionId) as Record<string, unknown> | undefined;
  if (!promotion)
    throw new Cult4Error("Promotion not found.", "PROMOTION_NOT_FOUND");
  if (promotion.proposed_by === reviewedBy)
    throw new Cult4Error(
      "Independent promotion review required.",
      "SELF_REVIEW_FORBIDDEN",
    );
  const promotedId = id("memory");
  db.transaction(() => {
    db.prepare(
      `INSERT INTO memory(id,scope_type,scope_id,kind,title,content,source_ref,confidence,status,supersedes_id,created_by,created_at,last_verified_at) VALUES(?,'organization','organization',?,?,?,?,?,'active',?,?,?,?)`,
    ).run(
      promotedId,
      promotion.kind,
      promotion.title,
      promotion.content,
      `promotion:${promotion.source_memory_id};${String(promotion.source_ref ?? "")}`,
      promotion.confidence ?? null,
      promotion.source_memory_id,
      reviewedBy,
      now(),
      promotion.last_verified_at ?? null,
    );
    db.prepare(
      "UPDATE knowledge_promotion SET promoted_memory_id=?,reviewed_by=?,status='APPROVED',resolved_at=? WHERE id=?",
    ).run(promotedId, reviewedBy, now(), promotionId);
    audit(db, {
      type: "KNOWLEDGE_PROMOTED",
      actorId: reviewedBy,
      subjectType: "MEMORY",
      subjectId: promotedId,
      data: { sourceMemoryId: promotion.source_memory_id, promotionId },
    });
  })();
  return promotedId;
}
