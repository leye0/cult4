import { createHash } from "node:crypto";
import type { CultDatabase } from "./db.js";
import {
  Cult4Error,
  type ActionIntent,
  type GateRequirement,
  type PolicyDecision,
} from "./domain.js";
import { requireGate, validateApproval } from "./approval.js";
import { transitionWorkItem } from "./work.js";
import {
  findApplicableFreshMarketStudy,
  marketStudyFailureReason,
} from "./market.js";
import { assessActionAssurance, recordActionAssurance } from "./assurance.js";

export const CORE_POLICY_VERSIONS = {
  BUSINESS_MANDATE: 1,
  FINANCIAL_SPEND: 1,
  AI_GENERATED_VISUAL_PUBLIC_USE: 1,
  COMMERCIAL_CREATIVE_IP: 1,
  PHYSICAL_PRODUCT_COMMERCIAL_RELEASE: 1,
  PRODUCTION_RELEASE: 1,
  FOUNDATION_CHANGE: 1,
  MARKET_RELEVANCE_REQUIRED: 1,
  BUSINESS_ASSURANCE: 1,
} as const;

interface PolicyResult {
  applicable: boolean;
  gates: GateRequirement[];
  denials: string[];
}
type CorePolicy = (db: CultDatabase, intent: ActionIntent) => PolicyResult;
const gate = (
  responsibility: string,
  authority: string,
  policyId: keyof typeof CORE_POLICY_VERSIONS,
  options: Partial<GateRequirement> = {},
): GateRequirement => ({
  responsibility,
  authority,
  policyId,
  policyVersion: CORE_POLICY_VERSIONS[policyId],
  ...options,
});

const businessMandatePolicy: CorePolicy = (db, intent) => {
  if (!intent.businessId) return { applicable: false, gates: [], denials: [] };
  const foundationExists = Boolean(
    db
      .prepare(
        "SELECT 1 FROM work_item WHERE business_id=? AND type='BUSINESS_FOUNDATION'",
      )
      .get(intent.businessId),
  );
  if (!foundationExists) return { applicable: false, gates: [], denials: [] };
  const confirmed = db
    .prepare(
      "SELECT 1 FROM business_mandate WHERE business_id=? AND status='CONFIRMED'",
    )
    .get(intent.businessId);
  return {
    applicable: true,
    gates: [],
    denials: confirmed ? [] : ["BUSINESS_MANDATE_REQUIRED"],
  };
};

