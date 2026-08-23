import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openMemoryDatabase, type CultDatabase } from "../src/db.js";
import { now } from "../src/domain.js";
import { seedFoundation } from "../src/seed.js";
import { createWorkItem, listReadyWork } from "../src/work.js";
import {
  confirmBusinessMandate,
  formatBusinessMandate,
  proposeBusinessMandate,
} from "../src/mandate.js";
import { executeTool } from "../src/tools.js";
import { getEmployeeContext } from "../src/employee.js";
import { evaluateAction } from "../src/policy.js";
import { audit } from "../src/audit.js";
import { resumableAutopilotRequest } from "../src/autopilot.js";

let db: CultDatabase;
let repo: string;
let foundationId: string;
let interactionId: string;

const mandate = {
  purpose:
    "Make plant people feel seen through small objects with wit and genuine affection.",
  customer:
    "French-speaking Quebec plant collectors who enjoy niche, intelligent humour.",
  offer:
    "Beautiful durable stickers whose jokes feel observed from inside plant culture.",
  narrative:
    "This is a warm, sharp little world made by someone who actually notices how plant people live: the negotiations with window light, the dramatic new leaf, and the quiet pride of keeping something alive. It should feel local without becoming folklore, playful without becoming disposable, and collectible without manufacturing empty hype.",
  spirit:
    "Cultivate affectionate mischief: observant, specific and slightly strange, with real tenderness beneath the joke. The business should feel made by a person with taste, never assembled from trend keywords.",
  voice:
    "Dry, intimate Quebec French with restraint; clever enough to reward attention without showing off.",
  taste:
    "Graphic simplicity, tactile materials, deliberate colour and odd details; never generic marketplace cute.",
  emotionalTerritory:
    "Recognition, complicity, quiet pride and a tiny spark of absurdity rather than loud novelty.",
  qualityBar:
    "Every object must feel intentional enough that a discerning plant collector would keep or gift it.",
  autonomyMode: "SUPERVISED" as const,
  constraints: [
    "Start in Quebec French and keep the initial experiment deliberately small.",
  ],
  allowedWithoutApproval: [
    "Research the market, develop hypotheses and prepare non-public drafts.",
  ],
  requiresApproval: [
    "Approve the creative direction, every spend, external account and public release.",
  ],
  prohibited: [
    "Do not publish, order products or imitate living artists without explicit approval.",
  ],
  antiGoals: [
    "Do not become a generic pun factory or a collage of current plant trends.",
  ],
  successSignals: [
    "Target customers recognize themselves and describe the work as unusually specific.",
  ],
  stopConditions: [
    "Stop if evidence shows no differentiated interest at the approved price range.",
  ],
  humanInputs: [
    "The founder wants the agents to catch the spirit and not work like robots.",
  ],
  unresolvedQuestions: [
    "Whether the first collection should emphasize characters or typography.",
  ],
  officialRequests: [
    {
      statement:
        "Build a distinctive Quebec plant-object business without flattening its human spirit.",
      kind: "OUTCOME" as const,
      priority: "MUST" as const,
      acceptanceCriteria:
        "Independent review confirms the delivered business preserves the stated audience, voice, taste, constraints, and quality bar.",
      sourceMessageIds: ["intake-message-test"],
      disposition: "COMMITTED" as const,
      contractReference: "purpose,narrative,spirit",
      rationale:
        "This is the substantive request expressed by the human in the Intake.",
    },
  ],
  messageDispositions: [],
  budget: {
    currency: "USD",
    maxExplorationSpendCents: 10_000,
    maxSpendWithoutApprovalCents: 0,
    maxSingleSpendCents: 10_000,
  },
};

