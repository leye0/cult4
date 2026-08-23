import { createHash } from "node:crypto";
import type { CultDatabase } from "./db.js";
import { audit } from "./audit.js";
import { Cult4Error, id, json, now, type ActionIntent } from "./domain.js";

export const ASSURANCE_REQUIRED_ACTIONS = new Set([
  "SPEND_MONEY",
  "ORDER_PHYSICAL_SAMPLE",
  "PUBLISH_PRODUCT",
  "SEND_PUBLIC_MESSAGE",
  "SIGN_COMMITMENT",
  "CREATE_EXTERNAL_ACCOUNT",
]);

const hash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function claimAssuranceVersion(
  db: CultDatabase,
  claimId: string,
): string {
  const claim = db
    .prepare("SELECT statement,status FROM claim WHERE id=?")
    .get(claimId) as { statement: string; status: string } | undefined;
  if (!claim) throw new Cult4Error("Claim not found.", "CLAIM_NOT_FOUND");
  const evidence = db
    .prepare(
      `SELECT id,source_id,summary,reliability,applicability,confidence,
              contradiction,observed_at,observation_type,metadata_json
       FROM evidence WHERE claim_id=? ORDER BY id`,
    )
    .all(claimId);
  return hash({ claim, evidence });
}

export function registerBusinessControl(
  db: CultDatabase,
  input: {
    businessId: string;
    slug: string;
    description: string;
    validationCommand: string;
    requiredActions: string[];
    codeVersion: string;
    declaredBy: string;
  },
): string {
  if (!/^[a-z][a-z0-9_-]{2,80}$/.test(input.slug))
    throw new Cult4Error("Invalid control slug.", "INVALID_CONTROL_SLUG");
  if (!input.validationCommand.trim() || !input.codeVersion.trim())
    throw new Cult4Error(
      "A control requires an executable validation command and code version.",
      "CONTROL_DEFINITION_INCOMPLETE",
    );
  const actions = [...new Set(input.requiredActions)];
  if (
    !actions.length ||
    actions.some((action) => !ASSURANCE_REQUIRED_ACTIONS.has(action))
  )
    throw new Cult4Error(
      "Control requiredActions must contain supported sensitive actions.",
      "CONTROL_ACTION_INVALID",
    );
  const existing = db
    .prepare(
      "SELECT id,code_version FROM business_control WHERE business_id=? AND slug=?",
    )
    .get(input.businessId, input.slug) as
    { id: string; code_version: string } | undefined;
  const controlId = existing?.id ?? id("control");
  const changed = existing && existing.code_version !== input.codeVersion;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO business_control(
        id,business_id,slug,description,validation_command,required_actions_json,
        code_version,status,declared_by,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,'EXPERIMENTAL',?,?,?)
      ON CONFLICT(business_id,slug) DO UPDATE SET
        description=excluded.description,
        validation_command=excluded.validation_command,
        required_actions_json=excluded.required_actions_json,
        code_version=excluded.code_version,
        status=CASE WHEN business_control.code_version<>excluded.code_version
          THEN 'EXPERIMENTAL' ELSE business_control.status END,
        declared_by=excluded.declared_by,
        updated_at=excluded.updated_at`,
    ).run(
      controlId,
      input.businessId,
      input.slug,
      input.description,
      input.validationCommand,
      json(actions),
      input.codeVersion,
      input.declaredBy,
      now(),
      now(),
    );
    audit(db, {
      type: changed ? "BUSINESS_CONTROL_STALE" : "BUSINESS_CONTROL_DECLARED",
      actorId: input.declaredBy,
      businessId: input.businessId,
      subjectType: "BUSINESS_CONTROL",
      subjectId: controlId,
      subjectVersion: input.codeVersion,
      data: { slug: input.slug, requiredActions: actions },
    });
  })();
  return controlId;
}

export function recordControlValidation(
  db: CultDatabase,
  input: {
    controlId: string;
    workItemId: string;
    subjectType: string;
    subjectId: string;
    subjectVersion?: string;
    inputHash?: string;
    result: "PASS" | "FAIL";
    level: "TESTED" | "QA_VERIFIED";
    evidence: string[];
    validatedBy: string;
    expiresAt?: string;
  },
): string {
  const control = db
    .prepare(
      "SELECT business_id,code_version,declared_by FROM business_control WHERE id=?",
    )
    .get(input.controlId) as
    | { business_id: string; code_version: string; declared_by: string }
    | undefined;
  if (!control)
    throw new Cult4Error("Business control not found.", "CONTROL_NOT_FOUND");
  const work = db
    .prepare("SELECT business_id,type,assigned_to FROM work_item WHERE id=?")
    .get(input.workItemId) as
    | { business_id: string | null; type: string; assigned_to: string | null }
    | undefined;
  if (
    !work ||
    work.business_id !== control.business_id ||
    (work.assigned_to && work.assigned_to !== input.validatedBy)
  )
    throw new Cult4Error(
      "Validation is outside the assigned Business work scope.",
      "CONTROL_VALIDATION_SCOPE_DENIED",
    );
  if (
    input.level === "QA_VERIFIED" &&
    (work.type !== "DIGITAL_QA" || control.declared_by === input.validatedBy)
  )
    throw new Cult4Error(
      "QA verification requires an independent DIGITAL_QA WorkItem.",
      "CONTROL_QA_INDEPENDENCE_REQUIRED",
    );
  if (!input.evidence.length)
    throw new Cult4Error(
      "Control validation requires durable evidence.",
      "CONTROL_VALIDATION_EVIDENCE_REQUIRED",
    );
  const subjectVersion =
    input.subjectType === "CLAIM"
      ? claimAssuranceVersion(db, input.subjectId)
      : input.subjectVersion;
  if (!subjectVersion)
    throw new Cult4Error(
      "Non-claim validation requires an exact subject version.",
      "CONTROL_SUBJECT_VERSION_REQUIRED",
    );
  const inputHash = input.inputHash ?? subjectVersion;
  const validationId = id("validation");
  db.transaction(() => {
    db.prepare(
      `INSERT INTO control_validation(
        id,control_id,subject_type,subject_id,subject_version,input_hash,
        code_version,result,level,validated_by,evidence_json,created_at,expires_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      validationId,
      input.controlId,
      input.subjectType,
      input.subjectId,
      subjectVersion,
      inputHash,
      control.code_version,
      input.result,
      input.level,
      input.validatedBy,
      json(input.evidence),
      now(),
      input.expiresAt ?? null,
    );
    db.prepare(
      `UPDATE business_control SET status=?,updated_at=? WHERE id=?`,
    ).run(
      input.result === "FAIL"
        ? "STALE"
        : input.level === "QA_VERIFIED"
          ? "QA_VERIFIED"
          : "TESTED",
      now(),
      input.controlId,
    );
    audit(db, {
      type: "CONTROL_VALIDATED",
      actorId: input.validatedBy,
      businessId: control.business_id,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectVersion,
      data: {
        controlId: input.controlId,
        validationId,
        result: input.result,
        level: input.level,
      },
    });
  })();
  return validationId;
}

