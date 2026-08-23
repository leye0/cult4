import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CultDatabase } from "./db.js";
import { safePathWithin } from "./config.js";
import { Cult4Error, id, json, now } from "./domain.js";
import { invalidateSubjectApprovals, requireGate } from "./approval.js";

export const computeHash = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");
export function registerArtifact(
  db: CultDatabase,
  input: {
    businessId: string;
    type: string;
    purpose: string;
    createdBy: string;
    publicFacing?: boolean;
    commercial?: boolean;
    creative?: boolean;
    cultureSensitive?: boolean;
    trendSensitive?: boolean;
    identitySensitive?: boolean;
  },
): string {
  const artifactId = id("artifact");
  db.prepare(
    "INSERT INTO artifact(id,business_id,type,purpose,created_by,public_facing,commercial,creative,culture_sensitive,trend_sensitive,identity_sensitive,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    artifactId,
    input.businessId,
    input.type,
    input.purpose,
    input.createdBy,
    input.publicFacing ? 1 : 0,
    input.commercial ? 1 : 0,
    input.creative ? 1 : 0,
    input.cultureSensitive ? 1 : 0,
    input.trendSensitive ? 1 : 0,
    input.identitySensitive ? 1 : 0,
    now(),
  );
  return artifactId;
}
export function createArtifactVersion(
  db: CultDatabase,
  input: {
    artifactId: string;
    locator: string;
    content?: Buffer | string;
    aiGenerated?: boolean;
    modelOrTool?: string;
    creationMetadata?: unknown;
  },
): { id: string; hash: string } {
  const artifact = db
    .prepare(
      "SELECT b.repo_path,a.created_by,a.public_facing FROM artifact a JOIN business b ON b.id=a.business_id WHERE a.id=?",
    )
    .get(input.artifactId) as Record<string, unknown> | undefined;
  if (!artifact)
    throw new Cult4Error("Artifact not found.", "ARTIFACT_NOT_FOUND");
  const bytes =
    input.content ??
    readFileSync(
      safePathWithin(String(artifact.repo_path), input.locator, false),
    );
  const hash = computeHash(bytes);
  const versionId = id("artifact-version");
  db.transaction(() => {
    db.prepare(
      "INSERT INTO artifact_version(id,artifact_id,content_hash,locator,ai_generated,model_or_tool,creation_metadata,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      versionId,
      input.artifactId,
      hash,
      input.locator,
      input.aiGenerated ? 1 : 0,
      input.modelOrTool ?? null,
      json(input.creationMetadata),
      now(),
    );
    invalidateSubjectApprovals(db, "ARTIFACT", input.artifactId, hash);
    if (input.aiGenerated && Number(artifact.public_facing))
      requireGate(db, {
        responsibility: "creative_quality",
        authority: "APPROVE_PUBLIC_AI_ART",
        policyId: "AI_GENERATED_VISUAL_PUBLIC_USE",
        policyVersion: 1,
        humanOnly: true,
        independent: true,
        subjectType: "ARTIFACT_VERSION",
        subjectId: versionId,
        subjectVersion: hash,
        producerActorId: String(artifact.created_by),
      });
  })();
  return { id: versionId, hash };
}
export function recordProvenance(
  db: CultDatabase,
  input: {
    artifactVersionId: string;
    sourceType: string;
    sourceRef: string;
    licenseStatus: "VERIFIED" | "UNVERIFIED" | "NOT_REQUIRED";
    notes?: string;
  },
): string {
  if (!input.sourceRef)
    throw new Cult4Error(
      "Provenance source is required.",
      "ARTIFACT_PROVENANCE_REQUIRED",
    );
  const sourceId = id("artifact-source");
  db.prepare(
    "INSERT INTO artifact_source(id,artifact_version_id,source_type,source_ref,license_status,notes) VALUES(?,?,?,?,?,?)",
  ).run(
    sourceId,
    input.artifactVersionId,
    input.sourceType,
    input.sourceRef,
    input.licenseStatus,
    input.notes ?? null,
  );
  return sourceId;
}
export function recordIpClearance(
  db: CultDatabase,
  input: {
    artifactVersionId: string;
    risk: "LOW" | "MEDIUM" | "HIGH" | "UNCERTAIN";
    searchStatus: "SEARCHED" | "FOUND" | "NOT_FOUND" | "UNCERTAIN";
    reviewerId: string;
    evidenceRef: string;
    notes?: string;
  },
): string {
  if (!input.evidenceRef)
    throw new Cult4Error(
      "IP clearance requires evidence trail.",
      "IP_EVIDENCE_REQUIRED",
    );
  const artifact = db
    .prepare(
      "SELECT a.created_by,av.content_hash FROM artifact_version av JOIN artifact a ON a.id=av.artifact_id WHERE av.id=?",
    )
    .get(input.artifactVersionId) as
    { created_by: string; content_hash: string } | undefined;
  if (!artifact)
    throw new Cult4Error(
      "Artifact version not found.",
      "ARTIFACT_VERSION_NOT_FOUND",
    );
  if (artifact.created_by === input.reviewerId)
    throw new Cult4Error(
      "Independent IP review required.",
      "SELF_REVIEW_FORBIDDEN",
    );
  const clearanceId = id("ip-clearance");
  db.prepare(
    "INSERT INTO ip_clearance(id,artifact_version_id,risk,search_status,reviewer_id,evidence_ref,notes,created_at) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    clearanceId,
    input.artifactVersionId,
    input.risk,
    input.searchStatus,
    input.reviewerId,
    input.evidenceRef,
    input.notes ?? null,
    now(),
  );
  return clearanceId;
}
