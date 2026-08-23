import { z } from "zod";
import type { CultDatabase } from "./db.js";
import { audit } from "./audit.js";
import { Cult4Error, id, json, now, parseJson } from "./domain.js";

const requiredText = z.string().trim().min(1);
const optionalText = z.string().trim().min(1).optional();
const confidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
const signalConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]);
const lifecycleSchema = z
  .enum([
    "EMERGING",
    "RISING",
    "MAINSTREAM",
    "SATURATED",
    "DECLINING",
    "DEAD",
    "UNKNOWN",
  ])
  .optional();

export const MarketStudyCreateSchema = z.object({
  businessId: requiredText,
  initiativeId: optionalText,
  targetSegment: requiredText,
  market: requiredText,
  language: optionalText,
  geography: optionalText,
  researchQuestion: requiredText,
  methodology: optionalText,
  analystEmployeeId: requiredText,
  replacesMarketStudyId: optionalText,
});
export const MarketStudyCompleteSchema = z.object({
  summary: requiredText,
  confidence: confidenceSchema,
  completedAt: z.iso.datetime().optional(),
  validUntil: z.iso.datetime(),
  methodology: requiredText,
  limitations: requiredText,
  counterSignalSearched: z.boolean(),
  counterSignalSummary: optionalText,
});
export const MarketSignalCreateSchema = z.object({
  marketStudyId: requiredText,
  kind: z.enum(["CULTURAL", "COMMERCIAL", "OPPORTUNITY", "SATURATION", "RISK"]),
  subtype: optionalText,
  title: requiredText,
  description: requiredText,
  lifecycle: lifecycleSchema,
  confidence: signalConfidenceSchema,
  observedAt: z.iso.datetime().optional(),
  expiresAt: z.iso.datetime().optional(),
});
export const CreativeBriefCreateSchema = z.object({
  businessId: requiredText,
  initiativeId: optionalText,
  marketStudyId: requiredText,
  strategistEmployeeId: requiredText,
  status: z.enum(["DRAFT", "READY"]).default("DRAFT"),
  targetAudience: requiredText,
  desiredResponse: optionalText,
  culturalContext: requiredText,
  relevantTropes: optionalText,
  customerLanguage: optionalText,
  aestheticTerritory: optionalText,
  saturatedIdeasToAvoid: optionalText,
  ipDangerAreas: optionalText,
  commercialConstraints: optionalText,
  relevantClaimIds: z.array(requiredText).default([]),
  relevantSignalIds: z.array(requiredText).default([]),
  validUntil: z.iso.datetime().optional(),
});

export type MarketStudyCreate = z.input<typeof MarketStudyCreateSchema>;
export type MarketStudyComplete = z.input<typeof MarketStudyCompleteSchema>;
export type MarketSignalCreate = z.input<typeof MarketSignalCreateSchema>;
export type CreativeBriefCreate = z.input<typeof CreativeBriefCreateSchema>;

function requireActiveEmployee(
  db: CultDatabase,
  employeeId: string,
  responsibility?: string,
): void {
  const row = responsibility
    ? db
        .prepare(
          `SELECT 1 FROM employee e JOIN responsibility_owner ro ON ro.actor_id=e.id AND ro.active=1 JOIN responsibility r ON r.id=ro.responsibility_id WHERE e.id=? AND e.status='ACTIVE' AND r.slug=?`,
        )
        .get(employeeId, responsibility)
    : db
        .prepare("SELECT 1 FROM employee WHERE id=? AND status='ACTIVE'")
        .get(employeeId);
  if (!row)
    throw new Cult4Error(
      "The responsible active employee was not found.",
      "MARKET_EMPLOYEE_NOT_AUTHORIZED",
    );
}