beforeEach(() => {
  db = openMemoryDatabase();
  seedFoundation(db);
  repo = mkdtempSync(join(tmpdir(), "cult4-mandate-"));
  mkdirSync(join(repo, "work"));
  db.prepare(
    "INSERT INTO business(id,slug,name,repo_path,status,created_at) VALUES('business-mandate','business-mandate','Mandate Business',?,'ACTIVE',?)",
  ).run(realpathSync(repo), now());
  foundationId = createWorkItem(db, {
    businessId: "business-mandate",
    type: "BUSINESS_FOUNDATION",
    title: "Build Mandate Business",
    goal: "Build only after the human confirms the mandate.",
    createdBy: "human-owner",
    assignedTo: "employee-operator",
    status: "PROPOSED",
  });
  interactionId = createWorkItem(db, {
    businessId: "business-mandate",
    type: "OPERATOR_INTERACTION",
    title: "Human intake",
    goal: "Understand the contract and spirit.",
    createdBy: "human-owner",
    assignedTo: "employee-operator",
    status: "READY",
  });
  db.prepare(
    `INSERT INTO intake_message(id,business_id,work_item_id,session_id,external_message_id,ordinal,content,content_hash,created_at)
     VALUES('intake-message-test','business-mandate',?,'session-test','external-message-test',0,?,'hash-test',?)`,
  ).run(
    interactionId,
    "Build a distinctive Quebec plant-object business without flattening its human spirit.",
    now(),
  );
});

afterEach(() => db.close());

