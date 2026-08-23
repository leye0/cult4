#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { getConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { Cult4Error } from "./domain.js";
import { seedFoundation } from "./seed.js";
import { materializeAllEmployees } from "./employee.js";
import { materializeCult4Tools } from "./tool-materialization.js";
import {
  createBusiness,
  initializeOrganization,
  registerOrganizationRepository,
} from "./repo.js";
import { doctor, repairDoctor } from "./doctor.js";
import {
  getHumanRequest,
  listPendingHumanRequests,
  resolveHumanRequest,
} from "./human.js";
import { authorizeCommitment } from "./finance.js";
import { createWorkItem } from "./work.js";
import { audit } from "./audit.js";
import {
  resumableAutopilotRequest,
  type AutopilotRequest,
} from "./autopilot.js";
import { tick } from "./tick.js";
import { executeTool } from "./tools.js";
import { recordPhysicalInspection } from "./physical.js";
import { materializeExtensionTools } from "./tool-extensions.js";
import { runOrganizationMaintenance } from "./organization-maintenance.js";
import { loadCult4Environment } from "./environment.js";
import { resolveOpenCodeModel } from "./opencode.js";
import type { OpenCodeProgressEvent } from "./opencode.js";
import {
  indentTimedTrace,
  renderAgentTrace,
  renderDiagnosticTrace,
  renderToolTrace,
  renderUsageTrace,
} from "./trace.js";
import { provisionProviderSecrets } from "./secrets.js";
import {
  configuredGithubOwner,
  setGithubOwner,
  unsetGithubOwner,
} from "./settings.js";
import {
  confirmBusinessMandate,
  formatBusinessMandate,
  formatMandateRequestCoverage,
  getBusinessMandate,
  hasConfirmedBusinessMandate,
  rejectBusinessMandate,
} from "./mandate.js";
import { runQaWorkItem } from "./review.js";
import {
  businessRepository,
  connectRemote,
  createPrivateGitHubRemote,
  finalizeVersionedWork,
  organizationRepository,
  prepareWritableRepository,
  recoverStagedOperatorWork,
  registerLocalRepository,
  releaseRepositoryLock,
  restoreRepository,
} from "./git.js";

const args = process.argv.slice(2);
loadCult4Environment(args[0]);
const config = getConfig();
type BusinessChoice = {
  id: string;
  slug: string;
  name: string;
  repo_path: string;
};
function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function requireExternalCommands(): void {
  for (const command of ["git", "opencode"]) {
    const check = spawnSync(command, ["--version"], { stdio: "ignore" });
    if (check.status !== 0)
      throw new Cult4Error(
        `${command} is required and was not found.`,
        `${command.toUpperCase()}_NOT_FOUND`,
      );
  }
}

function materializeInstallation(db: ReturnType<typeof openDatabase>): void {
  initializeOrganization(config);
  provisionProviderSecrets(config);
  seedFoundation(db);
  registerOrganizationRepository(db, config);
  materializeAllEmployees(db, config);
  materializeCult4Tools(config);
  materializeExtensionTools(config);
}

function createBusinessFoundationWork(
  db: ReturnType<typeof openDatabase>,
  business: { id: string; name: string },
): string {
  const existing = db
    .prepare(
      "SELECT id FROM work_item WHERE business_id=? AND type='BUSINESS_FOUNDATION' ORDER BY created_at LIMIT 1",
    )
    .get(business.id) as { id: string } | undefined;
  return (
    existing?.id ??
    createWorkItem(db, {
      businessId: business.id,
      type: "BUSINESS_FOUNDATION",
      title: `Build ${business.name}`,
      goal: "Discover, validate, build, and operate a viable business from evidence without assuming a universal workflow.",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "PROPOSED",
      priority: 90,
      risk: "MEDIUM",
    })
  );
}