export function createMarketStudy(
  db: CultDatabase,
  raw: MarketStudyCreate,
): string {
  const input = MarketStudyCreateSchema.parse(raw);
  requireActiveEmployee(
    db,
    input.analystEmployeeId,
    "CULTURAL_MARKET_INTELLIGENCE",
  );
  if (
    !db
      .prepare("SELECT 1 FROM business WHERE id=? AND status='ACTIVE'")
      .get(input.businessId)
  )
    throw new Cult4Error("Active business not found.", "BUSINESS_NOT_FOUND");
  if (input.replacesMarketStudyId) {
    const previous = db
      .prepare("SELECT business_id,status FROM market_study WHERE id=?")
      .get(input.replacesMarketStudyId) as
      { business_id: string; status: string } | undefined;
    if (
      !previous ||
      previous.business_id !== input.businessId ||
      !["EXPIRED", "INVALIDATED", "COMPLETE"].includes(previous.status)
    )
      throw new Cult4Error(
        "Replacement study must reference a prior study for the same business.",
        "MARKET_STUDY_REPLACEMENT_INVALID",
      );
  }
  const studyId = id("market-study");
  const timestamp = now();
  const organization = db
    .prepare(
      "SELECT current_sha FROM repository WHERE owner_type='organization' ORDER BY created_at LIMIT 1",
    )
    .get() as { current_sha: string | null } | undefined;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO market_study(id,business_id,initiative_id,target_segment,market,language,geography,research_question,methodology,status,analyst_employee_id,organization_sha,started_at,replaces_market_study_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?,?,?,?)`,
    ).run(
      studyId,
      input.businessId,
      input.initiativeId ?? null,
      input.targetSegment,
      input.market,
      input.language ?? null,
      input.geography ?? null,
      input.researchQuestion,
      input.methodology ?? null,
      input.analystEmployeeId,
      organization?.current_sha ?? null,
      timestamp,
      input.replacesMarketStudyId ?? null,
      timestamp,
      timestamp,
    );
    audit(db, {
      type: "MARKET_STUDY_CREATED",
      actorId: input.analystEmployeeId,
      businessId: input.businessId,
      subjectType: "MARKET_STUDY",
      subjectId: studyId,
      data: { organizationSha: organization?.current_sha ?? null },
    });
  })();
  return studyId;
}

export function startMarketStudy(
  db: CultDatabase,
  studyId: string,
  actorId: string,
): void {
  const changed = db
    .prepare(
      "UPDATE market_study SET status='RESEARCHING',updated_at=? WHERE id=? AND analyst_employee_id=? AND status='DRAFT'",
    )
    .run(now(), studyId, actorId);
  if (!changed.changes)
    throw new Cult4Error(
      "Market study cannot enter research.",
      "MARKET_STUDY_TRANSITION_INVALID",
    );
}

export function getMarketStudy(
  db: CultDatabase,
  studyId: string,
): Record<string, unknown> | undefined {
  const study = db
    .prepare("SELECT * FROM market_study WHERE id=?")
    .get(studyId) as Record<string, unknown> | undefined;
  if (!study) return undefined;
  return {
    ...study,
    signals: db
      .prepare(
        "SELECT * FROM market_signal WHERE market_study_id=? ORDER BY created_at",
      )
      .all(studyId),
    evidence: db
      .prepare(
        `SELECT mse.role,e.*,s.type source_type,s.title source_title,s.locator FROM market_study_evidence mse JOIN evidence e ON e.id=mse.evidence_id LEFT JOIN source s ON s.id=e.source_id WHERE mse.market_study_id=? ORDER BY e.created_at`,
      )
      .all(studyId),
  };
}

export function listMarketStudies(
  db: CultDatabase,
  businessId: string,
): unknown[] {
  return db
    .prepare(
      "SELECT * FROM market_study WHERE business_id=? ORDER BY created_at DESC",
    )
    .all(businessId);
}

export function attachEvidenceToMarketStudy(
  db: CultDatabase,
  studyId: string,
  evidenceId: string,
  role:
    | "SUPPORTING"
    | "CONTRADICTING"
    | "CONTEXTUAL"
    | "COMMERCIAL"
    | "SATURATION"
    | "CULTURAL"
    | "RISK"
    | "METHODOLOGY",
): void {
  const compatible = db
    .prepare(
      `SELECT 1 FROM market_study ms JOIN evidence e ON e.id=? JOIN claim c ON c.id=e.claim_id WHERE ms.id=? AND ms.status IN ('DRAFT','RESEARCHING') AND (c.business_id IS NULL OR c.business_id=ms.business_id)`,
    )
    .get(evidenceId, studyId);
  if (!compatible)
    throw new Cult4Error(
      "Evidence does not belong to a mutable compatible study.",
      "MARKET_EVIDENCE_INVALID",
    );
  db.prepare(
    "INSERT OR REPLACE INTO market_study_evidence(market_study_id,evidence_id,role) VALUES(?,?,?)",
  ).run(studyId, evidenceId, role);
}

export function createMarketSignal(
  db: CultDatabase,
  raw: MarketSignalCreate,
): string {
  const input = MarketSignalCreateSchema.parse(raw);
  const study = db
    .prepare("SELECT status FROM market_study WHERE id=?")
    .get(input.marketStudyId) as { status: string } | undefined;
  if (!study || !["DRAFT", "RESEARCHING"].includes(study.status))
    throw new Cult4Error(
      "Signals may only be added to a mutable market study.",
      "MARKET_STUDY_IMMUTABLE",
    );
  if (
    input.expiresAt &&
    input.observedAt &&
    input.expiresAt <= input.observedAt
  )
    throw new Cult4Error(
      "Signal expiry must follow observation.",
      "MARKET_SIGNAL_DATE_INVALID",
    );
  const signalId = id("market-signal");
  db.prepare(
    `INSERT INTO market_signal(id,market_study_id,kind,subtype,title,description,lifecycle,confidence,observed_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    signalId,
    input.marketStudyId,
    input.kind,
    input.subtype ?? null,
    input.title,
    input.description,
    input.lifecycle ?? null,
    input.confidence,
    input.observedAt ?? null,
    input.expiresAt ?? null,
    now(),
  );
  return signalId;
}