const financialSpendPolicy: CorePolicy = (db, intent) => {
  if (!["SPEND_MONEY", "ORDER_PHYSICAL_SAMPLE"].includes(intent.actionType))
    return { applicable: false, gates: [], denials: [] };
  const denials: string[] = [];
  if (!intent.businessId) denials.push("BUSINESS_REQUIRED");
  const business = intent.businessId
    ? (db
        .prepare("SELECT status FROM business WHERE id=?")
        .get(intent.businessId) as { status: string } | undefined)
    : undefined;
  if (!business || business.status !== "ACTIVE")
    denials.push("BUSINESS_NOT_ACTIVE");
  if (!Number.isInteger(intent.amount) || Number(intent.amount) <= 0)
    denials.push("INVALID_AMOUNT");
  if (!intent.currency) denials.push("CURRENCY_REQUIRED");
  const metadata = intent.metadata ?? {};
  const amount = intent.amount ?? 0;
  const mandate = intent.businessId
    ? (db
        .prepare(
          "SELECT contract_json FROM business_mandate WHERE business_id=? AND status='CONFIRMED'",
        )
        .get(intent.businessId) as { contract_json: string } | undefined)
    : undefined;
  let mandateRequiresHuman = false;
  if (mandate) {
    try {
      const contract = JSON.parse(mandate.contract_json) as {
        budget?: {
          currency?: string;
          maxExplorationSpendCents?: number;
          maxSpendWithoutApprovalCents?: number;
          maxSingleSpendCents?: number;
        };
      };
      const budget = contract.budget;
      if (
        !budget ||
        !Number.isInteger(budget.maxExplorationSpendCents) ||
        !Number.isInteger(budget.maxSpendWithoutApprovalCents) ||
        !Number.isInteger(budget.maxSingleSpendCents)
      )
        denials.push("BUSINESS_MANDATE_BUDGET_INVALID");
      else if (budget.currency !== intent.currency)
        denials.push("BUSINESS_MANDATE_CURRENCY_MISMATCH");
      else {
        if (amount > budget.maxSingleSpendCents!)
          denials.push("BUSINESS_MANDATE_SINGLE_SPEND_LIMIT_EXCEEDED");
        const used = db
          .prepare(
            `SELECT COALESCE((SELECT sum(amount) FROM transaction_entry WHERE business_id=? AND currency=?),0)
              +COALESCE((SELECT sum(c.amount) FROM commitment c JOIN budget b ON b.id=c.budget_id WHERE b.business_id=? AND c.currency=? AND c.status='ACTIVE'),0) used`,
          )
          .get(
            intent.businessId,
            intent.currency,
            intent.businessId,
            intent.currency,
          ) as { used: number };
        if (used.used + amount > budget.maxExplorationSpendCents!)
          denials.push("BUSINESS_MANDATE_TOTAL_SPEND_LIMIT_EXCEEDED");
        mandateRequiresHuman = amount > budget.maxSpendWithoutApprovalCents!;
      }
    } catch {
      denials.push("BUSINESS_MANDATE_BUDGET_INVALID");
    }
  }
  const thresholds = financialThresholds(
    db,
    intent.businessId,
    intent.currency ?? "USD",
  );
  const alwaysHuman = Boolean(
    metadata.legalRisk ||
    metadata.recurring ||
    metadata.credit ||
    metadata.bankTransfer ||
    metadata.contractualCommitment,
  );
  if (alwaysHuman || mandateRequiresHuman || amount > thresholds.treasurerMax)
    return {
      applicable: true,
      gates: [
        gate("budget_integrity", "APPROVE_HIGH_RISK_SPEND", "FINANCIAL_SPEND", {
          humanOnly: true,
          independent: true,
        }),
      ],
      denials,
    };
  if (amount > thresholds.autoMax)
    return {
      applicable: true,
      gates: [
        gate("budget_integrity", "APPROVE_TREASURER_SPEND", "FINANCIAL_SPEND", {
          independent: true,
        }),
      ],
      denials,
    };
  return { applicable: true, gates: [], denials };
};
function financialThresholds(
  db: CultDatabase,
  businessId: string | undefined,
  currency: string,
): { autoMax: number; treasurerMax: number } {
  const organization = db
    .prepare(
      "SELECT auto_max,treasurer_max FROM financial_threshold WHERE scope_type='ORGANIZATION' AND scope_id='organization' AND currency=? AND active=1 ORDER BY version DESC LIMIT 1",
    )
    .get(currency) as { auto_max: number; treasurer_max: number } | undefined;
  if (!organization) return { autoMax: 0, treasurerMax: 0 };
  const local = businessId
    ? (db
        .prepare(
          "SELECT auto_max,treasurer_max FROM financial_threshold WHERE scope_type='BUSINESS' AND scope_id=? AND currency=? AND active=1 ORDER BY version DESC LIMIT 1",
        )
        .get(businessId, currency) as
        { auto_max: number; treasurer_max: number } | undefined)
    : undefined;
  return {
    autoMax: Math.min(
      organization.auto_max,
      local?.auto_max ?? organization.auto_max,
    ),
    treasurerMax: Math.min(
      organization.treasurer_max,
      local?.treasurer_max ?? organization.treasurer_max,
    ),
  };
}
const aiCreativePolicy: CorePolicy = (db, intent) => {
  const artifact = findArtifact(db, intent);
  if (
    !artifact ||
    !Number(artifact.ai_generated) ||
    !(
      Number(artifact.public_facing) ||
      Number(artifact.commercial) ||
      intent.metadata?.sentToProduction
    )
  )
    return { applicable: false, gates: [], denials: [] };
  return {
    applicable: true,
    gates: [
      gate(
        "creative_quality",
        "APPROVE_PUBLIC_AI_ART",
        "AI_GENERATED_VISUAL_PUBLIC_USE",
        {
          humanOnly: true,
          independent: true,
          subjectType: "ARTIFACT_VERSION",
          subjectId: String(artifact.version_id),
          subjectVersion: String(artifact.content_hash),
        },
      ),
    ],
    denials: [],
  };
};
const commercialIpPolicy: CorePolicy = (db, intent) => {
  const artifact = findArtifact(db, intent);
  if (
    !artifact ||
    !(Number(artifact.commercial) || intent.actionType === "PUBLISH_PRODUCT")
  )
    return { applicable: false, gates: [], denials: [] };
  const sourceCount = (
    db
      .prepare(
        "SELECT count(*) n FROM artifact_source WHERE artifact_version_id=?",
      )
      .get(artifact.version_id) as { n: number }
  ).n;
  const clearance = db
    .prepare(
      "SELECT risk FROM ip_clearance WHERE artifact_version_id=? ORDER BY created_at DESC LIMIT 1",
    )
    .get(artifact.version_id) as { risk: string } | undefined;
  const denials: string[] = [];
  if (!sourceCount) denials.push("ARTIFACT_PROVENANCE_MISSING");
  if (clearance?.risk === "HIGH") denials.push("IP_RISK_HIGH");
  const subject = {
    subjectType: "ARTIFACT_VERSION",
    subjectId: String(artifact.version_id),
    subjectVersion: String(artifact.content_hash),
  };
  const gates = [
    gate(
      "intellectual_property_compliance",
      "APPROVE_IP_CLEARANCE",
      "COMMERCIAL_CREATIVE_IP",
      { independent: true, ...subject },
    ),
  ];
  if (
    clearance?.risk === "MEDIUM" ||
    clearance?.risk === "UNCERTAIN" ||
    !clearance
  )
    gates.push(
      gate(
        "intellectual_property_compliance",
        "APPROVE_LEGAL_RISK",
        "COMMERCIAL_CREATIVE_IP",
        { humanOnly: true, independent: true, ...subject },
      ),
    );
  return { applicable: true, gates, denials };
};
const physicalPolicy: CorePolicy = (db, intent) => {
  if (
    intent.actionType !== "PUBLISH_PRODUCT" ||
    intent.subjectType !== "PRODUCT_VERSION"
  )
    return { applicable: false, gates: [], denials: [] };
  const product = db
    .prepare(
      "SELECT p.fulfillment_kind,p.product_family,pv.supplier_id,pv.material,pv.process,pv.packaging,pv.shipping_method FROM product_version pv JOIN product p ON p.id=pv.product_id WHERE pv.id=? AND pv.content_hash=?",
    )
    .get(intent.subjectId, intent.subjectVersion) as
    Record<string, unknown> | undefined;
  if (!product || product.fulfillment_kind !== "PHYSICAL")
    return {
      applicable: false,
      gates: [],
      denials: product ? [] : ["SUBJECT_VERSION_NOT_FOUND"],
    };
  const denials: string[] = [];
  if (
    !db
      .prepare(
        "SELECT 1 FROM physical_sample WHERE product_version_id=? AND is_real=1 AND inspection_result='PASS'",
      )
      .get(intent.subjectId)
  )
    denials.push("REAL_PHYSICAL_SAMPLE_PASS_MISSING");
  const contextHash = createHash("sha256")
    .update(
      JSON.stringify([
        String(product.supplier_id ?? ""),
        String(product.product_family ?? ""),
        String(product.material ?? ""),
        String(product.process ?? ""),
        String(product.packaging ?? ""),
        String(product.shipping_method ?? ""),
      ]),
    )
    .digest("hex");
  if (
    !db
      .prepare(
        "SELECT 1 FROM supplier_qualification WHERE supplier_id=? AND context_hash=? AND result IN ('PASS','CONDITIONAL') AND invalidated_at IS NULL AND (expires_at IS NULL OR expires_at>?)",
      )
      .get(product.supplier_id, contextHash, new Date().toISOString())
  )
    denials.push("SUPPLIER_QUALIFICATION_MISSING");
  return {
    applicable: true,
    gates: [
      gate(
        "physical_product_approval",
        "APPROVE_PHYSICAL_SAMPLE",
        "PHYSICAL_PRODUCT_COMMERCIAL_RELEASE",
        { humanOnly: true, independent: true },
      ),
      gate(
        "supplier_qualification",
        "APPROVE_SUPPLIER",
        "PHYSICAL_PRODUCT_COMMERCIAL_RELEASE",
        { humanOnly: true, independent: true },
      ),
      gate(
        "release_quality",
        "APPROVE_RELEASE_QUALITY",
        "PHYSICAL_PRODUCT_COMMERCIAL_RELEASE",
        { independent: true },
      ),
      gate(
        "unit_economics",
        "APPROVE_UNIT_ECONOMICS",
        "PHYSICAL_PRODUCT_COMMERCIAL_RELEASE",
        { independent: true },
      ),
      gate(
        "strategy",
        "APPROVE_BUSINESS_CASE",
        "PHYSICAL_PRODUCT_COMMERCIAL_RELEASE",
        { independent: true },
      ),
    ],
    denials,
  };
};
const productionReleasePolicy: CorePolicy = (db, intent) =>
  intent.actionType === "RELEASE_CODE"
    ? {
        applicable: true,
        gates: [
          gate(
            "release_quality",
            "APPROVE_RELEASE_QUALITY",
            "PRODUCTION_RELEASE",
            { independent: true },
          ),
        ],
        denials:
          intent.subjectType !== "GIT_COMMIT" ||
          !db
            .prepare(
              "SELECT 1 FROM git_commit WHERE repository_id=? AND sha=? AND pushed_at IS NOT NULL AND remote_verified_at IS NOT NULL",
            )
            .get(intent.subjectId, intent.subjectVersion)
            ? ["DURABLE_GIT_COMMIT_NOT_FOUND"]
            : [],
      }
    : { applicable: false, gates: [], denials: [] };
