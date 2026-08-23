import type { OpenCodeProgressEvent } from "./opencode.js";

export function indentTimedTrace(lines: string[], elapsed: string): string[] {
  const prefix = `[${elapsed}] `;
  return lines.map(
    (line, index) =>
      `${index === 0 ? prefix : " ".repeat(prefix.length)}${line}`,
  );
}

const secretKey =
  /(?:api.?key|secret|credential|password|authorization|cookie|(?:access|refresh|auth).?token)/i;
const ansi = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  magenta: "\u001b[35m",
};

function paint(
  enabled: boolean,
  color: keyof typeof ansi,
  text: string,
): string {
  return enabled ? `${ansi[color]}${text}${ansi.reset}` : text;
}
function redact(value: unknown, key = ""): unknown {
  if (secretKey.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        redact(child, childKey),
      ]),
    );
  if (typeof value !== "string") return value;
  return value
    .replace(/\b(?:sk|gh[pousr])[-_][A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /\b([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL))=([^\s]+)/g,
      "$1=[REDACTED]",
    );
}
function terminalSafe(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- strip untrusted OSC bytes
      .replace(new RegExp("\\x1B\\][^\\x07]*(?:\\x07|\\x1B\\\\)", "g"), "")
      // eslint-disable-next-line no-control-regex -- strip untrusted CSI bytes
      .replace(new RegExp("\\x1B\\[[0-?]*[ -/]*[@-~]", "g"), "")
      .replace(
        // eslint-disable-next-line no-control-regex -- strip remaining controls
        new RegExp("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1A\\x1C-\\x1F\\x7F]", "g"),
        "",
      )
  );
}
function parsed(value: unknown): unknown {
  const clean = redact(value);
  if (typeof clean !== "string") return clean;
  const trimmed = clean.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  )
    try {
      return redact(JSON.parse(trimmed));
    } catch {
      // It is ordinary text that happens to resemble JSON.
    }
  return terminalSafe(clean);
}
function scalar(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object")
    return terminalSafe(JSON.stringify(redact(value)) ?? String(value));
  return terminalSafe(String(redact(value)));
}
function textLines(value: unknown): string[] {
  const clean = parsed(value);
  if (typeof clean === "string") return clean.split("\n");
  return (JSON.stringify(clean, null, 2) ?? scalar(clean)).split("\n");
}
function field(lines: string[], label: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  lines.push(`│ ${label.padEnd(12)} ${scalar(value)}`);
}
function record(value: unknown): Record<string, unknown> | undefined {
  const candidate = parsed(value);
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : undefined;
}
function section(lines: string[], label: string, value: unknown): void {
  if (value === undefined) return;
  lines.push(`│ ${label}`);
  for (const line of textLines(value)) lines.push(`│   ${line}`);
}
function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
function structuredSection(
  lines: string[],
  label: string,
  value: unknown,
): void {
  const candidate = parsed(value);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    section(lines, label, candidate);
    return;
  }
  const entries = Object.entries(candidate);
  if (!entries.length) return;
  lines.push(`│ ${label}`);
  for (const [key, child] of entries) {
    if (Array.isArray(child)) {
      lines.push(`│   ${humanize(key)}`);
      for (const item of child) lines.push(`│     • ${scalar(item)}`);
    } else if (child && typeof child === "object") {
      lines.push(`│   ${humanize(key)}`);
      for (const line of textLines(child)) lines.push(`│     ${line}`);
    } else lines.push(`│   ${humanize(key).padEnd(18)} ${scalar(child)}`);
  }
}
function stateView(output: unknown): string[] | undefined {
  const state = record(output);
  if (!state) return undefined;
  const business = record(state.business),
    mandate = record(state.mandate ?? state.businessMandate),
    work = record(state.work),
    employee = record(state.employee);
  if (!business && !mandate && !work && !employee) return undefined;
  const lines: string[] = [];
  field(
    lines,
    "Business",
    business
      ? `${scalar(business.name ?? business.slug)} · ${scalar(business.status)}`
      : undefined,
  );
  field(
    lines,
    "Mandat",
    mandate
      ? `${scalar(mandate.status)} · v${scalar(mandate.version)} · ${scalar(mandate.autonomy_mode)}`
      : undefined,
  );
  field(
    lines,
    "WorkItem",
    work
      ? `${scalar(work.title)} · ${scalar(work.status)} · ${scalar(work.id)}`
      : undefined,
  );
  field(
    lines,
    "Employé",
    employee
      ? `${scalar(employee.name ?? employee.slug)} · ${scalar(employee.status)}`
      : undefined,
  );
  for (const key of ["decisions", "assets", "memory", "capabilities", "gates"])
    if (Array.isArray(state[key])) field(lines, key, state[key].length);
  return lines;
}
function todoView(input: Record<string, unknown>): string[] {
  const todos = Array.isArray(input.todos) ? input.todos : [];
  return todos.map((candidate) => {
    const todo = record(candidate) ?? {};
    const status = scalar(todo.status);
    const mark =
      status === "completed" ? "✓" : status === "in_progress" ? "●" : "○";
    return `│ ${mark} ${scalar(todo.content ?? todo.title)}  [${status}]`;
  });
}
function editView(input: Record<string, unknown>): string[] {
  const lines: string[] = [];
  field(lines, "Fichier", input.filePath ?? input.path);
  const before = input.oldString ?? input.oldText,
    after = input.newString ?? input.newText ?? input.content;
  if (before !== undefined) {
    lines.push("│ Diff");
    for (const line of textLines(before)) lines.push(`│   - ${line}`);
    for (const line of textLines(after)) lines.push(`│   + ${line}`);
  } else section(lines, "Contenu", after);
  return lines;
}

