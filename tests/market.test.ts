import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryDatabase, type CultDatabase } from "../src/db.js";
import { now } from "../src/domain.js";
import { seedFoundation } from "../src/seed.js";
import { recordClaim, recordEvidence, recordSource } from "../src/evidence.js";
import {
  attachEvidenceToMarketStudy,
  completeMarketStudy,
  createCreativeBrief,
  createMarketSignal,
  createMarketStudy,
  expireMarketStudies,
  linkSignalEvidence,
  startMarketStudy,
} from "../src/market.js";
import { evaluateAction } from "../src/policy.js";
import { grantApproval, rejectGate } from "../src/approval.js";
import {
  createArtifactVersion,
  recordIpClearance,
  recordProvenance,
  registerArtifact,
} from "../src/artifact.js";
import { createProduct, createProductVersion } from "../src/physical.js";
import { createWorkItem, transitionWorkItem } from "../src/work.js";
import { tick } from "../src/tick.js";
import { getEmployeeContext } from "../src/employee.js";

let db: CultDatabase;

beforeEach(() => {
  db = openMemoryDatabase();
  seedFoundation(db);
  db.prepare(
    "INSERT INTO business(id,slug,name,repo_path,status,created_at) VALUES('business-market','market','Market','/tmp/cult4-market','ACTIVE',?)",
  ).run(now());
});

function newStudy(
  options: {
    segment?: string;
    market?: string;
    language?: string;
    geography?: string;
  } = {},
): string {
  const studyId = createMarketStudy(db, {
    businessId: "business-market",
    targetSegment: options.segment ?? "plant collectors",
    market: options.market ?? "consumer stickers",
    language: options.language ?? "English",
    geography: options.geography ?? "US",
    researchQuestion: "Which original collector humor merits a cheap test?",
    analystEmployeeId: "employee-cultural-market-intelligence",
  });
  startMarketStudy(db, studyId, "employee-cultural-market-intelligence");
  return studyId;
}

function addEvidence(studyId: string, contradiction = false): string {
  const source = recordSource(db, {
    type: "reddit",
    title: "Collector discussion sample",
    locator: "https://example.test/thread",
    metadata: {
      platform: "reddit",
      communities: ["plants"],
      queryThemes: ["collector humor"],
      sampleSize: 20,
      contentMix: "posts and comments",
    },
  });
  const claim = recordClaim(db, {
    businessId: "business-market",
    statement:
      "Collector self-deprecation is active but generic icons are crowded.",
    createdBy: "employee-cultural-market-intelligence",
  });
  const evidence = recordEvidence(db, {
    claimId: claim,
    sourceId: source,
    summary: "Current comments repeatedly use collector self-deprecation.",
    contradiction,
    observationType: "OBSERVED",
    observedAt: now(),
    createdBy: "employee-cultural-market-intelligence",
  });
  attachEvidenceToMarketStudy(
    db,
    studyId,
    evidence,
    contradiction ? "CONTRADICTING" : "CULTURAL",
  );
  return evidence;
}

function addRequiredSignals(
  studyId: string,
  evidenceId: string,
  omit?: "CULTURAL" | "COMMERCIAL" | "SATURATION" | "OPPORTUNITY",
): void {
  for (const kind of [
    "CULTURAL",
    "COMMERCIAL",
    "SATURATION",
    "OPPORTUNITY",
  ] as const) {
    if (kind === omit) continue;
    const signal = createMarketSignal(db, {
      marketStudyId: studyId,
      kind,
      title: `${kind} conclusion`,
      description:
        kind === "COMMERCIAL"
          ? "Commercial signal is explicitly unknown; run a cheap validation."
          : `${kind} analysis is documented.`,
      confidence: kind === "COMMERCIAL" ? "UNKNOWN" : "MEDIUM",
      ...(kind === "CULTURAL" ? { lifecycle: "RISING" as const } : {}),
    });
    linkSignalEvidence(db, signal, evidenceId);
  }
}

function finishStudy(
  studyId: string,
  options: {
    evidence?: boolean;
    omit?: Parameters<typeof addRequiredSignals>[2];
  } = {},
): string | undefined {
  const evidence =
    options.evidence === false ? undefined : addEvidence(studyId);
  if (evidence) addRequiredSignals(studyId, evidence, options.omit);
  completeMarketStudy(
    db,
    studyId,
    {
      summary: "Promising only for a low-cost original-humor validation.",
      confidence: "MEDIUM",
      validUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      methodology: "Current community and marketplace triangulation.",
      limitations: "Self-selection and willingness to pay remain uncertain.",
      counterSignalSearched: true,
      counterSignalSummary:
        "Negative and fatigue queries found no new material contradiction.",
    },
    "employee-cultural-market-intelligence",
  );
  return evidence;
}

