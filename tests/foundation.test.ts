import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CultDatabase } from "../src/db.js";
import { openMemoryDatabase } from "../src/db.js";
import { seedFoundation } from "../src/seed.js";
import { now } from "../src/domain.js";
import {
  addDependency,
  createWorkItem,
  listReadyWork,
  transitionWorkItem,
} from "../src/work.js";
import { evaluateAction } from "../src/policy.js";
import {
  canActorSatisfy,
  grantApproval,
  requireGate,
  validateApproval,
} from "../src/approval.js";
import {
  createHumanRequest,
  processHumanRequestTimers,
  resolveHumanRequest,
} from "../src/human.js";
import { remember, searchMemory } from "../src/memory.js";
import { createBudget, requestSpend } from "../src/finance.js";
import {
  createArtifactVersion,
  recordIpClearance,
  recordProvenance,
  registerArtifact,
} from "../src/artifact.js";
import {
  createProduct,
  createProductVersion,
  createSupplier,
  hasApplicableQualification,
  supplierContextHash,
} from "../src/physical.js";
import { opencodeBusinessConfig } from "../src/repo.js";
import {
  createExperiment,
  createHypothesis,
  readyExperiment,
} from "../src/experiment.js";
import { tick } from "../src/tick.js";
import type { OpenCodeRunner } from "../src/opencode.js";

let db: CultDatabase;
let root: string;
function addBusiness(id: string, name: string): string {
  const path = join(root, id);
  mkdirSync(path, { recursive: true });
  db.prepare(
    "INSERT INTO business(id,slug,name,repo_path,status,created_at) VALUES(?,?,?,?, 'ACTIVE',?)",
  ).run(id, id, name, path, now());
  db.prepare(
    "INSERT INTO repository(id,owner_type,owner_id,local_path,remote_url,current_sha,remote_sha,privacy_verified,sync_status,created_at,updated_at) VALUES(?, 'business',?,?,?,NULL,NULL,1,'synced',?,?)",
  ).run(`repo-${id}`, id, path, `file://${path}.git`, now(), now());
  return path;
}
function addDurableCommit(repositoryId: string, sha: string): void {
  db.prepare(
    "INSERT INTO git_commit(id,repository_id,sha,branch,employee_id,pushed_at,remote_verified_at,created_at) VALUES(?,?,?,'main','builder',?,?,?)",
  ).run(`commit-${sha}`, repositoryId, sha, now(), now(), now());
}
function addActor(id: string, kind = "EMPLOYEE"): void {
  db.prepare(
    "INSERT INTO actor(id,kind,name,status,created_at) VALUES(?,?,?,'ACTIVE',?)",
  ).run(id, kind, id, now());
}
beforeEach(() => {
  db = openMemoryDatabase();
  seedFoundation(db);
  root = mkdtempSync(join(tmpdir(), "cult4-test-"));
  addBusiness("business-a", "A");
  addBusiness("business-b", "B");
  addActor("builder");
});
afterEach(() => db.close());

