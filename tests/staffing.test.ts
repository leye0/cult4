import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openMemoryDatabase, type CultDatabase } from "../src/db.js";
import { now } from "../src/domain.js";
import { seedFoundation } from "../src/seed.js";
import { createWorkItem } from "../src/work.js";
import {
  assertEmployeeQualified,
  assertWorkAssignmentQualified,
  requiredCapabilitiesForWork,
  routeQualifiedEmployee,
} from "../src/staffing.js";
import { maybeScheduleCapabilityDevelopment } from "../src/learning.js";
import { proposeImprovement, reviewImprovement } from "../src/organization.js";

describe("specialized staffing and practice development", () => {
  let db: CultDatabase;

  beforeEach(() => {
    db = openMemoryDatabase();
    seedFoundation(db);
    db.prepare(
      "INSERT INTO business(id,slug,name,repo_path,status,created_at) VALUES('business-staffing','staffing','Staffing','/tmp/staffing','ACTIVE',?)",
    ).run(now());
  });
  afterEach(() => db.close());

  it("routes engineering to the equipped Builder and forbids Operator substitution", () => {
    const required = requiredCapabilitiesForWork("ENGINEERING");
    expect(required).toEqual(["software_engineering"]);
    expect(routeQualifiedEmployee(db, required)).toBe("employee-builder");
    expect(() =>
      assertEmployeeQualified(db, "employee-operator", required),
    ).toThrowError(/coordinates specialized work/i);

    const workId = createWorkItem(db, {
      businessId: "business-staffing",
      type: "ENGINEERING",
      title: "Implement the service",
      goal: "Implement an independently verifiable service.",
      createdBy: "employee-operator",
      assignedTo: "employee-builder",
      requiredCapabilities: required,
      status: "READY",
    });
    expect(() => assertWorkAssignmentQualified(db, workId)).not.toThrow();
    db.prepare(
      "UPDATE work_item SET assigned_to='employee-operator' WHERE id=?",
    ).run(workId);
    expect(() => assertWorkAssignmentQualified(db, workId)).toThrowError(
      /coordinates specialized work/i,
    );
  });

  it("reserves recurring work for reusable employee practice development", () => {
    let sourceWorkItemId = "";
    for (let index = 0; index < 4; index += 1) {
      sourceWorkItemId = createWorkItem(db, {
        businessId: "business-staffing",
        type: "ENGINEERING",
        title: `Engineering slice ${index}`,
        goal: "Produce a measured implementation slice.",
        createdBy: "employee-operator",
        assignedTo: "employee-builder",
        requiredCapabilities: ["software_engineering"],
        status: "READY",
      });
      db.prepare(
        `INSERT INTO employee_run(id,employee_id,work_item_id,status,created_at,finished_at)
         VALUES(?, 'employee-builder', ?, 'COMPLETED', ?, ?)`,
      ).run(`run-${index}`, sourceWorkItemId, now(), now());
    }
    const learningId = maybeScheduleCapabilityDevelopment(db, {
      employeeId: "employee-builder",
      businessId: "business-staffing",
      sourceWorkItemId,
      successful: true,
    });
    expect(learningId).toBeTruthy();
    expect(
      db
        .prepare(
          "SELECT type,status,assigned_to,parent_id FROM work_item WHERE id=?",
        )
        .get(learningId),
    ).toEqual({
      type: "CAPABILITY_DEVELOPMENT",
      status: "READY",
      assigned_to: "employee-builder",
      parent_id: sourceWorkItemId,
    });
    expect(
      db
        .prepare(
          `SELECT c.slug FROM work_capability_requirement wcr
           JOIN capability c ON c.id=wcr.capability_id
           WHERE wcr.work_item_id=?`,
        )
        .get(learningId),
    ).toEqual({ slug: "practice_development" });
  });

  it("requires independent evidence-backed review before accepting improvements", () => {
    const proposalId = proposeImprovement(db, {
      kind: "SKILL_CANDIDATE",
      ownerResponsibility: "software_engineering",
      proposedBy: "employee-builder",
      businessId: "business-staffing",
      title: "Improve repository boundary tests",
      rationale: "Repeated integration failures show a reusable test gap.",
      evidenceRef: "memory-postmortem-1",
    });
    const selfReviewWork = createWorkItem(db, {
      businessId: "business-staffing",
      type: "IMPROVEMENT_REVIEW",
      title: "Self review",
      goal: "Attempt an invalid self review.",
      createdBy: "employee-builder",
      assignedTo: "employee-builder",
      subjectType: "IMPROVEMENT_PROPOSAL",
      subjectId: proposalId,
      status: "READY",
    });
    expect(() =>
      reviewImprovement(db, {
        proposalId,
        reviewWorkItemId: selfReviewWork,
        reviewedBy: "employee-builder",
        decision: "APPROVE",
        evidence: ["Builder assertion"],
      }),
    ).toThrowError(/independent review/i);

    const qaReviewWork = createWorkItem(db, {
      businessId: "business-staffing",
      type: "IMPROVEMENT_REVIEW",
      title: "Independent review",
      goal: "Evaluate transferability and measurable benefit.",
      createdBy: "employee-builder",
      assignedTo: "employee-qa",
      requiredCapabilities: ["test_release"],
      subjectType: "IMPROVEMENT_PROPOSAL",
      subjectId: proposalId,
      status: "READY",
    });
    reviewImprovement(db, {
      proposalId,
      reviewWorkItemId: qaReviewWork,
      reviewedBy: "employee-qa",
      decision: "APPROVE",
      evidence: [
        "Compared the proposed method against three recorded failures.",
      ],
    });
    expect(
      db
        .prepare("SELECT status FROM improvement_proposal WHERE id=?")
        .get(proposalId),
    ).toEqual({ status: "APPROVED" });
    expect(
      db
        .prepare(
          "SELECT decision,reviewed_by FROM improvement_review WHERE proposal_id=?",
        )
        .get(proposalId),
    ).toEqual({ decision: "APPROVE", reviewed_by: "employee-qa" });
  });
});