export function linkDecisionClaims(
  db: CultDatabase,
  decisionId: string,
  claimIds: string[],
): void {
  const decision = db
    .prepare("SELECT business_id FROM decision WHERE id=?")
    .get(decisionId) as { business_id: string | null } | undefined;
  if (!decision)
    throw new Cult4Error("Decision not found.", "DECISION_NOT_FOUND");
  for (const claimId of [...new Set(claimIds)]) {
    const claim = db
      .prepare("SELECT business_id FROM claim WHERE id=?")
      .get(claimId) as { business_id: string | null } | undefined;
    if (!claim || claim.business_id !== decision.business_id)
      throw new Cult4Error(
        "Material claims must belong to the Decision Business.",
        "DECISION_CLAIM_SCOPE_DENIED",
      );
    db.prepare(
      "INSERT OR IGNORE INTO decision_claim(decision_id,claim_id,material) VALUES(?,?,1)",
    ).run(decisionId, claimId);
  }
}

export interface AssuranceAssessment {
  applicable: boolean;
  allowed: boolean;
  decisionId?: string;
  reasons: string[];
}

export function assessActionAssurance(
  db: CultDatabase,
  intent: ActionIntent,
): AssuranceAssessment {
  if (!ASSURANCE_REQUIRED_ACTIONS.has(intent.actionType))
    return { applicable: false, allowed: true, reasons: [] };
  const enforced = intent.businessId
    ? db
        .prepare(
          `SELECT 1 FROM business_policy WHERE business_id=?
           AND rule_type='REQUIRE_ASSURANCE' AND status='ACTIVE'
           AND effective_from<=? AND (effective_until IS NULL OR effective_until>?)`,
        )
        .get(intent.businessId, now(), now())
    : undefined;
  if (!enforced) return { applicable: false, allowed: true, reasons: [] };
  if (!intent.businessId)
    return {
      applicable: true,
      allowed: false,
      reasons: ["ASSURANCE_BUSINESS_REQUIRED"],
    };
  const decisionId = String(intent.metadata?.decisionId ?? "");
  if (!decisionId)
    return {
      applicable: true,
      allowed: false,
      reasons: ["MATERIAL_DECISION_REQUIRED"],
    };
  const decision = db
    .prepare(
      "SELECT business_id,subject_type,subject_id,subject_version,created_by FROM decision WHERE id=?",
    )
    .get(decisionId) as
    | {
        business_id: string | null;
        subject_type: string | null;
        subject_id: string | null;
        subject_version: string | null;
        created_by: string;
      }
    | undefined;
  if (!decision || decision.business_id !== intent.businessId)
    return {
      applicable: true,
      allowed: false,
      decisionId,
      reasons: ["MATERIAL_DECISION_NOT_FOUND"],
    };
  if (
    (decision.subject_type && decision.subject_type !== intent.subjectType) ||
    (decision.subject_id && decision.subject_id !== intent.subjectId) ||
    (decision.subject_version &&
      decision.subject_version !== intent.subjectVersion)
  )
    return {
      applicable: true,
      allowed: false,
      decisionId,
      reasons: ["MATERIAL_DECISION_SUBJECT_MISMATCH"],
    };
  const claims = db
    .prepare(
      `SELECT c.id,c.status,c.created_by FROM decision_claim dc
       JOIN claim c ON c.id=dc.claim_id
       WHERE dc.decision_id=? AND dc.material=1`,
    )
    .all(decisionId) as Array<{
    id: string;
    status: string;
    created_by: string;
  }>;
  if (!claims.length)
    return {
      applicable: true,
      allowed: false,
      decisionId,
      reasons: ["MATERIAL_CLAIMS_REQUIRED"],
    };
  const reasons: string[] = [];
  for (const claim of claims) {
    if (claim.status !== "SUPPORTED") {
      reasons.push(`MATERIAL_CLAIM_NOT_SUPPORTED:${claim.id}`);
      continue;
    }
    const evidence = db
      .prepare(
        `SELECT 1 FROM evidence WHERE claim_id=? AND contradiction=0
         AND (source_id IS NOT NULL OR observed_at IS NOT NULL) LIMIT 1`,
      )
      .get(claim.id);
    if (!evidence) {
      reasons.push(`MATERIAL_CLAIM_EVIDENCE_MISSING:${claim.id}`);
      continue;
    }
    const version = claimAssuranceVersion(db, claim.id);
    const validations = db
      .prepare(
        `SELECT cv.validated_by,bc.required_actions_json,bc.declared_by
         FROM control_validation cv
         JOIN business_control bc ON bc.id=cv.control_id
         WHERE bc.business_id=? AND bc.status='QA_VERIFIED'
           AND cv.subject_type='CLAIM' AND cv.subject_id=?
           AND cv.subject_version=? AND cv.code_version=bc.code_version
           AND cv.result='PASS' AND cv.level='QA_VERIFIED'
           AND (cv.expires_at IS NULL OR cv.expires_at>?)`,
      )
      .all(intent.businessId, claim.id, version, now()) as Array<{
      validated_by: string;
      required_actions_json: string;
      declared_by: string;
    }>;
    const valid = validations.some((validation) => {
      let actions: unknown;
      try {
        actions = JSON.parse(validation.required_actions_json);
      } catch {
        return false;
      }
      return (
        Array.isArray(actions) &&
        actions.includes(intent.actionType) &&
        validation.validated_by !== claim.created_by &&
        validation.validated_by !== decision.created_by
      );
    });
    if (!valid) reasons.push(`MATERIAL_CLAIM_QA_MISSING:${claim.id}`);
  }
  return {
    applicable: true,
    allowed: reasons.length === 0,
    decisionId,
    reasons,
  };
}

