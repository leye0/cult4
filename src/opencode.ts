import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { EmployeeRunResult } from "./domain.js";

export const DEFAULT_OPENCODE_MODEL = "openrouter/xiaomi/mimo-v2.5-pro";

export function resolveOpenCodeModel(
  employeeModel?: string | null,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return (
    employeeModel ?? environment.CULT4_OPENCODE_MODEL ?? DEFAULT_OPENCODE_MODEL
  );
}

export interface RunTaskInput {
  directory: string;
  agentName: string;
  prompt: string;
  sessionId?: string;
  model?: string;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
  configFile?: string;
  onProgress?: (event: OpenCodeProgressEvent) => void;
  signal?: AbortSignal;
}
export type OpenCodeProgressEvent =
  | {
      type: "tool";
      tool: string;
      status: string;
      callId?: string;
      title?: string;
      input?: Record<string, unknown>;
      output?: unknown;
      error?: unknown;
    }
  | { type: "message"; text: string }
  | { type: "diagnostic"; text: string }
  | {
      type: "usage";
      costCents: number;
      inputTokens: number;
      outputTokens: number;
    };
export interface OpenCodeRunner {
  runTask(input: RunTaskInput): Promise<EmployeeRunResult>;
}
function safeEnvironment(
  extra: NodeJS.ProcessEnv = {},
  configFile?: string,
): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TERM",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "OPENCODE_CONFIG_DIR",
    "CULT4_HOME",
    "CULT4_ORGANIZATION_PATH",
    "CULT4_OPENCODE_AGENTS_PATH",
    "CULT4_OPENCODE_TOOLS_PATH",
    "CULT4_OPENCODE_SKILLS_PATH",
  ];
  const mission = ["CULT4_EMPLOYEE", "CULT4_WORK_ITEM"];
  const base = Object.fromEntries(
    allowed.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]],
    ),
  ) as NodeJS.ProcessEnv;
  const scoped = Object.fromEntries(
    mission.flatMap((key) =>
      extra[key] === undefined ? [] : [[key, extra[key]]],
    ),
  ) as NodeJS.ProcessEnv;
  return {
    ...base,
    ...scoped,
    ...(configFile ? { OPENCODE_CONFIG: configFile } : {}),
  };
}
function parseEvent(
  line: string,
  state: {
    sessionId?: string;
    finalText?: string;
    costCents: number;
    inputTokens: number;
    outputTokens: number;
    error?: string;
  },
  onProgress?: (event: OpenCodeProgressEvent) => void,
): void {
  if (!line.trimStart().startsWith("{")) {
    if (line.trim()) onProgress?.({ type: "diagnostic", text: line });
    return;
  }
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    const direct = event.sessionID ?? event.sessionId ?? event.session_id;
    if (typeof direct === "string") state.sessionId = direct;
    const part =
      event.part && typeof event.part === "object"
        ? (event.part as Record<string, unknown>)
        : undefined;
    if (part?.sessionID && typeof part.sessionID === "string")
      state.sessionId = part.sessionID;
    const text =
      typeof part?.text === "string"
        ? part.text
        : typeof event.text === "string"
          ? event.text
          : undefined;
    if (text) state.finalText = `${state.finalText ?? ""}${text}`.slice(-32000);
    const cost =
      typeof event.cost === "number"
        ? event.cost
        : typeof part?.cost === "number"
          ? part.cost
          : 0;
    // Never account a paid model call as free: SQLite financial counters use
    // integer minor units, so positive sub-cent provider costs round upward.
    state.costCents += Math.max(0, Math.ceil(cost * 100));
    const tokens = (part?.tokens ?? event.tokens) as
      Record<string, unknown> | undefined;
    if (tokens) {
      state.inputTokens += Number(tokens.input ?? tokens.input_tokens ?? 0);
      state.outputTokens += Number(tokens.output ?? tokens.output_tokens ?? 0);
    }
    const error = event.error as Record<string, unknown> | undefined;
    if (typeof error?.message === "string")
      state.error = error.message.slice(0, 1000);
    if (part?.type === "tool" && typeof part.tool === "string") {
      const toolState =
        part.state && typeof part.state === "object"
          ? (part.state as Record<string, unknown>)
          : undefined;
      const status =
        typeof toolState?.status === "string" ? toolState.status : "running";
      onProgress?.({
        type: "tool",
        tool: part.tool.slice(0, 80),
        status,
        ...(typeof part.callID === "string" ? { callId: part.callID } : {}),
        ...(typeof toolState?.title === "string"
          ? { title: toolState.title }
          : {}),
        ...(toolState?.input && typeof toolState.input === "object"
          ? { input: toolState.input as Record<string, unknown> }
          : {}),
        ...(toolState && "output" in toolState
          ? { output: toolState.output }
          : {}),
        ...(toolState && "error" in toolState
          ? { error: toolState.error }
          : {}),
      });
    }
    if (part?.type === "text" && typeof part.text === "string")
      onProgress?.({ type: "message", text: part.text });
    if (event.type === "step_finish" || event.type === "step-finish")
      onProgress?.({
        type: "usage",
        costCents: Math.max(0, Math.ceil(cost * 100)),
        inputTokens: Number(tokens?.input ?? tokens?.input_tokens ?? 0),
        outputTokens: Number(tokens?.output ?? tokens?.output_tokens ?? 0),
      });
  } catch {
    /* Non-JSON diagnostic line. */
  }
}
function classify(output: string, timedOut: boolean): string {
  if (timedOut) return "MODEL_TIMEOUT";
  const lower = output.toLowerCase();
  if (/api.?key|credential|unauthorized|authentication|401/.test(lower))
    return "MODEL_AUTHENTICATION";
  if (/quota|rate.?limit|429/.test(lower)) return "MODEL_QUOTA";
  if (/context length|context window/.test(lower)) return "MODEL_CONTEXT_LIMIT";
  if (/enoent|not found/.test(lower)) return "OPENCODE_NOT_INSTALLED";
  return "OPENCODE_FAILED";
}
export class CliOpenCodeRunner implements OpenCodeRunner {
  constructor(
    private readonly command = process.env.CULT4_OPENCODE_COMMAND ?? "opencode",
  ) {}
  runTask(input: RunTaskInput): Promise<EmployeeRunResult> {
    const args = [
      "run",
      "--dir",
      input.directory,
      "--agent",
      input.agentName,
      "--auto",
      "--format",
      "json",
      "--title",
      `Cult4 work: ${input.agentName}`,
    ];
    if (input.sessionId) args.push("--session", input.sessionId);
    if (input.model) args.push("--model", input.model);
    args.push(input.prompt);
    const setpriv =
        process.platform === "linux"
          ? ["/usr/bin/setpriv", "/bin/setpriv"].find(existsSync)
          : undefined,
      command = setpriv ?? this.command,
      commandArgs = setpriv
        ? ["--pdeathsig", "KILL", "--", this.command, ...args]
        : args;
    const started = Date.now();
    return new Promise((resolve) => {
      const child = spawn(command, commandArgs, {
        cwd: input.directory,
        env: safeEnvironment(input.environment, input.configFile),
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      const killChildGroup = (signal: NodeJS.Signals = "SIGKILL") => {
          if (!child.pid) return;
          try {
            if (process.platform === "win32") child.kill(signal);
            else process.kill(-child.pid, signal);
          } catch {
            // It may already have exited.
          }
        },
        onParentExit = () => killChildGroup(),
        signalHandlers = new Map<NodeJS.Signals, () => void>();
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        const handler = () => {
          stopPending = true;
          cancelled = true;
          killChildGroup("SIGTERM");
          setTimeout(() => killChildGroup(), 5000).unref();
        };
        signalHandlers.set(signal, handler);
        process.on(signal, handler);
      }
      process.once("exit", onParentExit);
      let output = "",
        buffer = "",
        timedOut = false,
        cancelled = false,
        stopPending = false,
        cancellationTimer: NodeJS.Timeout | undefined,
        settled = false;
      const state: {
        sessionId?: string;
        finalText?: string;
        costCents: number;
        inputTokens: number;
        outputTokens: number;
        error?: string;
      } = { costCents: 0, inputTokens: 0, outputTokens: 0 };
      const stopAtBoundary = () => {
        if (!stopPending || cancelled) return;
        cancelled = true;
        killChildGroup("SIGTERM");
        setTimeout(() => killChildGroup(), 5000).unref();
      };
      const reportProgress = (event: OpenCodeProgressEvent) => {
        input.onProgress?.(event);
        if (!stopPending) return;
        if (
          event.type === "message" ||
          event.type === "usage" ||
          (event.type === "tool" &&
            ["completed", "error"].includes(event.status))
        )
          stopAtBoundary();
      };
      const onAbort = () => {
        stopPending = true;
        if (input.signal?.reason === "CULT4_IMMEDIATE_STOP") {
          stopAtBoundary();
          return;
        }
        cancellationTimer ??= setTimeout(stopAtBoundary, 60_000);
        cancellationTimer.unref();
      };
      if (input.signal?.aborted) onAbort();
      else input.signal?.addEventListener("abort", onAbort, { once: true });
      const consume = (chunk: Buffer | string) => {
        const text = String(chunk);
        output = `${output}${text}`.slice(-32000);
        const lines = `${buffer}${text}`.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) parseEvent(line, state, reportProgress);
      };
      child.stdout.on("data", consume);
      child.stderr.on("data", consume);
      const timer = setTimeout(() => {
        timedOut = true;
        killChildGroup("SIGTERM");
        setTimeout(() => {
          killChildGroup();
        }, 5000).unref();
      }, input.timeoutMs ?? 900000);
      const finish = (exitCode: number | null, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (cancellationTimer) clearTimeout(cancellationTimer);
        input.signal?.removeEventListener("abort", onAbort);
        process.off("exit", onParentExit);
        for (const [signal, handler] of signalHandlers)
          process.off(signal, handler);
        if (buffer) parseEvent(buffer, state, reportProgress);
        const ok = exitCode === 0 && !timedOut && !cancelled && !error;
        resolve({
          ok,
          exitCode,
          ...(state.sessionId ? { sessionId: state.sessionId } : {}),
          ...(state.finalText ? { finalText: state.finalText } : {}),
          durationMs: Date.now() - started,
          timedOut,
          ...(!ok
            ? {
                errorCode: cancelled
                  ? "MODEL_CANCELLED"
                  : classify(`${output}\n${error?.message ?? ""}`, timedOut),
                errorSummary: (cancelled
                  ? "Stopped by the human at an OpenCode event boundary."
                  : (state.error ?? error?.message ?? "OpenCode failed")
                ).slice(0, 1000),
              }
            : {}),
          costCents: state.costCents,
          inputTokens: state.inputTokens,
          outputTokens: state.outputTokens,
        });
      };
      child.once("error", (error) => finish(null, error));
      child.once("close", (code) => finish(code));
    });
  }
}
export const runEmployeeTask = (
  input: RunTaskInput,
  runner: OpenCodeRunner = new CliOpenCodeRunner(),
): Promise<EmployeeRunResult> => runner.runTask(input);
export const resumeEmployeeTask = runEmployeeTask;
