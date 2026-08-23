# Architecture

> OpenCode executes intelligence; Cult4 preserves and enforces the organization.

```text
human / cron / CI
       |
     cult CLI ---- SQLite (authoritative operational state)
       |                 |-- work, governance, finance, evidence, market studies, audit
       |                 `-- scoped FTS5 memory
       |
 OpenCodeRunner -------- OpenCode CLI (disposable sessions)
       |-- business Git repo (read/write)
       |-- organization Git repo (read-only in business missions)
       `-- Cult4 narrow tools (no arbitrary SQL or secrets)

Git: source, policies, skills, tools, versioned artifacts
Object store: large evidence, sample photos, candidate binaries
```

Cult4 does not implement an LLM runtime, agent protocol, browser, shell, Git engine, scheduler, broker, workflow DSL, vector store, ORM, or plugin platform. Employees are durable database identities; OpenCode sessions are disposable projections. Workflows are dynamic WorkItem DAGs; policies only derive non-negotiable obligations from structured actions.

Employees are not prompt personas around one universal agent. WorkItems carry
required organizational capabilities; Cult4 routes them to active Employees
that possess those capabilities and active organizational assets. Role-specific
OpenCode permissions reinforce the boundary: the Operator manages the graph but
cannot edit or shell, the Builder implements, and QA can inspect and test but
cannot edit. Missing qualified staffing fails as an explicit capability gap.

Employee development is scheduled work. After a bounded number of measured
runs, and immediately after failures, Cult4 creates capability-development work
for the responsible Employee. The Employee must preserve a calibrated
postmortem and propose evidence-backed improvements to reusable Skills, tools,
playbooks, methods, evaluations, or staffing. Promotion to organization scope
remains independently reviewed and provenance-preserving.

Every persistent Organization or Business repository is registered in SQLite
with its private remote, `main`, local/remote SHA, privacy verification, and sync
health. A single writer lock protects it. Cult4 prepares a clean synchronized
base, prevents agents from changing Git history, creates one logical commit,
pushes and verifies it, and only then records durability. Independent QA uses a
detached worktree at an exact registered SHA; approvals and release candidates
bind both repository ID and SHA.

Core policies V1: `FINANCIAL_SPEND@1`, `AI_GENERATED_VISUAL_PUBLIC_USE@1`, `COMMERCIAL_CREATIVE_IP@1`, `PHYSICAL_PRODUCT_COMMERCIAL_RELEASE@1`, `PRODUCTION_RELEASE@1`, `FOUNDATION_CHANGE@1`, `MARKET_RELEVANCE_REQUIRED@1`, and `BUSINESS_ASSURANCE@1`.

Business semantics remain inside each Business repository. A Business declares
versioned executable controls for the parsers, calculations, or domain rules
that support sensitive action. Cult4 does not interpret those semantics; it
enforces their lifecycle. New or changed controls are experimental, material
Decisions identify their Claims, and only an independent `DIGITAL_QA` result
bound to the current control version and current Claim evidence makes those
Claims eligible to support an external action. Spend, samples, publication,
public messages, commitments, and external accounts fail closed without this
assurance chain.

Cultural & Market Intelligence is an ordinary permanent Employee and persistent Responsibility. `market_study`, `market_signal`, and `creative_brief` are compact structured handoffs over the existing Source/Evidence/Claim system. `MARKET_RELEVANCE_REQUIRED` checks classification, applicability, evidence structure, analyst approval, and freshness before design and again for classified release or major investment. Research remains OpenCode + Skills work; there is no cultural orchestrator, crawler service, scheduler, queue, or second database.

The OpenCode contract is the `OpenCodeRunner` interface in `src/opencode.ts`; the CLI implementation is replaceable by a future SDK backend. Every infrastructure PR must answer: “Why can this not be supplied more simply by OpenCode, Git, SQLite, or the OS?”

The generic sticker acceptance scenario is encoded in tests and evals. No core rule knows the category “sticker”; policies inspect cultural sensitivity, target applicability, physical fulfillment, commercial use, AI provenance, risk, and subject versions.
