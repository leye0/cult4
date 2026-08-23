import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Cult4Config } from "./config.js";
import { getConfig } from "./config.js";

const tools: Record<string, { description: string; args: string }> = {
  cult4_record_approval: {
    description:
      "Grant or reject an exact gate using only the current Employee identity and actual authority",
    args: 'gateId:s.string(),decision:s.enum(["APPROVE","REJECT"]),notes:s.string().optional(),expiresAt:s.string().optional()',
  },
  cult4_register_artifact: {
    description: "Register a commercial artifact in the current business",
    args: "type:s.string(),purpose:s.string(),publicFacing:s.boolean().optional(),commercial:s.boolean().optional(),creative:s.boolean().optional(),cultureSensitive:s.boolean().optional(),trendSensitive:s.boolean().optional(),identitySensitive:s.boolean().optional()",
  },
  cult4_create_artifact_version: {
    description:
      "Hash and register an artifact file inside the current business repository",
    args: "artifactId:s.string(),locator:s.string(),aiGenerated:s.boolean().optional(),modelOrTool:s.string().optional(),creationMetadata:s.record(s.string(),s.unknown()).optional()",
  },
  cult4_record_ip_clearance: {
    description:
      "Record conservative IP review; authority remains gate-controlled",
    args: 'artifactVersionId:s.string(),risk:s.enum(["LOW","MEDIUM","HIGH","UNCERTAIN"]),searchStatus:s.enum(["SEARCHED","FOUND","NOT_FOUND","UNCERTAIN"]),evidenceRef:s.string(),notes:s.string().optional()',
  },
  cult4_propose_knowledge_promotion: {
    description:
      "Propose local knowledge for independent organization promotion",
    args: "sourceMemoryId:s.string(),rationale:s.string()",
  },
  cult4_propose_improvement: {
    description:
      "Propose explicit skill, tool, employee, or Foundation maintenance work",
    args: 'kind:s.enum(["SKILL_CANDIDATE","TOOL_IMPROVEMENT","EMPLOYEE_CHANGE","FOUNDATION_CHANGE"]),ownerResponsibility:s.string().optional(),title:s.string(),rationale:s.string(),evidenceRef:s.string().optional()',
  },
  cult4_review_improvement: {
    description:
      "Independently approve or reject an exact Skill, tool, employee, or Foundation improvement proposal with durable evidence",
    args: 'proposalId:s.string(),decision:s.enum(["APPROVE","REJECT"]),evidence:s.array(s.string()).min(1)',
  },
};
export function materializeExtensionTools(
  config: Cult4Config = getConfig(),
): string[] {
  mkdirSync(config.toolsPath, { recursive: true, mode: 0o700 });
  const paths: string[] = [];
  for (const [name, spec] of Object.entries(tools)) {
    const domainName = name.replace(/^cult4_/, "");
    const path = join(config.toolsPath, `${name}.ts`);
    const source = `import { tool } from "@opencode-ai/plugin"\nimport { execFile } from "node:child_process"\nimport { promisify } from "node:util"\nconst run=promisify(execFile),s=tool.schema\nexport default tool({description:${JSON.stringify(spec.description)},args:{${spec.args}},async execute(args,context){const {stdout}=await run("cult",["__tool",${JSON.stringify(domainName)},JSON.stringify(args)],{cwd:context.directory,env:{...process.env,CULT4_TOOL_EMPLOYEE:process.env.CULT4_EMPLOYEE??context.agent,CULT4_TOOL_WORK:process.env.CULT4_WORK_ITEM??"",CULT4_TOOL_DIRECTORY:context.directory},maxBuffer:1048576});return stdout.trim()}})\n`;
    writeFileSync(path, source, { mode: 0o600 });
    chmodSync(path, 0o600);
    paths.push(path);
  }
  return paths;
}
