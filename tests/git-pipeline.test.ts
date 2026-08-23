import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Cult4Config } from "../src/config.js";
import { openDatabase, type CultDatabase } from "../src/db.js";
import { doctor, repairDoctor } from "../src/doctor.js";
import { grantApproval } from "../src/approval.js";
import {
  acquireRepositoryLock,
  connectRemote,
  finalizeVersionedWork,
  githubRemoteUrl,
  inspectRepository,
  prepareWritableRepository,
  recoverStagedOperatorWork,
  releaseRepositoryLock,
  restoreRepository,
  runGit,
} from "../src/git.js";
import { evaluateAction } from "../src/policy.js";
import { runOrganizationMaintenance } from "../src/organization-maintenance.js";
import {
  createBusiness,
  initializeOrganization,
  registerOrganizationRepository,
} from "../src/repo.js";
import {
  approveReleaseCandidate,
  completeQaReview,
  createQaWorktree,
  createReleaseCandidate,
  runQaWorkItem,
} from "../src/review.js";
import { seedFoundation } from "../src/seed.js";
import { createWorkItem, transitionWorkItem } from "../src/work.js";

let root: string;
let config: Cult4Config;
let db: CultDatabase;
let businessId: string;
let repositoryId: string;
let businessPath: string;
let organizationRepositoryId: string;
const previousPrivateTest = process.env.CULT4_TEST_PRIVATE_REMOTES;

function bare(name: string): string {
  const path = join(root, `${name}.git`);
  execFileSync("git", ["init", "--bare", "-b", "main", path], {
    stdio: "ignore",
  });
  return path;
}

function builderCommit(
  title: string,
  filename: string,
  content: string,
): string {
  const workItemId = createWorkItem(db, {
    businessId,
    type: "VERSIONED_BUILD",
    title,
    goal: title,
    createdBy: "human-owner",
    assignedTo: "employee-operator",
    status: "READY",
    subjectType: "GIT_REPOSITORY",
    subjectId: repositoryId,
  });
  prepareWritableRepository(db, repositoryId, workItemId, `test:${workItemId}`);
  transitionWorkItem(db, workItemId, "RUNNING", "system");
  writeFileSync(join(businessPath, filename), content);
  return finalizeVersionedWork(db, {
    repositoryId,
    workItemId,
    employeeId: "employee-operator",
    requireChanges: true,
  }).sha;
}

function qa(sha: string, result: "PASS" | "FAIL"): string {
  const workItemId = createWorkItem(db, {
    businessId,
    type: "DIGITAL_QA",
    title: `QA ${sha.slice(0, 8)}`,
    goal: "Review the exact immutable commit.",
    createdBy: "employee-operator",
    assignedTo: "employee-qa",
    status: "READY",
    subjectType: "GIT_COMMIT",
    subjectId: repositoryId,
    subjectVersion: sha,
    repositoryId,
  });
  const path = createQaWorktree(db, repositoryId, sha, workItemId, config);
  expect(runGit(["rev-parse", "HEAD"], path).stdout).toBe(sha);
  expect(
    runGit(["symbolic-ref", "-q", "HEAD"], path, { allowFailure: true }).ok,
  ).toBe(false);
  completeQaReview(db, {
    workItemId,
    qaEmployeeId: "employee-qa",
    result,
    testsRun: ["fixture-test"],
    failures: result === "FAIL" ? ["fixture failure"] : [],
  });
  expect(existsSync(path)).toBe(false);
  return workItemId;
}

beforeEach(() => {
  process.env.CULT4_TEST_PRIVATE_REMOTES = "1";
  root = mkdtempSync(join(tmpdir(), "cult4-git-"));
  config = {
    home: join(root, "home"),
    databasePath: join(root, "home/state.db"),
    objectsPath: join(root, "home/objects"),
    runtimePath: join(root, "home/runtime"),
    secretsPath: join(root, "home/secrets"),
    businessesPath: join(root, "home/businesses"),
    organizationPath: join(root, "home/organization"),
    agentsPath: join(root, "config/agents"),
    toolsPath: join(root, "config/tools"),
    skillsPath: join(root, "config/skills"),
  };
  initializeOrganization(config);
  db = openDatabase(config);
  seedFoundation(db);
  organizationRepositoryId = registerOrganizationRepository(db, config);
  connectRemote(db, organizationRepositoryId, bare("organization"));
  const business = createBusiness(db, "Pipeline Business", config);
  businessId = business.id;
  repositoryId = business.repositoryId;
  businessPath = business.repoPath;
  connectRemote(db, repositoryId, bare("business"));
});