export function linkSignalEvidence(
  db: CultDatabase,
  signalId: string,
  evidenceId: string,
): void {
  const compatible = db
    .prepare(
      `SELECT 1 FROM market_signal ms JOIN market_study study ON study.id=ms.market_study_id JOIN evidence e ON e.id=? JOIN market_study_evidence mse ON mse.market_study_id=study.id AND mse.evidence_id=e.id WHERE ms.id=? AND study.status IN ('DRAFT','RESEARCHING')`,
    )
    .get(evidenceId, signalId);
  if (!compatible)
    throw new Cult4Error(
      "Signal evidence must already be attached to its mutable study.",
      "MARKET_SIGNAL_EVIDENCE_INVALID",
    );
  db.prepare(
    "INSERT OR IGNORE INTO market_signal_evidence(market_signal_id,evidence_id) VALUES(?,?)",
  ).run(signalId, evidenceId);
}

export function completeMarketStudy(
  db: CultDatabase,
  studyId: string,
  raw: MarketStudyComplete,
  actorId?: string,
): void {
  const input = MarketStudyCompleteSchema.parse(raw);
  const study = db
    .prepare("SELECT * FROM market_study WHERE id=?")
    .get(studyId) as Record<string, unknown> | undefined;
  if (!study || study.status !== "RESEARCHING")
    throw new Cult4Error(
      "Only a researching study may complete.",
      "MARKET_STUDY_TRANSITION_INVALID",
    );
  if (actorId && study.analyst_employee_id !== actorId)
    throw new Cult4Error(
      "Only the assigned analyst may complete this study.",
      "MARKET_STUDY_ACTOR_MISMATCH",
    );
  const completedAt = input.completedAt ?? now();
  if (input.validUntil <= completedAt)
    throw new Cult4Error(
      "Market study validity must extend beyond completion.",
      "MARKET_STUDY_DATE_INVALID",
    );
  const evidence = db
    .prepare(
      `SELECT mse.role,e.id,e.contradiction,e.source_id,s.type source_type FROM market_study_evidence mse JOIN evidence e ON e.id=mse.evidence_id LEFT JOIN source s ON s.id=e.source_id WHERE mse.market_study_id=?`,
    )
    .all(studyId) as Array<Record<string, unknown>>;
  const sourced = evidence.filter(
    (row) =>
      row.source_id &&
      !["llm", "model_memory", "internal_llm_knowledge"].includes(
        String(row.source_type).toLowerCase(),
      ),
  );
  if (!sourced.length)
    throw new Cult4Error(
      "A complete market study requires provenance-backed non-LLM evidence.",
      "MARKET_STUDY_EVIDENCE_MISSING",
    );
  const signals = db
    .prepare(
      "SELECT id,kind,confidence FROM market_signal WHERE market_study_id=?",
    )
    .all(studyId) as Array<{ id: string; kind: string; confidence: string }>;
  for (const kind of ["CULTURAL", "COMMERCIAL", "SATURATION", "OPPORTUNITY"])
    if (!signals.some((signal) => signal.kind === kind))
      throw new Cult4Error(
        `${kind.toLowerCase()} analysis is required.`,
        `MARKET_STUDY_${kind}_MISSING`,
      );
  for (const signal of signals)
    if (
      signal.confidence !== "UNKNOWN" &&
      !db
        .prepare(
          "SELECT 1 FROM market_signal_evidence WHERE market_signal_id=?",
        )
        .get(signal.id)
    )
      throw new Cult4Error(
        "Non-unknown market signals require linked evidence.",
        "MARKET_SIGNAL_EVIDENCE_MISSING",
      );
  if (
    !evidence.some(
      (row) => Number(row.contradiction) || row.role === "CONTRADICTING",
    ) &&
    (!input.counterSignalSearched || !input.counterSignalSummary)
  )
    throw new Cult4Error(
      "Counter-signal research must be documented.",
      "MARKET_STUDY_COUNTER_SIGNAL_MISSING",
    );
  db.transaction(() => {
    db.prepare(
      `UPDATE market_study SET status='COMPLETE',confidence=?,completed_at=?,valid_until=?,summary=?,methodology=?,limitations=?,counter_signal_searched=?,counter_signal_summary=?,updated_at=? WHERE id=?`,
    ).run(
      input.confidence,
      completedAt,
      input.validUntil,
      input.summary,
      input.methodology,
      input.limitations,
      input.counterSignalSearched ? 1 : 0,
      input.counterSignalSummary ?? null,
      now(),
      studyId,
    );
    audit(db, {
      type: "MARKET_STUDY_COMPLETED",
      actorId: actorId ?? String(study.analyst_employee_id),
      businessId: String(study.business_id),
      subjectType: "MARKET_STUDY",
      subjectId: studyId,
      subjectVersion: completedAt,
      data: { validUntil: input.validUntil, confidence: input.confidence },
    });
  })();
}