const foundationChangePolicy: CorePolicy = (_db, intent) =>
  intent.actionType === "FOUNDATION_CHANGE"
    ? {
        applicable: true,
        gates: [
          gate(
            "foundation_integrity",
            "MODIFY_FOUNDATION",
            "FOUNDATION_CHANGE",
            { humanOnly: true, independent: true },
          ),
          gate(
            "release_quality",
            "APPROVE_RELEASE_QUALITY",
            "FOUNDATION_CHANGE",
            { independent: true },
          ),
        ],
        denials: [],
      }
    : { applicable: false, gates: [], denials: [] };

function classifiedMarketSubject(
  db: CultDatabase,
  intent: ActionIntent,
): Record<string, unknown> {
  let stored: Record<string, unknown> = {};
  if (intent.subjectType === "PRODUCT_VERSION")
    stored =
      (db
        .prepare(
          `SELECT p.commercial,p.creative,p.culture_sensitive,p.trend_sensitive,p.identity_sensitive,p.target_segment,p.market,p.language,p.geography FROM product_version pv JOIN product p ON p.id=pv.product_id WHERE pv.id=? AND pv.content_hash=?`,
        )
        .get(intent.subjectId, intent.subjectVersion) as
        Record<string, unknown> | undefined) ?? {};
  else if (intent.subjectType === "ARTIFACT_VERSION")
    stored =
      (db
        .prepare(
          `SELECT a.commercial,a.creative,a.culture_sensitive,a.trend_sensitive,a.identity_sensitive FROM artifact_version av JOIN artifact a ON a.id=av.artifact_id WHERE av.id=? AND av.content_hash=?`,
        )
        .get(intent.subjectId, intent.subjectVersion) as
        Record<string, unknown> | undefined) ?? {};
  return { ...stored, ...(intent.metadata ?? {}) };
}

