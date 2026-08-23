import { describe, expect, test } from "vitest";
import {
  indentTimedTrace,
  renderAgentTrace,
  renderToolTrace,
  renderUsageTrace,
} from "../src/trace.js";

describe("autopilot trace views", () => {
  test("aligns every card border with variable-width elapsed timestamps", () => {
    const card = ["╭─ AGENT", "│ message", "╰─"];

    for (const elapsed of ["3m36s", "10m00s", "120m00s"]) {
      const rendered = indentTimedTrace(card, elapsed);
      const borderColumns = rendered.map((line) =>
        Math.max(line.indexOf("╭"), line.indexOf("│"), line.indexOf("╰")),
      );
      expect(new Set(borderColumns).size).toBe(1);
      expect(borderColumns[0]).toBe(`[${elapsed}] `.length);
    }
  });

  test("renders Cult4 state as a compact semantic card", () => {
    const output = JSON.stringify({
      business: { name: "Mercator", status: "ACTIVE" },
      mandate: {
        status: "CONFIRMED",
        version: 2,
        autonomy_mode: "SUPERVISED",
        purpose: "A very long mandate that does not belong in the compact view",
      },
      work: { id: "work_123", title: "Build Mercator", status: "RUNNING" },
      decisions: [{ id: "one" }, { id: "two" }],
    });
    const rendered = renderToolTrace(
      {
        type: "tool",
        tool: "cult4_get_state",
        status: "completed",
        output,
      },
      false,
    ).join("\n");

    expect(rendered).toContain("Mercator · ACTIVE");
    expect(rendered).toContain("CONFIRMED · v2 · SUPERVISED");
    expect(rendered).toContain("Build Mercator · RUNNING · work_123");
    expect(rendered).toContain("decisions");
    expect(rendered).not.toContain("very long mandate");
    expect(rendered).not.toContain("\\n");
  });

  test("can reveal the complete state on demand", () => {
    const rendered = renderToolTrace(
      {
        type: "tool",
        tool: "cult4_get_state",
        status: "completed",
        output: JSON.stringify({
          business: { name: "Mercator", status: "ACTIVE" },
          mandate: { purpose: "Complete purpose" },
        }),
      },
      false,
      true,
    ).join("\n");

    expect(rendered).toContain("État complet");
    expect(rendered).toContain("Complete purpose");
  });

  test("renders shell commands and output without escaped newlines", () => {
    const rendered = renderToolTrace(
      {
        type: "tool",
        tool: "bash",
        status: "completed",
        input: { command: "git status --short", workdir: "/repo" },
        output: " M src/app.ts\n?? tests/app.test.ts",
      },
      false,
    ).join("\n");

    expect(rendered).toContain("Répertoire   /repo");
    expect(rendered).toContain("git status --short");
    expect(rendered).toContain("│    M src/app.ts\n│   ?? tests/app.test.ts");
  });

  test("renders edits as an inline diff", () => {
    const rendered = renderToolTrace(
      {
        type: "tool",
        tool: "edit",
        status: "completed",
        input: {
          filePath: "src/app.ts",
          oldString: "const state = 'old';",
          newString: "const state = 'new';",
        },
        output: "Done",
      },
      false,
    ).join("\n");

    expect(rendered).toContain("Fichier      src/app.ts");
    expect(rendered).toContain("- const state = 'old';");
    expect(rendered).toContain("+ const state = 'new';");
  });

  test("redacts secrets and neutralizes terminal control sequences", () => {
    const rendered = renderToolTrace(
      {
        type: "tool",
        tool: "custom",
        status: "error",
        input: { apiKey: "top-secret" },
        error: "Bearer abcdefghijklmnop\u001b[2J",
      },
      true,
    ).join("\n");

    expect(rendered).toContain("[REDACTED]");
    expect(rendered).not.toContain("top-secret");
    expect(rendered).not.toContain("abcdefghijklmnop");
    expect(rendered).not.toContain("\u001b[2J");
    expect(rendered).toContain("\u001b[31m");
  });

  test("renders agent messages and usage as first-class events", () => {
    expect(renderAgentTrace("First\nSecond", false)).toEqual([
      "╭─ AGENT",
      "│ First",
      "│ Second",
      "╰─",
    ]);
    expect(renderUsageTrace(125, 12_000, 345, false)[0]).toContain(
      "1.25 $ · 12,000 in · 345 out",
    );
  });
});
