import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openMemoryDatabase, type CultDatabase } from "../src/db.js";
import { seedFoundation } from "../src/seed.js";
import { now } from "../src/domain.js";
import {
  linkDecisionClaims,
  recordControlValidation,
  registerBusinessControl,
} from "../src/assurance.js";
import {
  recordClaim,
  recordDecision,
  recordEvidence,
  recordSource,
} from "../src/evidence.js";
import { createWorkItem } from "../src/work.js";
import { evaluateAction } from "../src/policy.js";

describe("Business-owned assurance controls", () => {
  let db: CultDatabase;

  beforeEach(() => {
    db = openMemoryDatabase();
    seedFoundation(db);
    db.prepare(
      "INSERT INTO business(id,slug,name,repo_path,status,created_at) VALUES('business-a','a','A','/tmp/assurance-a','ACTIVE',?)",
    ).run(now());
    db.prepare(
      `INSERT INTO business_policy(
        id,business_id,rule_type,parameters,created_by,effective_from,status
      ) VALUES('policy-assurance-a','business-a','REQUIRE_ASSURANCE','{}','system',?,'ACTIVE')`,
    ).run(now());
  });
  afterEach(() => db.close());

  it("blocks a sensitive decision until every material claim has independent current QA", () => {
    const sourceId = recordSource(db, {
      type: "PRIMARY",
      title: "Exact supplier offer",
      locator: "https://supplier.example/offer",
    });
    const claimId = recordClaim(db, {
      businessId: "business-a",
      statement: "Five units can be purchased for 25 CAD delivered.",
      status: "SUPPORTED",
      createdBy: "employee-operator",
    });
    recordEvidence(db, {
      claimId,
      sourceId,
      summary: "The exact quantity tier and shipping total were observed.",
      observationType: "OBSERVED",
      createdBy: "employee-operator",
    });
    const decisionId = recordDecision(db, {
      businessId: "business-a",
      statement: "Buy five units.",
      rationale: "The verified micro-lot economics satisfy the mandate.",
      alternatives: ["Do not buy"],
      unknowns: [],
      risk: "MEDIUM",
      subjectType: "PRODUCT_TEST_PURCHASE",
      subjectId: "product-1",
      subjectVersion: "offer-v1",
      createdBy: "employee-operator",
    });
    linkDecisionClaims(db, decisionId, [claimId]);
    const controlId = registerBusinessControl(db, {
      businessId: "business-a",
      slug: "supplier_offer_micro_lot",
      description: "Validate a quantity-bound delivered supplier price.",
      validationCommand: "python -m business.validate supplier-offer",
      requiredActions: ["SPEND_MONEY", "ORDER_PHYSICAL_SAMPLE"],
      codeVersion: "sha-v1",
      declaredBy: "employee-operator",
    });
    const intent = {
      actionType: "SPEND_MONEY" as const,
      actorId: "employee-operator",
      businessId: "business-a",
      subjectType: "PRODUCT_TEST_PURCHASE",
      subjectId: "product-1",
      subjectVersion: "offer-v1",
      amount: 3000,
      currency: "USD",
      metadata: { decisionId },
    };
    expect(evaluateAction(db, intent).denialReasons).toEqual([
      `MATERIAL_CLAIM_QA_MISSING:${claimId}`,
    ]);

    const qaWorkItemId = createWorkItem(db, {
      businessId: "business-a",
      type: "DIGITAL_QA",
      title: "Verify supplier offer extraction",
      goal: "Refute or verify the exact quantity-bound price.",
      createdBy: "employee-operator",
      assignedTo: "employee-qa",
      status: "READY",
    });
    recordControlValidation(db, {
      controlId,
      workItemId: qaWorkItemId,
      subjectType: "CLAIM",
      subjectId: claimId,
      result: "PASS",
      level: "QA_VERIFIED",
      evidence: ["Fixture and live source both preserve price/quantity pairs."],
      validatedBy: "employee-qa",
    });

    const verified = evaluateAction(db, intent);
    expect(verified.outcome).toBe("BLOCK");
    expect(verified.denialReasons).toEqual([]);
    expect(verified.missingGates).toHaveLength(1);
    expect(db.prepare("SELECT count(*) n FROM action_assurance").get()).toEqual(
      { n: 1 },
    );

    registerBusinessControl(db, {
      businessId: "business-a",
      slug: "supplier_offer_micro_lot",
      description: "Validate a quantity-bound delivered supplier price.",
      validationCommand: "python -m business.validate supplier-offer",
      requiredActions: ["SPEND_MONEY", "ORDER_PHYSICAL_SAMPLE"],
      codeVersion: "sha-v2",
      declaredBy: "employee-operator",
    });
    expect(evaluateAction(db, intent).denialReasons).toEqual([
      `MATERIAL_CLAIM_QA_MISSING:${claimId}`,
    ]);
  });

  it("forbids the control author from self-certifying QA", () => {
    const controlId = registerBusinessControl(db, {
      businessId: "business-a",
      slug: "unit_economics",
      description: "Validate unit economics.",
      validationCommand: "npm test",
      requiredActions: ["SPEND_MONEY"],
      codeVersion: "sha-v1",
      declaredBy: "employee-operator",
    });
    const workItemId = createWorkItem(db, {
      businessId: "business-a",
      type: "DIGITAL_QA",
      title: "Self review",
      goal: "Attempt invalid self review.",
      createdBy: "employee-operator",
      assignedTo: "employee-operator",
      status: "READY",
    });
    expect(() =>
      recordControlValidation(db, {
        controlId,
        workItemId,
        subjectType: "OTHER",
        subjectId: "subject",
        subjectVersion: "v1",
        result: "PASS",
        level: "QA_VERIFIED",
        evidence: ["self assertion"],
        validatedBy: "employee-operator",
      }),
    ).toThrowError(/independent DIGITAL_QA/);
  });
});