const booleanClassification = (
  subject: Record<string, unknown>,
  snake: string,
  camel: string,
): boolean => Boolean(subject[snake] ?? subject[camel]);

const marketRelevancePolicy: CorePolicy = (db, intent) => {
  const subject = classifiedMarketSubject(db, intent);
  const sensitive =
    booleanClassification(subject, "creative", "creative") ||
    booleanClassification(subject, "culture_sensitive", "cultureSensitive") ||
    booleanClassification(subject, "trend_sensitive", "trendSensitive") ||
    booleanClassification(subject, "identity_sensitive", "identitySensitive");
  const commercial = booleanClassification(subject, "commercial", "commercial");
  const stageApplies =
    ["DESIGN_READY", "PUBLISH_PRODUCT"].includes(intent.actionType) ||
    (["SPEND_MONEY", "ORDER_PHYSICAL_SAMPLE"].includes(intent.actionType) &&
      Boolean(subject.majorInvestment ?? subject.major_investment));
  if (!commercial || !sensitive || !stageApplies)
    return { applicable: false, gates: [], denials: [] };
  if (!intent.businessId)
    return {
      applicable: true,
      gates: [],
      denials: ["BUSINESS_REQUIRED"],
    };
  const marketStudyId =
    String(subject.marketStudyId ?? subject.market_study_id ?? "") || undefined;
  const applicability = {
    businessId: intent.businessId,
    ...(marketStudyId ? { marketStudyId } : {}),
    ...((subject.targetSegment ?? subject.target_segment)
      ? {
          targetSegment: String(
            subject.targetSegment ?? subject.target_segment,
          ),
        }
      : {}),
    ...(subject.market ? { market: String(subject.market) } : {}),
    ...(subject.language ? { language: String(subject.language) } : {}),
    ...(subject.geography ? { geography: String(subject.geography) } : {}),
  };
  const hasApplicability = Boolean(
    marketStudyId ||
    applicability.targetSegment ||
    applicability.market ||
    applicability.language ||
    applicability.geography,
  );
  const study = hasApplicability
    ? findApplicableFreshMarketStudy(db, applicability)
    : undefined;
  const reason = hasApplicability
    ? marketStudyFailureReason(db, applicability)
    : "MARKET_RELEVANCE_NOT_APPLICABLE";
  return {
    applicable: true,
    gates: [
      gate(
        "CULTURAL_MARKET_INTELLIGENCE",
        "APPROVE_MARKET_RELEVANCE",
        "MARKET_RELEVANCE_REQUIRED",
        {
          independent: false,
          ...(study
            ? {
                marketStudyId: String(study.id),
                expiresAt: String(study.valid_until),
              }
            : {}),
        },
      ),
    ],
    denials: reason ? [reason] : [],
  };
};
export const corePolicies: CorePolicy[] = [
  businessMandatePolicy,
  marketRelevancePolicy,
  financialSpendPolicy,
  aiCreativePolicy,
  commercialIpPolicy,
  physicalPolicy,
  productionReleasePolicy,
  foundationChangePolicy,
];