describe("Foundation adversarial evals E01-E20", () => {
  it("E01/E02 blocks release without structured QA even if prose says approved", () => {
    addDurableCommit(
      "repo-business-a",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    const decision = evaluateAction(
      db,
      {
        actionType: "RELEASE_CODE",
        actorId: "builder",
        businessId: "business-a",
        subjectType: "GIT_COMMIT",
        subjectId: "repo-business-a",
        subjectVersion: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        metadata: { note: "Human approved" },
      },
      true,
    );
    expect(decision.outcome).toBe("BLOCK");
    expect(decision.missingGates[0]?.responsibility).toBe("release_quality");
    expect(db.prepare("SELECT count(*) n FROM approval").get()).toEqual({
      n: 0,
    });
  });
  it("E03 rejects an expired approval", () => {
    const gateId = requireGate(db, {
      responsibility: "release_quality",
      authority: "APPROVE_RELEASE_QUALITY",
      policyId: "PRODUCTION_RELEASE",
      policyVersion: 1,
      subjectType: "GIT_COMMIT",
      subjectId: "repo",
      subjectVersion: "a",
      producerActorId: "builder",
      independent: true,
    });
    grantApproval(
      db,
      gateId,
      "employee-qa",
      "ok",
      new Date(Date.now() - 1000).toISOString(),
    );
    expect(validateApproval(db, gateId, "a")).toBe(false);
  });
  it("E04 expires HumanRequest without approval", () => {
    const gateId = requireGate(db, {
      responsibility: "creative_quality",
      authority: "APPROVE_PUBLIC_AI_ART",
      policyId: "AI_GENERATED_VISUAL_PUBLIC_USE",
      policyVersion: 1,
      subjectType: "ARTIFACT_VERSION",
      subjectId: "art",
      subjectVersion: "a",
      humanOnly: true,
    });
    const requestId = createHumanRequest(db, {
      gateId,
      type: "AESTHETIC_REVIEW",
      subjectType: "ARTIFACT_VERSION",
      subjectId: "art",
      subjectVersion: "a",
      title: "Review",
      context: "Exact asset",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(processHumanRequestTimers(db).expired).toBe(1);
    expect(() =>
      resolveHumanRequest(db, requestId, "human-owner", true),
    ).toThrow();
    expect(validateApproval(db, gateId, "a")).toBe(false);
  });
  it("E05 enforces human and independent review", () => {
    const gateId = requireGate(db, {
      responsibility: "creative_quality",
      authority: "APPROVE_PUBLIC_AI_ART",
      policyId: "AI_GENERATED_VISUAL_PUBLIC_USE",
      policyVersion: 1,
      subjectType: "ARTIFACT_VERSION",
      subjectId: "art",
      subjectVersion: "a",
      producerActorId: "employee-designer",
      humanOnly: true,
      independent: true,
    });
    expect(canActorSatisfy(db, gateId, "employee-designer")).toMatchObject({
      ok: false,
    });
  });
  it("E06 invalidates aesthetic approval when exact asset changes", () => {
    const artifactId = registerArtifact(db, {
      businessId: "business-a",
      type: "IMAGE",
      purpose: "sale",
      createdBy: "employee-designer",
      publicFacing: true,
      commercial: true,
    });
    const a = createArtifactVersion(db, {
      artifactId,
      locator: "a.png",
      content: "A",
      aiGenerated: true,
    });
    recordProvenance(db, {
      artifactVersionId: a.id,
      sourceType: "PROMPT",
      sourceRef: "original prompt",
      licenseStatus: "NOT_REQUIRED",
    });
    recordIpClearance(db, {
      artifactVersionId: a.id,
      risk: "LOW",
      searchStatus: "NOT_FOUND",
      reviewerId: "employee-ip-reviewer",
      evidenceRef: "search-1",
    });
    let decision = evaluateAction(
      db,
      {
        actionType: "PUBLISH_PRODUCT",
        actorId: "employee-operator",
        businessId: "business-a",
        subjectType: "ARTIFACT_VERSION",
        subjectId: a.id,
        subjectVersion: a.hash,
      },
      true,
    );
    for (const missing of decision.missingGates) {
      grantApproval(
        db,
        missing.gateId!,
        missing.humanOnly ? "human-owner" : "employee-ip-reviewer",
      );
    }
    expect(
      evaluateAction(
        db,
        {
          actionType: "PUBLISH_PRODUCT",
          actorId: "employee-operator",
          businessId: "business-a",
          subjectType: "ARTIFACT_VERSION",
          subjectId: a.id,
          subjectVersion: a.hash,
        },
        false,
      ).allowed,
    ).toBe(true);
    const b = createArtifactVersion(db, {
      artifactId,
      locator: "b.png",
      content: "B",
      aiGenerated: true,
    });
    recordProvenance(db, {
      artifactVersionId: b.id,
      sourceType: "PROMPT",
      sourceRef: "changed prompt",
      licenseStatus: "NOT_REQUIRED",
    });
    recordIpClearance(db, {
      artifactVersionId: b.id,
      risk: "LOW",
      searchStatus: "NOT_FOUND",
      reviewerId: "employee-ip-reviewer",
      evidenceRef: "search-2",
    });
    decision = evaluateAction(
      db,
      {
        actionType: "PUBLISH_PRODUCT",
        actorId: "employee-operator",
        businessId: "business-a",
        subjectType: "ARTIFACT_VERSION",
        subjectId: b.id,
        subjectVersion: b.hash,
      },
      true,
    );
    expect(decision.allowed).toBe(false);
    expect(
      decision.missingGates.some(
        (g) => g.authority === "APPROVE_PUBLIC_AI_ART",
      ),
    ).toBe(true);
  });
  it("E07 binds code QA to commit", () => {
    addDurableCommit(
      "repo-business-a",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    addDurableCommit(
      "repo-business-a",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    const a = evaluateAction(
      db,
      {
        actionType: "RELEASE_CODE",
        actorId: "builder",
        businessId: "business-a",
        subjectType: "GIT_COMMIT",
        subjectId: "repo-business-a",
        subjectVersion: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      true,
    );
    grantApproval(db, a.missingGates[0]!.gateId!, "employee-qa");
    expect(
      evaluateAction(
        db,
        {
          actionType: "RELEASE_CODE",
          actorId: "builder",
          businessId: "business-a",
          subjectType: "GIT_COMMIT",
          subjectId: "repo-business-a",
          subjectVersion: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        true,
      ).allowed,
    ).toBe(false);
  });
  it("E08/E09 commitments prevent oversubscription", () => {
    const budget = createBudget(db, {
      businessId: "business-a",
      category: "validation",
      currency: "USD",
      limitAmount: 5000,
      periodStart: "2020-01-01T00:00:00.000Z",
      periodEnd: "2099-01-01T00:00:00.000Z",
      createdBy: "human-owner",
    });
    expect(
      requestSpend(db, {
        businessId: "business-a",
        requestedBy: "employee-operator",
        amount: 4000,
        currency: "USD",
        vendor: "A",
        purpose: "test",
        budgetId: budget,
      }).status,
    ).toBe("WAITING_APPROVAL");
    const low1 = requestSpend(db, {
      businessId: "business-a",
      requestedBy: "employee-operator",
      amount: 2000,
      currency: "USD",
      vendor: "A",
      purpose: "test",
      budgetId: budget,
    });
    const low2 = requestSpend(db, {
      businessId: "business-a",
      requestedBy: "employee-operator",
      amount: 4000,
      currency: "USD",
      vendor: "B",
      purpose: "test",
      budgetId: budget,
    });
    expect(low1.status).toBe("AUTHORIZED");
    expect(low2.status).toBe("DENIED");
  });
  it("E10 preserves hypothesis epistemic kind", () => {
    const memoryId = remember(db, {
      scopeType: "business",
      scopeId: "business-a",
      kind: "hypothesis",
      title: "X works",
      content: "We think X works",
      createdBy: "employee-researcher",
    });
    const result = searchMemory(db, "works", {
      employeeId: "employee-researcher",
      businessId: "business-a",
    }) as Array<Record<string, unknown>>;
    expect(result.find((x) => x.id === memoryId)?.kind).toBe("hypothesis");
  });
  it("E11 prevents cross-business memory leakage", () => {
    remember(db, {
      scopeType: "business",
      scopeId: "business-b",
      kind: "observation",
      title: "Private zephyr",
      content: "zephyr secret",
      createdBy: "employee-qa",
    });
    expect(
      searchMemory(db, "zephyr", {
        employeeId: "employee-qa",
        businessId: "business-a",
      }),
    ).toHaveLength(0);
  });
  it("E12/E18/E19 emits restrictive prompt-injection, organization, and secret permissions", () => {
    const config = {
      home: "/safe/.cult4",
      databasePath: "/safe/.cult4/state.db",
      objectsPath: "/safe/.cult4/objects",
      runtimePath: "/safe/.cult4/runtime",
      secretsPath: "/safe/.cult4/secrets",
      businessesPath: "/safe/.cult4/businesses",
      organizationPath: "/safe/.cult4/organization",
      agentsPath: "/safe/opencode/agents",
      toolsPath: "/safe/opencode/tools",
      skillsPath: "/safe/opencode/skills",
    };
    const policy = opencodeBusinessConfig(config) as any;
    expect(policy.permission.edit["/safe/.cult4/organization/**"]).toBe("deny");
    expect(policy.permission.read["/safe/.cult4/secrets/**"]).toBe("deny");
    expect(policy.permission.external_directory["*"]).toBe("deny");
  });
  it("E13 blocks a physical product without real sample", () => {
    const supplier = createSupplier(db, { name: "Mock", type: "PRINT" });
    const product = createProduct(db, {
      businessId: "business-a",
      name: "Generic physical",
      fulfillmentKind: "PHYSICAL",
      productFamily: "print",
    });
    const version = createProductVersion(db, {
      productId: product,
      version: "1",
      contentHash: "hash",
      supplierId: supplier,
      material: "paper",
      process: "ink",
      packaging: "box",
      shippingMethod: "mail",
    });
    const result = evaluateAction(
      db,
      {
        actionType: "PUBLISH_PRODUCT",
        actorId: "employee-operator",
        businessId: "business-a",
        subjectType: "PRODUCT_VERSION",
        subjectId: version,
        subjectVersion: "hash",
      },
      true,
    );
    expect(result.denialReasons).toContain("REAL_PHYSICAL_SAMPLE_PASS_MISSING");
  });
  it("E14 blocks AI art even when IP is low", () => {
    const artifact = registerArtifact(db, {
      businessId: "business-a",
      type: "IMAGE",
      purpose: "sale",
      createdBy: "employee-designer",
      publicFacing: true,
      commercial: true,
    });
    const version = createArtifactVersion(db, {
      artifactId: artifact,
      locator: "x",
      content: "x",
      aiGenerated: true,
    });
    recordProvenance(db, {
      artifactVersionId: version.id,
      sourceType: "PROMPT",
      sourceRef: "p",
      licenseStatus: "NOT_REQUIRED",
    });
    recordIpClearance(db, {
      artifactVersionId: version.id,
      risk: "LOW",
      searchStatus: "NOT_FOUND",
      reviewerId: "employee-ip-reviewer",
      evidenceRef: "e",
    });
    const result = evaluateAction(
      db,
      {
        actionType: "PUBLISH_PRODUCT",
        actorId: "employee-operator",
        businessId: "business-a",
        subjectType: "ARTIFACT_VERSION",
        subjectId: version.id,
        subjectVersion: version.hash,
      },
      true,
    );
    expect(
      result.missingGates.some(
        (g) => g.humanOnly && g.authority === "APPROVE_PUBLIC_AI_ART",
      ),
    ).toBe(true);
  });
  it("E15 escalates uncertain IP to human", () => {
    const artifact = registerArtifact(db, {
      businessId: "business-a",
      type: "IMAGE",
      purpose: "sale",
      createdBy: "employee-designer",
      commercial: true,
    });
    const version = createArtifactVersion(db, {
      artifactId: artifact,
      locator: "x",
      content: "x",
    });
    recordProvenance(db, {
      artifactVersionId: version.id,
      sourceType: "STOCK",
      sourceRef: "unknown",
      licenseStatus: "UNVERIFIED",
    });
    recordIpClearance(db, {
      artifactVersionId: version.id,
      risk: "UNCERTAIN",
      searchStatus: "UNCERTAIN",
      reviewerId: "employee-ip-reviewer",
      evidenceRef: "search",
    });
    const result = evaluateAction(
      db,
      {
        actionType: "PUBLISH_PRODUCT",
        actorId: "employee-operator",
        businessId: "business-a",
        subjectType: "ARTIFACT_VERSION",
        subjectId: version.id,
        subjectVersion: version.hash,
      },
      true,
    );
    expect(
      result.missingGates.some(
        (g) => g.authority === "APPROVE_LEGAL_RISK" && g.humanOnly,
      ),
    ).toBe(true);
  });
  it("E16 context changes require supplier requalification", () => {
    const supplier = createSupplier(db, { name: "S", type: "PRINT" });
    const product = createProduct(db, {
      businessId: "business-a",
      name: "P",
      fulfillmentKind: "PHYSICAL",
      productFamily: "print",
    });
    const version = createProductVersion(db, {
      productId: product,
      version: "1",
      contentHash: "h",
      supplierId: supplier,
      material: "paper",
      process: "B",
      packaging: "box",
      shippingMethod: "mail",
    });
    db.prepare(
      `INSERT INTO supplier_qualification(id,supplier_id,product_family,material,process,packaging,shipping_method,context_hash,result,qualified_by,evidence_ref,qualified_at) VALUES('q',?,?,?,?,?,?,?,'PASS','human-owner','sample',?)`,
    ).run(
      supplier,
      "print",
      "paper",
      "A",
      "box",
      "mail",
      supplierContextHash({
        supplierId: supplier,
        productFamily: "print",
        material: "paper",
        process: "A",
        packaging: "box",
        shippingMethod: "mail",
      }),
      now(),
    );
    expect(hasApplicableQualification(db, version)).toBe(false);
  });
  it("E17 tick continues another business while one waits for human", async () => {
    const waiting = createWorkItem(db, {
      businessId: "business-a",
      type: "A",
      title: "A",
      goal: "A",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
    });
    createHumanRequest(db, {
      businessId: "business-a",
      workItemId: waiting,
      type: "DECISION",
      subjectType: "WORK_ITEM",
      subjectId: waiting,
      subjectVersion: "1",
      title: "Wait",
      context: "Wait",
    });
    const ready = createWorkItem(db, {
      businessId: "business-b",
      type: "B",
      title: "B",
      goal: "B",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
      priority: 90,
    });
    const runner: OpenCodeRunner = {
      runTask: async () => ({
        ok: true,
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
        costCents: 0,
        inputTokens: 1,
        outputTokens: 1,
        finalText: "yield",
      }),
    };
    const result = await tick(db, { maxWorkItems: 1, runner });
    expect(result.results[0]?.workItemId).toBe(ready);
  });
  it("stops a bounded tick cleanly after the current model turn", async () => {
    const first = createWorkItem(db, {
      businessId: "business-b",
      type: "FIRST",
      title: "First autonomous turn",
      goal: "Complete one bounded turn.",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
      priority: 95,
    });
    createWorkItem(db, {
      businessId: "business-b",
      type: "SECOND",
      title: "Second autonomous turn",
      goal: "Must remain ready after a graceful stop.",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
      priority: 90,
    });
    let stop = false;
    const progress: string[] = [];
    const result = await tick(db, {
      businessId: "business-b",
      maxWorkItems: 2,
      shouldStop: () => stop,
      onProgress: (event) => {
        progress.push(event.type);
        if (event.type === "work_started") stop = true;
      },
      runner: {
        async runTask() {
          return {
            ok: true,
            exitCode: 0,
            durationMs: 1,
            timedOut: false,
            costCents: 1,
            inputTokens: 1,
            outputTokens: 1,
            finalText: "Turn yielded safely.",
          };
        },
      },
    });
    expect(result).toMatchObject({ processed: 1, stoppedEarly: true });
    expect(result.results[0]?.workItemId).toBe(first);
    expect(progress).toEqual(["work_started", "work_finished"]);
  });
  it("recovers a tick lock whose owning Cult4 process no longer exists", async () => {
    db.prepare(
      "INSERT INTO runtime_lock(name,owner,expires_at) VALUES('tick','2147483647:orphan','2999-01-01T00:00:00.000Z')",
    ).run();
    const result = await tick(db, { maxWorkItems: 0 });
    expect(result.processed).toBe(0);
    expect(db.prepare("SELECT count(*) count FROM runtime_lock").get()).toEqual(
      { count: 0 },
    );
  });
  it("E20 cannot weaken physical core policy locally", () => {
    db.prepare(
      "INSERT INTO business_policy(id,business_id,rule_type,parameters,created_by,effective_from,status) VALUES('p','business-a','sample_not_required','true','human-owner',?,'ACTIVE')",
    ).run("2020-01-01T00:00:00.000Z");
    const supplier = createSupplier(db, { name: "S", type: "PRINT" });
    const product = createProduct(db, {
      businessId: "business-a",
      name: "P",
      fulfillmentKind: "PHYSICAL",
      productFamily: "print",
    });
    const version = createProductVersion(db, {
      productId: product,
      version: "1",
      contentHash: "h",
      supplierId: supplier,
    });
    expect(
      evaluateAction(
        db,
        {
          actionType: "PUBLISH_PRODUCT",
          actorId: "employee-operator",
          businessId: "business-a",
          subjectType: "PRODUCT_VERSION",
          subjectId: version,
          subjectVersion: "h",
        },
        true,
      ).denialReasons,
    ).toContain("REAL_PHYSICAL_SAMPLE_PASS_MISSING");
  });
});

describe("work, experiments, audit and persistence", () => {
  it("validates DAG branches, cycles and transitions", () => {
    const a = createWorkItem(db, {
      businessId: "business-a",
      type: "A",
      title: "A",
      goal: "A",
      createdBy: "human-owner",
      status: "READY",
    });
    const b = createWorkItem(db, {
      businessId: "business-a",
      type: "B",
      title: "B",
      goal: "B",
      createdBy: "human-owner",
      status: "READY",
    });
    const otherBusiness = createWorkItem(db, {
      businessId: "business-b",
      type: "OTHER",
      title: "Other Business",
      goal: "Stay outside the scoped run.",
      createdBy: "human-owner",
      status: "READY",
    });
    const interaction = createWorkItem(db, {
      businessId: "business-a",
      type: "OPERATOR_INTERACTION",
      title: "Conversation",
      goal: "Remain interactive.",
      createdBy: "human-owner",
      status: "READY",
    });
    addDependency(db, b, a);
    expect((listReadyWork(db) as any[]).map((x) => x.id)).toContain(a);
    expect((listReadyWork(db) as any[]).map((x) => x.id)).not.toContain(b);
    const scoped = (listReadyWork(db, 20, "business-a") as any[]).map(
      (x) => x.id,
    );
    expect(scoped).toContain(a);
    expect(scoped).not.toContain(otherBusiness);
    expect(scoped).not.toContain(interaction);
    expect(() => addDependency(db, a, b)).toThrow(/cycle/i);
    transitionWorkItem(db, a, "RUNNING", "system");
    transitionWorkItem(db, a, "DONE", "system");
    expect((listReadyWork(db) as any[]).map((x) => x.id)).toContain(b);
    expect(() => transitionWorkItem(db, a, "RUNNING", "system")).toThrow();
  });
  it("requires complete experiment readiness", () => {
    const hypothesis = createHypothesis(db, {
      businessId: "business-a",
      statement: "X",
      rationale: "Y",
      createdBy: "employee-strategist",
    });
    const experiment = createExperiment(db, {
      hypothesisId: hypothesis,
      design: "test",
    });
    expect(() => readyExperiment(db, experiment)).toThrow();
  });
  it("makes critical audit append-only", () => {
    expect(() => db.prepare("DELETE FROM audit_event").run()).toThrow(
      /append-only/,
    );
    expect(() => db.prepare("UPDATE audit_event SET type='X'").run()).toThrow(
      /append-only/,
    );
  });
});