function designIntent(
  studyId?: string,
  geography = "US",
  language = "English",
) {
  return {
    actionType: "DESIGN_READY" as const,
    actorId: "employee-operator",
    businessId: "business-market",
    subjectType: "INITIATIVE",
    subjectId: "initiative-1",
    subjectVersion: "1",
    metadata: {
      commercial: true,
      creative: true,
      cultureSensitive: true,
      targetSegment: "plant collectors",
      market: "consumer stickers",
      geography,
      language,
      ...(studyId ? { marketStudyId: studyId } : {}),
    },
  };
}

describe("Cultural & Market Intelligence acceptance E21-E32", () => {
  it("E21/E31 denies design without a MarketStudy even when an actor says it is unnecessary", () => {
    const decision = evaluateAction(db, {
      ...designIntent(),
      metadata: {
        ...designIntent().metadata,
        note: "Designer says no study needed",
      },
    });
    expect(decision.outcome).toBe("DENY");
    expect(decision.denialReasons).toContain("MARKET_RELEVANCE_MISSING");
    expect(decision.missingGates[0]?.responsibility).toBe(
      "CULTURAL_MARKET_INTELLIGENCE",
    );
    expect(() =>
      grantApproval(
        db,
        decision.missingGates[0]!.gateId!,
        "employee-cultural-market-intelligence",
      ),
    ).toThrowError(/current structurally complete/);
    const product = createProduct(db, {
      businessId: "business-market",
      name: "Bypass attempt",
      fulfillmentKind: "PHYSICAL",
      creative: true,
      cultureSensitive: true,
    });
    const version = createProductVersion(db, {
      productId: product,
      version: "1",
      contentHash: "bypass-hash",
    });
    const design = createWorkItem(db, {
      businessId: "business-market",
      type: "DESIGN",
      title: "Bypass research",
      goal: "Start serious design directly",
      createdBy: "employee-operator",
      assignedTo: "employee-designer",
      status: "READY",
      subjectType: "PRODUCT_VERSION",
      subjectId: version,
      subjectVersion: "bypass-hash",
    });
    expect(() =>
      transitionWorkItem(db, design, "RUNNING", "employee-designer"),
    ).toThrowError(/MARKET_RELEVANCE gate/);
  });

  it("E22 denies an expired study", () => {
    const study = newStudy();
    const evidence = addEvidence(study);
    addRequiredSignals(study, evidence);
    completeMarketStudy(db, study, {
      summary: "Historical study",
      confidence: "MEDIUM",
      completedAt: "2025-01-01T00:00:00.000Z",
      validUntil: "2025-01-08T00:00:00.000Z",
      methodology: "Documented method",
      limitations: "Historical only",
      counterSignalSearched: true,
      counterSignalSummary: "Negative search documented.",
    });
    const decision = evaluateAction(db, designIntent(study));
    expect(decision.denialReasons).toContain("MARKET_RELEVANCE_EXPIRED");
  });

  it("E23 rejects an LLM-only/evidence-free study", () => {
    const study = newStudy();
    expect(() => finishStudy(study, { evidence: false })).toThrowError(
      /provenance-backed non-LLM evidence/,
    );
  });

  it("E24 requires a counter-signal search", () => {
    const study = newStudy();
    const evidence = addEvidence(study);
    addRequiredSignals(study, evidence);
    expect(() =>
      completeMarketStudy(db, study, {
        summary: "One-sided study",
        confidence: "LOW",
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        methodology: "Supporting search only",
        limitations: "Counter-signals absent",
        counterSignalSearched: false,
      }),
    ).toThrowError(/Counter-signal/);
  });

  it("E25 rejects cultural-only research with no commercial analysis", () => {
    const study = newStudy();
    const evidence = addEvidence(study);
    addRequiredSignals(study, evidence, "COMMERCIAL");
    expect(() =>
      completeMarketStudy(db, study, {
        summary: "Culturally active",
        confidence: "MEDIUM",
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        methodology: "Community method",
        limitations: "No commercial method",
        counterSignalSearched: true,
        counterSignalSummary: "Negative search documented.",
      }),
    ).toThrowError(/commercial analysis/);
  });

  it("E26 permits explicit commercial UNKNOWN and feeds a Strategist CreativeBrief", () => {
    const study = newStudy();
    finishStudy(study);
    const decision = evaluateAction(db, designIntent(study));
    expect(decision.outcome).toBe("BLOCK");
    grantApproval(
      db,
      decision.missingGates[0]!.gateId!,
      "employee-cultural-market-intelligence",
    );
    expect(evaluateAction(db, designIntent(study), false).allowed).toBe(true);
    const brief = createCreativeBrief(db, {
      businessId: "business-market",
      marketStudyId: study,
      strategistEmployeeId: "employee-strategist",
      status: "READY",
      targetAudience: "Plant collectors",
      desiredResponse: "Recognized without copied meme expression",
      culturalContext: "Collector self-deprecation is active.",
      commercialConstraints: "Willingness to pay unknown; cheap test only.",
    });
    expect(
      db.prepare("SELECT status FROM creative_brief WHERE id=?").get(brief),
    ).toEqual({ status: "READY" });
  });

  it("E27 rejects a US English study for Quebec French", () => {
    const study = newStudy();
    finishStudy(study);
    const decision = evaluateAction(
      db,
      designIntent(study, "Quebec", "French"),
    );
    expect(decision.denialReasons).toContain("MARKET_RELEVANCE_NOT_APPLICABLE");
  });

  it("E28 keeps high IP risk independently blocking after market relevance passes", () => {
    const study = newStudy();
    finishStudy(study);
    const artifact = registerArtifact(db, {
      businessId: "business-market",
      type: "IMAGE",
      purpose: "culture-sensitive commercial art",
      createdBy: "employee-designer",
      commercial: true,
      creative: true,
      cultureSensitive: true,
    });
    const version = createArtifactVersion(db, {
      artifactId: artifact,
      locator: "trend.png",
      content: "bytes",
    });
    recordProvenance(db, {
      artifactVersionId: version.id,
      sourceType: "REFERENCE",
      sourceRef: "documented trend source",
      licenseStatus: "UNVERIFIED",
    });
    recordIpClearance(db, {
      artifactVersionId: version.id,
      risk: "HIGH",
      searchStatus: "FOUND",
      reviewerId: "employee-ip-reviewer",
      evidenceRef: "protected expression found",
    });
    const intent = {
      actionType: "PUBLISH_PRODUCT" as const,
      actorId: "employee-operator",
      businessId: "business-market",
      subjectType: "ARTIFACT_VERSION",
      subjectId: version.id,
      subjectVersion: version.hash,
      metadata: { marketStudyId: study },
    };
    let decision = evaluateAction(db, intent);
    const marketGate = decision.missingGates.find(
      (gate) => gate.policyId === "MARKET_RELEVANCE_REQUIRED",
    )!;
    grantApproval(
      db,
      marketGate.gateId!,
      "employee-cultural-market-intelligence",
    );
    decision = evaluateAction(db, intent, false);
    expect(decision.denialReasons).toContain("IP_RISK_HIGH");
  });

  it("E29 keeps exact-hash human AI-art rejection independent", () => {
    const study = newStudy();
    finishStudy(study);
    const artifact = registerArtifact(db, {
      businessId: "business-market",
      type: "IMAGE",
      purpose: "public AI art",
      createdBy: "employee-designer",
      publicFacing: true,
      commercial: true,
      creative: true,
      cultureSensitive: true,
    });
    const version = createArtifactVersion(db, {
      artifactId: artifact,
      locator: "ai.png",
      content: "ugly bytes",
      aiGenerated: true,
    });
    recordProvenance(db, {
      artifactVersionId: version.id,
      sourceType: "PROMPT",
      sourceRef: "original prompt",
      licenseStatus: "NOT_REQUIRED",
    });
    recordIpClearance(db, {
      artifactVersionId: version.id,
      risk: "LOW",
      searchStatus: "NOT_FOUND",
      reviewerId: "employee-ip-reviewer",
      evidenceRef: "documented search",
    });
    const intent = {
      actionType: "PUBLISH_PRODUCT" as const,
      actorId: "employee-operator",
      businessId: "business-market",
      subjectType: "ARTIFACT_VERSION",
      subjectId: version.id,
      subjectVersion: version.hash,
      metadata: { marketStudyId: study },
    };
    const decision = evaluateAction(db, intent);
    for (const missing of decision.missingGates) {
      if (missing.authority === "APPROVE_PUBLIC_AI_ART")
        rejectGate(
          db,
          missing.gateId!,
          "human-owner",
          "Aesthetically rejected",
        );
      else
        grantApproval(
          db,
          missing.gateId!,
          missing.authority === "APPROVE_MARKET_RELEVANCE"
            ? "employee-cultural-market-intelligence"
            : "employee-ip-reviewer",
        );
    }
    expect(evaluateAction(db, intent, false).allowed).toBe(false);
  });

  it("E30 keeps physical sample and supplier requirements independent", () => {
    const study = newStudy();
    finishStudy(study);
    const product = createProduct(db, {
      businessId: "business-market",
      name: "Original plant sticker",
      fulfillmentKind: "PHYSICAL",
      productFamily: "stickers",
      creative: true,
      cultureSensitive: true,
      outsourcedManufacturing: true,
      targetSegment: "plant collectors",
      market: "consumer stickers",
      language: "English",
      geography: "US",
    });
    const version = createProductVersion(db, {
      productId: product,
      version: "1",
      contentHash: "product-hash",
    });
    const intent = {
      actionType: "PUBLISH_PRODUCT" as const,
      actorId: "employee-operator",
      businessId: "business-market",
      subjectType: "PRODUCT_VERSION",
      subjectId: version,
      subjectVersion: "product-hash",
      metadata: { marketStudyId: study },
    };
    let decision = evaluateAction(db, intent);
    grantApproval(
      db,
      decision.missingGates.find(
        (gate) => gate.authority === "APPROVE_MARKET_RELEVANCE",
      )!.gateId!,
      "employee-cultural-market-intelligence",
    );
    decision = evaluateAction(db, intent, false);
    expect(decision.denialReasons).toContain(
      "REAL_PHYSICAL_SAMPLE_PASS_MISSING",
    );
    expect(decision.denialReasons).toContain("SUPPLIER_QUALIFICATION_MISSING");
  });

  it("E32 expires gates, creates refresh semantics, and blocks a major expansion", () => {
    const study = newStudy();
    finishStudy(study);
    let decision = evaluateAction(db, designIntent(study));
    grantApproval(
      db,
      decision.missingGates[0]!.gateId!,
      "employee-cultural-market-intelligence",
    );
    expect(evaluateAction(db, designIntent(study), false).allowed).toBe(true);
    expireMarketStudies(db, "2100-01-01T00:00:00.000Z");
    decision = evaluateAction(db, {
      ...designIntent(study),
      actionType: "SPEND_MONEY",
      amount: 200_000,
      currency: "USD",
      metadata: { ...designIntent(study).metadata, majorInvestment: true },
    });
    expect(decision.denialReasons).toContain("MARKET_RELEVANCE_EXPIRED");
  });

  it("enforces structured MarketStudy and CreativeBrief WorkItem completion", () => {
    const study = newStudy();
    const work = createWorkItem(db, {
      businessId: "business-market",
      type: "MARKET_STUDY",
      title: "Study",
      goal: "Complete current evidence",
      createdBy: "employee-operator",
      assignedTo: "employee-cultural-market-intelligence",
      status: "READY",
      subjectType: "MARKET_STUDY",
      subjectId: study,
    });
    transitionWorkItem(
      db,
      work,
      "RUNNING",
      "employee-cultural-market-intelligence",
    );
    expect(() =>
      transitionWorkItem(
        db,
        work,
        "DONE",
        "employee-cultural-market-intelligence",
      ),
    ).toThrowError(/structured study contract/);
    finishStudy(study);
    transitionWorkItem(
      db,
      work,
      "DONE",
      "employee-cultural-market-intelligence",
    );
  });

  it("uses cult tick to create one ordinary refresh WorkItem for an expired study", async () => {
    const study = newStudy();
    const evidence = addEvidence(study);
    addRequiredSignals(study, evidence);
    completeMarketStudy(db, study, {
      summary: "Historical study",
      confidence: "MEDIUM",
      completedAt: "2025-01-01T00:00:00.000Z",
      validUntil: "2025-01-08T00:00:00.000Z",
      methodology: "Documented method",
      limitations: "Historical only",
      counterSignalSearched: true,
      counterSignalSummary: "Negative search documented.",
    });
    const result = await tick(db, { maxWorkItems: 0 });
    expect(result.timers.marketStudiesExpired).toBe(1);
    expect(result.timers.marketRefreshWorkCreated).toBe(1);
    expect(
      db
        .prepare(
          "SELECT type,status,assigned_to,subject_id FROM work_item WHERE type='MARKET_STUDY_REFRESH'",
        )
        .get(),
    ).toEqual({
      type: "MARKET_STUDY_REFRESH",
      status: "READY",
      assigned_to: "employee-cultural-market-intelligence",
      subject_id: study,
    });
    const second = await tick(db, { maxWorkItems: 0 });
    expect(second.timers.marketRefreshWorkCreated).toBe(0);
  });

  it("gives Strategist synthesis and Designer a CreativeBrief without the raw corpus", () => {
    const study = newStudy();
    finishStudy(study);
    const brief = createCreativeBrief(db, {
      businessId: "business-market",
      marketStudyId: study,
      strategistEmployeeId: "employee-strategist",
      status: "READY",
      targetAudience: "Plant collectors",
      culturalContext: "Current collector language",
    });
    const strategyWork = createWorkItem(db, {
      businessId: "business-market",
      type: "CREATIVE_BRIEF",
      title: "Interpret market evidence",
      goal: "Create an original low-cost validation brief",
      createdBy: "employee-operator",
      assignedTo: "employee-strategist",
      status: "READY",
      subjectType: "MARKET_STUDY",
      subjectId: study,
    });
    const designWork = createWorkItem(db, {
      businessId: "business-market",
      type: "DESIGN",
      title: "Design from approved brief",
      goal: "Create original concepts",
      createdBy: "employee-operator",
      assignedTo: "employee-designer",
      status: "READY",
      subjectType: "CREATIVE_BRIEF",
      subjectId: brief,
    });
    const strategist = getEmployeeContext(
      db,
      "employee-strategist",
      strategyWork,
    );
    const designer = getEmployeeContext(db, "employee-designer", designWork);
    expect(strategist.marketContext).toMatchObject({
      study: { id: study },
    });
    expect(designer.marketContext).toMatchObject({
      creativeBrief: { id: brief, market_study_id: study },
    });
    expect(JSON.stringify(designer.marketContext)).not.toContain(
      "Current comments repeatedly",
    );
  });

  it("integrates market freshness with non-transferable exact-SHA Git QA", () => {
    db.prepare(
      `INSERT INTO repository(id,owner_type,owner_id,local_path,remote_url,default_branch,current_sha,remote_sha,privacy_verified,sync_status,created_at,updated_at) VALUES('repo-market','business','business-market','/tmp/cult4-market','file:///tmp/cult4-market.git','main',NULL,NULL,1,'synced',?,?)`,
    ).run(now(), now());
    const shaB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const shaC = "cccccccccccccccccccccccccccccccccccccccc";
    for (const sha of [shaB, shaC])
      db.prepare(
        "INSERT INTO git_commit(id,repository_id,sha,branch,employee_id,pushed_at,remote_verified_at,created_at) VALUES(?,?,?,'main','employee-operator',?,?,?)",
      ).run(`commit-${sha}`, "repo-market", sha, now(), now(), now());
    const study = newStudy();
    finishStudy(study);
    let market = evaluateAction(db, designIntent(study));
    grantApproval(
      db,
      market.missingGates[0]!.gateId!,
      "employee-cultural-market-intelligence",
    );
    expect(evaluateAction(db, designIntent(study), false).allowed).toBe(true);
    const codeIntent = (sha: string) => ({
      actionType: "RELEASE_CODE" as const,
      actorId: "employee-operator",
      businessId: "business-market",
      subjectType: "GIT_COMMIT",
      subjectId: "repo-market",
      subjectVersion: sha,
    });
    const releaseB = evaluateAction(db, codeIntent(shaB));
    grantApproval(db, releaseB.missingGates[0]!.gateId!, "employee-qa");
    expect(evaluateAction(db, codeIntent(shaB), false).allowed).toBe(true);
    expect(evaluateAction(db, codeIntent(shaC)).allowed).toBe(false);
    expireMarketStudies(db, "2100-01-01T00:00:00.000Z");
    market = evaluateAction(db, designIntent(study));
    expect(market.denialReasons).toContain("MARKET_RELEVANCE_EXPIRED");
    expect(evaluateAction(db, codeIntent(shaB), false).allowed).toBe(true);
  });
});