function findArtifact(
  db: CultDatabase,
  intent: ActionIntent,
): Record<string, unknown> | undefined {
  if (intent.subjectType === "ARTIFACT_VERSION")
    return db
      .prepare(
        "SELECT av.id version_id,av.content_hash,av.ai_generated,a.public_facing,a.commercial FROM artifact_version av JOIN artifact a ON a.id=av.artifact_id WHERE av.id=? AND av.content_hash=?",
      )
      .get(intent.subjectId, intent.subjectVersion) as
      Record<string, unknown> | undefined;
  if (intent.subjectType === "PRODUCT_VERSION")
    return db
      .prepare(
        "SELECT av.id version_id,av.content_hash,av.ai_generated,a.public_facing,a.commercial FROM product_version pv JOIN artifact_version av ON av.id=pv.artifact_version_id JOIN artifact a ON a.id=av.artifact_id WHERE pv.id=? AND pv.content_hash=?",
      )
      .get(intent.subjectId, intent.subjectVersion) as
      Record<string, unknown> | undefined;
  return undefined;
}

function localPolicyDenials(db: CultDatabase, intent: ActionIntent): string[] {
  if (!intent.businessId) return [];
  const policies = db
    .prepare(
      "SELECT rule_type,parameters FROM business_policy WHERE business_id=? AND status='ACTIVE' AND effective_from<=? AND (effective_until IS NULL OR effective_until>?)",
    )
    .all(
      intent.businessId,
      new Date().toISOString(),
      new Date().toISOString(),
    ) as Array<{ rule_type: string; parameters: string }>;
  const denials: string[] = [];
  for (const policy of policies) {
    if (
      policy.rule_type === "DENY_EXTERNAL_SPEND" &&
      ["SPEND_MONEY", "ORDER_PHYSICAL_SAMPLE"].includes(intent.actionType)
    )
      denials.push("BUSINESS_POLICY_DENIES_SPEND");
    if (policy.rule_type === "DENY_ACTION") {
      try {
        if (
          (JSON.parse(policy.parameters) as { actionType?: string })
            .actionType === intent.actionType
        )
          denials.push("BUSINESS_POLICY_DENIES_ACTION");
      } catch {
        denials.push("INVALID_BUSINESS_POLICY_FAIL_CLOSED");
      }
    }
  }
  return denials;
}