export function recordActionAssurance(
  db: CultDatabase,
  intent: ActionIntent,
  decisionId: string,
): string {
  const assuranceId = id("assurance");
  db.prepare(
    `INSERT INTO action_assurance(
      id,business_id,work_item_id,decision_id,action_type,subject_type,
      subject_id,subject_version,assessed_by,assessed_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(business_id,decision_id,action_type,subject_type,subject_id,subject_version)
    DO UPDATE SET work_item_id=excluded.work_item_id,
      assessed_by=excluded.assessed_by,assessed_at=excluded.assessed_at`,
  ).run(
    assuranceId,
    intent.businessId,
    intent.workItemId ?? null,
    decisionId,
    intent.actionType,
    intent.subjectType,
    intent.subjectId,
    intent.subjectVersion,
    intent.actorId,
    now(),
  );
  return assuranceId;
}

export function invalidateUnassuredFinancialRequests(db: CultDatabase): number {
  const rows = db
    .prepare(
      `SELECT DISTINCT g.id,hr.business_id,hr.id human_request_id,
              hr.work_item_id,hr.subject_type,hr.subject_id,hr.subject_version
       FROM gate g JOIN human_request hr ON hr.gate_id=g.id
       JOIN business_policy bp ON bp.business_id=hr.business_id
         AND bp.rule_type='REQUIRE_ASSURANCE' AND bp.status='ACTIVE'
       WHERE g.policy_id='FINANCIAL_SPEND'
         AND g.status IN ('PENDING','REQUIRED')
         AND hr.status IN ('PENDING','REMINDER_DUE','OVERDUE')
         AND NOT EXISTS(
           SELECT 1 FROM action_assurance aa
           WHERE aa.business_id=hr.business_id
             AND aa.work_item_id IS hr.work_item_id
             AND aa.subject_type=hr.subject_type
             AND aa.subject_id=hr.subject_id
             AND aa.subject_version=hr.subject_version
         )`,
    )
    .all() as Array<{
    id: string;
    business_id: string;
    human_request_id: string;
    subject_type: string;
    subject_id: string;
    subject_version: string;
  }>;
  for (const row of rows)
    db.transaction(() => {
      db.prepare(
        "UPDATE gate SET status='INVALIDATED',satisfied_by_approval_id=NULL WHERE id=?",
      ).run(row.id);
      db.prepare(
        "UPDATE human_request SET status='CANCELLED',resolved_at=?,resolved_by='system' WHERE id=?",
      ).run(now(), row.human_request_id);
      audit(db, {
        type: "UNASSURED_ACTION_INVALIDATED",
        actorId: "system",
        businessId: row.business_id,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        subjectVersion: row.subject_version,
        data: { gateId: row.id, humanRequestId: row.human_request_id },
      });
    })();
  return rows.length;
}