async function interactiveBusiness(
  db: ReturnType<typeof openDatabase>,
): Promise<BusinessChoice> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const askRequired = async (question: string): Promise<string> => {
    while (true) {
      let answer: string;
      try {
        answer = (await readline.question(question)).trim();
      } catch {
        throw new Cult4Error(
          "Interactive setup was cancelled.",
          "INTERACTIVE_SETUP_CANCELLED",
        );
      }
      if (answer) return answer;
      process.stdout.write("Une valeur est requise.\n");
    }
  };
  let githubOwner = configuredGithubOwner(config).value;
  const connectInteractively = async (
    repositoryId: string,
    repositoryName: string,
    configuredRemote?: string,
  ): Promise<void> => {
    if (configuredRemote) {
      connectRemote(db, repositoryId, configuredRemote);
      return;
    }
    if (!githubOwner) {
      githubOwner = (
        await readline.question(
          "Propriétaire GitHub pour créer les dépôts privés automatiquement (Entrée pour fournir une URL) : ",
        )
      ).trim();
      if (githubOwner) {
        githubOwner = setGithubOwner(config, githubOwner);
        process.stdout.write(
          `Propriétaire GitHub enregistré dans ${config.settingsPath}.\n`,
        );
      }
    }
    if (githubOwner) {
      createPrivateGitHubRemote(db, repositoryId, githubOwner, repositoryName);
      return;
    }
    const remote = await askRequired("URL du dépôt Git privé existant : ");
    connectRemote(db, repositoryId, remote);
  };

  try {
    let organization = db
      .prepare(
        "SELECT id,remote_url FROM repository WHERE owner_type='organization'",
      )
      .get() as { id: string; remote_url: string } | undefined;
    if (!organization) {
      process.stdout.write(
        "Bienvenue dans Cult4. Initialisation de l’organisation…\n",
      );
      materializeInstallation(db);
      organization = db
        .prepare(
          "SELECT id,remote_url FROM repository WHERE owner_type='organization'",
        )
        .get() as { id: string; remote_url: string };
    }
    if (!organization.remote_url)
      await connectInteractively(
        organization.id,
        "cult4-organization",
        process.env.CULT4_ORGANIZATION_REMOTE_URL,
      );

    let businesses = db
      .prepare(
        "SELECT id,slug,name,repo_path,status FROM business ORDER BY created_at",
      )
      .all() as Array<BusinessChoice & { status: string }>;
    if (!businesses.length) {
      const name = await askRequired("Nom de la première entreprise : ");
      const created = createBusiness(db, name, config);
      await connectInteractively(created.repositoryId, created.slug);
      createBusinessFoundationWork(db, { id: created.id, name });
      businesses = db
        .prepare(
          "SELECT id,slug,name,repo_path,status FROM business WHERE id=?",
        )
        .all(created.id) as Array<BusinessChoice & { status: string }>;
    }

    const active = businesses.filter(
      (business) => business.status === "ACTIVE",
    );
    if (!active.length) {
      const business = businesses[0]!;
      const repository = businessRepository(db, business.id);
      await connectInteractively(repository.id, business.slug);
      createBusinessFoundationWork(db, business);
      return business;
    }
    if (active.length === 1) return active[0]!;

    process.stdout.write("\nEntreprises actives :\n");
    active.forEach((business, index) =>
      process.stdout.write(
        `  ${index + 1}. ${business.name} (${business.slug})\n`,
      ),
    );
    while (true) {
      const selection = Number(
        await askRequired(`Choisir une entreprise [1-${active.length}] : `),
      );
      if (
        Number.isInteger(selection) &&
        selection >= 1 &&
        selection <= active.length
      )
        return active[selection - 1]!;
      process.stdout.write("Choix invalide.\n");
    }
  } finally {
    readline.close();
  }
}

async function reviewPendingMandate(
  db: ReturnType<typeof openDatabase>,
  business: BusinessChoice,
): Promise<"NONE" | "CONFIRMED" | "DEFERRED" | "INTERRUPTED"> {
  const pending = db
    .prepare(
      `SELECT bm.*,hr.work_item_id intake_work_item_id FROM business_mandate bm JOIN human_request hr ON hr.subject_id=bm.id AND hr.subject_type='BUSINESS_MANDATE' AND hr.subject_version=bm.content_hash
       WHERE bm.business_id=? AND bm.status='DRAFT' AND hr.status IN ('PENDING','REMINDER_DUE','OVERDUE')
       ORDER BY bm.version DESC LIMIT 1`,
    )
    .get(business.id) as
    | (Parameters<typeof formatBusinessMandate>[0] & {
        intake_work_item_id: string | null;
      })
    | undefined;
  if (!pending) return "NONE";
  process.stdout.write(
    `\n${formatBusinessMandate(pending)}\n\n${formatMandateRequestCoverage(db, pending.id)}\n\n`,
  );
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    let answer = "";
    try {
      answer = (
        await readline.question(
          "Ce mandat capture-t-il fidèlement le contrat ET l’esprit de l’entreprise? Confirmer cette version exacte? [o/N] : ",
        )
      )
        .trim()
        .toLowerCase();
    } catch {
      process.stdout.write(
        "Mandat conservé en attente; aucune autonomie n’a été activée.\n",
      );
      return "INTERRUPTED";
    }
    if (["o", "oui", "y", "yes"].includes(answer)) {
      confirmBusinessMandate(
        db,
        pending.id,
        "human-owner",
        pending.content_hash,
      );
      process.stdout.write(
        "Mandat confirmé. Le travail autonome est maintenant admissible dans ses limites.\n",
      );
      return "CONFIRMED";
    } else {
      audit(db, {
        type: "BUSINESS_INTAKE_REVIEW_DEFERRED",
        actorId: "human-owner",
        businessId: business.id,
        subjectType: "OPERATOR_INTERACTION",
        subjectId: pending.intake_work_item_id ?? pending.id,
        subjectVersion: pending.content_hash,
        data: { mandateId: pending.id },
      });
      process.stdout.write(
        "Mandat conservé en attente. Relancez cult pour poursuivre la conversation et le nuancer.\n",
      );
      return "DEFERRED";
    }
  } finally {
    readline.close();
  }
}

