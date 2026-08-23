import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { proposeBusinessMandate } from "../src/mandate.js";

describe("cult CLI", () => {
  it("initializes, creates a generic business, reports status, and passes doctor", () => {
    const root = mkdtempSync(join(tmpdir(), "cult4-cli-"));
    const organizationRemote = join(root, "organization.git"),
      businessRemote = join(root, "no-category-assumption.git");
    execFileSync("git", ["init", "--bare", "-b", "main", organizationRemote]);
    execFileSync("git", ["init", "--bare", "-b", "main", businessRemote]);
    const env = {
      ...process.env,
      CULT4_HOME: join(root, "home"),
      CULT4_ORGANIZATION_PATH: join(root, "organization"),
      CULT4_OPENCODE_AGENTS_PATH: join(root, "opencode/agents"),
      CULT4_OPENCODE_TOOLS_PATH: join(root, "opencode/tools"),
      CULT4_OPENCODE_SKILLS_PATH: join(root, "opencode/skills"),
      CULT4_ORGANIZATION_REMOTE_URL: organizationRemote,
      CULT4_TEST_PRIVATE_REMOTES: "1",
      CULT4_GITHUB_OWNER: undefined,
    };
    const tsx = join(process.cwd(), "node_modules/.bin/tsx"),
      cli = join(process.cwd(), "src/cli.ts");
    const run = (args: string[]) =>
      JSON.parse(
        execFileSync(tsx, [cli, ...args], { env, encoding: "utf8" }),
      ) as Record<string, unknown>;
    expect(run(["config", "show"]).githubOwner).toBeNull();
    expect(
      run(["config", "set", "github-owner", "cult4-test-owner"]).status,
    ).toBe("saved");
    expect(run(["config", "show"])).toMatchObject({
      githubOwner: "cult4-test-owner",
      githubOwnerSource: "settings",
    });
    expect(existsSync(join(root, "home/state.db"))).toBe(false);
    expect(run(["config", "unset", "github-owner"]).status).toBe("removed");
    expect(run(["config", "show"]).githubOwner).toBeNull();
    expect(run(["init"]).status).toBe("initialized");
    expect(
      run([
        "business",
        "create",
        "No Category Assumption",
        "--remote",
        businessRemote,
      ]).slug,
    ).toBe("no-category-assumption");
    expect(run(["business", "list"])).toHaveLength(1);
    expect(run(["status"]).pendingHuman).toBe(0);
    expect(run(["doctor"]).ok).toBe(true);
  }, 30_000);

  it("onboards from cult with no arguments and opens an interactive Operator", async () => {
    const root = mkdtempSync(join(tmpdir(), "cult4-onboarding-"));
    const organizationRemote = join(root, "organization.git"),
      businessRemote = join(root, "interactive-business.git"),
      fakeBin = join(root, "bin"),
      openCodeLog = join(root, "opencode.log");
    mkdirSync(fakeBin);
    execFileSync("git", ["init", "--bare", "-b", "main", organizationRemote]);
    execFileSync("git", ["init", "--bare", "-b", "main", businessRemote]);
    const fakeOpenCode = join(fakeBin, "opencode");
    writeFileSync(
      fakeOpenCode,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "opencode test"; exit 0; fi\nif [ "$1" = "run" ]; then\n  if [ ! -e "$CULT4_HOME/autopilot.first-turn" ]; then\n    : > "$CULT4_HOME/autopilot.first-turn"\n    exit 0\n  fi\n  : > "$CULT4_HOME/autopilot.ran"\n  CULT4_TOOL_EMPLOYEE="$CULT4_EMPLOYEE" CULT4_TOOL_WORK="$CULT4_WORK_ITEM" CULT4_TOOL_DIRECTORY="$CULT4_HOME/businesses/interactive-business" cult __tool update_work \'{"status":"DONE","result":"Autopilot completed durable work."}\'\n  exit 0\nfi\nprintf "%s\\n" "$@" > "$CULT4_TEST_OPENCODE_LOG"\nif [ "$CULT4_TEST_OPERATOR_EDIT" = "1" ]; then printf "operator artifact\\n" > "$1/operator-output.txt"; fi\nif [ "$CULT4_TEST_FINISH_INTAKE" = "1" ] && [ ! -e "$CULT4_TEST_HANDOFF_ONCE" ]; then\n  : > "$CULT4_TEST_HANDOFF_ONCE"\n  CULT4_TOOL_EMPLOYEE="$CULT4_EMPLOYEE" CULT4_TOOL_WORK="$CULT4_WORK_ITEM" CULT4_TOOL_DIRECTORY="$1" "$CULT4_TEST_TSX" "$CULT4_TEST_CLI" __tool finish_intake "$CULT4_TEST_FINISH_PAYLOAD"\n  exec sleep 30\nfi\nif [ "$CULT4_TEST_START_AUTOPILOT" = "1" ] && [ ! -e "$CULT4_TEST_AUTOPILOT_ONCE" ]; then\n  : > "$CULT4_TEST_AUTOPILOT_ONCE"\n  CULT4_TOOL_EMPLOYEE="$CULT4_EMPLOYEE" CULT4_TOOL_WORK="$CULT4_WORK_ITEM" CULT4_TOOL_DIRECTORY="$1" "$CULT4_TEST_TSX" "$CULT4_TEST_CLI" __tool start_autopilot "$CULT4_TEST_AUTOPILOT_PAYLOAD"\n  exec sleep 30\nfi\n',
    );
    chmodSync(fakeOpenCode, 0o700);
    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      CULT4_HOME: join(root, "home"),
      CULT4_ORGANIZATION_PATH: join(root, "organization"),
      CULT4_OPENCODE_AGENTS_PATH: join(root, "opencode/agents"),
      CULT4_OPENCODE_TOOLS_PATH: join(root, "opencode/tools"),
      CULT4_OPENCODE_SKILLS_PATH: join(root, "opencode/skills"),
      CULT4_ORGANIZATION_REMOTE_URL: organizationRemote,
      CULT4_TEST_PRIVATE_REMOTES: "1",
      CULT4_TEST_OPENCODE_LOG: openCodeLog,
      CULT4_TEST_TSX: join(process.cwd(), "node_modules/.bin/tsx"),
      CULT4_TEST_CLI: join(process.cwd(), "src/cli.ts"),
      CULT4_GITHUB_OWNER: undefined,
    };
    const tsx = join(process.cwd(), "node_modules/.bin/tsx"),
      cli = join(process.cwd(), "src/cli.ts");
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(tsx, [cli], { env, stdio: "pipe" });
      let stdout = "",
        stderr = "",
        answer = 0;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (answer === 0 && stdout.includes("Nom de la première entreprise")) {
          answer = 1;
          child.stdin.write("Interactive Business\n");
        } else if (answer === 1 && stdout.includes("Propriétaire GitHub")) {
          answer = 2;
          child.stdin.write("\n");
        } else if (answer === 2 && stdout.includes("URL du dépôt Git privé")) {
          answer = 3;
          child.stdin.end(`${businessRemote}\n`);
        }
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`cult exited ${code}: ${stderr}`));
      });
    });
    expect(output).toContain("Bienvenue dans Cult4");
    expect(output).toContain(
      "Ouverture de l’Operator pour Interactive Business",
    );
    const openCodeArgs = readFileSync(openCodeLog, "utf8").trim().split("\n");
    expect(openCodeArgs[0]).toBe(
      join(root, "home/businesses/interactive-business"),
    );
    expect(openCodeArgs).not.toContain("--dir");
    expect(openCodeArgs).toContain("cult4-intake");
    expect(openCodeArgs).not.toContain("--continue");

    const state = new Database(join(root, "home/state.db"));
    state
      .prepare(
        `UPDATE work_item SET status='WAITING_HUMAN'
         WHERE business_id=(SELECT id FROM business WHERE slug='interactive-business')
           AND type='OPERATOR_INTERACTION'`,
      )
      .run();
    state.close();

    execFileSync(tsx, [cli], { env });
    const resumedArgs = readFileSync(openCodeLog, "utf8").trim().split("\n");
    expect(resumedArgs[0]).toBe(
      join(root, "home/businesses/interactive-business"),
    );
    expect(resumedArgs).toContain("--continue");
    const resumedState = new Database(join(root, "home/state.db"), {
      readonly: true,
    });
    const interactionCount = resumedState
      .prepare(
        `SELECT count(*) AS count FROM work_item
         WHERE business_id=(SELECT id FROM business WHERE slug='interactive-business')
           AND type='OPERATOR_INTERACTION'`,
      )
      .get() as { count: number };
    resumedState.close();
    expect(interactionCount.count).toBe(1);

    const cultDb = openDatabase(getConfig(env));
    const interaction = cultDb
      .prepare(
        `SELECT wi.id,wi.business_id FROM work_item wi
         JOIN business b ON b.id=wi.business_id
         WHERE b.slug='interactive-business' AND wi.type='OPERATOR_INTERACTION'`,
      )
      .get() as { id: string; business_id: string };
    cultDb
      .prepare(
        `INSERT INTO intake_message(id,business_id,work_item_id,session_id,external_message_id,ordinal,content,content_hash,created_at)
       VALUES('cli-intake-message',?,?,'cli-session','cli-external-message',0,?,'cli-hash',datetime('now'))`,
      )
      .run(
        interaction.business_id,
        interaction.id,
        "Build a disciplined local opportunity engine from measurable demand.",
      );
    const proposed = proposeBusinessMandate(
      cultDb,
      {
        purpose:
          "Build a disciplined local opportunity engine from measurable demand.",
        customer:
          "Local buyers seeking useful products at realistic marketplace prices.",
        offer:
          "Small product tests selected through evidence, sourcing, and scoring.",
        narrative:
          "A careful modern merchant searches for temporary local asymmetries, tests them with very small bets, and learns from actual buyer behavior. The engine matters more than any individual product and stays useful by remaining curious, disciplined, and willing to abandon weak inventory quickly.",
        spirit:
          "Pragmatic, observant, frugal, and fast without becoming reckless, generic, or emotionally attached to weak inventory.",
        voice:
          "Direct, precise, grounded in evidence, and free of inflated commercial claims.",
        taste:
          "Simple operational systems, small experiments, clear thresholds, and useful outputs.",
        emotionalTerritory:
          "Quiet confidence from seeing reality clearly and making reversible commercial bets.",
        qualityBar:
          "Every recommendation must expose its evidence, costs, uncertainty, and stop rule.",
        autonomyMode: "SUPERVISED",
        constraints: [
          "Keep every initial product experiment small and reversible.",
        ],
        allowedWithoutApproval: [
          "Research, score opportunities, and prepare private operational drafts.",
        ],
        requiresApproval: [
          "Require the human to approve spending and every public marketplace action.",
        ],
        prohibited: [
          "Never purchase, publish, or contact buyers without the required approval.",
        ],
        antiGoals: [
          "Do not accumulate permanent inventory or defend weak product ideas emotionally.",
        ],
        successSignals: [
          "A measured product test sells quickly enough to produce a positive net margin.",
        ],
        stopConditions: [
          "Stop an experiment when demand, margin, safety, or compliance evidence fails.",
        ],
        humanInputs: [
          "The human performs physical handling and confirms sensitive commercial actions.",
        ],
        unresolvedQuestions: [],
        officialRequests: [
          {
            statement:
              "Build a disciplined local opportunity engine from measurable demand.",
            kind: "OUTCOME",
            priority: "MUST",
            acceptanceCriteria:
              "Independent QA verifies an evidence-driven reusable opportunity engine rather than a one-off product batch.",
            sourceMessageIds: ["cli-intake-message"],
            disposition: "COMMITTED",
            contractReference: "purpose,offer,narrative",
            rationale:
              "This is the official outcome requested by the human during Intake.",
          },
        ],
        messageDispositions: [],
        budget: {
          currency: "CAD",
          maxExplorationSpendCents: 100_000,
          maxSpendWithoutApprovalCents: 0,
          maxSingleSpendCents: 10_000,
        },
      },
      {
        businessId: interaction.business_id,
        workItemId: interaction.id,
        proposedBy: "employee-operator",
      },
    );
    cultDb.close();
    const interruptedHandoffOutput = await new Promise<string>(
      (resolve, reject) => {
        const child = spawn(tsx, [cli], {
          env: {
            ...env,
            CULT4_TEST_FINISH_INTAKE: "1",
            CULT4_TEST_HANDOFF_ONCE: join(root, "handoff.once"),
            CULT4_TEST_FINISH_PAYLOAD: JSON.stringify({
              mandateId: proposed.mandateId,
              contentHash: proposed.contentHash,
            }),
          },
          stdio: "pipe",
        });
        let stdout = "",
          stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          if (stdout.includes("Confirmer cette version exacte?"))
            child.stdin.end();
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) resolve(stdout);
          else reject(new Error(`cult exited ${code}: ${stderr}`));
        });
      },
    );
    expect(interruptedHandoffOutput).toContain("Intake terminé");

    const handoffOutput = await new Promise<string>((resolve, reject) => {
      const child = spawn(tsx, [cli], {
        env,
        stdio: "pipe",
      });
      let stdout = "",
        stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (stdout.includes("Confirmer cette version exacte?"))
          child.stdin.write("o\n");
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`cult exited ${code}: ${stderr}`));
      });
    });
    expect(handoffOutput).toContain("Mandat confirmé");
    const operatorArgs = readFileSync(openCodeLog, "utf8").trim().split("\n");
    expect(operatorArgs).not.toContain("--continue");
    expect(operatorArgs).toContain("cult4-operator");
    expect(operatorArgs).toContain("--prompt");
    expect(operatorArgs.join(" ")).toContain(
      "route each task to an operationally equipped specialist",
    );
    const confirmedState = new Database(join(root, "home/state.db"), {
      readonly: true,
    });
    expect(
      confirmedState
        .prepare(
          "SELECT confirmed_mandate_id FROM business WHERE slug='interactive-business'",
        )
        .get(),
    ).toEqual({ confirmed_mandate_id: proposed.mandateId });
    confirmedState.close();

    const freshOperatorState = new Database(join(root, "home/state.db"));
    freshOperatorState
      .prepare(
        "UPDATE work_item SET status='DONE' WHERE type='OPERATOR_INTERACTION'",
      )
      .run();
    freshOperatorState.close();
    execFileSync(tsx, [cli], { env });
    const freshOperatorArgs = readFileSync(openCodeLog, "utf8")
      .trim()
      .split("\n");
    expect(freshOperatorArgs).not.toContain("--continue");
    expect(freshOperatorArgs).toContain("cult4-operator");
    expect(freshOperatorArgs).toContain("--prompt");
    expect(freshOperatorArgs.join(" ")).toContain(
      "route each task to an operationally equipped specialist",
    );

    const autopilotOutput = execFileSync(tsx, [cli], {
      env: {
        ...env,
        CULT4_TEST_START_AUTOPILOT: "1",
        CULT4_TEST_AUTOPILOT_ONCE: join(root, "autopilot.once"),
        CULT4_TEST_AUTOPILOT_PAYLOAD: JSON.stringify({
          maxDurationMinutes: 1,
          maxWorkItems: 2,
          maxCostCents: 100,
        }),
      },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(autopilotOutput).toContain("Autopilot démarré");
    expect(autopilotOutput).toContain("Autopilot terminé : 2 tour(s)");
    expect(existsSync(join(root, "home/autopilot.ran"))).toBe(true);
    const autopilotArgs = readFileSync(openCodeLog, "utf8").trim().split("\n");
    expect(autopilotArgs).toContain("cult4-operator");
    expect(autopilotArgs.join(" ")).toContain("autopilot run has ended");
    const autopilotState = new Database(join(root, "home/state.db"), {
      readonly: true,
    });
    expect(
      autopilotState
        .prepare(
          "SELECT status,result FROM work_item WHERE type='BUSINESS_FOUNDATION'",
        )
        .get(),
    ).toEqual({
      status: "READY",
      result: "Session yielded without a terminal work transition.",
    });
    expect(
      autopilotState.prepare("SELECT count(*) count FROM employee_run").get(),
    ).toEqual({ count: 2 });
    autopilotState.close();

    const operatorFinalizationOutput = execFileSync(tsx, [cli], {
      env: { ...env, CULT4_TEST_OPERATOR_EDIT: "1" },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(operatorFinalizationOutput).toContain(
      "Modifications de l’Operator validées, commitées et poussées par Cult4",
    );
    const businessPath = join(root, "home/businesses/interactive-business");
    expect(
      readFileSync(join(businessPath, "operator-output.txt"), "utf8"),
    ).toBe("operator artifact\n");
    expect(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: businessPath,
        encoding: "utf8",
      }),
    ).toBe("");
    const localSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: businessPath,
      encoding: "utf8",
    }).trim();
    const remoteSha = execFileSync(
      "git",
      ["--git-dir", businessRemote, "rev-parse", "main"],
      { encoding: "utf8" },
    ).trim();
    expect(remoteSha).toBe(localSha);
    const finalizedState = new Database(join(root, "home/state.db"), {
      readonly: true,
    });
    expect(
      finalizedState
        .prepare(
          "SELECT count(*) count FROM git_commit WHERE employee_id='employee-operator' AND sha=?",
        )
        .get(localSha),
    ).toEqual({ count: 1 });
    expect(
      finalizedState
        .prepare(
          "SELECT count(*) count FROM work_item WHERE type='DIGITAL_QA' AND subject_version=?",
        )
        .get(localSha),
    ).toEqual({ count: 1 });
    finalizedState.close();

    const secondRemote = join(root, "second-business.git");
    execFileSync("git", ["init", "--bare", "-b", "main", secondRemote]);
    execFileSync(
      tsx,
      [cli, "business", "create", "Second Business", "--remote", secondRemote],
      { env },
    );
    const selectionOutput = await new Promise<string>((resolve, reject) => {
      const child = spawn(tsx, [cli], { env, stdio: "pipe" });
      let stdout = "",
        stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (stdout.includes("Choisir une entreprise")) child.stdin.end("2\n");
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`cult exited ${code}: ${stderr}`));
      });
    });
    expect(selectionOutput).toContain("Entreprises actives");
    expect(selectionOutput).toContain("Second Business");
    expect(readFileSync(openCodeLog, "utf8")).toContain(
      join(root, "home/businesses/second-business"),
    );
  }, 30_000);
});