afterEach(() => {
  db.close();
  if (previousPrivateTest === undefined)
    delete process.env.CULT4_TEST_PRIVATE_REMOTES;
  else process.env.CULT4_TEST_PRIVATE_REMOTES = previousPrivateTest;
});

describe("Git integrity and exact QA pipeline", () => {
  it("recovers a repository lock and running work left by a dead host", () => {
    const interrupted = createWorkItem(db, {
      businessId,
      type: "VERSIONED_BUILD",
      title: "Interrupted work",
      goal: "Recover after a dead host",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
    });
    transitionWorkItem(db, interrupted, "RUNNING", "system");
    acquireRepositoryLock(
      db,
      repositoryId,
      interrupted,
      "2147483647:dead-tick",
    );
    db.prepare(
      "INSERT INTO employee_run(id,employee_id,work_item_id,status,created_at) VALUES('run_dead','employee-operator',?,'RUNNING',?)",
    ).run(interrupted, new Date().toISOString());
    const replacement = createWorkItem(db, {
      businessId,
      type: "VERSIONED_BUILD",
      title: "Replacement work",
      goal: "Acquire after recovery",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
    });

    acquireRepositoryLock(db, repositoryId, replacement, "current-host");

    expect(
      db
        .prepare("SELECT status,result FROM work_item WHERE id=?")
        .get(interrupted),
    ).toEqual({
      status: "READY",
      result: "Recovered after an interrupted Cult4 host.",
    });
    expect(
      db
        .prepare(
          "SELECT status,error_code FROM employee_run WHERE id='run_dead'",
        )
        .get(),
    ).toEqual({ status: "CANCELLED", error_code: "HOST_INTERRUPTED" });
    releaseRepositoryLock(db, repositoryId, replacement);
  });

  it("builds GitHub remote URLs using the configured transport", () => {
    expect(githubRemoteUrl("owner", "repo", "https")).toBe(
      "https://github.com/owner/repo.git",
    );
    expect(githubRemoteUrl("owner", "repo", "ssh")).toBe(
      "git@github.com:owner/repo.git",
    );
  });

  it("runs Builder → push → detached QA → exact approval → cleanup → new SHA QA", () => {
    const shaB = builderCommit("Implement B", "src/b.txt", "B\n");
    const remoteB = runGit(
      ["ls-remote", "origin", "refs/heads/main"],
      businessPath,
    ).stdout.split(/\s+/)[0];
    expect(remoteB).toBe(shaB);
    expect(
      runGit(["show", "-s", "--format=%s", shaB], businessPath).stdout,
    ).toMatch(/^cult4\(#.+\): Implement B$/);
    expect(
      db
        .prepare(
          "SELECT count(*) count FROM audit_event WHERE type IN ('COMMIT_CREATED','COMMIT_PUSHED') AND subject_version=?",
        )
        .get(shaB),
    ).toEqual({ count: 2 });
    expect(
      db
        .prepare(
          "SELECT count(*) count FROM work_item WHERE type='DIGITAL_QA' AND repository_id=? AND subject_version=?",
        )
        .get(repositoryId, shaB),
    ).toEqual({ count: 1 });
    expect(inspectRepository(db, repositoryId).health).toBe("HEALTHY");
    qa(shaB, "PASS");
    const candidateB = createReleaseCandidate(
      db,
      repositoryId,
      shaB,
      "employee-operator",
    );
    expect(
      approveReleaseCandidate(db, candidateB, "employee-operator").allowed,
    ).toBe(true);
    expect(
      evaluateAction(
        db,
        {
          actionType: "RELEASE_CODE",
          actorId: "employee-operator",
          businessId,
          subjectType: "GIT_COMMIT",
          subjectId: repositoryId,
          subjectVersion: shaB,
        },
        true,
      ).allowed,
    ).toBe(true);

    const shaC = builderCommit("Implement C", "src/c.txt", "C\n");
    expect(shaC).not.toBe(shaB);
    const candidateC = createReleaseCandidate(
      db,
      repositoryId,
      shaC,
      "employee-operator",
    );
    expect(
      evaluateAction(
        db,
        {
          actionType: "RELEASE_CODE",
          actorId: "employee-operator",
          businessId,
          subjectType: "GIT_COMMIT",
          subjectId: repositoryId,
          subjectVersion: shaC,
        },
        true,
      ).allowed,
    ).toBe(false);
    expect(
      approveReleaseCandidate(db, candidateC, "employee-operator").allowed,
    ).toBe(false);
    qa(shaC, "FAIL");
    expect(
      db
        .prepare(
          "SELECT count(*) count FROM approval WHERE repository_id=? AND subject_version=? AND decision='APPROVE'",
        )
        .get(repositoryId, shaC),
    ).toEqual({ count: 0 });
    qa(shaC, "PASS");
    expect(
      approveReleaseCandidate(db, candidateC, "employee-operator").allowed,
    ).toBe(true);
    expect(
      evaluateAction(
        db,
        {
          actionType: "RELEASE_CODE",
          actorId: "employee-operator",
          businessId,
          subjectType: "GIT_COMMIT",
          subjectId: repositoryId,
          subjectVersion: shaC,
        },
        true,
      ).allowed,
    ).toBe(true);
  });

  it("classifies dirty, wrong branch, SQLite mismatch, ahead, behind and diverged", () => {
    writeFileSync(join(businessPath, "dirty.txt"), "dirty");
    expect(inspectRepository(db, repositoryId).health).toBe("DIRTY");
    execFileSync("git", ["clean", "-f"], { cwd: businessPath });
    runGit(["checkout", "-b", "wrong"], businessPath);
    expect(inspectRepository(db, repositoryId).health).toBe("WRONG_BRANCH");
    runGit(["checkout", "main"], businessPath);
    db.prepare("UPDATE repository SET current_sha=? WHERE id=?").run(
      "0".repeat(40),
      repositoryId,
    );
    expect(inspectRepository(db, repositoryId).health).toBe("SHA_MISMATCH");
    const head = runGit(["rev-parse", "HEAD"], businessPath).stdout;
    db.prepare("UPDATE repository SET current_sha=? WHERE id=?").run(
      head,
      repositoryId,
    );
    writeFileSync(join(businessPath, "ahead.txt"), "ahead");
    runGit(["add", "--all"], businessPath);
    runGit(
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@localhost",
        "commit",
        "-m",
        "ahead",
      ],
      businessPath,
    );
    expect(inspectRepository(db, repositoryId).health).toBe("AHEAD");
    runGit(["push", "origin", "main"], businessPath);
    const aheadSha = runGit(["rev-parse", "HEAD"], businessPath).stdout;
    db.prepare(
      "UPDATE repository SET current_sha=?,remote_sha=? WHERE id=?",
    ).run(aheadSha, aheadSha, repositoryId);

    const other = join(root, "other");
    runGit(
      [
        "clone",
        db
          .prepare("SELECT remote_url FROM repository WHERE id=?")
          .pluck()
          .get(repositoryId) as string,
        other,
      ],
      root,
    );
    writeFileSync(join(other, "remote.txt"), "remote");
    runGit(["add", "--all"], other);
    runGit(
      [
        "-c",
        "user.name=Remote",
        "-c",
        "user.email=remote@localhost",
        "commit",
        "-m",
        "remote",
      ],
      other,
    );
    runGit(["push", "origin", "main"], other);
    runGit(["fetch", "origin", "main"], businessPath);
    expect(inspectRepository(db, repositoryId).health).toBe("BEHIND");
    writeFileSync(join(businessPath, "local.txt"), "local");
    runGit(["add", "--all"], businessPath);
    runGit(
      [
        "-c",
        "user.name=Local",
        "-c",
        "user.email=local@localhost",
        "commit",
        "-m",
        "local divergence",
      ],
      businessPath,
    );
    expect(inspectRepository(db, repositoryId).health).toBe("DIVERGED");
    expect(() => restoreRepository(db, repositoryId)).toThrowError(
      expect.objectContaining({ code: "RESTORE_REPOSITORY_DIVERGED" }),
    );
  });

  it("detects a missing or mismatched remote and wrong Foundation location", () => {
    const originalRemote = db
      .prepare("SELECT remote_url FROM repository WHERE id=?")
      .pluck()
      .get(repositoryId) as string;
    runGit(["remote", "remove", "origin"], businessPath);
    expect(inspectRepository(db, repositoryId).health).toBe("LOCAL_ONLY");
    runGit(
      ["remote", "add", "origin", `${originalRemote}.wrong`],
      businessPath,
    );
    expect(inspectRepository(db, repositoryId).health).toBe(
      "REMOTE_URL_MISMATCH",
    );
    const canonical = join(config.organizationPath, "foundation/FOUNDATION.md"),
      wrong = join(config.organizationPath, "FOUNDATION.md");
    renameSync(canonical, wrong);
    expect(
      doctor(db, config).find((item) => item.name === "GIT021 Foundation path")
        ?.ok,
    ).toBe(false);
  });

  it("refuses dirty restore and reconstructs a missing working copy", () => {
    const sha = builderCommit("Restorable", "docs/restorable.md", "yes\n");
    writeFileSync(join(businessPath, "dirty.txt"), "dirty");
    expect(() => restoreRepository(db, repositoryId)).toThrowError(
      expect.objectContaining({ code: "RESTORE_DIRTY_WORKTREE" }),
    );
    execFileSync("git", ["clean", "-f"], { cwd: businessPath });
    const displaced = `${businessPath}.displaced`;
    renameSync(businessPath, displaced);
    expect(repairDoctor(db, config)).toContain(
      `${repositoryId}: cloned missing working copy`,
    );
    const restored = inspectRepository(db, repositoryId, {
      fetch: true,
      verifyPrivacy: true,
    });
    expect(restored.health).toBe("HEALTHY");
    expect(restored.localSha).toBe(sha);
    expect(existsSync(join(businessPath, ".git"))).toBe(true);
  });

  it("fails closed on public/unverifiable remote and on push failure", () => {
    delete process.env.CULT4_TEST_PRIVATE_REMOTES;
    expect(inspectRepository(db, repositoryId).health).toBe(
      "REMOTE_NOT_PRIVATE",
    );
    process.env.CULT4_TEST_PRIVATE_REMOTES = "1";
    const workItemId = createWorkItem(db, {
      businessId,
      type: "VERSIONED_BUILD",
      title: "Push failure",
      goal: "Test fail closed",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
    });
    prepareWritableRepository(db, repositoryId, workItemId, "push-failure");
    const durableSha = db
      .prepare("SELECT current_sha FROM repository WHERE id=?")
      .pluck()
      .get(repositoryId) as string;
    writeFileSync(join(businessPath, "src/failure.txt"), "failure");
    runGit(
      ["remote", "set-url", "origin", join(root, "missing.git")],
      businessPath,
    );
    expect(() =>
      finalizeVersionedWork(db, {
        repositoryId,
        workItemId,
        employeeId: "employee-operator",
        requireChanges: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "BLOCKED_GIT_SYNC" }));
    expect(
      db.prepare("SELECT status FROM work_item WHERE id=?").get(workItemId),
    ).toEqual({ status: "BLOCKED" });
    expect(
      db
        .prepare("SELECT current_sha FROM repository WHERE id=?")
        .get(repositoryId),
    ).toEqual({ current_sha: durableSha });
  });

  it("rejects an agent-created commit and a dirty post-commit hook result", () => {
    const unexpected = createWorkItem(db, {
      businessId,
      type: "VERSIONED_BUILD",
      title: "Unexpected history",
      goal: "Test history ownership",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
    });
    prepareWritableRepository(db, repositoryId, unexpected, "unexpected");
    writeFileSync(join(businessPath, "src/unexpected.txt"), "unexpected");
    runGit(["add", "--all"], businessPath);
    runGit(
      [
        "-c",
        "user.name=Agent",
        "-c",
        "user.email=agent@localhost",
        "commit",
        "-m",
        "forbidden",
      ],
      businessPath,
    );
    expect(() =>
      finalizeVersionedWork(db, {
        repositoryId,
        workItemId: unexpected,
        employeeId: "employee-operator",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "UNEXPECTED_GIT_HISTORY_CHANGE" }),
    );

    runGit(["reset", "--hard", "origin/main"], businessPath);
    db.prepare("DELETE FROM repository_lock WHERE repository_id=?").run(
      repositoryId,
    );
    const dirtyAfter = createWorkItem(db, {
      businessId,
      type: "VERSIONED_BUILD",
      title: "Dirty after commit",
      goal: "Test postcondition",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
    });
    prepareWritableRepository(db, repositoryId, dirtyAfter, "dirty-after");
    mkdirSync(join(businessPath, "src"), { recursive: true });
    writeFileSync(join(businessPath, "src/normal.txt"), "normal");
    const hook = join(businessPath, ".git/hooks/post-commit");
    writeFileSync(hook, "#!/bin/sh\nprintf residual > residual.txt\n");
    chmodSync(hook, 0o700);
    expect(() =>
      finalizeVersionedWork(db, {
        repositoryId,
        workItemId: dirtyAfter,
        employeeId: "employee-operator",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "REPOSITORY_DIRTY_AFTER_COMMIT" }),
    );
  });

  it("recovers fully staged work from an older completed Operator session", () => {
    const workItemId = createWorkItem(db, {
      businessId,
      type: "OPERATOR_INTERACTION",
      title: "Legacy interactive work",
      goal: "Recover changes staged before host finalization existed.",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
    });
    transitionWorkItem(db, workItemId, "RUNNING", "employee-operator");
    transitionWorkItem(
      db,
      workItemId,
      "DONE",
      "employee-operator",
      "Changes complete and staged.",
    );
    mkdirSync(join(businessPath, "src"), { recursive: true });
    writeFileSync(join(businessPath, "src/legacy.txt"), "recovered\n");
    runGit(["add", "--all"], businessPath);

    const recovered = recoverStagedOperatorWork(db, {
      repositoryId,
      businessId,
      employeeId: "employee-operator",
    });

    expect(recovered).toMatchObject({ workItemId, changed: true });
    expect(runGit(["status", "--porcelain"], businessPath).stdout).toBe("");
    expect(
      db
        .prepare(
          "SELECT base_sha,repository_id,result_sha FROM work_item WHERE id=?",
        )
        .get(workItemId),
    ).toEqual({
      base_sha: expect.any(String),
      repository_id: repositoryId,
      result_sha: recovered?.sha,
    });
    expect(
      db
        .prepare(
          "SELECT count(*) count FROM work_item WHERE parent_id=? AND type='DIGITAL_QA'",
        )
        .get(workItemId),
    ).toEqual({ count: 1 });
  });

  it("creates a durable clean checkpoint for a human-stopped WorkItem", () => {
    const workItemId = createWorkItem(db, {
      businessId,
      type: "VERSIONED_BUILD",
      title: "Interruptible build",
      goal: "Preserve partial work at a human stop boundary.",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
    });
    prepareWritableRepository(db, repositoryId, workItemId, "checkpoint-test");
    transitionWorkItem(db, workItemId, "RUNNING", "system");
    writeFileSync(
      join(businessPath, "checkpoint.txt"),
      "durable partial work\n",
    );
    const checkpoint = finalizeVersionedWork(db, {
      repositoryId,
      workItemId,
      employeeId: "employee-operator",
      purpose: "Human-requested checkpoint",
      checkpoint: true,
    });
    transitionWorkItem(
      db,
      workItemId,
      "READY",
      "human-owner",
      "Stopped after checkpoint.",
    );
    expect(checkpoint.changed).toBe(true);
    expect(
      runGit(["show", "-s", "--format=%s", checkpoint.sha], businessPath)
        .stdout,
    ).toContain(`cult4 checkpoint(#${workItemId})`);
    expect(runGit(["status", "--porcelain"], businessPath).stdout).toBe("");
    expect(
      db
        .prepare("SELECT status,result_sha FROM work_item WHERE id=?")
        .get(workItemId),
    ).toEqual({ status: "READY", result_sha: checkpoint.sha });
  });

  it("finalizes Organization Maintenance and records the exact new SHA", async () => {
    const workItemId = createWorkItem(db, {
      type: "ORGANIZATION_MAINTENANCE",
      title: "Improve organization playbook",
      goal: "Add a tested organization playbook.",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
    });
    const result = await runOrganizationMaintenance(
      db,
      workItemId,
      {
        async runTask(input) {
          writeFileSync(
            join(input.directory, "playbooks/maintenance.md"),
            "# Maintained\n",
          );
          return {
            ok: true,
            exitCode: 0,
            sessionId: "organization-live-fixture",
            finalText: "Organization change complete.",
            durationMs: 10,
            timedOut: false,
            costCents: 1,
            inputTokens: 10,
            outputTokens: 5,
          };
        },
      },
      config,
    );
    expect(result.ok).toBe(true);
    expect(result.resultSha).toMatch(/^[0-9a-f]{40}$/);
    const remoteSha = runGit(
      ["ls-remote", "origin", "refs/heads/main"],
      config.organizationPath,
    ).stdout.split(/\s+/)[0];
    expect(remoteSha).toBe(result.resultSha);
    expect(
      runGit(["status", "--porcelain"], config.organizationPath).stdout,
    ).toBe("");
    expect(
      db
        .prepare(
          "SELECT base_sha,result_sha FROM organization_maintenance WHERE work_item_id=?",
        )
        .get(workItemId),
    ).toEqual(expect.objectContaining({ result_sha: result.resultSha }));
    expect(
      db
        .prepare(
          "SELECT count(*) count FROM git_commit WHERE repository_id=? AND sha=?",
        )
        .get(organizationRepositoryId, result.resultSha),
    ).toEqual({ count: 1 });
  });

  it("requires exact Foundation approvals and records the human approval trailer", async () => {
    const baseSha = runGit(
      ["rev-parse", "HEAD"],
      config.organizationPath,
    ).stdout;
    const workItemId = createWorkItem(db, {
      type: "FOUNDATION_CHANGE",
      title: "Clarify Foundation integrity",
      goal: "Make an explicitly approved exact Foundation change.",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
      subjectType: "GIT_COMMIT",
      subjectId: organizationRepositoryId,
      subjectVersion: baseSha,
      repositoryId: organizationRepositoryId,
    });
    const decision = evaluateAction(
      db,
      {
        actionType: "FOUNDATION_CHANGE",
        actorId: "employee-operator",
        subjectType: "GIT_COMMIT",
        subjectId: organizationRepositoryId,
        subjectVersion: baseSha,
        workItemId,
      },
      true,
    );
    expect(decision.allowed).toBe(false);
    const gates = db
      .prepare(
        "SELECT id,human_only FROM gate WHERE work_item_id=? AND policy_id='FOUNDATION_CHANGE'",
      )
      .all(workItemId) as Array<{ id: string; human_only: number }>;
    const humanGate = gates.find((gate) => gate.human_only === 1);
    const qaGate = gates.find((gate) => gate.human_only === 0);
    expect(humanGate).toBeDefined();
    expect(qaGate).toBeDefined();
    const humanApproval = grantApproval(
      db,
      humanGate!.id,
      "human-owner",
      "Exact Foundation change approved.",
    );
    grantApproval(db, qaGate!.id, "employee-qa", "Quality approved.");
    transitionWorkItem(db, workItemId, "READY", "human-owner");
    const result = await runOrganizationMaintenance(
      db,
      workItemId,
      {
        async runTask(input) {
          writeFileSync(
            join(input.directory, "foundation/FOUNDATION.md"),
            "# Cult4 Organization Foundation\n\nApproved integrity clarification.\n",
          );
          return {
            ok: true,
            exitCode: 0,
            sessionId: "foundation-approved-fixture",
            finalText: "Foundation change complete.",
            durationMs: 10,
            timedOut: false,
            costCents: 1,
            inputTokens: 10,
            outputTokens: 5,
          };
        },
      },
      config,
    );
    expect(result.ok).toBe(true);
    const commit = runGit(
      ["show", "-s", "--format=%B", result.resultSha!],
      config.organizationPath,
    ).stdout;
    expect(commit).toContain(`Cult4-Human-Approval: ${humanApproval}`);
    expect(commit).toContain("Cult4-Foundation-Change: true");
  });

  it("runs QA through the detached read-only session and persists its report", async () => {
    const sha = builderCommit("QA runner", "src/qa-runner.txt", "review me\n");
    const qaWork = db
      .prepare(
        "SELECT id FROM work_item WHERE type='DIGITAL_QA' AND repository_id=? AND subject_version=? ORDER BY created_at LIMIT 1",
      )
      .get(repositoryId, sha) as { id: string };
    const result = await runQaWorkItem(
      db,
      qaWork.id,
      {
        async runTask(input) {
          expect(
            runGit(["symbolic-ref", "-q", "HEAD"], input.directory, {
              allowFailure: true,
            }).ok,
          ).toBe(false);
          // Older/in-flight QA agents could terminally transition their own
          // WorkItem before the host parsed the final report. The host must be
          // idempotent instead of attempting DONE -> DONE.
          transitionWorkItem(
            db,
            qaWork.id,
            "DONE",
            "employee-qa",
            "agent reported completion before host finalization",
          );
          return {
            ok: true,
            exitCode: 0,
            sessionId: "qa-session",
            finalText: JSON.stringify({
              result: "PASS",
              testsRun: ["npm test"],
              failures: [],
              evidence: ["all checks passed"],
              notes: "exact SHA reviewed",
            }),
            durationMs: 10,
            timedOut: false,
            costCents: 1,
            inputTokens: 10,
            outputTokens: 5,
          };
        },
      },
      config,
    );
    expect(result).toMatchObject({ ok: true, result: "PASS" });
    expect(
      db
        .prepare(
          "SELECT result,reviewed_sha FROM qa_review WHERE work_item_id=?",
        )
        .get(qaWork.id),
    ).toEqual({ result: "PASS", reviewed_sha: sha });
  });

  it("fails Organization Maintenance when finalization leaves a dirty tree", async () => {
    const hook = join(config.organizationPath, ".git/hooks/post-commit");
    writeFileSync(
      hook,
      "#!/bin/sh\nprintf residual > organization-residual.txt\n",
    );
    chmodSync(hook, 0o700);
    const workItemId = createWorkItem(db, {
      type: "ORGANIZATION_MAINTENANCE",
      title: "Dirty organization maintenance",
      goal: "Exercise the clean postcondition.",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
    });
    const result = await runOrganizationMaintenance(
      db,
      workItemId,
      {
        async runTask(input) {
          writeFileSync(
            join(input.directory, "playbooks/dirty-maintenance.md"),
            "dirty fixture\n",
          );
          return {
            ok: true,
            exitCode: 0,
            durationMs: 10,
            timedOut: false,
            costCents: 1,
            inputTokens: 10,
            outputTokens: 5,
          };
        },
      },
      config,
    );
    expect(result).toMatchObject({
      ok: false,
      errorCode: "REPOSITORY_DIRTY_AFTER_COMMIT",
    });
    expect(
      db.prepare("SELECT status FROM work_item WHERE id=?").get(workItemId),
    ).toEqual({ status: "FAILED" });
  });
});