export interface MarketApplicability {
  businessId: string;
  marketStudyId?: string;
  targetSegment?: string;
  market?: string;
  language?: string;
  geography?: string;
  at?: string;
}

const comparable = (value: unknown): string | undefined => {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase();
  return normalized || undefined;
};

export function findApplicableFreshMarketStudy(
  db: CultDatabase,
  applicability: MarketApplicability,
): Record<string, unknown> | undefined {
  const at = applicability.at ?? now();
  const rows = db
    .prepare(
      `SELECT * FROM market_study WHERE business_id=? AND status='COMPLETE' AND valid_until>=? AND (? IS NULL OR id=?) ORDER BY completed_at DESC`,
    )
    .all(
      applicability.businessId,
      at,
      applicability.marketStudyId ?? null,
      applicability.marketStudyId ?? null,
    ) as Array<Record<string, unknown>>;
  const fields = [
    ["target_segment", applicability.targetSegment],
    ["market", applicability.market],
    ["language", applicability.language],
    ["geography", applicability.geography],
  ] as const;
  return rows.find((row) =>
    fields.every((field) => {
      const expected = comparable(field[1]);
      return !expected || comparable(row[field[0]]) === expected;
    }),
  );
}

export function marketStudyFailureReason(
  db: CultDatabase,
  applicability: MarketApplicability,
): string | undefined {
  if (findApplicableFreshMarketStudy(db, applicability)) return undefined;
  const rows = db
    .prepare(
      "SELECT id,status,valid_until,target_segment,market,language,geography FROM market_study WHERE business_id=? AND (? IS NULL OR id=?) ORDER BY created_at DESC",
    )
    .all(
      applicability.businessId,
      applicability.marketStudyId ?? null,
      applicability.marketStudyId ?? null,
    ) as Array<Record<string, unknown>>;
  if (!rows.length) return "MARKET_RELEVANCE_MISSING";
  if (
    rows.some(
      (row) =>
        row.status === "EXPIRED" ||
        (row.valid_until &&
          String(row.valid_until) < (applicability.at ?? now())),
    )
  )
    return "MARKET_RELEVANCE_EXPIRED";
  if (rows.some((row) => row.status !== "COMPLETE"))
    return "MARKET_RELEVANCE_INCOMPLETE";
  return "MARKET_RELEVANCE_NOT_APPLICABLE";
}

