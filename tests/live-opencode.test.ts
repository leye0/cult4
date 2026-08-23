import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getConfig } from "../src/config.js";
import { openDatabase, type CultDatabase } from "../src/db.js";
import { materializeAllEmployees } from "../src/employee.js";
import { CliOpenCodeRunner } from "../src/opencode.js";
import {
  createBusiness,
  initializeOrganization,
  registerOrganizationRepository,
} from "../src/repo.js";
import { seedFoundation } from "../src/seed.js";
import { provisionProviderSecrets } from "../src/secrets.js";
import { materializeExtensionTools } from "../src/tool-extensions.js";
import { materializeCult4Tools } from "../src/tool-materialization.js";
import { tick } from "../src/tick.js";
import { createWorkItem } from "../src/work.js";
import { connectRemote } from "../src/git.js";

const live = process.env.CULT4_LIVE_TEST === "1";
const projectRoot = resolve(import.meta.dirname, "..");
if (live && existsSync(join(projectRoot, ".env")))
  process.loadEnvFile(join(projectRoot, ".env"));

describe.skipIf(!live)("live OpenCode integration", () => {
  let db: CultDatabase;
  const original = { ...process.env };
  const root = mkdtempSync(join(tmpdir(), "cult4-live-"));

  beforeAll(() => {
    if (!process.env.OPENROUTER_API_KEY)
      throw new Error("OPENROUTER_API_KEY is required for the live test.");
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const compiledCli = join(projectRoot, "dist", "cli.js");
    chmodSync(compiledCli, 0o755);
    symlinkSync(compiledCli, join(bin, "cult"));
    Object.assign(process.env, {
      CULT4_HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_CACHE_HOME: join(root, "cache"),
      CULT4_ORGANIZATION_PATH: join(root, "home", "organization"),
      CULT4_OPENCODE_AGENTS_PATH: join(root, "config", "opencode", "agents"),
      CULT4_OPENCODE_TOOLS_PATH: join(root, "config", "opencode", "tools"),
      CULT4_OPENCODE_SKILLS_PATH: join(root, "config", "opencode", "skills"),
      PATH: `${bin}:${original.PATH ?? ""}`,
      CULT4_TEST_PRIVATE_REMOTES: "1",
    });
    const config = getConfig();
    initializeOrganization(config);
    provisionProviderSecrets(config);
    db = openDatabase(config);
    seedFoundation(db);
    const organizationRemote = join(root, "organization.git");
    execFileSync("git", ["init", "--bare", "-b", "main", organizationRemote]);
    connectRemote(
      db,
      registerOrganizationRepository(db, config),
      organizationRemote,
    );
    materializeAllEmployees(db, config);
    materializeCult4Tools(config);
    materializeExtensionTools(config);
  });

  afterAll(() => {
    db?.close();
    for (const key of Object.keys(process.env))
      if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  });

  it("runs a real model through a real Cult4 agent and persists a tool write", async () => {
    const business = createBusiness(db, "Live OpenCode Business", getConfig());
    const remote = join(root, "live-opencode.git");
    execFileSync("git", ["init", "--bare", "-b", "main", remote]);
    connectRemote(db, business.repositoryId, remote);
    const workItemId = createWorkItem(db, {
      businessId: business.id,
      type: "LIVE_INTEGRATION",
      title: "Prove the real OpenCode-to-Cult4 tool path",
      goal: "Use authoritative context and persist a durable test observation.",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
    });
    const marker = `live-${Date.now()}`;
    const result = await new CliOpenCodeRunner().runTask({
      directory: business.repoPath,
      agentName: "cult4-operator",
      model: process.env.CULT4_LIVE_MODEL ?? "openrouter/openai/gpt-5-nano",
      timeoutMs: 180_000,
      environment: {
        CULT4_EMPLOYEE: "employee-operator",
        CULT4_WORK_ITEM: workItemId,
      },
      prompt: `First use bash to test whether OPENROUTER_API_KEY is absent from your environment; do not print its value under any circumstances. Call cult4_bootstrap and cult4_get_work. Then call cult4_remember with kind observation, scope business, title ${marker}, content Live OpenCode invoked a real Cult4 write tool, sourceRef live-integration-test, and confidence 1. After all tools succeed, reply exactly CULT4_TOOLS_OK CULT4_SECRET_NOT_IN_ENV if and only if the variable was absent.`,
    });
    expect(result.ok, result.errorSummary).toBe(true);
    expect(result.finalText).toContain(
      "CULT4_TOOLS_OK CULT4_SECRET_NOT_IN_ENV",
    );
    const memory = db
      .prepare("SELECT title,content FROM memory WHERE title=?")
      .get(marker) as { title: string; content: string } | undefined;
    expect(memory?.title).toBe(marker);
    expect(memory?.content).toContain(
      "Live OpenCode invoked a real Cult4 write tool",
    );
    expect(result.sessionId).toBeTruthy();
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.costCents).toBeGreaterThan(0);
  });

  it("executes a complete real cult tick through OpenRouter", async () => {
    const business = createBusiness(db, "Live Tick Business", getConfig());
    const remote = join(root, "live-tick.git");
    execFileSync("git", ["init", "--bare", "-b", "main", remote]);
    connectRemote(db, business.repositoryId, remote);
    const marker = `tick-${Date.now()}`;
    const workItemId = createWorkItem(db, {
      businessId: business.id,
      type: "LIVE_TICK",
      title: "Complete a live autonomous tick",
      goal: `Call cult4_bootstrap, persist a business observation titled ${marker} with content "Real cult tick completed", sourceRef "live-tick", confidence 1, then call cult4_update_work with status DONE and result "Live tick verified".`,
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
      priority: 100,
    });
    process.env.CULT4_OPENCODE_MODEL =
      process.env.CULT4_LIVE_MODEL ?? "openrouter/openai/gpt-5-nano";
    const result = await tick(db, {
      maxWorkItems: 1,
      maxDurationMs: 180_000,
      maxCostCents: 100,
    });
    expect(result.processed).toBe(1);
    expect(result.results).toEqual([{ workItemId, ok: true }]);
    expect(
      db.prepare("SELECT title FROM memory WHERE title=?").get(marker),
    ).toEqual({ title: marker });
    expect(
      db
        .prepare("SELECT status,result FROM work_item WHERE id=?")
        .get(workItemId),
    ).toEqual({ status: "DONE", result: "Live tick verified" });
    const run = db
      .prepare(
        "SELECT status,cost_cents,input_tokens,output_tokens,session_id FROM employee_run WHERE work_item_id=? ORDER BY created_at DESC LIMIT 1",
      )
      .get(workItemId) as Record<string, unknown>;
    expect(run.status).toBe("COMPLETED");
    expect(Number(run.input_tokens)).toBeGreaterThan(0);
    expect(Number(run.output_tokens)).toBeGreaterThan(0);
    expect(Number(run.cost_cents)).toBeGreaterThan(0);
    expect(run.session_id).toBeTruthy();
  });
});