function hasResumableIntakeHandoff(
  db: ReturnType<typeof openDatabase>,
  businessId: string,
): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM audit_event handoff
         JOIN human_request hr ON hr.work_item_id=handoff.subject_id
           AND hr.subject_type='BUSINESS_MANDATE'
           AND hr.status IN ('PENDING','REMINDER_DUE','OVERDUE')
         JOIN business_mandate bm ON bm.id=hr.subject_id
           AND bm.business_id=handoff.business_id
           AND bm.content_hash=hr.subject_version
           AND bm.status='DRAFT'
         WHERE handoff.business_id=?
           AND handoff.type='BUSINESS_INTAKE_HANDOFF_REQUESTED'
           AND NOT EXISTS(
             SELECT 1 FROM audit_event deferred
             WHERE deferred.id>handoff.id
               AND deferred.type='BUSINESS_INTAKE_REVIEW_DEFERRED'
               AND deferred.business_id=handoff.business_id
               AND deferred.subject_type=handoff.subject_type
               AND deferred.subject_id=handoff.subject_id
           )
         ORDER BY handoff.id DESC LIMIT 1`,
      )
      .get(businessId),
  );
}

async function launchOperator(
  db: ReturnType<typeof openDatabase>,
  business: BusinessChoice,
  options: {
    continueSession?: boolean;
    freshSession?: boolean;
    resumePrompt?: string;
  } = {},
): Promise<void> {
  const automaticAutopilot =
    !options.continueSession &&
    !options.freshSession &&
    hasConfirmedBusinessMandate(db, business.id)
      ? resumableAutopilotRequest(db, business.id)
      : undefined;
  const pending = db
    .prepare(
      `SELECT id FROM work_item
       WHERE business_id=? AND type='OPERATOR_INTERACTION' AND assigned_to='employee-operator' AND status IN ('READY','RUNNING','WAITING_HUMAN')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(business.id) as { id: string } | undefined;
  const workId =
    (!options.freshSession ? pending?.id : undefined) ??
    createWorkItem(db, {
      businessId: business.id,
      type: "OPERATOR_INTERACTION",
      title: "Human-directed Operator session",
      goal: "Understand the human request, build or revise the dynamic work graph, and persist all durable state.",
      createdBy: "human-owner",
      assignedTo: "employee-operator",
      status: "READY",
    });
  const operator = db
    .prepare("SELECT model FROM employee WHERE id='employee-operator'")
    .get() as { model: string | null } | undefined;
  const model = resolveOpenCodeModel(operator?.model);
  const agentName = hasConfirmedBusinessMandate(db, business.id)
    ? "cult4-operator"
    : "cult4-intake";
  const repositoryId =
    agentName === "cult4-operator"
      ? businessRepository(db, business.id).id
      : undefined;
  if (repositoryId) {
    const recovered = recoverStagedOperatorWork(db, {
      repositoryId,
      businessId: business.id,
      employeeId: "employee-operator",
    });
    if (recovered?.changed)
      process.stdout.write(
        `\nTravail Operator interrompu récupéré, commité et poussé par Cult4 (${recovered.sha}).\n`,
      );
    prepareWritableRepository(
      db,
      repositoryId,
      workId,
      `interactive:employee-operator:${process.pid}`,
    );
  }
  const openCodeArgs = [business.repo_path];
  if (!options.freshSession && (pending || options.continueSession))
    openCodeArgs.push("--continue");
  openCodeArgs.push("--agent", agentName);
  openCodeArgs.push("--model", model);
  if (agentName === "cult4-operator")
    openCodeArgs.push(
      "--prompt",
      options.resumePrompt ??
        "The trusted Cult4 host has opened or resumed this Operator under the confirmed exact Business mandate. Load authoritative Cult4 context and the current WorkItem, inspect durable state, then immediately coordinate the highest-priority objective within that mandate. Build or repair a complete request-linked WorkItem graph with explicit required capabilities and let Cult4 route each task to an operationally equipped specialist. Do not perform specialist research, strategy, finance, design, implementation, legal/IP review, or QA yourself; record a capability gap if no qualified employee exists. Do not wait silently, ask whether to begin, repeat the intake, or offer another menu of plans. For sustained execution, call start_autopilot after the graph is ready. Reserve recurring work for employee postmortems and evidence-backed improvement of reusable Skills, tools, playbooks, and methods. Briefly report only concrete coordination progress, material decisions, or genuine blockers.",
    );
  process.stdout.write(
    automaticAutopilot
      ? `\nReprise automatique de l’autopilot pour ${business.name}…\n`
      : `\nOuverture de l’Operator pour ${business.name}…\n`,
  );
  const baselineAuditId = (
    db.prepare("SELECT COALESCE(max(id),0) id FROM audit_event").get() as {
      id: number;
    }
  ).id;
  let child: ReturnType<typeof spawn>;
  try {
    if (automaticAutopilot) {
      child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    } else {
      const setpriv =
          process.platform === "linux"
            ? ["/usr/bin/setpriv", "/bin/setpriv"].find(existsSync)
            : undefined,
        command = setpriv ?? "opencode",
        commandArgs = setpriv
          ? ["--pdeathsig", "KILL", "--", "opencode", ...openCodeArgs]
          : openCodeArgs;
      child = spawn(command, commandArgs, {
        stdio: "inherit",
        env: {
          ...process.env,
          CULT4_EMPLOYEE: "employee-operator",
          CULT4_WORK_ITEM: workId,
        },
      });
    }
  } catch (error) {
    if (repositoryId) releaseRepositoryLock(db, repositoryId, workId);
    throw error;
  }
  type HostHandoff = { type: string; data_json: string };
  const requestedHandoff = (): HostHandoff | undefined =>
    db
      .prepare(
        `SELECT type,data_json FROM audit_event
         WHERE id>? AND type IN ('BUSINESS_INTAKE_HANDOFF_REQUESTED','BUSINESS_AUTOPILOT_HANDOFF_REQUESTED')
           AND business_id=? AND subject_type='OPERATOR_INTERACTION' AND subject_id=?
         ORDER BY id LIMIT 1`,
      )
      .get(baselineAuditId, business.id, workId) as HostHandoff | undefined;
  let handoff: HostHandoff | undefined = automaticAutopilot
    ? {
        type: "BUSINESS_AUTOPILOT_HANDOFF_REQUESTED",
        data_json: JSON.stringify(automaticAutopilot),
      }
    : undefined;
  let terminationSent = false;
  let interruptedSignal: NodeJS.Signals | undefined;
  let interactiveKillTimer: NodeJS.Timeout | undefined;
  const interactiveSignalHandlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    const handler = () => {
      if (interruptedSignal) {
        child.kill("SIGKILL");
        return;
      }
      interruptedSignal = signal;
      child.kill("SIGTERM");
      interactiveKillTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      interactiveKillTimer.unref();
    };
    interactiveSignalHandlers.set(signal, handler);
    process.on(signal, handler);
  }
  const watcher = setInterval(() => {
    handoff ??= requestedHandoff();
    if (handoff && !terminationSent) {
      terminationSent = true;
      child.kill("SIGTERM");
    }
  }, 100);
  let result: { status: number | null };
  try {
    result = await new Promise<{ status: number | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status) => resolve({ status }));
    });
  } catch (error) {
    if (repositoryId) releaseRepositoryLock(db, repositoryId, workId);
    throw error;
  } finally {
    clearInterval(watcher);
    if (interactiveKillTimer) clearTimeout(interactiveKillTimer);
    for (const [signal, handler] of interactiveSignalHandlers)
      process.off(signal, handler);
  }
  handoff ??= requestedHandoff();
  if (repositoryId) {
    const shouldFinalize =
      result.status === 0 ||
      handoff?.type === "BUSINESS_AUTOPILOT_HANDOFF_REQUESTED" ||
      Boolean(interruptedSignal);
    if (shouldFinalize) {
      const finalized = finalizeVersionedWork(db, {
        repositoryId,
        workItemId: workId,
        employeeId: "employee-operator",
        purpose: interruptedSignal
          ? "Interrupted human-directed Operator session"
          : "Human-directed Operator session",
        checkpoint: Boolean(interruptedSignal),
      });
      if (finalized.changed)
        process.stdout.write(
          `\nModifications de l’Operator validées, commitées et poussées par Cult4 (${finalized.sha}).\n`,
        );
    } else releaseRepositoryLock(db, repositoryId, workId);
  }
  if (interruptedSignal) {
    process.exitCode = interruptedSignal === "SIGINT" ? 130 : 1;
    process.stdout.write(
      `\n${interruptedSignal} reçu : Operator fermé, modifications checkpointées et verrou libéré.\n`,
    );
    return;
  }
  if (handoff?.type === "BUSINESS_INTAKE_HANDOFF_REQUESTED") {
    process.exitCode = 0;
    process.stdout.write(
      "\nIntake terminé. Retour à Cult4 pour la confirmation humaine exacte…\n",
    );
    const review = await reviewPendingMandate(db, business);
    if (review === "CONFIRMED")
      await launchOperator(db, business, { freshSession: true });
    return;
  }
  if (handoff?.type === "BUSINESS_AUTOPILOT_HANDOFF_REQUESTED") {
    process.exitCode = 0;
    const requested = JSON.parse(handoff.data_json) as AutopilotRequest;
    process.stdout.write(
      `\nAutopilot démarré pour ${business.name} : ${requested.maxDurationMinutes} min max, ${requested.maxWorkItems} tours max, ${(requested.maxCostCents / 100).toFixed(2)} $ de modèle max.\n`,
    );
    let stopRequested = false,
      emergencyRequested = false,
      detailsVisible = false,
      activeTitle = "préparation",
      lastActivity = "initialisation",
      statusVisible = false;
    const shownToolInputs = new Set<string>();
    let lastToolEvent:
      Extract<OpenCodeProgressEvent, { type: "tool" }> | undefined;
    const stopController = new AbortController();
    const autopilotStarted = Date.now(),
      input = process.stdin,
      canReadKeys = Boolean(input.isTTY && input.setRawMode),
      wasRaw = input.isRaw;
    const elapsed = () => {
      const seconds = Math.floor((Date.now() - autopilotStarted) / 1000);
      return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
    };
    const clearStatus = () => {
      if (!statusVisible || !process.stdout.isTTY) return;
      process.stdout.write("\r\u001b[2K");
      statusVisible = false;
    };
    const writeEvent = (label: string, detail?: unknown) => {
      clearStatus();
      process.stdout.write(`[${elapsed()}] ${label}\n`);
      if (detail !== undefined) {
        const rendered =
          typeof detail === "string"
            ? detail
            : (JSON.stringify(detail, null, 2) ?? String(detail));
        for (const line of rendered.split("\n"))
          process.stdout.write(`         ${line}\n`);
      }
    };
    const writeTrace = (lines: string[]) => {
      clearStatus();
      for (const line of indentTimedTrace(lines, elapsed()))
        process.stdout.write(`${line}\n`);
    };
    const onKey = (chunk: Buffer) => {
      const key = chunk.toString();
      if (key === "\u0003") {
        emergencyRequested = true;
        stopRequested = true;
        stopController.abort("CULT4_IMMEDIATE_STOP");
        writeEvent(
          "■ Ctrl+C reçu — arrêt immédiat, checkpoint, retour au shell; le prochain cult reprendra l’autopilot",
        );
        return;
      }
      if ((key === "d" || key === "D") && !stopRequested) {
        detailsVisible = !detailsVisible;
        writeEvent(
          `◫ détails ${detailsVisible ? "activés" : "désactivés"}${lastToolEvent ? " — dernière vue réaffichée" : ""}`,
        );
        if (lastToolEvent)
          writeTrace(
            renderToolTrace(
              lastToolEvent,
              Boolean(process.stdout.isTTY),
              detailsVisible,
            ),
          );
        return;
      }
      if (key !== "\u001b" || stopRequested) return;
      stopRequested = true;
      stopController.abort();
      writeEvent(
        "■ ESC reçu — arrêt à la fin de l’outil courant, checkpoint, puis retour dans l’Operator",
      );
    };
    if (canReadKeys) {
      input.setRawMode!(true);
      input.resume();
      input.on("data", onKey);
      process.stdout.write(
        "ESC : arrêt après l’outil courant · D : afficher/masquer les détails complets.\n",
      );
    }
    const heartbeat = setInterval(() => {
      if (process.stdout.isTTY) {
        process.stdout.write(
          `\r\u001b[2K[${elapsed()}] ◌ ${activeTitle} — ${lastActivity}  (ESC pour arrêter)`,
        );
        statusVisible = true;
      } else
        process.stdout.write(
          `[${elapsed()}] … ${activeTitle} — ${lastActivity}\n`,
        );
    }, 15_000);
    heartbeat.unref();
    let result: Awaited<ReturnType<typeof tick>>;
    try {
      result = await tick(db, {
        businessId: business.id,
        maxDurationMs: requested.maxDurationMinutes * 60_000,
        maxWorkItems: requested.maxWorkItems,
        maxCostCents: requested.maxCostCents,
        shouldStop: () => stopRequested,
        signal: stopController.signal,
        onProgress: (event) => {
          if (event.type === "work_started") {
            activeTitle = event.title;
            lastActivity = "démarrage du tour";
            writeEvent(`▶ WORK ${event.title} — ${event.employeeId}`, {
              workItemId: event.workItemId,
              type: event.workType,
            });
          } else {
            writeEvent(
              `${event.ok ? "✓" : "✗"} WORK ${event.title} — ${(event.costCents / 100).toFixed(2)} $${event.errorCode ? ` — ${event.errorCode}` : ""}`,
              {
                workItemId: event.workItemId,
                durationMs: event.durationMs,
              },
            );
          }
        },
        onModelProgress: (event) => {
          if (event.type === "message") {
            lastActivity = "message de l’agent";
            writeTrace(
              renderAgentTrace(event.text, Boolean(process.stdout.isTTY)),
            );
            return;
          }
          if (event.type === "diagnostic") {
            lastActivity = "diagnostic OpenCode";
            writeTrace(
              renderDiagnosticTrace(event.text, Boolean(process.stdout.isTTY)),
            );
            return;
          }
          if (event.type === "usage") {
            writeTrace(
              renderUsageTrace(
                event.costCents,
                event.inputTokens,
                event.outputTokens,
                Boolean(process.stdout.isTTY),
              ),
            );
            return;
          }
          lastActivity = `${event.tool} — ${event.status}`;
          const inputKey = event.callId ?? "";
          const showInput =
            Boolean(event.input) &&
            (!inputKey || !shownToolInputs.has(inputKey));
          if (inputKey && showInput) shownToolInputs.add(inputKey);
          const visibleEvent = {
            ...event,
            ...(event.callId ? { callId: event.callId } : {}),
            ...(event.title ? { title: event.title } : {}),
            ...(showInput ? { input: event.input } : {}),
            ...(event.output !== undefined ? { output: event.output } : {}),
            ...(event.error !== undefined ? { error: event.error } : {}),
          };
          lastToolEvent = visibleEvent;
          writeTrace(
            renderToolTrace(
              visibleEvent,
              Boolean(process.stdout.isTTY),
              detailsVisible,
            ),
          );
        },
      });
    } finally {
      clearInterval(heartbeat);
      clearStatus();
      if (canReadKeys) {
        input.off("data", onKey);
        input.setRawMode!(wasRaw);
        input.pause();
      }
    }
    process.stdout.write(
      `Autopilot ${result.stoppedEarly ? "arrêté proprement" : "terminé"} : ${result.processed} tour(s), ${(result.costCents / 100).toFixed(2)} $ de modèle.\n`,
    );
    if (emergencyRequested) return;
    audit(db, {
      type: stopRequested
        ? "BUSINESS_AUTOPILOT_INTERVENED"
        : "BUSINESS_AUTOPILOT_COMPLETED",
      actorId: stopRequested ? "human-owner" : "system",
      businessId: business.id,
      subjectType: "BUSINESS",
      subjectId: business.id,
      data: {
        processed: result.processed,
        costCents: result.costCents,
        limits: requested,
      },
    });
    await launchOperator(db, business, {
      continueSession: true,
      resumePrompt: `A bounded Cult4 autopilot run has ${result.stoppedEarly ? "been stopped gracefully by the human after the current turn" : "ended"} for this Business. It processed ${result.processed} model turn(s), used ${result.costCents} model-cost cents, and recorded these outcomes: ${JSON.stringify(result.results)}. Load authoritative state and inspect the repository. Report concrete artifacts, commits, completed work, pending gates, and genuine blockers to the human. Do not restart autopilot unless the human explicitly requests another run.`,
    });
    return;
  }
  process.exitCode = result.status ?? 1;
  if (result.status === 0) {
    const review = await reviewPendingMandate(db, business);
    if (review === "CONFIRMED")
      await launchOperator(db, business, { freshSession: true });
  }
}
function status(db: ReturnType<typeof openDatabase>): unknown {
  return {
    businesses: db
      .prepare(
        "SELECT id,slug,name,status,CASE WHEN confirmed_mandate_id IS NULL THEN 'ONBOARDING' ELSE 'CONFIRMED' END mandate_status,confirmed_mandate_id,created_at FROM business ORDER BY created_at",
      )
      .all(),
    work: Object.fromEntries(
      (
        db
          .prepare(
            "SELECT status,count(*) count FROM work_item GROUP BY status",
          )
          .all() as Array<{ status: string; count: number }>
      ).map((x) => [x.status, x.count]),
    ),
    pendingHuman: (
      db
        .prepare(
          "SELECT count(*) count FROM human_request WHERE status IN ('PENDING','REMINDER_DUE','OVERDUE')",
        )
        .get() as { count: number }
    ).count,
    repositories: db
      .prepare(
        "SELECT id,owner_type,owner_id,default_branch,current_sha,remote_sha,privacy_verified,sync_status,last_verified_at FROM repository ORDER BY owner_type,owner_id",
      )
      .all(),
    budgetAvailable: db
      .prepare(
        `SELECT b.id,b.business_id,b.category,b.currency,b.limit_amount-COALESCE((SELECT sum(t.amount) FROM transaction_entry t WHERE t.budget_id=b.id),0)-COALESCE((SELECT sum(c.amount) FROM commitment c WHERE c.budget_id=b.id AND c.status='ACTIVE'),0) available FROM budget b WHERE b.status='ACTIVE'`,
      )
      .all(),
    recentAudit: db
      .prepare("SELECT * FROM audit_event ORDER BY id DESC LIMIT 10")
      .all(),
  };
}
async function main(): Promise<void> {
  if (["--help", "-h", "help"].includes(args[0] ?? "")) {
    process.stdout.write(
      "Usage: cult [init|config show/set/unset|status|doctor|business create/list|git connect/provision/restore|qa run <work-id>|human list/show/approve/reject|tick|organization maintain <work-id>]\n",
    );
    return;
  }
  if (args[0] === "init") {
    requireExternalCommands();
    initializeOrganization(config);
    const providerSecrets = provisionProviderSecrets(config);
    const db = openDatabase(config);
    try {
      seedFoundation(db);
      const organizationRepositoryId = registerOrganizationRepository(
        db,
        config,
      );
      for (const business of db
        .prepare("SELECT id,repo_path FROM business")
        .all() as Array<{ id: string; repo_path: string }>)
        if (existsSync(business.repo_path))
          registerLocalRepository(db, {
            ownerType: "business",
            ownerId: business.id,
            localPath: business.repo_path,
          });
      const organizationRemote = process.env.CULT4_ORGANIZATION_REMOTE_URL;
      if (organizationRemote)
        connectRemote(db, organizationRepositoryId, organizationRemote);
      else if (configuredGithubOwner(config).value)
        createPrivateGitHubRemote(
          db,
          organizationRepositoryId,
          configuredGithubOwner(config).value!,
          "cult4-organization",
        );
      const agents = materializeAllEmployees(db, config),
        tools = [
          materializeCult4Tools(config),
          ...materializeExtensionTools(config),
        ];
      print({
        status: "initialized",
        home: config.home,
        database: config.databasePath,
        organization: config.organizationPath,
        agents,
        tools,
        providerSecrets: providerSecrets.map(() => "openrouter:configured"),
        repository: db
          .prepare(
            "SELECT id,sync_status,privacy_verified,current_sha FROM repository WHERE id=?",
          )
          .get(organizationRepositoryId),
      });
    } finally {
      db.close();
    }
    return;
  }
  if (args[0] === "config" && args[1] === "show") {
    const githubOwner = configuredGithubOwner(config);
    print({
      settingsPath: config.settingsPath,
      githubOwner: githubOwner.value ?? null,
      githubOwnerSource: githubOwner.source,
    });
    return;
  }
  if (
    args[0] === "config" &&
    args[1] === "set" &&
    args[2] === "github-owner" &&
    args[3]
  ) {
    const owner = setGithubOwner(config, args[3]);
    print({
      status: "saved",
      githubOwner: owner,
      settingsPath: config.settingsPath,
      overriddenByEnvironment: Boolean(process.env.CULT4_GITHUB_OWNER),
    });
    return;
  }
  if (
    args[0] === "config" &&
    args[1] === "unset" &&
    args[2] === "github-owner"
  ) {
    unsetGithubOwner(config);
    print({
      status: "removed",
      setting: "github-owner",
      settingsPath: config.settingsPath,
      environmentStillConfigured: Boolean(process.env.CULT4_GITHUB_OWNER),
    });
    return;
  }
  if (args[0] === "config")
    throw new Cult4Error(
      "Usage: cult config show | set github-owner <owner> | unset github-owner",
      "CLI_USAGE",
    );
  const db = openDatabase(config);
  try {
    provisionProviderSecrets(config);
    seedFoundation(db);
    if (!args.length) {
      requireExternalCommands();
      materializeAllEmployees(db, config);
      materializeCult4Tools(config);
      materializeExtensionTools(config);
      const business = await interactiveBusiness(db);
      if (
        !hasConfirmedBusinessMandate(db, business.id) &&
        hasResumableIntakeHandoff(db, business.id)
      ) {
        const review = await reviewPendingMandate(db, business);
        if (review === "CONFIRMED")
          await launchOperator(db, business, { freshSession: true });
        else if (review === "DEFERRED") await launchOperator(db, business);
        return;
      }
      await launchOperator(db, business);
      return;
    }
    if (args[0] === "status") {
      print(status(db));
      return;
    }
    if (args[0] === "doctor") {
      const repairs = args.includes("--repair")
        ? repairDoctor(db, config)
        : undefined;
      const checks = doctor(db, config);
      print({
        ok: checks.every((c) => c.ok),
        ...(repairs ? { repairs } : {}),
        checks,
      });
      if (checks.some((c) => !c.ok)) process.exitCode = 1;
      return;
    }
    if (args[0] === "business" && args[1] === "create") {
      const remoteIndex = args.indexOf("--remote", 2);
      const remoteUrl = remoteIndex >= 0 ? args[remoteIndex + 1] : undefined;
      const name = args
        .slice(2, remoteIndex >= 0 ? remoteIndex : undefined)
        .join(" ")
        .trim();
      if (!name)
        throw new Cult4Error(
          "Business name is required.",
          "BUSINESS_NAME_REQUIRED",
        );
      const business = createBusiness(db, name, config);
      if (remoteUrl) connectRemote(db, business.repositoryId, remoteUrl);
      else if (configuredGithubOwner(config).value)
        createPrivateGitHubRemote(
          db,
          business.repositoryId,
          configuredGithubOwner(config).value!,
          business.slug,
        );
      else
        throw new Cult4Error(
          "Business repository exists locally but a verified private remote is required. Re-run with --remote <url> or use cult git connect business.",
          "BUSINESS_PROVISIONING_INCOMPLETE",
          { repositoryId: business.repositoryId, slug: business.slug },
        );
      const workItemId = createBusinessFoundationWork(db, {
        id: business.id,
        name,
      });
      print({ ...business, workItemId });
      return;
    }
    if (args[0] === "business" && args[1] === "list") {
      print(
        db
          .prepare(
            `SELECT b.id,b.slug,b.name,b.repo_path,b.status,CASE WHEN b.confirmed_mandate_id IS NULL THEN 'ONBOARDING' ELSE 'CONFIRMED' END mandate_status,b.confirmed_mandate_id,b.created_at,r.id repository_id,r.sync_status,r.current_sha,r.remote_sha,r.privacy_verified
             FROM business b LEFT JOIN repository r ON r.owner_type='business' AND r.owner_id=b.id ORDER BY b.created_at`,
          )
          .all(),
      );
      return;
    }
    if (args[0] === "git" && args[1] === "connect") {
      if (args[2] === "organization" && args[3]) {
        print(connectRemote(db, organizationRepository(db).id, args[3]));
        return;
      }
      if (args[2] === "business" && args[3] && args[4]) {
        const business = db
          .prepare("SELECT id FROM business WHERE slug=?")
          .get(args[3]) as { id: string } | undefined;
        if (!business)
          throw new Cult4Error("Business not found.", "BUSINESS_NOT_FOUND");
        print(
          connectRemote(db, businessRepository(db, business.id).id, args[4]),
        );
        return;
      }
      throw new Cult4Error(
        "Usage: cult git connect organization <remote-url> | business <slug> <remote-url>",
        "CLI_USAGE",
      );
    }
    if (args[0] === "git" && args[1] === "provision") {
      const owner = args.includes("--owner")
        ? args[args.indexOf("--owner") + 1]
        : configuredGithubOwner(config).value;
      if (!owner)
        throw new Cult4Error(
          "GitHub owner is required.",
          "GITHUB_OWNER_REQUIRED",
        );
      if (args[2] === "organization") {
        print(
          createPrivateGitHubRemote(
            db,
            organizationRepository(db).id,
            owner,
            "cult4-organization",
          ),
        );
        return;
      }
      if (args[2] === "business" && args[3]) {
        const business = db
          .prepare("SELECT id FROM business WHERE slug=?")
          .get(args[3]) as { id: string } | undefined;
        if (!business)
          throw new Cult4Error("Business not found.", "BUSINESS_NOT_FOUND");
        print(
          createPrivateGitHubRemote(
            db,
            businessRepository(db, business.id).id,
            owner,
            args[3],
          ),
        );
        return;
      }
      throw new Cult4Error(
        "Usage: cult git provision organization|business <slug> [--owner <owner>]",
        "CLI_USAGE",
      );
    }
    if (args[0] === "git" && args[1] === "restore") {
      if (args[2] === "organization") {
        print(restoreRepository(db, organizationRepository(db).id));
        return;
      }
      if (args[2] === "business" && args[3]) {
        const business = db
          .prepare("SELECT id FROM business WHERE slug=?")
          .get(args[3]) as { id: string } | undefined;
        if (!business)
          throw new Cult4Error("Business not found.", "BUSINESS_NOT_FOUND");
        print(restoreRepository(db, businessRepository(db, business.id).id));
        return;
      }
      if (args[2] === "--all") {
        print(
          (
            db
              .prepare("SELECT id FROM repository ORDER BY owner_type,owner_id")
              .all() as Array<{ id: string }>
          ).map((repo) => ({
            repositoryId: repo.id,
            ...restoreRepository(db, repo.id),
          })),
        );
        return;
      }
      throw new Cult4Error(
        "Usage: cult git restore organization|business <slug>|--all",
        "CLI_USAGE",
      );
    }
    if (args[0] === "human" && args[1] === "list") {
      print(listPendingHumanRequests(db));
      return;
    }
    if (args[0] === "human" && args[1] === "show" && args[2]) {
      const request = getHumanRequest(db, args[2]) as Record<string, unknown>;
      if (request.subject_type === "BUSINESS_MANDATE") {
        const mandate = getBusinessMandate(db, String(request.subject_id));
        print({
          ...request,
          mandate,
          rendered: `${formatBusinessMandate(mandate)}\n\n${formatMandateRequestCoverage(db, mandate.id)}`,
        });
        return;
      }
      const subject =
        request.subject_type === "ARTIFACT_VERSION"
          ? db
              .prepare(
                "SELECT av.*,a.purpose,a.type FROM artifact_version av JOIN artifact a ON a.id=av.artifact_id WHERE av.id=? AND av.content_hash=?",
              )
              .get(request.subject_id, request.subject_version)
          : request.subject_type === "PRODUCT_VERSION"
            ? db
                .prepare(
                  "SELECT pv.*,p.name,p.fulfillment_kind FROM product_version pv JOIN product p ON p.id=pv.product_id WHERE pv.id=? AND pv.content_hash=?",
                )
                .get(request.subject_id, request.subject_version)
            : null;
      print({ ...request, subject });
      return;
    }
    if (
      args[0] === "human" &&
      ["approve", "reject"].includes(args[1] ?? "") &&
      args[2]
    ) {
      const parsed = parseArgs({
        args: args.slice(3),
        options: {
          notes: { type: "string" },
          "checklist-json": { type: "string" },
          "photos-json": { type: "string" },
        },
        strict: true,
      });
      const request = getHumanRequest(db, args[2]) as Record<string, unknown>;
      if (request.subject_type === "BUSINESS_MANDATE") {
        const mandate =
          args[1] === "approve"
            ? confirmBusinessMandate(
                db,
                String(request.subject_id),
                "human-owner",
                String(request.subject_version),
              )
            : rejectBusinessMandate(
                db,
                String(request.subject_id),
                "human-owner",
                parsed.values.notes,
              );
        print({
          status: mandate.status,
          id: request.subject_id,
          version: mandate.content_hash,
        });
        return;
      }
      if (request.type === "PHYSICAL_INSPECTION") {
        if (!parsed.values["checklist-json"])
          throw new Cult4Error(
            "Physical inspection requires --checklist-json.",
            "INSPECTION_INCOMPLETE",
          );
        const order = db
          .prepare(
            "SELECT id FROM sample_order WHERE product_version_id=? AND status='RECEIVED' ORDER BY received_at DESC LIMIT 1",
          )
          .get(request.subject_id) as { id: string } | undefined;
        if (!order)
          throw new Cult4Error(
            "Received sample order not found.",
            "SAMPLE_NOT_RECEIVED",
          );
        recordPhysicalInspection(db, {
          sampleOrderId: order.id,
          result: args[1] === "approve" ? "PASS" : "FAIL",
          inspectedBy: "human-owner",
          checklist: JSON.parse(parsed.values["checklist-json"]) as Record<
            string,
            string | boolean
          >,
          notes: parsed.values.notes,
          photos: parsed.values["photos-json"]
            ? (JSON.parse(parsed.values["photos-json"]) as string[])
            : [],
        });
      }
      resolveHumanRequest(
        db,
        args[2],
        "human-owner",
        args[1] === "approve",
        parsed.values.notes,
      );
      if (args[1] === "approve" && request.gate_id) {
        const spend = db
          .prepare(
            "SELECT id FROM spend_request WHERE gate_id=? AND status='WAITING_APPROVAL'",
          )
          .get(request.gate_id) as { id: string } | undefined;
        if (spend) authorizeCommitment(db, spend.id, "human-owner");
      }
      print({
        status: args[1] === "approve" ? "RESOLVED" : "REJECTED",
        id: args[2],
      });
      return;
    }
    if (args[0] === "tick") {
      const parsed = parseArgs({
        args: args.slice(1),
        options: {
          "max-work-items": { type: "string" },
          "max-duration-ms": { type: "string" },
          "max-cost-cents": { type: "string" },
        },
        strict: true,
      });
      const result = await tick(db, {
        ...(parsed.values["max-work-items"]
          ? { maxWorkItems: Number(parsed.values["max-work-items"]) }
          : {}),
        ...(parsed.values["max-duration-ms"]
          ? { maxDurationMs: Number(parsed.values["max-duration-ms"]) }
          : {}),
        ...(parsed.values["max-cost-cents"]
          ? { maxCostCents: Number(parsed.values["max-cost-cents"]) }
          : {}),
      });
      print(result);
      return;
    }
    if (args[0] === "organization" && args[1] === "maintain" && args[2]) {
      print(await runOrganizationMaintenance(db, args[2]));
      return;
    }
    if (args[0] === "qa" && args[1] === "run" && args[2]) {
      print(await runQaWorkItem(db, args[2]));
      return;
    }
    if (args[0] === "__tool" && args[1]) {
      const employeeId = process.env.CULT4_TOOL_EMPLOYEE,
        workItemId = process.env.CULT4_TOOL_WORK,
        directory = process.env.CULT4_TOOL_DIRECTORY,
        sessionId = process.env.CULT4_TOOL_SESSION;
      if (!employeeId || !workItemId || !directory)
        throw new Cult4Error(
          "Cult4 tool mission context is missing.",
          "TOOL_SCOPE_DENIED",
        );
      let payload: unknown = {};
      try {
        payload = args[2] ? JSON.parse(args[2]) : {};
      } catch {
        throw new Cult4Error("Invalid tool JSON.", "TOOL_ARGUMENT_INVALID");
      }
      print(
        executeTool(db, args[1], payload, {
          employeeId,
          workItemId,
          directory,
          sessionId,
        }),
      );
      return;
    }
    throw new Cult4Error(
      "Usage: cult [init|config show/set/unset|status|doctor|business create/list|git connect/provision/restore|qa run <work-id>|human list/show/approve/reject|tick|organization maintain <work-id>]",
      "CLI_USAGE",
    );
  } finally {
    db.close();
  }
}
main().catch((error) => {
  const known = error instanceof Cult4Error;
  process.stderr.write(
    `${known ? error.code : "UNEXPECTED_ERROR"}: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  if (known && error.details)
    process.stderr.write(`${JSON.stringify(error.details)}\n`);
  process.exitCode = 1;
});