describe("business mandate intake gate", () => {
  it("refuses a mandate that silently drops a captured human message", () => {
    db.prepare(
      `INSERT INTO intake_message(id,business_id,work_item_id,session_id,external_message_id,ordinal,content,content_hash,created_at)
       VALUES('intake-message-uncovered','business-mandate',?,'session-test','external-message-uncovered',1,?,'hash-uncovered',?)`,
    ).run(
      interactionId,
      "Use the two named marketplace and messenger integrations in the actual service.",
      now(),
    );
    expect(() =>
      proposeBusinessMandate(db, mandate, {
        businessId: "business-mandate",
        workItemId: interactionId,
        proposedBy: "employee-operator",
      }),
    ).toThrowError(/every human Intake message/i);
    expect(
      db.prepare("SELECT count(*) count FROM business_mandate").get(),
    ).toEqual({ count: 0 });
  });

  it("blocks autonomous work until the exact rich mandate is human-confirmed", () => {
    expect(listReadyWork(db)).toEqual([]);
    expect(
      evaluateAction(db, {
        actionType: "SPEND_MONEY",
        actorId: "employee-operator",
        businessId: "business-mandate",
        subjectType: "SPEND_REQUEST",
        subjectId: "premature-spend",
        subjectVersion: "v1",
        amount: 1,
        currency: "USD",
      }).denialReasons,
    ).toContain("BUSINESS_MANDATE_REQUIRED");
    expect(() =>
      executeTool(
        db,
        "create_work",
        { type: "RESEARCH", title: "Run away", goal: "Start without intake" },
        {
          employeeId: "employee-operator",
          workItemId: interactionId,
          directory: repo,
        },
      ),
    ).toThrowError(/mandate/i);

    const proposed = proposeBusinessMandate(db, mandate, {
      businessId: "business-mandate",
      workItemId: interactionId,
      proposedBy: "employee-operator",
    });
    db.exec(
      `CREATE TRIGGER fail_reproposal BEFORE INSERT ON business_mandate
       WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT,'forced reproposal failure'); END`,
    );
    expect(() =>
      proposeBusinessMandate(
        db,
        { ...mandate, offer: `${mandate.offer} with a material revision` },
        {
          businessId: "business-mandate",
          workItemId: interactionId,
          proposedBy: "employee-operator",
        },
      ),
    ).toThrowError(/forced reproposal failure/i);
    db.exec("DROP TRIGGER fail_reproposal");
    expect(
      db
        .prepare(
          "SELECT bm.status mandate_status,hr.status request_status FROM business_mandate bm JOIN human_request hr ON hr.subject_id=bm.id WHERE bm.id=?",
        )
        .get(proposed.mandateId),
    ).toEqual({ mandate_status: "DRAFT", request_status: "PENDING" });
    const draft = db
      .prepare("SELECT * FROM business_mandate WHERE id=?")
      .get(proposed.mandateId) as Parameters<typeof formatBusinessMandate>[0];
    expect(formatBusinessMandate(draft)).toContain("ESPRIT À PRÉSERVER");
    expect(formatBusinessMandate(draft)).toContain(
      "DEMANDES OFFICIELLES DE L’UTILISATEUR",
    );
    expect(
      db.prepare("SELECT count(*) count FROM official_request").get(),
    ).toEqual({ count: 1 });
    expect(formatBusinessMandate(draft)).toContain("generic pun factory");
    expect(
      db.prepare("SELECT status FROM work_item WHERE id=?").get(interactionId),
    ).toEqual({ status: "WAITING_HUMAN" });
    expect(() =>
      executeTool(
        db,
        "start_autopilot",
        {},
        {
          employeeId: "employee-operator",
          workItemId: interactionId,
          directory: repo,
        },
      ),
    ).toThrowError(/mandate/i);
    expect(() =>
      executeTool(
        db,
        "finish_intake",
        { mandateId: proposed.mandateId, contentHash: "0".repeat(64) },
        {
          employeeId: "employee-operator",
          workItemId: interactionId,
          directory: repo,
        },
      ),
    ).toThrowError(/pending mandate/i);
    db.prepare(
      `INSERT INTO intake_message(id,business_id,work_item_id,session_id,external_message_id,ordinal,content,content_hash,created_at)
       VALUES('intake-message-confirmation','business-mandate',?,'session-test','external-message-confirmation',1,'This exact draft is good; finish the intake now.','hash-confirmation','9999-01-01T00:00:00.000Z')`,
    ).run(interactionId);
    expect(
      executeTool(
        db,
        "finish_intake",
        {
          mandateId: proposed.mandateId,
          contentHash: proposed.contentHash,
        },
        {
          employeeId: "employee-operator",
          workItemId: interactionId,
          directory: repo,
        },
      ),
    ).toMatchObject({ status: "HANDOFF_REQUESTED" });
    expect(
      db
        .prepare(
          "SELECT count(*) count FROM audit_event WHERE type='BUSINESS_INTAKE_HANDOFF_REQUESTED' AND subject_id=?",
        )
        .get(interactionId),
    ).toEqual({ count: 1 });
    expect(listReadyWork(db)).toEqual([]);
    expect(() =>
      confirmBusinessMandate(
        db,
        proposed.mandateId,
        "human-owner",
        "wrong-hash",
      ),
    ).toThrowError(/version/i);

    const confirmed = confirmBusinessMandate(
      db,
      proposed.mandateId,
      "human-owner",
      proposed.contentHash,
    );
    expect(confirmed.status).toBe("CONFIRMED");
    expect(
      db
        .prepare("SELECT confirmed_mandate_id FROM business WHERE id=?")
        .get("business-mandate"),
    ).toEqual({ confirmed_mandate_id: proposed.mandateId });
    expect(
      db.prepare("SELECT status FROM work_item WHERE id=?").get(interactionId),
    ).toEqual({ status: "DONE" });
    expect(
      (listReadyWork(db) as Array<{ id: string }>).map((work) => work.id),
    ).toContain(foundationId);
    const resumedInteractionId = createWorkItem(db, {
      businessId: "business-mandate",
      type: "OPERATOR_INTERACTION",
      title: "Resume with confirmed mandate",
      goal: "Hand durable work to the bounded host loop.",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
    });
    expect(
      (listReadyWork(db) as Array<{ id: string }>).map((work) => work.id),
    ).not.toContain(resumedInteractionId);
    const firstAutopilotWork = (
      executeTool(
        db,
        "create_work",
        {
          type: "BUILD",
          title: "Build durable core",
          goal: "Produce the first independently verifiable implementation.",
          requestIds: [
            (
              db.prepare("SELECT id FROM official_request LIMIT 1").get() as {
                id: string;
              }
            ).id,
          ],
        },
        {
          employeeId: "employee-operator",
          workItemId: resumedInteractionId,
          directory: repo,
        },
      ) as { workItemId: string }
    ).workItemId;
    expect(
      db
        .prepare("SELECT assigned_to FROM work_item WHERE id=?")
        .get(firstAutopilotWork),
    ).toEqual({ assigned_to: "employee-builder" });
    const dependentAutopilotWork = (
      executeTool(
        db,
        "create_work",
        {
          type: "VALIDATE",
          title: "Validate durable core",
          goal: "Verify the built core against its completion conditions.",
          assignedTo: "employee-qa",
          requestIds: [
            (
              db.prepare("SELECT id FROM official_request LIMIT 1").get() as {
                id: string;
              }
            ).id,
          ],
        },
        {
          employeeId: "employee-operator",
          workItemId: resumedInteractionId,
          directory: repo,
        },
      ) as { workItemId: string }
    ).workItemId;
    expect(
      executeTool(
        db,
        "add_work_dependency",
        {
          workItemId: dependentAutopilotWork,
          dependsOnWorkItemId: firstAutopilotWork,
        },
        {
          employeeId: "employee-operator",
          workItemId: resumedInteractionId,
          directory: repo,
        },
      ),
    ).toEqual({ ok: true });
    for (const workItemId of [firstAutopilotWork, dependentAutopilotWork])
      expect(
        executeTool(
          db,
          "ready_work",
          { workItemId },
          {
            employeeId: "employee-operator",
            workItemId: resumedInteractionId,
            directory: repo,
          },
        ),
      ).toEqual({ ok: true });
    const eligibleIds = (
      listReadyWork(db, 20, "business-mandate") as Array<{ id: string }>
    ).map((work) => work.id);
    expect(eligibleIds).toContain(firstAutopilotWork);
    expect(eligibleIds).not.toContain(dependentAutopilotWork);
    expect(
      executeTool(
        db,
        "start_autopilot",
        {
          maxDurationMinutes: 120,
          maxWorkItems: 25,
          maxCostCents: 500,
        },
        {
          employeeId: "employee-operator",
          workItemId: resumedInteractionId,
          directory: repo,
        },
      ),
    ).toMatchObject({
      status: "AUTOPILOT_HANDOFF_REQUESTED",
      limits: {
        maxDurationMinutes: 120,
        maxWorkItems: 25,
        maxCostCents: 500,
      },
    });
    expect(
      db
        .prepare(
          "SELECT data_json FROM audit_event WHERE type='BUSINESS_AUTOPILOT_HANDOFF_REQUESTED' AND subject_id=?",
        )
        .get(resumedInteractionId),
    ).toEqual({
      data_json:
        '{"maxDurationMinutes":120,"maxWorkItems":25,"maxCostCents":500}',
    });
    expect(resumableAutopilotRequest(db, "business-mandate")).toEqual({
      maxDurationMinutes: 120,
      maxWorkItems: 25,
      maxCostCents: 500,
    });
    audit(db, {
      type: "BUSINESS_AUTOPILOT_INTERVENED",
      actorId: "human-owner",
      businessId: "business-mandate",
      subjectType: "BUSINESS",
      subjectId: "business-mandate",
      data: {},
    });
    expect(resumableAutopilotRequest(db, "business-mandate")).toBeUndefined();
    expect(
      (
        getEmployeeContext(db, "employee-operator", foundationId)
          .businessMandate as { spirit: string }
      ).spirit,
    ).toContain("affectionate mischief");

    const smallSpend = evaluateAction(db, {
      actionType: "SPEND_MONEY",
      actorId: "employee-operator",
      businessId: "business-mandate",
      subjectType: "SPEND_REQUEST",
      subjectId: "small-spend",
      subjectVersion: "v1",
      amount: 1,
      currency: "USD",
    });
    expect(smallSpend.outcome).toBe("BLOCK");
    expect(smallSpend.requiredGates.some((gate) => gate.humanOnly)).toBe(true);
    const excessiveSpend = evaluateAction(db, {
      actionType: "SPEND_MONEY",
      actorId: "employee-operator",
      businessId: "business-mandate",
      subjectType: "SPEND_REQUEST",
      subjectId: "large-spend",
      subjectVersion: "v1",
      amount: 10_001,
      currency: "USD",
    });
    expect(excessiveSpend.denialReasons).toContain(
      "BUSINESS_MANDATE_SINGLE_SPEND_LIMIT_EXCEEDED",
    );
  });

  it("keeps ASSISTED businesses out of unattended ticks after confirmation", () => {
    const proposed = proposeBusinessMandate(
      db,
      { ...mandate, autonomyMode: "ASSISTED" },
      {
        businessId: "business-mandate",
        workItemId: interactionId,
        proposedBy: "employee-operator",
      },
    );
    confirmBusinessMandate(
      db,
      proposed.mandateId,
      "human-owner",
      proposed.contentHash,
    );
    expect(listReadyWork(db)).toEqual([]);
    const resumedInteractionId = createWorkItem(db, {
      businessId: "business-mandate",
      type: "OPERATOR_INTERACTION",
      title: "Assisted conversation",
      goal: "Remain human-driven.",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
    });
    expect(() =>
      executeTool(
        db,
        "start_autopilot",
        {},
        {
          employeeId: "employee-operator",
          workItemId: resumedInteractionId,
          directory: repo,
        },
      ),
    ).toThrowError(/ASSISTED/i);
  });
});