export function evaluateAction(
  db: CultDatabase,
  intent: ActionIntent,
  createGates = true,
): PolicyDecision {
  if (
    !db
      .prepare("SELECT 1 FROM actor WHERE id=? AND status='ACTIVE'")
      .get(intent.actorId)
  )
    return {
      outcome: "DENY",
      allowed: false,
      requiredGates: [],
      missingGates: [],
      denialReasons: ["ACTOR_NOT_ACTIVE"],
      applicablePolicies: [],
    };
  const assurance = assessActionAssurance(db, intent);
  const results = corePolicies.map((policy) => policy(db, intent));
  const applicablePolicies: string[] = [];
  const required = new Map<string, GateRequirement>();
  const denials = localPolicyDenials(db, intent);
  if (!results.some((result) => result.applicable))
    denials.push("NO_POLICY_FOR_SENSITIVE_ACTION");
  for (const result of results) {
    if (!result.applicable) continue;
    for (const requirement of result.gates) {
      applicablePolicies.push(
        `${requirement.policyId}@${requirement.policyVersion}`,
      );
      required.set(
        `${requirement.responsibility}:${requirement.authority}:${requirement.policyId}:${requirement.policyVersion}`,
        requirement,
      );
    }
    denials.push(...result.denials);
  }
  if (assurance.applicable)
    applicablePolicies.push(
      `BUSINESS_ASSURANCE@${CORE_POLICY_VERSIONS.BUSINESS_ASSURANCE}`,
    );
  if (assurance.applicable && !assurance.allowed)
    return {
      outcome: "DENY",
      allowed: false,
      requiredGates: [],
      missingGates: [],
      denialReasons: [...new Set([...denials, ...assurance.reasons])],
      applicablePolicies: [...new Set(applicablePolicies)],
    };
  const requiredGates = [...required.values()];
  const missing: PolicyDecision["missingGates"] = [];
  for (const requirement of requiredGates) {
    const subjectType = requirement.subjectType ?? intent.subjectType,
      subjectId = requirement.subjectId ?? intent.subjectId,
      subjectVersion = requirement.subjectVersion ?? intent.subjectVersion;
    let gateId: string | undefined;
    if (createGates)
      gateId = requireGate(db, {
        ...requirement,
        workItemId: intent.workItemId,
        subjectType,
        subjectId,
        subjectVersion,
        producerActorId: intent.actorId,
        repositoryId:
          requirement.repositoryId ??
          (subjectType === "GIT_COMMIT" &&
          db.prepare("SELECT 1 FROM repository WHERE id=?").get(subjectId)
            ? subjectId
            : undefined),
      });
    else {
      const row = db
        .prepare(
          `SELECT g.id FROM gate g JOIN responsibility r ON r.id=g.responsibility_id WHERE r.slug=? AND g.subject_type=? AND g.subject_id=? AND g.subject_version=? AND g.policy_id=? AND g.policy_version=?`,
        )
        .get(
          requirement.responsibility,
          subjectType,
          subjectId,
          subjectVersion,
          requirement.policyId,
          requirement.policyVersion,
        ) as { id: string } | undefined;
      gateId = row?.id;
    }
    if (!gateId || !validateApproval(db, gateId, subjectVersion))
      missing.push({ ...requirement, ...(gateId ? { gateId } : {}) });
  }
  if (createGates && intent.workItemId && missing.length) {
    const work = db
      .prepare("SELECT status FROM work_item WHERE id=?")
      .get(intent.workItemId) as { status: string } | undefined;
    if (work && ["READY", "RUNNING"].includes(work.status))
      transitionWorkItem(db, intent.workItemId, "WAITING_GATE", "system");
  }
  const uniquePolicies = [...new Set(applicablePolicies)];
  if (denials.length)
    return {
      outcome: "DENY",
      allowed: false,
      requiredGates,
      missingGates: missing,
      denialReasons: [...new Set(denials)],
      applicablePolicies: uniquePolicies,
    };
  if (createGates && assurance.applicable && assurance.decisionId)
    recordActionAssurance(db, intent, assurance.decisionId);
  if (missing.length)
    return {
      outcome: "BLOCK",
      allowed: false,
      requiredGates,
      missingGates: missing,
      denialReasons: [],
      applicablePolicies: uniquePolicies,
    };
  return {
    outcome: "ALLOW",
    allowed: true,
    requiredGates,
    missingGates: [],
    denialReasons: [],
    applicablePolicies: uniquePolicies,
  };
}

export function assertActionAllowed(
  db: CultDatabase,
  intent: ActionIntent,
): void {
  const decision = evaluateAction(db, intent, true);
  if (!decision.allowed)
    throw new Cult4Error(
      `Action ${decision.outcome}: ${[...decision.denialReasons, ...decision.missingGates.map((g) => g.responsibility)].join(", ")}`,
      decision.outcome === "DENY" ? "ACTION_DENIED" : "ACTION_BLOCKED",
      decision,
    );
}