export function renderToolTrace(
  event: Extract<OpenCodeProgressEvent, { type: "tool" }>,
  colors: boolean,
  detailed = false,
): string[] {
  const statusColor =
      event.status === "completed"
        ? "green"
        : event.status === "error"
          ? "red"
          : "yellow",
    symbol =
      event.status === "completed" ? "✓" : event.status === "error" ? "✗" : "●",
    tool = terminalSafe(event.tool),
    title = `${symbol} ${tool} · ${terminalSafe(event.status)}`,
    lines = [`╭─ ${paint(colors, statusColor, title)}`],
    input = (redact(event.input ?? {}) ?? {}) as Record<string, unknown>;
  if (event.title) field(lines, "Action", terminalSafe(event.title));
  if (event.callId) field(lines, "Call", event.callId);

  if (["cult4_get_state", "cult4_bootstrap"].includes(event.tool)) {
    for (const line of stateView(event.output) ?? []) lines.push(line);
  } else if (event.tool === "bash") {
    field(lines, "Répertoire", input.workdir);
    section(lines, "Commande", input.command);
    section(lines, "Sortie", event.output);
  } else if (event.tool === "read") {
    field(lines, "Fichier", input.filePath ?? input.path);
    section(lines, "Contenu", event.output);
  } else if (["edit", "write", "apply_patch"].includes(event.tool)) {
    lines.push(...editView(input));
    section(lines, "Résultat", event.output);
  } else if (["todowrite", "todo_write"].includes(event.tool)) {
    lines.push(...todoView(input));
    section(lines, "Résultat", event.output);
  } else if (["webfetch", "websearch"].includes(event.tool)) {
    field(lines, "URL", input.url ?? input.query);
    field(lines, "Format", input.format);
    section(lines, "Réponse", event.output);
  } else if (["glob", "grep", "list"].includes(event.tool)) {
    field(lines, "Chemin", input.path ?? input.directory);
    field(lines, "Motif", input.pattern ?? input.query);
    section(lines, "Résultats", event.output);
  } else if (["task", "skill"].includes(event.tool)) {
    field(lines, "Nom", input.name ?? input.subagent_type);
    field(lines, "Description", input.description);
    section(lines, "Instruction", input.prompt ?? input.task);
    section(lines, "Résultat", event.output);
  } else {
    if (Object.keys(input).length) structuredSection(lines, "Entrée", input);
    const summarized = event.tool.startsWith("cult4_")
      ? stateView(event.output)
      : undefined;
    if (summarized) lines.push(...summarized);
    else structuredSection(lines, "Résultat", event.output);
  }
  section(lines, "Erreur", event.error);
  if (detailed && ["cult4_get_state", "cult4_bootstrap"].includes(event.tool)) {
    section(lines, "État complet", event.output);
  }
  lines.push("╰─");
  return lines;
}

export function renderAgentTrace(text: string, colors: boolean): string[] {
  const lines = textLines(text);
  return [
    `╭─ ${paint(colors, "magenta", "AGENT")}`,
    ...lines.map((line) => `│ ${line}`),
    "╰─",
  ];
}

export function renderUsageTrace(
  costCents: number,
  inputTokens: number,
  outputTokens: number,
  colors: boolean,
): string[] {
  return [
    `◆ ${paint(colors, "cyan", "USAGE")} · ${(costCents / 100).toFixed(2)} $ · ${inputTokens.toLocaleString()} in · ${outputTokens.toLocaleString()} out`,
  ];
}

export function renderDiagnosticTrace(text: string, colors: boolean): string[] {
  return [
    `╭─ ${paint(colors, "yellow", "OPENCODE")}`,
    ...textLines(text).map((line) => `│ ${line}`),
    "╰─",
  ];
}
