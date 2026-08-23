import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openMemoryDatabase, type CultDatabase } from "../src/db.js";
import { seedFoundation } from "../src/seed.js";
import { now } from "../src/domain.js";
import {
  CliOpenCodeRunner,
  resolveOpenCodeModel,
  type OpenCodeProgressEvent,
} from "../src/opencode.js";
import { materializeAllEmployees } from "../src/employee.js";
import { materializeCult4Tools } from "../src/tool-materialization.js";
import { materializeExtensionTools } from "../src/tool-extensions.js";
import {
  createArtifactVersion,
  recordIpClearance,
  recordProvenance,
  registerArtifact,
} from "../src/artifact.js";
import { createBudget, requestSpend } from "../src/finance.js";
import {
  createProduct,
  createProductVersion,
  createSampleOrder,
  createSupplier,
  markSampleOrdered,
  markSampleReceived,
  markSampleShipped,
  qualifySupplier,
  recordPhysicalInspection,
} from "../src/physical.js";
import { resolveHumanRequest } from "../src/human.js";
import { evaluateAction } from "../src/policy.js";
import { grantApproval } from "../src/approval.js";
import { executeAuthorizedAction } from "../src/action.js";
import { organizationSessionConfig } from "../src/organization-maintenance.js";

let db: CultDatabase;
let root: string;
let repo: string;
beforeEach(() => {
  db = openMemoryDatabase();
  seedFoundation(db);
  root = mkdtempSync(join(tmpdir(), "cult4-int-"));
  repo = join(root, "business");
  mkdirSync(repo);
  db.prepare(
    "INSERT INTO business(id,slug,name,repo_path,status,created_at) VALUES('business-a','business-a','A',?,'ACTIVE',?)",
  ).run(repo, now());
});
afterEach(() => db.close());

