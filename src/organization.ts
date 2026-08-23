import type { CultDatabase } from "./db.js";
import { Cult4Error, id, now } from "./domain.js";
import { audit } from "./audit.js";

export function proposeImprovement(
  db: CultDatabase,
  input: {
    kind:
      | "SKILL_CANDIDATE"
      | "TOOL_IMPROVEMENT"
      | "EMPLOYEE_CHANGE"
      | "FOUNDATION_CHANGE";
    ownerResponsibility?: string;
    proposedBy: string;
    businessId?: string;
    title: string;
    rationale: string;
    evidenceRef?: string;
  },
): string {
  if (!input.rationale.trim())
    throw new Cult4Error(
      "Improvement proposals require rationale.",
      "IMPROVEMENT_RATIONALE_REQUIRED",
    );
  if (input.kind !== "EMPLOYEE_CHANGE" && !input.evidenceRef)
    throw new Cult4Error(
      "Skill, tool, and Foundation proposals require evidence.",
      "IMPROVEMENT_EVIDENCE_REQUIRED",
    );
  const proposalId = id("improvement");
  db.prepare(
    "INSERT INTO improvement_proposal(id,kind,owner_responsibility,proposed_by,business_id,title,rationale,evidence_ref,status,created_at) VALUES(?,?,?,?,?,?,?,?,'PROPOSED',?)",
  ).run(
    proposalId,
    input.kind,
    input.ownerResponsibility ?? null,
    input.proposedBy,
    input.businessId ?? null,
    input.title,
    input.rationale,
    input.evidenceRef ?? null,
    now(),
  );
  return proposalId;
}

export function reviewImprovement(
  db: CultDatabase,
  input: {
    proposalId: string;
    reviewWorkItemId: string;
    reviewedBy: string;
    decision: "APPROVE" | "REJECT";
    evidence: string[];
  },
): void {
  if (!input.evidence.length)
    throw new Cult4Error(
      "Improvement review requires evidence.",
      "IMPROVEMENT_REVIEW_EVIDENCE_REQUIRED",
    );
  const proposal = db
    .prepare(
      "SELECT proposed_by,business_id,status FROM improvement_proposal WHERE id=?",
    )
    .get(input.proposalId) as
    | { proposed_by: string; business_id: string | null; status: string }
    | undefined;
  if (!proposal || proposal.status !== "PROPOSED")
    throw new Cult4Error(
      "Proposed improvement not found or already reviewed.",
      "IMPROVEMENT_NOT_REVIEWABLE",
    );
  if (proposal.proposed_by === input.reviewedBy)
    throw new Cult4Error(
      "Improvement proposals require independent review.",
      "IMPROVEMENT_SELF_REVIEW_DENIED",
    );
  const reviewWork = db
    .prepare(
      `SELECT business_id,type,assigned_to,subject_type,subject_id,status
       FROM work_item WHERE id=?`,
    )
    .get(input.reviewWorkItemId) as
    | {
        business_id: string | null;
        type: string;
        assigned_to: string | null;
        subject_type: string | null;
        subject_id: string | null;
        status: string;
      }
    | undefined;
  if (
    !reviewWork ||
    reviewWork.type !== "IMPROVEMENT_REVIEW" ||
    reviewWork.assigned_to !== input.reviewedBy ||
    reviewWork.subject_type !== "IMPROVEMENT_PROPOSAL" ||
    reviewWork.subject_id !== input.proposalId ||
    reviewWork.business_id !== proposal.business_id ||
    !["READY", "RUNNING"].includes(reviewWork.status)
  )
    throw new Cult4Error(
      "Improvement review does not match the assigned independent WorkItem.",
      "IMPROVEMENT_REVIEW_SCOPE_MISMATCH",
    );
  const qualified = db
    .prepare(
      `SELECT 1 FROM employee_capability ec JOIN capability c ON c.id=ec.capability_id
       WHERE ec.employee_id=? AND c.slug='test_release'`,
    )
    .get(input.reviewedBy);
  if (!qualified)
    throw new Cult4Error(
      "Improvement review requires an independently qualified QA employee.",
      "IMPROVEMENT_REVIEW_QUALIFICATION_REQUIRED",
    );
  db.transaction(() => {
    db.prepare(
      `INSERT INTO improvement_review(id,proposal_id,review_work_item_id,reviewed_by,decision,evidence_json,created_at)
       VALUES(?,?,?,?,?,?,?)`,
    ).run(
      id("improvement-review"),
      input.proposalId,
      input.reviewWorkItemId,
      input.reviewedBy,
      input.decision,
      JSON.stringify(input.evidence),
      now(),
    );
    db.prepare("UPDATE improvement_proposal SET status=? WHERE id=?").run(
      input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      input.proposalId,
    );
    audit(db, {
      type: "IMPROVEMENT_REVIEWED",
      actorId: input.reviewedBy,
      businessId: proposal.business_id ?? undefined,
      subjectType: "IMPROVEMENT_PROPOSAL",
      subjectId: input.proposalId,
      data: { decision: input.decision, evidence: input.evidence },
    });
  })();
}