export function validateMarketStudyForGate(
  db: CultDatabase,
  studyId: string | null | undefined,
): boolean {
  if (!studyId) return false;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM market_study ms WHERE ms.id=? AND ms.status='COMPLETE' AND ms.valid_until>=? AND ms.completed_at IS NOT NULL AND ms.confidence IS NOT NULL AND EXISTS(SELECT 1 FROM market_study_evidence mse JOIN evidence e ON e.id=mse.evidence_id WHERE mse.market_study_id=ms.id AND e.source_id IS NOT NULL) AND EXISTS(SELECT 1 FROM market_signal WHERE market_study_id=ms.id AND kind='CULTURAL') AND EXISTS(SELECT 1 FROM market_signal WHERE market_study_id=ms.id AND kind='COMMERCIAL') AND EXISTS(SELECT 1 FROM market_signal WHERE market_study_id=ms.id AND kind='SATURATION') AND EXISTS(SELECT 1 FROM market_signal WHERE market_study_id=ms.id AND kind='OPPORTUNITY') AND (ms.counter_signal_searched=1 OR EXISTS(SELECT 1 FROM market_study_evidence mse JOIN evidence e ON e.id=mse.evidence_id WHERE mse.market_study_id=ms.id AND (mse.role='CONTRADICTING' OR e.contradiction=1)))`,
      )
      .get(studyId, now()),
  );
}

export function createCreativeBrief(
  db: CultDatabase,
  raw: CreativeBriefCreate,
): string {
  const input = CreativeBriefCreateSchema.parse(raw);
  requireActiveEmployee(db, input.strategistEmployeeId, "strategy");
  const study = findApplicableFreshMarketStudy(db, {
    businessId: input.businessId,
    marketStudyId: input.marketStudyId,
  });
  if (!study)
    throw new Cult4Error(
      "Creative brief requires a fresh complete study for the business.",
      "CREATIVE_BRIEF_MARKET_STUDY_INVALID",
    );
  for (const claimId of input.relevantClaimIds) {
    if (
      !db
        .prepare("SELECT 1 FROM claim WHERE id=? AND business_id=?")
        .get(claimId, input.businessId)
    )
      throw new Cult4Error(
        "Creative brief claim is outside the business.",
        "CREATIVE_BRIEF_REFERENCE_INVALID",
      );
  }
  for (const signalId of input.relevantSignalIds) {
    if (
      !db
        .prepare("SELECT 1 FROM market_signal WHERE id=? AND market_study_id=?")
        .get(signalId, input.marketStudyId)
    )
      throw new Cult4Error(
        "Creative brief signal is outside its study.",
        "CREATIVE_BRIEF_REFERENCE_INVALID",
      );
  }
  const validUntil = input.validUntil ?? String(study.valid_until);
  if (validUntil > String(study.valid_until) || validUntil <= now())
    throw new Cult4Error(
      "Creative brief cannot outlive its market study.",
      "CREATIVE_BRIEF_DATE_INVALID",
    );
  const briefId = id("creative-brief");
  const timestamp = now();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO creative_brief(id,business_id,initiative_id,market_study_id,strategist_employee_id,status,target_audience,desired_response,cultural_context,relevant_tropes,customer_language,aesthetic_territory,saturated_ideas_to_avoid,ip_danger_areas,commercial_constraints,relevant_claim_ids,relevant_signal_ids,valid_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      briefId,
      input.businessId,
      input.initiativeId ?? null,
      input.marketStudyId,
      input.strategistEmployeeId,
      input.status,
      input.targetAudience,
      input.desiredResponse ?? null,
      input.culturalContext,
      input.relevantTropes ?? null,
      input.customerLanguage ?? null,
      input.aestheticTerritory ?? null,
      input.saturatedIdeasToAvoid ?? null,
      input.ipDangerAreas ?? null,
      input.commercialConstraints ?? null,
      json(input.relevantClaimIds),
      json(input.relevantSignalIds),
      validUntil,
      timestamp,
      timestamp,
    );
    audit(db, {
      type: "CREATIVE_BRIEF_CREATED",
      actorId: input.strategistEmployeeId,
      businessId: input.businessId,
      subjectType: "CREATIVE_BRIEF",
      subjectId: briefId,
      data: { marketStudyId: input.marketStudyId, status: input.status },
    });
  })();
  return briefId;
}

export function getCreativeBrief(
  db: CultDatabase,
  briefId: string,
): Record<string, unknown> | undefined {
  const brief = db
    .prepare("SELECT * FROM creative_brief WHERE id=?")
    .get(briefId) as Record<string, unknown> | undefined;
  if (!brief) return undefined;
  return {
    ...brief,
    relevant_claim_ids: parseJson(String(brief.relevant_claim_ids), []),
    relevant_signal_ids: parseJson(String(brief.relevant_signal_ids), []),
  };
}

export function invalidateCreativeBrief(
  db: CultDatabase,
  briefId: string,
  actorId: string,
  reason: string,
  status: "INVALIDATED" | "SUPERSEDED" = "INVALIDATED",
): void {
  if (!reason.trim())
    throw new Cult4Error(
      "Creative brief invalidation requires a reason.",
      "CREATIVE_BRIEF_INVALIDATION_REASON_REQUIRED",
    );
  const changed = db
    .prepare(
      "UPDATE creative_brief SET status=?,updated_at=? WHERE id=? AND status IN ('DRAFT','READY')",
    )
    .run(status, now(), briefId);
  if (!changed.changes)
    throw new Cult4Error(
      "Creative brief is not active.",
      "CREATIVE_BRIEF_TRANSITION_INVALID",
    );
  audit(db, {
    type: "CREATIVE_BRIEF_INVALIDATED",
    actorId,
    subjectType: "CREATIVE_BRIEF",
    subjectId: briefId,
    data: { reason, status },
  });
}

export function expireMarketStudies(db: CultDatabase, at = now()): string[] {
  const expired = db
    .prepare(
      "SELECT id,business_id FROM market_study WHERE status='COMPLETE' AND valid_until<?",
    )
    .all(at) as Array<{ id: string; business_id: string }>;
  for (const study of expired)
    db.transaction(() => {
      db.prepare(
        "UPDATE market_study SET status='EXPIRED',updated_at=? WHERE id=? AND status='COMPLETE'",
      ).run(at, study.id);
      db.prepare(
        "UPDATE creative_brief SET status='INVALIDATED',updated_at=? WHERE market_study_id=? AND status='DRAFT'",
      ).run(at, study.id);
      db.prepare(
        "UPDATE gate SET status='EXPIRED' WHERE market_study_id=? AND status IN ('PENDING','SATISFIED')",
      ).run(study.id);
      audit(db, {
        type: "MARKET_STUDY_EXPIRED",
        actorId: "system",
        businessId: study.business_id,
        subjectType: "MARKET_STUDY",
        subjectId: study.id,
      });
    })();
  return expired.map((study) => study.id);
}

export function invalidateMarketStudy(
  db: CultDatabase,
  studyId: string,
  actorId: string,
  reason: string,
): void {
  if (!reason.trim())
    throw new Cult4Error(
      "Invalidation reason is required.",
      "MARKET_STUDY_INVALIDATION_REASON_REQUIRED",
    );
  const changed = db
    .prepare(
      "UPDATE market_study SET status='INVALIDATED',updated_at=? WHERE id=? AND status='COMPLETE'",
    )
    .run(now(), studyId);
  if (!changed.changes)
    throw new Cult4Error(
      "Only a complete study may be invalidated.",
      "MARKET_STUDY_TRANSITION_INVALID",
    );
  db.prepare(
    "UPDATE gate SET status='INVALIDATED' WHERE market_study_id=? AND status IN ('PENDING','SATISFIED')",
  ).run(studyId);
  audit(db, {
    type: "MARKET_STUDY_INVALIDATED",
    actorId,
    subjectType: "MARKET_STUDY",
    subjectId: studyId,
    data: { reason },
  });
}

export function assertMarketWorkCompletion(
  db: CultDatabase,
  work: { type: string; subject_id: string | null },
): void {
  if (["MARKET_STUDY", "MARKET_STUDY_REFRESH"].includes(work.type)) {
    if (!work.subject_id || !validateMarketStudyForGate(db, work.subject_id))
      throw new Cult4Error(
        "Market research work cannot finish before its structured study contract is complete.",
        "MARKET_STUDY_WORK_INCOMPLETE",
      );
  }
  if (work.type === "CREATIVE_BRIEF") {
    const brief = work.subject_id
      ? (db
          .prepare("SELECT status,valid_until FROM creative_brief WHERE id=?")
          .get(work.subject_id) as
          { status: string; valid_until: string | null } | undefined)
      : undefined;
    if (
      !brief ||
      brief.status !== "READY" ||
      !brief.valid_until ||
      brief.valid_until < now()
    )
      throw new Cult4Error(
        "Creative brief work requires a fresh READY structured brief.",
        "CREATIVE_BRIEF_WORK_INCOMPLETE",
      );
  }
}

export function assertMarketDesignExecution(
  db: CultDatabase,
  workId: string,
  work: {
    type: string;
    subject_type: string | null;
    subject_id: string | null;
  },
): void {
  if (!["DESIGN", "CREATIVE_PRODUCTION"].includes(work.type)) return;
  let cultureSensitive = work.subject_type === "CREATIVE_BRIEF";
  if (work.subject_type === "PRODUCT_VERSION" && work.subject_id)
    cultureSensitive = Boolean(
      db
        .prepare(
          `SELECT 1 FROM product_version pv JOIN product p ON p.id=pv.product_id WHERE pv.id=? AND p.commercial=1 AND (p.creative=1 OR p.culture_sensitive=1 OR p.trend_sensitive=1 OR p.identity_sensitive=1)`,
        )
        .get(work.subject_id),
    );
  if (!cultureSensitive) return;
  const gates = db
    .prepare(
      "SELECT market_study_id FROM gate WHERE work_item_id=? AND policy_id='MARKET_RELEVANCE_REQUIRED' AND status='SATISFIED'",
    )
    .all(workId) as Array<{ market_study_id: string | null }>;
  if (
    !gates.some((gate) => validateMarketStudyForGate(db, gate.market_study_id))
  )
    throw new Cult4Error(
      "Culture-sensitive commercial design cannot start without a satisfied fresh MARKET_RELEVANCE gate.",
      "MARKET_RELEVANCE_MISSING",
    );
}