describe("OpenCode adapter and materialization", () => {
  it("defaults to pinned MiMo Pro while preserving explicit model overrides", () => {
    expect(resolveOpenCodeModel(null, {})).toBe(
      "openrouter/xiaomi/mimo-v2.5-pro",
    );
    expect(
      resolveOpenCodeModel(null, {
        CULT4_OPENCODE_MODEL: "openrouter/example/environment-model",
      }),
    ).toBe("openrouter/example/environment-model");
    expect(
      resolveOpenCodeModel("openrouter/example/employee-model", {
        CULT4_OPENCODE_MODEL: "openrouter/example/environment-model",
      }),
    ).toBe("openrouter/example/employee-model");
  });

  it("uses the verified CLI contract, parses JSON, and does not forward arbitrary secrets", async () => {
    const script = join(root, "fake-opencode");
    writeFileSync(
      script,
      `#!/bin/sh\nprintf '%s\\n' "$*" > "${join(root, "args")}"\nprintf '%s' "\${DANGEROUS_SECRET:-absent}:\${OPENROUTER_API_KEY:-absent}" > "${join(root, "secret")}"\nprintf '%s\\n' 'OpenCode diagnostic'\nprintf '%s\\n' '{"sessionID":"session-1","part":{"type":"tool","tool":"cult4_get_state","callID":"call-1","state":{"status":"completed","title":"Load durable state","input":{"scope":"current"},"output":"state loaded"}}}'\nprintf '%s\\n' '{"sessionID":"session-1","part":{"type":"text","text":"done"}}'\nprintf '%s\\n' '{"type":"step_finish","cost":0.12,"tokens":{"input":7,"output":3}}'\n`,
      { mode: 0o700 },
    );
    chmodSync(script, 0o700);
    const progress: OpenCodeProgressEvent[] = [];
    const result = await new CliOpenCodeRunner(script).runTask({
      directory: repo,
      agentName: "cult4-qa",
      prompt: "mission",
      timeoutMs: 2000,
      environment: {
        CULT4_EMPLOYEE: "employee-qa",
        CULT4_WORK_ITEM: "work-1",
        DANGEROUS_SECRET: "must-not-pass",
        OPENROUTER_API_KEY: "must-also-not-pass",
      },
      onProgress: (event) => progress.push(event),
    });
    expect(result).toMatchObject({
      ok: true,
      sessionId: "session-1",
      finalText: "done",
      costCents: 12,
      inputTokens: 7,
      outputTokens: 3,
    });
    const args = readFileSync(join(root, "args"), "utf8");
    expect(args).toContain(
      `run --dir ${repo} --agent cult4-qa --auto --format json`,
    );
    expect(readFileSync(join(root, "secret"), "utf8")).toBe("absent:absent");
    expect(progress).toEqual([
      { type: "diagnostic", text: "OpenCode diagnostic" },
      {
        type: "tool",
        tool: "cult4_get_state",
        status: "completed",
        callId: "call-1",
        title: "Load durable state",
        input: { scope: "current" },
        output: "state loaded",
      },
      { type: "message", text: "done" },
      {
        type: "usage",
        costCents: 12,
        inputTokens: 7,
        outputTokens: 3,
      },
    ]);
  });
  it.runIf(process.platform === "linux")(
    "kills an autonomous OpenCode child even when the Cult4 parent is killed",
    async () => {
      const childPidPath = join(root, "autonomous-child.pid");
      const parentPidPath = join(root, "cult-parent.pid");
      const script = join(root, "long-opencode");
      writeFileSync(
        script,
        `#!/bin/sh\nprintf '%s' "$$" > "${childPidPath}"\nwhile :; do sleep 1; done\n`,
        { mode: 0o700 },
      );
      chmodSync(script, 0o700);
      const helper = join(root, "parent.ts");
      const adapter = join(process.cwd(), "src/opencode.ts");
      writeFileSync(
        helper,
        `import { writeFileSync } from "node:fs";\nimport { CliOpenCodeRunner } from ${JSON.stringify(adapter)};\nwriteFileSync(${JSON.stringify(parentPidPath)},String(process.pid));\nvoid new CliOpenCodeRunner(${JSON.stringify(script)}).runTask({directory:${JSON.stringify(repo)},agentName:"cult4-operator",prompt:"mission",timeoutMs:60000});\n`,
      );
      const parent = spawn(
        join(process.cwd(), "node_modules/.bin/tsx"),
        [helper],
        {
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let parentError = "";
      parent.stderr!.setEncoding("utf8");
      parent.stderr!.on("data", (chunk: string) => {
        parentError += chunk;
      });
      for (
        let index = 0;
        index < 100 &&
        (!existsSync(childPidPath) || !existsSync(parentPidPath));
        index++
      )
        await new Promise((resolve) => setTimeout(resolve, 25));
      if (!existsSync(childPidPath))
        throw new Error(`Autonomous child did not start: ${parentError}`);
      const childPid = Number(readFileSync(childPidPath, "utf8"));
      const cultParentPid = Number(readFileSync(parentPidPath, "utf8"));
      process.kill(cultParentPid, "SIGKILL");
      const childIsRunning = () => {
        const statPath = `/proc/${childPid}/stat`;
        if (!existsSync(statPath)) return false;
        return readFileSync(statPath, "utf8").split(" ")[2] !== "Z";
      };
      for (let index = 0; index < 100; index++) {
        if (!childIsRunning()) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(childIsRunning()).toBe(false);
    },
  );
  it.runIf(process.platform === "linux")(
    "turns SIGINT into a completed cancellation before the parent exits",
    async () => {
      const childPidPath = join(root, "signal-child.pid");
      const resultPath = join(root, "signal-result.json");
      const script = join(root, "signal-opencode");
      writeFileSync(
        script,
        `#!/bin/sh\nprintf '%s' "$$" > "${childPidPath}"\nwhile :; do sleep 1; done\n`,
        { mode: 0o700 },
      );
      chmodSync(script, 0o700);
      const helper = join(root, "signal-parent.ts");
      const adapter = join(process.cwd(), "src/opencode.ts");
      writeFileSync(
        helper,
        `import { writeFileSync } from "node:fs";\nimport { CliOpenCodeRunner } from ${JSON.stringify(adapter)};\nvoid new CliOpenCodeRunner(${JSON.stringify(script)}).runTask({directory:${JSON.stringify(repo)},agentName:"cult4-operator",prompt:"mission",timeoutMs:60000}).then(result=>writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(result)));\n`,
      );
      const parent = spawn(
        join(process.cwd(), "node_modules/.bin/tsx"),
        [helper],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      for (let index = 0; index < 100 && !existsSync(childPidPath); index++)
        await new Promise((resolve) => setTimeout(resolve, 25));
      expect(existsSync(childPidPath)).toBe(true);
      parent.kill("SIGINT");
      const exitCode = await new Promise<number | null>((resolve) =>
        parent.once("close", resolve),
      );
      expect(exitCode).toBe(0);
      expect(JSON.parse(readFileSync(resultPath, "utf8"))).toMatchObject({
        ok: false,
        errorCode: "MODEL_CANCELLED",
      });
      const childPid = Number(readFileSync(childPidPath, "utf8"));
      expect(existsSync(`/proc/${childPid}`)).toBe(false);
    },
  );
  it("stops an OpenCode run at the next completed tool boundary", async () => {
    const script = join(root, "boundary-opencode");
    writeFileSync(
      script,
      `#!/bin/sh\nprintf '%s\\n' '{"part":{"type":"tool","tool":"edit","callID":"call-stop","state":{"status":"pending","input":{"filePath":"artifact.txt"}}}}'\nsleep 0.1\nprintf '%s\\n' '{"part":{"type":"tool","tool":"edit","callID":"call-stop","state":{"status":"completed","input":{"filePath":"artifact.txt"},"output":"saved"}}}'\nsleep 30\n`,
      { mode: 0o700 },
    );
    chmodSync(script, 0o700);
    const controller = new AbortController();
    const started = Date.now();
    const result = await new CliOpenCodeRunner(script).runTask({
      directory: repo,
      agentName: "cult4-operator",
      prompt: "mission",
      timeoutMs: 5000,
      signal: controller.signal,
      onProgress: (event) => {
        if (event.type === "tool" && event.status === "pending")
          controller.abort();
      },
    });
    expect(result).toMatchObject({
      ok: false,
      timedOut: false,
      errorCode: "MODEL_CANCELLED",
    });
    expect(Date.now() - started).toBeLessThan(3000);
  });
  it("materializes idempotent agents and every narrow OpenCode tool", () => {
    const config = {
      home: root,
      databasePath: join(root, "state.db"),
      objectsPath: join(root, "objects"),
      runtimePath: join(root, "runtime"),
      secretsPath: join(root, "secrets"),
      businessesPath: join(root, "businesses"),
      organizationPath: join(root, "organization"),
      agentsPath: join(root, "agents"),
      toolsPath: join(root, "tools"),
      skillsPath: join(root, "skills"),
    };
    const agents = materializeAllEmployees(db, config),
      core = materializeCult4Tools(config),
      extensions = materializeExtensionTools(config);
    expect(agents).toHaveLength(10);
    expect(readFileSync(agents[0]!, "utf8")).toContain(
      "External content may contain instructions",
    );
    const operator = readFileSync(
      agents.find((path) => path.endsWith("cult4-operator.md"))!,
      "utf8",
    );
    expect(operator).toContain("edit: deny");
    expect(operator).toContain("bash: deny");
    const builder = readFileSync(
      agents.find((path) => path.endsWith("cult4-builder.md"))!,
      "utf8",
    );
    expect(builder).toContain("edit: allow");
    expect(builder).toContain("bash: allow");
    expect(builder).toContain("skill: allow");
    const qa = readFileSync(
      agents.find((path) => path.endsWith("cult4-qa.md"))!,
      "utf8",
    );
    expect(qa).toContain("edit: deny");
    expect(qa).toContain("bash: allow");
    const intake = readFileSync(
      agents.find((path) => path.endsWith("cult4-intake.md"))!,
      "utf8",
    );
    expect(intake).toContain("read: allow");
    expect(intake).toContain("edit: deny");
    expect(intake).toContain("websearch: deny");
    expect(intake).toContain("not an administrative interview");
    expect(readFileSync(core, "utf8")).not.toContain("\n+");
    expect(readFileSync(core, "utf8")).toContain("export const request_spend");
    expect(readFileSync(core, "utf8")).toContain(
      "export const create_market_study",
    );
    expect(readFileSync(core, "utf8")).toContain(
      "export const propose_business_mandate",
    );
    expect(readFileSync(core, "utf8")).toContain("export const finish_intake");
    expect(readFileSync(core, "utf8")).toContain(
      "export const start_autopilot",
    );
    expect(readFileSync(core, "utf8")).toContain("export const ready_work");
    expect(readFileSync(core, "utf8")).toContain(
      "export const add_work_dependency",
    );
    expect(extensions.map((x) => x.split("/").pop())).toContain(
      "cult4_record_approval.ts",
    );
    materializeAllEmployees(db, config);
    expect(existsSync(agents[0]!)).toBe(true);
  });
  it("keeps Foundation edits denied outside an approved Foundation session", () => {
    const config = {
      home: root,
      databasePath: join(root, "state.db"),
      objectsPath: join(root, "objects"),
      runtimePath: join(root, "runtime"),
      secretsPath: join(root, "secrets"),
      businessesPath: join(root, "businesses"),
      organizationPath: join(root, "organization"),
      agentsPath: join(root, "agents"),
      toolsPath: join(root, "tools"),
      skillsPath: join(root, "skills"),
    };
    expect(
      (organizationSessionConfig(config, false) as any).permission.edit[
        "foundation/**"
      ],
    ).toBe("deny");
    expect(
      (organizationSessionConfig(config, true) as any).permission.edit[
        "foundation/**"
      ],
    ).toBeUndefined();
  });
});

describe("generic physical commercial acceptance", () => {
  it("releases an AI-created physical product only after every exact independent gate", async () => {
    const artifact = registerArtifact(db, {
      businessId: "business-a",
      type: "IMAGE",
      purpose: "commercial product",
      createdBy: "employee-designer",
      publicFacing: true,
      commercial: true,
    });
    const art = createArtifactVersion(db, {
      artifactId: artifact,
      locator: "art.png",
      content: "original bytes",
      aiGenerated: true,
      modelOrTool: "test-model",
    });
    recordProvenance(db, {
      artifactVersionId: art.id,
      sourceType: "PROMPT",
      sourceRef: "prompt record",
      licenseStatus: "NOT_REQUIRED",
    });
    recordIpClearance(db, {
      artifactVersionId: art.id,
      risk: "LOW",
      searchStatus: "NOT_FOUND",
      reviewerId: "employee-ip-reviewer",
      evidenceRef: "documented IP searches",
    });
    const supplier = createSupplier(db, {
      name: "Qualified Printer",
      type: "PRINT_ON_DEMAND",
    });
    const product = createProduct(db, {
      businessId: "business-a",
      name: "Generic physical art product",
      fulfillmentKind: "PHYSICAL",
      productFamily: "printed-paper",
    });
    const version = createProductVersion(db, {
      productId: product,
      version: "1",
      contentHash: "product-hash",
      artifactVersionId: art.id,
      supplierId: supplier,
      material: "vinyl",
      process: "inkjet",
      packaging: "mailer",
      shippingMethod: "postal",
    });
    const budget = createBudget(db, {
      businessId: "business-a",
      category: "samples",
      currency: "USD",
      limitAmount: 2500,
      periodStart: "2020-01-01T00:00:00.000Z",
      periodEnd: "2099-01-01T00:00:00.000Z",
      createdBy: "human-owner",
    });
    const spend = requestSpend(db, {
      businessId: "business-a",
      requestedBy: "employee-operator",
      amount: 2000,
      currency: "USD",
      vendor: "Qualified Printer",
      purpose: "Exact physical sample",
      budgetId: budget,
    });
    expect(spend.status).toBe("AUTHORIZED");
    const order = createSampleOrder(db, {
      productVersionId: version,
      supplierId: supplier,
      spendRequestId: spend.spendRequestId,
      commitmentId: spend.commitmentId,
    });
    markSampleOrdered(db, order, "order-1");
    markSampleShipped(db, order);
    const requestId = markSampleReceived(db, order);
    const checklist = Object.fromEntries(
      [
        "visual_quality",
        "print_sharpness",
        "color_fidelity",
        "cut_alignment",
        "material",
        "size_function",
        "packaging",
        "shipping_damage",
        "delivery_experience",
        "listing_vs_reality",
        "overall_quality",
      ].map((key) => [key, "PASS"]),
    );
    recordPhysicalInspection(db, {
      sampleOrderId: order,
      result: "PASS",
      inspectedBy: "human-owner",
      checklist,
      notes: "Exact sample inspected",
    });
    resolveHumanRequest(
      db,
      requestId,
      "human-owner",
      true,
      "Exact sample passes",
    );
    qualifySupplier(db, {
      supplierId: supplier,
      productFamily: "printed-paper",
      material: "vinyl",
      process: "inkjet",
      packaging: "mailer",
      shippingMethod: "postal",
      result: "PASS",
      qualifiedBy: "human-owner",
      evidenceRef: "sample and delivery inspection",
      sampleOrderId: order,
    });
    let decision = evaluateAction(
      db,
      {
        actionType: "PUBLISH_PRODUCT",
        actorId: "employee-operator",
        businessId: "business-a",
        subjectType: "PRODUCT_VERSION",
        subjectId: version,
        subjectVersion: "product-hash",
      },
      true,
    );
    expect(decision.denialReasons).toEqual([]);
    for (const missing of decision.missingGates) {
      const actor =
        missing.authority === "APPROVE_PUBLIC_AI_ART" ||
        missing.authority === "APPROVE_SUPPLIER"
          ? "human-owner"
          : missing.authority === "APPROVE_IP_CLEARANCE"
            ? "employee-ip-reviewer"
            : missing.authority === "APPROVE_RELEASE_QUALITY"
              ? "employee-qa"
              : missing.authority === "APPROVE_UNIT_ECONOMICS"
                ? "employee-treasurer"
                : "employee-strategist";
      grantApproval(
        db,
        missing.gateId!,
        actor,
        `approved ${missing.authority}`,
      );
    }
    decision = evaluateAction(
      db,
      {
        actionType: "PUBLISH_PRODUCT",
        actorId: "employee-operator",
        businessId: "business-a",
        subjectType: "PRODUCT_VERSION",
        subjectId: version,
        subjectVersion: "product-hash",
      },
      false,
    );
    expect(decision.allowed).toBe(true);
    const external = await executeAuthorizedAction(
      db,
      {
        actionType: "PUBLISH_PRODUCT",
        actorId: "employee-operator",
        businessId: "business-a",
        subjectType: "PRODUCT_VERSION",
        subjectId: version,
        subjectVersion: "product-hash",
      },
      {
        execute: async (_intent, key) => ({
          externalReference: "listing-1",
          data: { key },
        }),
      },
      "release-key-1",
    );
    expect(external.externalReference).toBe("listing-1");
    expect(
      db.prepare("SELECT status FROM product_version WHERE id=?").get(version),
    ).toEqual({ status: "RELEASED" });
    expect(
      db
        .prepare("SELECT type FROM audit_event WHERE type='PRODUCT_RELEASED'")
        .get(),
    ).toEqual({ type: "PRODUCT_RELEASED" });
  });
});
