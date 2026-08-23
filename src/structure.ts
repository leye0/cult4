import type { CultDatabase } from "./db.js";
import { id, now } from "./domain.js";
export function createService(
  db: CultDatabase,
  input: { businessId: string; name: string; description: string },
): string {
  const value = id("service");
  db.prepare(
    "INSERT INTO service(id,business_id,name,description,status,created_at) VALUES(?,?,?,?,'ACTIVE',?)",
  ).run(value, input.businessId, input.name, input.description, now());
  return value;
}
export function createObjective(
  db: CultDatabase,
  input: {
    businessId: string;
    title: string;
    outcome: string;
    createdBy: string;
    targetDate?: string;
  },
): string {
  const value = id("objective");
  db.prepare(
    "INSERT INTO objective(id,business_id,title,outcome,status,target_date,created_by,created_at) VALUES(?,?,?,?, 'ACTIVE',?,?,?)",
  ).run(
    value,
    input.businessId,
    input.title,
    input.outcome,
    input.targetDate ?? null,
    input.createdBy,
    now(),
  );
  return value;
}
export function createCustomerSegment(
  db: CultDatabase,
  input: { businessId: string; name: string; definition: string },
): string {
  const value = id("segment");
  db.transaction(() => {
    db.prepare(
      "INSERT INTO customer_segment(id,business_id,name,definition,status,created_at) VALUES(?,?,?,?,'ACTIVE',?)",
    ).run(value, input.businessId, input.name, input.definition, now());
    db.prepare(
      "INSERT INTO business_segment(business_id,segment_id) VALUES(?,?)",
    ).run(input.businessId, value);
  })();
  return value;
}
export function createChannel(
  db: CultDatabase,
  input: { businessId: string; name: string; kind: string },
): string {
  const value = id("channel");
  db.transaction(() => {
    db.prepare(
      "INSERT INTO channel(id,business_id,name,kind,status,created_at) VALUES(?,?,?,?,'ACTIVE',?)",
    ).run(value, input.businessId, input.name, input.kind, now());
    db.prepare(
      "INSERT INTO business_channel(business_id,channel_id) VALUES(?,?)",
    ).run(input.businessId, value);
  })();
  return value;
}
export function recordRisk(
  db: CultDatabase,
  input: {
    businessId: string;
    description: string;
    severity: string;
    likelihood: string;
    ownerId?: string;
    mitigation?: string;
    subjectType?: string;
    subjectId?: string;
  },
): string {
  const value = id("risk");
  db.prepare(
    "INSERT INTO risk(id,business_id,subject_type,subject_id,description,severity,likelihood,status,mitigation,owner_id,created_at) VALUES(?,?,?,?,?,?,?,'OPEN',?,?,?)",
  ).run(
    value,
    input.businessId,
    input.subjectType ?? null,
    input.subjectId ?? null,
    input.description,
    input.severity,
    input.likelihood,
    input.mitigation ?? null,
    input.ownerId ?? null,
    now(),
  );
  return value;
}
