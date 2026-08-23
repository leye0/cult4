import type { CultDatabase } from "./db.js";
import { json, now } from "./domain.js";

export interface AuditInput {
  type: string;
  actorId?: string;
  businessId?: string;
  subjectType?: string;
  subjectId?: string;
  subjectVersion?: string;
  data?: unknown;
}

export function audit(db: CultDatabase, input: AuditInput): number {
  const result = db
    .prepare(
      `INSERT INTO audit_event(type,actor_id,business_id,subject_type,subject_id,subject_version,data_json,created_at)
    VALUES(@type,@actorId,@businessId,@subjectType,@subjectId,@subjectVersion,@data,@createdAt)`,
    )
    .run({
      type: input.type,
      actorId: input.actorId ?? null,
      businessId: input.businessId ?? null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      subjectVersion: input.subjectVersion ?? null,
      data: json(input.data),
      createdAt: now(),
    });
  return Number(result.lastInsertRowid);
}
