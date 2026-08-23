import type { CultDatabase } from "./db.js";
import { audit } from "./audit.js";
import { Cult4Error, id, json, now } from "./domain.js";
export function recordSource(
  db: CultDatabase,
  input: {
    type: string;
    title: string;
    author?: string;
    publisher?: string;
    locator?: string;
    publicationDate?: string;
    accessNotes?: string;
    licenseNotes?: string;
    metadata?: Record<string, unknown>;
  },
): string {
  const sourceId = id("source");
  db.prepare(
    "INSERT INTO source(id,type,title,author,publisher,locator,publication_date,accessed_at,access_notes,license_notes,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    sourceId,
    input.type,
    input.title,
    input.author ?? null,
    input.publisher ?? null,
    input.locator ?? null,
    input.publicationDate ?? null,
    now(),
    input.accessNotes ?? null,
    input.licenseNotes ?? null,
    json(input.metadata ?? {}),
  );
  return sourceId;
}
export function recordClaim(
  db: CultDatabase,
  input: {
    businessId?: string;
    statement: string;
    createdBy: string;
    status?: "HYPOTHESIS" | "SUPPORTED" | "CONTRADICTED" | "UNRESOLVED";
  },
): string {
  const claimId = id("claim");
  db.prepare(
    "INSERT INTO claim(id,business_id,statement,status,created_by,created_at) VALUES(?,?,?,?,?,?)",
  ).run(
    claimId,
    input.businessId ?? null,
    input.statement,
    input.status ?? "UNRESOLVED",
    input.createdBy,
    now(),
  );
  return claimId;
}
export function recordEvidence(
  db: CultDatabase,
  input: {
    claimId: string;
    sourceId?: string;
    summary: string;
    reliability?: number;
    applicability?: number;
    confidence?: number;
    contradiction?: boolean;
    observedAt?: string;
    observationType?: "OBSERVED" | "ESTIMATED" | "INFERRED" | "UNKNOWN";
    metadata?: Record<string, unknown>;
    createdBy: string;
  },
): string {
  if (!input.sourceId && !input.observedAt)
    throw new Cult4Error(
      "Evidence requires a source or direct observation time.",
      "EVIDENCE_PROVENANCE_REQUIRED",
    );
  const evidenceId = id("evidence");
  db.transaction(() => {
    db.prepare(
      "INSERT INTO evidence(id,claim_id,source_id,summary,reliability,applicability,confidence,contradiction,observed_at,created_by,created_at,observation_type,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      evidenceId,
      input.claimId,
      input.sourceId ?? null,
      input.summary,
      input.reliability ?? null,
      input.applicability ?? null,
      input.confidence ?? null,
      input.contradiction ? 1 : 0,
      input.observedAt ?? null,
      input.createdBy,
      now(),
      input.observationType ?? "OBSERVED",
      json(input.metadata ?? {}),
    );
    audit(db, {
      type: "EVIDENCE_RECORDED",
      actorId: input.createdBy,
      subjectType: "CLAIM",
      subjectId: input.claimId,
      data: {
        evidenceId,
        sourceId: input.sourceId,
        contradiction: Boolean(input.contradiction),
      },
    });
  })();
  return evidenceId;
}
export function recordDecision(
  db: CultDatabase,
  input: {
    businessId?: string;
    workItemId?: string;
    statement: string;
    rationale: string;
    alternatives: string[];
    unknowns: string[];
    risk: string;
    budgetId?: string;
    subjectType?: string;
    subjectId?: string;
    subjectVersion?: string;
    policySnapshotId?: string;
    createdBy: string;
    approvedBy?: string;
    evidenceIds?: string[];
  },
): string {
  if (!input.rationale || !input.alternatives.length)
    throw new Cult4Error(
      "A material decision requires rationale and alternatives.",
      "DECISION_INCOMPLETE",
    );
  const decisionId = id("decision");
  db.transaction(() => {
    db.prepare(
      `INSERT INTO decision(id,business_id,work_item_id,statement,rationale,alternatives,unknowns,risk,budget_id,subject_type,subject_id,subject_version,policy_snapshot_id,created_by,approved_by,effective_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      decisionId,
      input.businessId ?? null,
      input.workItemId ?? null,
      input.statement,
      input.rationale,
      json(input.alternatives),
      json(input.unknowns),
      input.risk,
      input.budgetId ?? null,
      input.subjectType ?? null,
      input.subjectId ?? null,
      input.subjectVersion ?? null,
      input.policySnapshotId ?? null,
      input.createdBy,
      input.approvedBy ?? null,
      now(),
      now(),
    );
    for (const evidenceId of input.evidenceIds ?? [])
      db.prepare(
        "INSERT INTO decision_evidence(decision_id,evidence_id) VALUES(?,?)",
      ).run(decisionId, evidenceId);
    audit(db, {
      type: "DECISION_RECORDED",
      actorId: input.createdBy,
      businessId: input.businessId,
      subjectType: input.subjectType ?? "DECISION",
      subjectId: input.subjectId ?? decisionId,
      subjectVersion: input.subjectVersion,
      data: { decisionId, risk: input.risk, unknowns: input.unknowns },
    });
  })();
  return decisionId;
}
