import { realpathSync } from "node:fs";
import { z } from "zod";
import type { CultDatabase } from "./db.js";
import { Cult4Error, now, type ActionIntent } from "./domain.js";
import { getEmployeeContext } from "./employee.js";
import {
  addDependency,
  createWorkItem,
  listReadyWork,
  transitionWorkItem,
} from "./work.js";
import { remember, searchMemory } from "./memory.js";
import {
  recordClaim,
  recordDecision,
  recordEvidence,
  recordSource,
} from "./evidence.js";
import { evaluateAction } from "./policy.js";
import { createHumanRequest } from "./human.js";
import { requestSpend } from "./finance.js";
import {
  createArtifactVersion,
  recordIpClearance,
  recordProvenance,
  registerArtifact,
} from "./artifact.js";
import { grantApproval, rejectGate } from "./approval.js";
import { proposePromotion } from "./memory.js";
import { proposeImprovement, reviewImprovement } from "./organization.js";
import { getConfig } from "./config.js";
import {
  attachEvidenceToMarketStudy,
  completeMarketStudy,
  createCreativeBrief,
  createMarketSignal,
  createMarketStudy,
  getMarketStudy,
  linkSignalEvidence,
  startMarketStudy,
} from "./market.js";
import {
  hasConfirmedBusinessMandate,
  latestBusinessMandate,
  proposeBusinessMandate,
} from "./mandate.js";
import { audit } from "./audit.js";
import {
  assertMandateRequestCoverage,
  assertWorkRequestLinks,
  linkWorkRequests,
  recordRequestVerification,
  syncIntakeTranscript,
} from "./requirements.js";
import {
  linkDecisionClaims,
  recordControlValidation,
  registerBusinessControl,
} from "./assurance.js";
import {
  assertWorkAssignmentQualified,
  requiredCapabilitiesForWork,
  routeQualifiedEmployee,
} from "./staffing.js";

const workSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
  priority: z.number().int().min(0).max(100).optional(),
  risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  assignedTo: z.string().optional(),
  parentId: z.string().optional(),
  requiredCapabilities: z.array(z.string().min(1)).optional(),
  requestIds: z.array(z.string()).min(1),
});
const actionSchema = z.object({
  actionType: z.enum([
    "PUBLISH_PRODUCT",
    "SPEND_MONEY",
    "CREATE_EXTERNAL_ACCOUNT",
    "SEND_PUBLIC_MESSAGE",
    "SIGN_COMMITMENT",
    "RELEASE_CODE",
    "ORDER_PHYSICAL_SAMPLE",
    "DESIGN_READY",
    "FOUNDATION_CHANGE",
  ]),
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
  subjectVersion: z.string().min(1),
  amount: z.number().int().positive().optional(),
  currency: z.string().optional(),
  destination: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export interface ToolContext {
  employeeId: string;
  workItemId: string;
  directory: string;
  sessionId?: string;
}
function businessForContext(
  db: CultDatabase,
  context: ToolContext,
): { id: string } {
  const path = realpathSync(context.directory);
  const row = db
    .prepare(
      `SELECT id FROM business WHERE repo_path=? AND status='ACTIVE' UNION SELECT rw.business_id id FROM review_worktree rw JOIN business b ON b.id=rw.business_id WHERE rw.path=? AND rw.work_item_id=? AND rw.status='ACTIVE' AND b.status='ACTIVE'`,
    )
    .get(path, path, context.workItemId) as { id: string } | undefined;
  if (!row)
    throw new Cult4Error(
      "Tool context is not a registered active business repository.",
      "TOOL_SCOPE_DENIED",
    );
  const work = db
    .prepare("SELECT business_id,assigned_to FROM work_item WHERE id=?")
    .get(context.workItemId) as
    { business_id: string; assigned_to: string | null } | undefined;
  if (
    !work ||
    work.business_id !== row.id ||
    (work.assigned_to && work.assigned_to !== context.employeeId)
  )
    throw new Cult4Error(
      "Tool context does not match mission assignment.",
      "TOOL_SCOPE_DENIED",
    );
  return row;
}
export function executeTool(
  db: CultDatabase,
  name: string,
  payload: unknown,
  context: ToolContext,
): unknown {
  if (name === "bootstrap")
    return getEmployeeContext(db, context.employeeId, context.workItemId);
  const organizationWork = db
    .prepare(
      "SELECT assigned_to FROM work_item WHERE id=? AND business_id IS NULL",
    )
    .get(context.workItemId) as { assigned_to: string | null } | undefined;
  if (organizationWork) {
    if (
      realpathSync(context.directory) !==
        realpathSync(getConfig().organizationPath) ||
      (organizationWork.assigned_to &&
        organizationWork.assigned_to !== context.employeeId)
    )
      throw new Cult4Error(
        "Organization tool context does not match mission assignment.",
        "TOOL_SCOPE_DENIED",
      );
    if (name === "record_approval") {
      const input = z
        .object({
          gateId: z.string(),
          decision: z.enum(["APPROVE", "REJECT"]),
          notes: z.string().optional(),
          expiresAt: z.string().optional(),
        })
        .parse(payload);
      return {
        approvalId:
          input.decision === "APPROVE"
            ? grantApproval(
                db,
                input.gateId,
                context.employeeId,
                input.notes,
                input.expiresAt,
              )
            : rejectGate(db, input.gateId, context.employeeId, input.notes),
      };
    }
    throw new Cult4Error(
      "Only bootstrap and exact approval tools are available in organization review sessions.",
      "TOOL_SCOPE_DENIED",
    );
  }
  const business = businessForContext(db, context);
  const foundationExists = Boolean(
    db
      .prepare(
        "SELECT 1 FROM work_item WHERE business_id=? AND type='BUSINESS_FOUNDATION'",
      )
      .get(business.id),
  );
  if (
    foundationExists &&
    !hasConfirmedBusinessMandate(db, business.id) &&
    ![
      "get_work",
      "get_state",
      "sync_intake",
      "propose_business_mandate",
      "request_human",
      "finish_intake",
    ].includes(name)
  )
    throw new Cult4Error(
      "Business autonomy is locked until the human confirms an exact operating and narrative mandate.",
      "BUSINESS_MANDATE_REQUIRED",
    );
  switch (name) {
    case "get_work":
      return db
        .prepare("SELECT * FROM work_item WHERE id=? AND business_id=?")
        .get(context.workItemId, business.id);
    case "sync_intake":
      if (context.sessionId)
        syncIntakeTranscript(db, {
          businessId: business.id,
          workItemId: context.workItemId,
          sessionId: context.sessionId,
        });
      return {
        messages: db
          .prepare(
            "SELECT id,ordinal,content,content_hash FROM intake_message WHERE business_id=? AND work_item_id=? ORDER BY ordinal",
          )
          .all(business.id, context.workItemId),
      };
    case "create_work": {
      const input = workSchema.parse(payload);
      if (context.employeeId !== "employee-operator")
        throw new Cult4Error(
          "Only the Operator may structure and route the dynamic work graph.",
          "WORK_GRAPH_DENIED",
        );
      const {
        requestIds,
        requiredCapabilities: declared,
        ...workInput
      } = input;
      const requiredCapabilities = requiredCapabilitiesForWork(
        input.type,
        declared,
      );
      const assignedTo = routeQualifiedEmployee(
        db,
        requiredCapabilities,
        input.assignedTo,
      );
      const workItemId = db.transaction(() => {
        const created = createWorkItem(db, {
          businessId: business.id,
          ...workInput,
          assignedTo,
          requiredCapabilities,
          createdBy: context.employeeId,
          status: "PROPOSED",
        });
        linkWorkRequests(db, created, business.id, requestIds);
        return created;
      })();
      return {
        workItemId,
        assignedTo,
        requiredCapabilities,
      };
    }
    case "add_work_dependency": {
      const input = z
        .object({ workItemId: z.string(), dependsOnWorkItemId: z.string() })
        .parse(payload);
      if (context.employeeId !== "employee-operator")
        throw new Cult4Error(
          "Only the Operator may structure the dynamic work graph.",
          "WORK_GRAPH_DENIED",
        );
      const rows = db
        .prepare(
          `SELECT id,created_by FROM work_item
           WHERE business_id=? AND id IN (?,?)`,
        )
        .all(
          business.id,
          input.workItemId,
          input.dependsOnWorkItemId,
        ) as Array<{ id: string; created_by: string }>;
      if (
        rows.length !== 2 ||
        rows.some((row) => row.created_by !== context.employeeId)
      )
        throw new Cult4Error(
          "Dependencies may only connect Operator-created work in this Business.",
          "WORK_GRAPH_DENIED",
        );
      addDependency(db, input.workItemId, input.dependsOnWorkItemId);
      return { ok: true };
    }
    case "ready_work": {
      const input = z.object({ workItemId: z.string() }).parse(payload);
      if (context.employeeId !== "employee-operator")
        throw new Cult4Error(
          "Only the Operator may ready proposed ordinary work.",
          "WORK_GRAPH_DENIED",
        );
      const target = db
        .prepare(
          `SELECT id FROM work_item
           WHERE id=? AND business_id=? AND created_by=? AND status='PROPOSED'
             AND type<>'OPERATOR_INTERACTION'
             AND (assigned_to IS NULL OR EXISTS(
               SELECT 1 FROM employee WHERE employee.id=work_item.assigned_to AND employee.status='ACTIVE'
             ))`,
        )
        .get(input.workItemId, business.id, context.employeeId);
      if (!target)
        throw new Cult4Error(
          "Only Operator-created proposed work in this Business may be readied.",
          "WORK_GRAPH_DENIED",
        );
      const targetWork = db
        .prepare("SELECT type,business_id FROM work_item WHERE id=?")
        .get(input.workItemId) as { type: string; business_id: string };
      assertWorkRequestLinks(
        db,
        input.workItemId,
        targetWork.type,
        targetWork.business_id,
      );
      assertWorkAssignmentQualified(db, input.workItemId);
      transitionWorkItem(db, input.workItemId, "READY", context.employeeId);
      return { ok: true };
    }
    case "update_work": {
      const input = z
        .object({
          status: z.enum([
            "READY",
            "RUNNING",
            "WAITING_GATE",
            "WAITING_HUMAN",
            "WAITING_EXTERNAL",
            "BLOCKED",
            "FAILED",
            "DONE",
            "CANCELLED",
          ]),
          result: z.string().optional(),
        })
        .parse(payload);
      const assignedWork = db
        .prepare("SELECT type FROM work_item WHERE id=?")
        .get(context.workItemId) as { type: string };
      if (assignedWork.type === "DIGITAL_QA")
        throw new Cult4Error(
          "The trusted Cult4 host owns DIGITAL_QA completion after parsing the exact structured report.",
          "QA_WORK_TRANSITION_HOST_OWNED",
        );
      transitionWorkItem(
        db,
        context.workItemId,
        input.status,
        context.employeeId,
        input.result,
      );
      return { ok: true };
    }
    case "get_state":
      return {
        business: db
          .prepare(
            "SELECT id,slug,name,status,created_at FROM business WHERE id=?",
          )
          .get(business.id),
        mandate: latestBusinessMandate(db, business.id) ?? null,
        officialRequests: db
          .prepare(
            `SELECT r.id,r.statement,r.kind,r.priority,r.acceptance_criteria,r.status,
               mr.disposition,mr.contract_reference,
               EXISTS(SELECT 1 FROM request_verification rv WHERE rv.request_id=r.id AND rv.result='PASS') verified,
               (SELECT count(*) FROM work_request wr WHERE wr.request_id=r.id) linked_work_count
             FROM official_request r
             LEFT JOIN mandate_request mr ON mr.request_id=r.id AND mr.mandate_id=(SELECT confirmed_mandate_id FROM business WHERE id=r.business_id)
             WHERE r.business_id=? ORDER BY r.created_at`,
          )
          .all(business.id),
        employees: db
          .prepare(
            `SELECT e.id,e.slug,e.charter,e.status,
               json_group_array(DISTINCT c.slug) capabilities,
               (SELECT json_group_array(oa.slug) FROM employee_asset ea
                JOIN organizational_asset oa ON oa.id=ea.asset_id
                WHERE ea.employee_id=e.id AND oa.status='ACTIVE') assets
             FROM employee e
             LEFT JOIN employee_capability ec ON ec.employee_id=e.id
             LEFT JOIN capability c ON c.id=ec.capability_id
             WHERE e.status='ACTIVE'
             GROUP BY e.id ORDER BY e.slug`,
          )
          .all(),
        readyWork: listReadyWork(db, 20, business.id),
        pendingHuman: db
          .prepare(
            "SELECT id,type,title,status,subject_type,subject_id,subject_version FROM human_request WHERE business_id=? AND status IN ('PENDING','REMINDER_DUE','OVERDUE')",
          )
          .all(business.id),
        assurance: {
          controls: db
            .prepare(
              "SELECT id,slug,status,code_version,required_actions_json FROM business_control WHERE business_id=? ORDER BY slug",
            )
            .all(business.id),
          unresolvedMaterialClaims: db
            .prepare(
              `SELECT DISTINCT c.id,c.statement,c.status FROM decision_claim dc
               JOIN decision d ON d.id=dc.decision_id
               JOIN claim c ON c.id=dc.claim_id
               WHERE d.business_id=? AND dc.material=1
                 AND NOT EXISTS(
                   SELECT 1 FROM control_validation cv
                   JOIN business_control bc ON bc.id=cv.control_id
                   WHERE cv.subject_type='CLAIM' AND cv.subject_id=c.id
                     AND cv.result='PASS' AND cv.level='QA_VERIFIED'
                     AND bc.status='QA_VERIFIED'
                     AND cv.code_version=bc.code_version
                     AND (cv.expires_at IS NULL OR cv.expires_at>?)
                 )`,
            )
            .all(business.id, now()),
        },
        gates: db
          .prepare(
            "SELECT id,status,subject_type,subject_id,subject_version,policy_id FROM gate WHERE work_item_id=?",
          )
          .all(context.workItemId),
      };
    case "propose_business_mandate":
      if (!context.sessionId)
        throw new Cult4Error(
          "The exact OpenCode Intake session id is required.",
          "INTAKE_SESSION_REQUIRED",
        );
      syncIntakeTranscript(db, {
        businessId: business.id,
        workItemId: context.workItemId,
        sessionId: context.sessionId,
      });
      return proposeBusinessMandate(db, payload, {
        businessId: business.id,
        workItemId: context.workItemId,
        proposedBy: context.employeeId,
      });
    case "finish_intake": {
      const input = z
        .object({
          mandateId: z.string().min(1),
          contentHash: z.string().length(64),
        })
        .parse(payload);
      if (context.sessionId)
        syncIntakeTranscript(db, {
          businessId: business.id,
          workItemId: context.workItemId,
          sessionId: context.sessionId,
        });
      assertMandateRequestCoverage(db, input.mandateId);
      const pending = db
        .prepare(
          `SELECT bm.id FROM business_mandate bm
           JOIN human_request hr ON hr.subject_type='BUSINESS_MANDATE'
             AND hr.subject_id=bm.id AND hr.subject_version=bm.content_hash
           WHERE bm.id=? AND bm.business_id=? AND bm.content_hash=?
             AND bm.status='DRAFT' AND hr.work_item_id=?
             AND hr.status IN ('PENDING','REMINDER_DUE','OVERDUE')`,
        )
        .get(
          input.mandateId,
          business.id,
          input.contentHash,
          context.workItemId,
        );
      if (!pending)
        throw new Cult4Error(
          "No exact pending mandate confirmation belongs to this intake session.",
          "INTAKE_HANDOFF_NOT_READY",
        );
      const auditEventId = audit(db, {
        type: "BUSINESS_INTAKE_HANDOFF_REQUESTED",
        actorId: context.employeeId,
        businessId: business.id,
        subjectType: "OPERATOR_INTERACTION",
        subjectId: context.workItemId,
        subjectVersion: input.contentHash,
        data: { mandateId: input.mandateId },
      });
      return {
        status: "HANDOFF_REQUESTED",
        auditEventId,
        instruction:
          "Stop responding. The Cult4 host is ending intake and will ask the human to confirm the exact mandate outside the model conversation.",
      };
    }
    case "start_autopilot": {
      const input = z
        .object({
          maxDurationMinutes: z.number().int().min(1).max(180).default(180),
          maxWorkItems: z.number().int().min(1).max(200).default(50),
          maxCostCents: z.number().int().min(1).max(2000).default(1000),
        })
        .parse(payload);
      if (context.employeeId !== "employee-operator")
        throw new Cult4Error(
          "Only the Operator may hand work to autopilot.",
          "AUTOPILOT_HANDOFF_DENIED",
        );
      const interaction = db
        .prepare(
          "SELECT type FROM work_item WHERE id=? AND business_id=? AND assigned_to=?",
        )
        .get(context.workItemId, business.id, context.employeeId) as
        { type: string } | undefined;
      if (interaction?.type !== "OPERATOR_INTERACTION")
        throw new Cult4Error(
          "Autopilot handoff must come from the human-directed Operator conversation.",
          "AUTOPILOT_HANDOFF_DENIED",
        );
      if (!hasConfirmedBusinessMandate(db, business.id))
        throw new Cult4Error(
          "Autopilot requires a confirmed exact Business mandate.",
          "BUSINESS_MANDATE_REQUIRED",
        );
      const confirmedMandate = db
        .prepare(
          "SELECT autonomy_mode FROM business_mandate WHERE business_id=? AND status='CONFIRMED'",
        )
        .get(business.id) as { autonomy_mode: string };
      if (confirmedMandate.autonomy_mode === "ASSISTED")
        throw new Cult4Error(
          "ASSISTED businesses cannot enter unattended autopilot.",
          "AUTOPILOT_MODE_DENIED",
        );
      if (!listReadyWork(db, 1, business.id).length)
        throw new Cult4Error(
          "Create and ready at least one eligible durable non-interactive WorkItem before starting autopilot.",
          "AUTOPILOT_NO_READY_WORK",
        );
      const auditEventId = audit(db, {
        type: "BUSINESS_AUTOPILOT_HANDOFF_REQUESTED",
        actorId: context.employeeId,
        businessId: business.id,
        subjectType: "OPERATOR_INTERACTION",
        subjectId: context.workItemId,
        data: input,
      });
      return {
        status: "AUTOPILOT_HANDOFF_REQUESTED",
        auditEventId,
        limits: input,
        instruction:
          "Stop responding. The Cult4 host is ending the interactive turn and starting the bounded autonomous work loop.",
      };
    }
    case "search_memory": {
      const input = z
        .object({
          query: z.string().min(1),
          limit: z.number().int().min(1).max(20).optional(),
        })
        .parse(payload);
      return searchMemory(
        db,
        input.query,
        { employeeId: context.employeeId, businessId: business.id },
        input.limit,
      );
    }
    case "remember": {
      const input = z
        .object({
          kind: z.enum([
            "observation",
            "hypothesis",
            "external_evidence",
            "procedure",
            "postmortem",
            "decision",
            "warning",
          ]),
          scope: z.enum(["employee", "business", "employee_business"]),
          title: z.string().min(1),
          content: z.string().min(1),
          sourceRef: z.string().optional(),
          confidence: z.number().min(0).max(1).optional(),
          expiresAt: z.string().optional(),
        })
        .parse(payload);
      const scopeId =
        input.scope === "employee"
          ? context.employeeId
          : input.scope === "business"
            ? business.id
            : `${context.employeeId}:${business.id}`;
      return {
        memoryId: remember(db, {
          scopeType: input.scope,
          scopeId,
          kind: input.kind,
          title: input.title,
          content: input.content,
          createdBy: context.employeeId,
          ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
          ...(input.confidence !== undefined
            ? { confidence: input.confidence }
            : {}),
          ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        }),
      };
    }
    case "record_source": {
      const input = z
        .object({
          type: z.string(),
          title: z.string(),
          author: z.string().optional(),
          publisher: z.string().optional(),
          locator: z.string().optional(),
          publicationDate: z.string().optional(),
          accessNotes: z.string().optional(),
          licenseNotes: z.string().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(payload);
      return { sourceId: recordSource(db, input) };
    }
    case "record_claim": {
      const input = z
        .object({
          statement: z.string().min(1),
          status: z
            .enum(["HYPOTHESIS", "SUPPORTED", "CONTRADICTED", "UNRESOLVED"])
            .optional(),
        })
        .parse(payload);
      return {
        claimId: recordClaim(db, {
          businessId: business.id,
          statement: input.statement,
          createdBy: context.employeeId,
          ...(input.status ? { status: input.status } : {}),
        }),
      };
    }
    case "record_evidence": {
      const input = z
        .object({
          claimId: z.string(),
          sourceId: z.string().optional(),
          summary: z.string().min(1),
          reliability: z.number().min(0).max(1).optional(),
          applicability: z.number().min(0).max(1).optional(),
          confidence: z.number().min(0).max(1).optional(),
          contradiction: z.boolean().optional(),
          observedAt: z.string().optional(),
          observationType: z
            .enum(["OBSERVED", "ESTIMATED", "INFERRED", "UNKNOWN"])
            .optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(payload);
      return {
        evidenceId: recordEvidence(db, {
          ...input,
          createdBy: context.employeeId,
        }),
      };
    }
    case "record_decision": {
      const input = z
        .object({
          statement: z.string(),
          rationale: z.string(),
          alternatives: z.array(z.string()).min(1),
          unknowns: z.array(z.string()),
          risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
          evidenceIds: z.array(z.string()).optional(),
          materialClaimIds: z.array(z.string()).min(1).optional(),
          subjectType: z.string().optional(),
          subjectId: z.string().optional(),
          subjectVersion: z.string().optional(),
        })
        .parse(payload);
      const decisionId = recordDecision(db, {
        ...input,
        businessId: business.id,
        workItemId: context.workItemId,
        createdBy: context.employeeId,
      });
      if (input.materialClaimIds)
        linkDecisionClaims(db, decisionId, input.materialClaimIds);
      return {
        decisionId,
      };
    }
    case "register_control": {
      const input = z
        .object({
          slug: z.string(),
          description: z.string().min(1),
          validationCommand: z.string().min(1),
          requiredActions: z
            .array(
              z.enum([
                "SPEND_MONEY",
                "ORDER_PHYSICAL_SAMPLE",
                "PUBLISH_PRODUCT",
                "SEND_PUBLIC_MESSAGE",
                "SIGN_COMMITMENT",
                "CREATE_EXTERNAL_ACCOUNT",
              ]),
            )
            .min(1),
          codeVersion: z.string().min(1),
        })
        .parse(payload);
      return {
        controlId: registerBusinessControl(db, {
          ...input,
          businessId: business.id,
          declaredBy: context.employeeId,
        }),
      };
    }
    case "record_control_validation": {
      const input = z
        .object({
          controlId: z.string(),
          subjectType: z.string(),
          subjectId: z.string(),
          subjectVersion: z.string().optional(),
          inputHash: z.string().optional(),
          result: z.enum(["PASS", "FAIL"]),
          level: z.enum(["TESTED", "QA_VERIFIED"]),
          evidence: z.array(z.string().min(1)).min(1),
          expiresAt: z.string().optional(),
        })
        .parse(payload);
      return {
        validationId: recordControlValidation(db, {
          ...input,
          workItemId: context.workItemId,
          validatedBy: context.employeeId,
        }),
      };
    }
    case "create_market_study": {
      const input = z
        .object({
          initiativeId: z.string().optional(),
          targetSegment: z.string(),
          market: z.string(),
          language: z.string().optional(),
          geography: z.string().optional(),
          researchQuestion: z.string(),
          methodology: z.string().optional(),
          replacesMarketStudyId: z.string().optional(),
        })
        .parse(payload);
      const marketStudyId = createMarketStudy(db, {
        ...input,
        businessId: business.id,
        analystEmployeeId: context.employeeId,
      });
      startMarketStudy(db, marketStudyId, context.employeeId);
      db.prepare(
        `UPDATE work_item SET subject_type='MARKET_STUDY',subject_id=?,subject_version=?,updated_at=? WHERE id=? AND ((type='MARKET_STUDY' AND subject_id IS NULL) OR (type='MARKET_STUDY_REFRESH' AND subject_id=?))`,
      ).run(
        marketStudyId,
        now(),
        now(),
        context.workItemId,
        input.replacesMarketStudyId ?? null,
      );
      return { marketStudyId };
    }
    case "attach_market_evidence": {
      const input = z
        .object({
          marketStudyId: z.string(),
          evidenceId: z.string(),
          role: z.enum([
            "SUPPORTING",
            "CONTRADICTING",
            "CONTEXTUAL",
            "COMMERCIAL",
            "SATURATION",
            "CULTURAL",
            "RISK",
            "METHODOLOGY",
          ]),
        })
        .parse(payload);
      attachEvidenceToMarketStudy(
        db,
        input.marketStudyId,
        input.evidenceId,
        input.role,
      );
      return { ok: true };
    }
    case "add_market_signal": {
      const input = z
        .object({
          marketStudyId: z.string(),
          kind: z.enum([
            "CULTURAL",
            "COMMERCIAL",
            "OPPORTUNITY",
            "SATURATION",
            "RISK",
          ]),
          subtype: z.string().optional(),
          title: z.string(),
          description: z.string(),
          lifecycle: z
            .enum([
              "EMERGING",
              "RISING",
              "MAINSTREAM",
              "SATURATED",
              "DECLINING",
              "DEAD",
              "UNKNOWN",
            ])
            .optional(),
          confidence: z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]),
          observedAt: z.string().optional(),
          expiresAt: z.string().optional(),
          evidenceIds: z.array(z.string()).optional(),
        })
        .parse(payload);
      const { evidenceIds, ...signal } = input;
      const marketSignalId = createMarketSignal(db, signal);
      for (const evidenceId of evidenceIds ?? [])
        linkSignalEvidence(db, marketSignalId, evidenceId);
      return { marketSignalId };
    }
    case "complete_market_study": {
      const input = z
        .object({
          marketStudyId: z.string(),
          summary: z.string(),
          confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
          validUntil: z.string(),
          methodology: z.string(),
          limitations: z.string(),
          counterSignalSearched: z.boolean(),
          counterSignalSummary: z.string().optional(),
        })
        .parse(payload);
      const { marketStudyId, ...completion } = input;
      completeMarketStudy(db, marketStudyId, completion, context.employeeId);
      return { ok: true };
    }
    case "get_market_study": {
      const input = z.object({ marketStudyId: z.string() }).parse(payload);
      const study = getMarketStudy(db, input.marketStudyId);
      if (!study || study.business_id !== business.id)
        throw new Cult4Error(
          "Market study is outside this business.",
          "TOOL_SCOPE_DENIED",
        );
      return study;
    }
    case "create_creative_brief": {
      const input = z
        .object({
          initiativeId: z.string().optional(),
          marketStudyId: z.string(),
          status: z.enum(["DRAFT", "READY"]).optional(),
          targetAudience: z.string(),
          desiredResponse: z.string().optional(),
          culturalContext: z.string(),
          relevantTropes: z.string().optional(),
          customerLanguage: z.string().optional(),
          aestheticTerritory: z.string().optional(),
          saturatedIdeasToAvoid: z.string().optional(),
          ipDangerAreas: z.string().optional(),
          commercialConstraints: z.string().optional(),
          relevantClaimIds: z.array(z.string()).optional(),
          relevantSignalIds: z.array(z.string()).optional(),
          validUntil: z.string().optional(),
        })
        .parse(payload);
      const creativeBriefId = createCreativeBrief(db, {
        ...input,
        businessId: business.id,
        strategistEmployeeId: context.employeeId,
      });
      db.prepare(
        `UPDATE work_item SET subject_type='CREATIVE_BRIEF',subject_id=?,subject_version=?,updated_at=? WHERE id=? AND type='CREATIVE_BRIEF' AND (subject_id IS NULL OR subject_id=?)`,
      ).run(
        creativeBriefId,
        now(),
        now(),
        context.workItemId,
        input.marketStudyId,
      );
      return { creativeBriefId };
    }
    case "evaluate_action": {
      const input = actionSchema.parse(payload);
      const intent: ActionIntent = {
        ...input,
        actorId: context.employeeId,
        businessId: business.id,
        workItemId: context.workItemId,
      };
      return evaluateAction(db, intent, true);
    }
    case "request_human": {
      const input = z
        .object({
          gateId: z.string().optional(),
          type: z.enum([
            "APPROVAL",
            "DECISION",
            "INFORMATION",
            "PHYSICAL_ACTION",
            "IDENTITY_VERIFICATION",
            "AESTHETIC_REVIEW",
            "LEGAL_REVIEW",
            "PHYSICAL_INSPECTION",
            "CULTURAL_JUDGMENT",
            "LOCAL_LANGUAGE_JUDGMENT",
            "BRAND_RISK_JUDGMENT",
          ]),
          requestedResponsibility: z.string().optional(),
          subjectType: z.string(),
          subjectId: z.string(),
          subjectVersion: z.string(),
          title: z.string(),
          context: z.string(),
          recommendation: z.string().optional(),
          options: z.array(z.string()).optional(),
          remindAt: z.string().optional(),
          expiresAt: z.string().optional(),
        })
        .parse(payload);
      return {
        humanRequestId: createHumanRequest(db, {
          ...input,
          businessId: business.id,
          workItemId: context.workItemId,
        }),
      };
    }
    case "verify_official_request": {
      const input = z
        .object({
          requestId: z.string(),
          workItemId: z.string(),
          subjectType: z.string(),
          subjectId: z.string(),
          subjectVersion: z.string(),
          result: z.enum(["PASS", "FAIL", "PARTIAL"]),
          evidence: z.array(z.string().min(1)).min(1),
        })
        .parse(payload);
      return {
        verificationId: recordRequestVerification(db, {
          ...input,
          qaWorkItemId: context.workItemId,
          qaEmployeeId: context.employeeId,
        }),
      };
    }
    case "request_spend": {
      const input = z
        .object({
          amount: z.number().int().positive(),
          currency: z.string(),
          vendor: z.string(),
          purpose: z.string(),
          budgetId: z.string(),
          risk: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
          legalRisk: z.boolean().optional(),
          recurring: z.boolean().optional(),
          idempotencyKey: z.string().optional(),
        })
        .parse(payload);
      return requestSpend(db, {
        ...input,
        businessId: business.id,
        requestedBy: context.employeeId,
        relatedWorkItemId: context.workItemId,
      });
    }
    case "record_artifact_source": {
      const input = z
        .object({
          artifactVersionId: z.string(),
          sourceType: z.string(),
          sourceRef: z.string(),
          licenseStatus: z.enum(["VERIFIED", "UNVERIFIED", "NOT_REQUIRED"]),
          notes: z.string().optional(),
        })
        .parse(payload);
      return { sourceId: recordProvenance(db, input) };
    }
    case "record_approval": {
      const input = z
        .object({
          gateId: z.string(),
          decision: z.enum(["APPROVE", "REJECT"]),
          notes: z.string().optional(),
          expiresAt: z.string().optional(),
        })
        .parse(payload);
      return {
        approvalId:
          input.decision === "APPROVE"
            ? grantApproval(
                db,
                input.gateId,
                context.employeeId,
                input.notes,
                input.expiresAt,
              )
            : rejectGate(db, input.gateId, context.employeeId, input.notes),
      };
    }
    case "register_artifact": {
      const input = z
        .object({
          type: z.string(),
          purpose: z.string(),
          publicFacing: z.boolean().optional(),
          commercial: z.boolean().optional(),
          creative: z.boolean().optional(),
          cultureSensitive: z.boolean().optional(),
          trendSensitive: z.boolean().optional(),
          identitySensitive: z.boolean().optional(),
        })
        .parse(payload);
      return {
        artifactId: registerArtifact(db, {
          ...input,
          businessId: business.id,
          createdBy: context.employeeId,
        }),
      };
    }
    case "create_artifact_version": {
      const input = z
        .object({
          artifactId: z.string(),
          locator: z.string(),
          aiGenerated: z.boolean().optional(),
          modelOrTool: z.string().optional(),
          creationMetadata: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(payload);
      return createArtifactVersion(db, input);
    }
    case "record_ip_clearance": {
      const input = z
        .object({
          artifactVersionId: z.string(),
          risk: z.enum(["LOW", "MEDIUM", "HIGH", "UNCERTAIN"]),
          searchStatus: z.enum(["SEARCHED", "FOUND", "NOT_FOUND", "UNCERTAIN"]),
          evidenceRef: z.string(),
          notes: z.string().optional(),
        })
        .parse(payload);
      return {
        clearanceId: recordIpClearance(db, {
          ...input,
          reviewerId: context.employeeId,
        }),
      };
    }
    case "propose_knowledge_promotion": {
      const input = z
        .object({ sourceMemoryId: z.string(), rationale: z.string() })
        .parse(payload);
      return {
        promotionId: proposePromotion(
          db,
          input.sourceMemoryId,
          context.employeeId,
          input.rationale,
        ),
      };
    }
    case "propose_improvement": {
      const input = z
        .object({
          kind: z.enum([
            "SKILL_CANDIDATE",
            "TOOL_IMPROVEMENT",
            "EMPLOYEE_CHANGE",
            "FOUNDATION_CHANGE",
          ]),
          ownerResponsibility: z.string().optional(),
          title: z.string(),
          rationale: z.string(),
          evidenceRef: z.string().optional(),
        })
        .parse(payload);
      return db.transaction(() => {
        const proposalId = proposeImprovement(db, {
          ...input,
          proposedBy: context.employeeId,
          businessId: business.id,
        });
        const reviewWorkItemId = createWorkItem(db, {
          businessId: business.id,
          type: "IMPROVEMENT_REVIEW",
          title: `Review improvement: ${input.title}`,
          goal: "Independently evaluate the evidence, transferability, safety, and measurable expected benefit of this proposed organizational improvement. Approve or reject it without editing the proposed method.",
          createdBy: context.employeeId,
          assignedTo: "employee-qa",
          parentId: context.workItemId,
          subjectType: "IMPROVEMENT_PROPOSAL",
          subjectId: proposalId,
          requiredCapabilities: ["test_release"],
          status: "READY",
          priority: 70,
          risk: "MEDIUM",
        });
        return { proposalId, reviewWorkItemId };
      })();
    }
    case "review_improvement": {
      const input = z
        .object({
          proposalId: z.string(),
          decision: z.enum(["APPROVE", "REJECT"]),
          evidence: z.array(z.string().min(1)).min(1),
        })
        .parse(payload);
      reviewImprovement(db, {
        ...input,
        reviewWorkItemId: context.workItemId,
        reviewedBy: context.employeeId,
      });
      return { ok: true };
    }
    default:
      throw new Cult4Error(`Unknown Cult4 tool: ${name}`, "TOOL_NOT_FOUND");
  }
}
