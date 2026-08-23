# Cult4

Cult4 is a deterministic organizational foundation for autonomous businesses run by OpenCode.

OpenCode supplies the intelligence: reasoning, research, coding, web use, temporary subagents, and tool execution. Cult4 supplies the institution around that intelligence: durable identities, responsibilities, work, evidence, memory, policies, approvals, finance controls, exact-version Git QA, human requests, and an append-only audit trail.

The central design rule is:

> OpenCode decides how to work. Cult4 decides what must be true before consequential work may proceed.

Cult4 is deliberately not another agent runtime, workflow DSL, browser, scheduler, vector database, or social-data platform. It uses OpenCode, SQLite, Git, and the operating system for those jobs.

## The primary experience

Cult4 is designed to start as an interactive, long-lived CLI. After installation and provider configuration, run:

```bash
cult
```

On the first launch, Cult4 initializes the organization, asks how to connect its required private Git repositories, creates the first Business, and then opens the interactive Operator. The Business remains locked in onboarding: the Operator first has a real conversation with you and must understand both the operating contract and the living spirit before autonomous work becomes eligible.

```text
> Build a small autonomous business for Quebec houseplant collectors.
> Show me the evidence behind the opportunity before designing anything.
> What decisions are waiting for me?
```

The Operator reflects the result back as an exact versioned mandate. It includes practical boundaries—customer, offer, budget, autonomy, approvals, prohibitions, success and stop conditions—alongside a nuanced narrative of the Business's worldview, voice, taste, emotional territory, productive tensions, anti-goals, and quality bar. Confirm it only when it feels recognizably yours. Until then, `cult tick` cannot start the Business; a dedicated intake agent has native research, file-editing, shell, Skill, and delegation permissions denied; and narrow Cult4 tools permit only context inspection and mandate proposal.

After confirmation, every employee receives the mandate in mission context and is instructed to treat it as the Business's constitution rather than decorative brand prose. Confirmed currency, total exploration budget, per-spend ceiling, and no-approval spending ceiling are enforced by deterministic financial policy.

The mandate records one of three autonomy modes. `ASSISTED` excludes the Business from unattended `cult tick` execution. `SUPERVISED` and `BOUNDED_AUTONOMOUS` are tick-eligible subject to the same deterministic gates and budgets; their different intended operating postures are currently conveyed through the mandate rather than separate scheduler behavior.

Later launches open the selected Business in restricted intake mode until its mandate is confirmed, and in the normal Operator afterward. Cult4 asks which Business to open when several are active. The other `cult` subcommands are available for explicit administration, automation, cron, and CI; they are not required for the normal conversational workflow.

## What Cult4 provides

- Permanent organizational employees executed through disposable OpenCode sessions.
- Human-confirmed, exact-version Business mandates combining enforceable limits with a living creative and cultural description.
- Immutable Intake transcripts and official human requests traced through mandate, work, exact-version acceptance evidence, and QA.
- Generic `WorkItem` dependency graphs instead of hardcoded business workflows.
- Deterministic policies and version-bound gates for sensitive actions.
- Scoped organizational, employee, business, and employee-business memory.
- Provenance-aware `Source → Evidence → Claim → Decision` research records.
- Business-owned versioned controls: material claims must pass independent QA before they can support sensitive external action.
- Cultural and market intelligence with freshness, counter-signal, saturation, and commercial-analysis requirements.
- Exact-hash human approval for public AI-generated artwork.
- Independent IP, release-quality, physical-sample, supplier, strategy, and financial controls.
- Transactional budgets, commitments, spend requests, and recorded transactions.
- Private Git remotes, Cult4-owned commits, verified pushes, and detached exact-SHA QA.
- Persistent asynchronous `HumanRequest` records where silence never means approval.
- Bounded autonomous execution through `cult tick`.
- An append-only audit trail for reconstructing material actions and decisions.

## How it works

```text
human / cron / CI
        |
      cult CLI
        |
        +---- SQLite
        |       employees, mandates, work, gates, approvals,
        |       evidence, market studies, finance, memory, audit
        |
        +---- OpenCode
        |       disposable employee sessions and subagents
        |
        +---- private Git repositories
        |       business output and organization methods
        |
        +---- content-addressed object storage
                large evidence and binary artifacts
```

A new Business first passes through a non-autonomous intake:

1. The human and restricted intake Operator develop the operating contract and living spirit.
2. Cult4 captures the exact human-authored transcript. Every substantive demand, named integration, constraint, preference, and idea becomes an official request linked to its source message; every other message remains visible with an explicit disposition.
3. The Operator proposes an exact, hashed mandate draft with a complete request-coverage matrix. Deferral or rejection requires a resolved `SCOPE_DEVIATION` HumanRequest.
4. When the human is ready, the Operator calls the non-approving `finish_intake` handoff tool and stops.
5. The trusted `cult` host shows the exact mandate, request ledger, source excerpts, and explicit non-request dispositions before asking for confirmation.
6. On confirmation, execution work must identify the official requests it serves; independent QA verifies their acceptance criteria on the exact resulting version.

Within a Business whose mandate permits execution, a typical work cycle is:

1. The Operator turns the human objective into durable non-interactive `WorkItem`s.
2. After an explicit request for sustained execution, the Operator calls `start_autopilot` with bounded time, work-turn, and model-cost limits.
3. The trusted `cult` host interrupts the interactive TUI and runs a Business-scoped `cult tick` loop; an early model stop leaves unfinished work eligible for another turn instead of silently returning control to the human.
4. Cult4 resolves the responsible permanent Employee and builds a fresh scoped mission context for every turn.
5. OpenCode executes the mission using the business repository, approved Skills, and narrow Cult4 tools.
6. The employee records evidence, decisions, artifacts, structured results, and blockers in Cult4.
7. Deterministic policies derive gates for consequential actions.
8. Authorized employees or humans approve only exact subject versions.
9. Cult4 finalizes repository changes as one verified private Git commit.
10. Independent QA reviews an exact detached SHA when required.
11. The loop stops on its bounds, a gate, a blocker, completed work, or no eligible work, then reopens the same Operator conversation with a durable result summary.

Prose such as “looks approved” is never an approval. Approval is a structured record tied to an actor, authority, policy version, subject, subject version, and optional expiry.

## Seeded employees

Cult4 starts with eight permanent employees:

| Employee                               | Responsibility                                                         |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Operator                               | Maintains portfolio continuity and builds the dynamic work graph       |
| Strategist                             | Turns evidence into strategies, decisions, hypotheses, and experiments |
| Researcher                             | Produces calibrated provenance-aware research                          |
| Cultural & Market Intelligence Analyst | Maintains current human-market and cultural understanding              |
| Designer                               | Creates original, traceable commercial artifacts                       |
| QA Analyst                             | Independently validates exact release versions                         |
| Treasurer                              | Protects budgets and evaluates unit economics                          |
| IP Reviewer                            | Independently evaluates commercial IP provenance and risk              |

Employee identities, responsibilities, experience, and memory persist. Their individual OpenCode sessions do not.

## Cultural and market intelligence

Culture-sensitive commercial work is fail-closed before serious design begins. The Market Intelligence Analyst must create a fresh, applicable `MarketStudy` backed by existing Source, Evidence, and Claim records.

A complete study structurally requires:

- a target segment, market, language, and geography;
- current non-LLM provenance-backed evidence;
- cultural analysis;
- commercial analysis, which may explicitly be `UNKNOWN`;
- saturation analysis;
- an opportunity or explicit no-opportunity conclusion;
- counter-signal research;
- methodology, limitations, confidence, completion time, and validity window.

The flow is:

```text
MarketStudy
  -> MARKET_RELEVANCE approval
  -> Strategist Decision / Hypothesis
  -> CreativeBrief
  -> Designer
  -> Human AI-art approval when applicable
  -> independent IP clearance
  -> digital QA / physical sample / supplier / finance gates
  -> release
  -> experiment results and future study refresh
```

Market relevance never implies that the art is good, the expression is legally safe, the physical product is acceptable, or the economics work. Those controls remain independent.

Expired studies cannot be silently extended. `cult tick` expires their gates and creates one ordinary `MARKET_STUDY_REFRESH` WorkItem. There is no separate trend daemon or cultural-intelligence orchestrator.

## Requirements

- Node.js 20 or newer.
- Git.
- SQLite with FTS5 support. The bundled `better-sqlite3` dependency normally supplies this.
- The `opencode` CLI available on `PATH`.
- A supported model-provider credential; the current setup supports an OpenRouter API key.
- Private Git remotes for the Organization and every Business repository.
- Git authentication through SSH, a credential helper, or `gh auth` when using GitHub provisioning.

Verify the external commands before initializing:

```bash
node --version
git --version
opencode --version
```

## Installation

From this repository:

```bash
npm install
npm run build
npm link
```

`npm link` exposes the compiled `cult` command globally for the current Node installation. During development, the equivalent source command is:

```bash
npm run dev -- status
```

## Configuration

Cult4 loads `.env` from the directory where an operator command is invoked. Set `CULT4_ENV_FILE` to use an explicit file instead.

Non-secret operator preferences are stored persistently in `CULT4_HOME/config.json`. The interactive onboarding saves the GitHub owner there automatically, so it is normally requested only once. An environment variable takes precedence when both are present.

Example `.env`:

```dotenv
OPENROUTER_API_KEY=replace-with-your-key
CULT4_OPENCODE_MODEL=openrouter/xiaomi/mimo-v2.5-pro
CULT4_HOME=/absolute/path/to/.cult4

# Optional override; interactive onboarding normally persists this once.
CULT4_GITHUB_OWNER=your-private-github-owner
```

The variables are:

| Variable                        | Purpose                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`            | Imported into Cult4's mode-0600 secret store and referenced by OpenCode from a file |
| `CULT4_OPENCODE_MODEL`          | Override for the pinned default `openrouter/xiaomi/mimo-v2.5-pro` model             |
| `CULT4_GITHUB_OWNER`            | Optional environment override for the persisted GitHub owner                        |
| `CULT4_ORGANIZATION_REMOTE_URL` | Existing private remote for the Organization repository                             |
| `CULT4_HOME`                    | Operational state root; defaults to `~/.cult4`                                      |
| `CULT4_ORGANIZATION_PATH`       | Override for the Organization working copy                                          |
| `CULT4_OPENCODE_AGENTS_PATH`    | Generated OpenCode employee definitions                                             |
| `CULT4_OPENCODE_TOOLS_PATH`     | Generated narrow Cult4 tools                                                        |
| `CULT4_OPENCODE_SKILLS_PATH`    | Generated or linked OpenCode Skills                                                 |
| `CULT4_ENV_FILE`                | Exact environment file to load instead of `./.env`                                  |
| `CULT4_TICK_MAX_WORK_ITEMS`     | Default maximum work items per tick                                                 |
| `CULT4_TICK_MAX_DURATION_MS`    | Default tick wall-time budget                                                       |
| `CULT4_TICK_MAX_COST_CENTS`     | Default tick provider-cost budget                                                   |

Business tool subprocesses do not discover arbitrary `.env` files. Provider keys are not copied into employee subprocess environments, prompts, Git repositories, or tool arguments.

Inspect or change the persisted GitHub owner explicitly with:

```bash
cult config show
cult config set github-owner your-private-github-owner
cult config unset github-owner
```

## Quick start

### 1. Start Cult4

After creating the `.env` described above, launch the interactive experience:

```bash
cult
```

The first-run prompt performs organization initialization and asks only for values that are not already configured:

- a GitHub owner, saved as the persistent default while provisioning verified private repositories automatically, or an existing private Organization remote URL;
- the name of the first Business;
- an existing private Business remote URL when automatic provisioning was not selected.

It then opens OpenCode inside the new Business repository using the deliberately restricted `cult4-intake` agent. The CLI remains active around that session. When intake completes, Cult4 returns control to its own trusted prompt and, after exact confirmation, resumes the same OpenCode conversation with the normal permanent Operator.

The first conversation is an intake, not autonomous execution. The Operator follows your language and energy instead of marching through a rigid questionnaire. It explores what the Business should feel like, what would make it generic or wrong, and what operational freedom it should have. Once it can express that faithfully, it proposes a mandate containing:

- a structured operating contract: purpose, customer, offer, constraints, budget, autonomy, approvals, prohibitions, success signals, stop conditions, and open questions;
- a living description: narrative, spirit, voice, taste, emotional territory, quality bar, and anti-goals;
- the human inputs from which it derived that interpretation;
- a cryptographic hash identifying the exact version under review.

Once the Operator has proposed a mandate draft and you indicate that it is ready, it calls `finish_intake`. This tool cannot approve anything: it emits an audited handoff signal, Cult4 interrupts the restricted session, renders the complete exact draft, and asks you directly for confirmation. On approval, Cult4 resumes the same conversation in normal Operator mode. A rejection, interruption, or no response leaves the Business locked in onboarding so the conversation can be continued on the next `cult` launch. Pending mandates are also available through `cult human list`, `cult human show <request-id>`, `cult human approve <request-id>`, and `cult human reject <request-id>`.

### 2. Shape and confirm the mandate

For example:

```text
Build an autonomous sticker business for Quebec houseplant collectors.
Validate the market before designing anything, keep initial downside below $100,
and ask me only for decisions that require human judgment.
```

The intake Operator is instructed to stay in conversation long enough to understand what those words mean to you, especially what would make the result feel generic, soulless, or off-brand. Cult4 does not impose an arbitrary minimum number of messages and cannot mechanically prove semantic understanding. Its deterministic guarantee is that autonomous work remains locked until you inspect and confirm the exact operating-and-spirit mandate. Only after that confirmation may the Operator classify the initiative, create a MarketStudy dependency, route research to the Market Intelligence Analyst, and preserve ordinary work through Cult4 tools.

### Non-interactive and administrative setup

The same setup remains available as explicit commands for scripts, deployment, and troubleshooting.

#### Initialize the organization

With automatic private GitHub provisioning configured:

```bash
cult init
cult doctor
```

To use an existing private Organization remote instead:

```bash
export CULT4_ORGANIZATION_REMOTE_URL=git@github.com:example/cult4-organization.git
cult init
```

Initialization:

- creates or upgrades the SQLite database;
- seeds employees, responsibilities, authorities, and policies;
- creates the Organization repository;
- connects and verifies its private remote;
- materializes OpenCode employee definitions and Cult4 tools;
- imports configured provider secrets into protected storage.

#### Create a business

Using automatic GitHub provisioning:

```bash
cult business create "Plant Goblin"
```

Using an existing private remote:

```bash
cult business create "Plant Goblin" \
  --remote git@github.com:example/plant-goblin.git
```

The command creates a registered Business, a local repository, a remote-backed durability boundary, and an initial `BUSINESS_FOUNDATION` WorkItem assigned to the Operator. That foundation work starts proposed and cannot execute until the Business has a confirmed mandate that permits unattended execution.

#### Open an interactive Operator session

Run Cult4 with no arguments:

```bash
cult
```

Cult4 creates an `OPERATOR_INTERACTION` WorkItem and opens OpenCode. A Business still onboarding uses the restricted intake agent; a Business with a confirmed mandate uses the normal permanent Operator. If several Businesses are active, Cult4 first asks which one to open.

```text
Build an autonomous sticker business for Quebec houseplant collectors.
Validate the market before designing anything, keep initial downside below $100,
and ask me only for decisions that require human judgment.
```

For a sustained autonomous objective, say so explicitly in this conversation. The Operator must first create or verify durable non-interactive WorkItems, then call `start_autopilot`. This is a real host handoff: Cult4 closes the interactive TUI, runs repeated Business-scoped OpenCode turns within explicit limits, and reopens the same conversation afterward. A model ending one turn prematurely does not end the run while eligible unfinished work and budget remain.

During that host loop, the terminal renders a complete operational trace: the active WorkItem and Employee, public agent messages, every OpenCode tool call, exact arguments and commands, file paths, stdout, stderr, errors, usage, elapsed time, model cost, and durable outcomes. Dedicated colored views render Cult4 state, shell commands, file reads and edits, task lists, and web activity semantically instead of dumping protocol JSON; unknown tools use a generic fallback. Press `D` to reveal or hide the complete payload of large state tools. Credentials and detected secret values are redacted, terminal-control sequences are neutralized, and private model reasoning is not emitted. A single in-place heartbeat shows the current activity between events. Press `Esc` to stop at the next completed OpenCode tool or message boundary, checkpoint, and reopen the Operator for intervention. Press `Ctrl+C` for an immediate controlled pause: Cult4 terminates the OpenCode child, checkpoints versioned work, leaves unfinished work `READY`, releases repository and runtime locks, restores terminal input, and returns to the shell. The next plain `cult` automatically resumes the still-open autopilot intent with its recorded limits; a normally completed run or an `Esc` intervention closes that intent. A five-second kill fallback prevents an unresponsive child from surviving; dead-host locks are recovered on the next acquisition as an additional crash safeguard.

#### Run bounded autonomous work

```bash
cult tick \
  --max-work-items 3 \
  --max-duration-ms 600000 \
  --max-cost-cents 500
```

A tick processes human-request timers, expires approvals and MarketStudies, reevaluates waiting WorkItems, selects eligible non-interactive READY work, runs the assigned Employee through OpenCode, and finalizes successful repository changes. Interactive Operator conversations are never selected as unattended work. Businesses without a confirmed mandate, and Businesses whose confirmed autonomy mode is `ASSISTED`, are excluded from unattended selection. The explicit command remains useful for cron, CI, and administration; `start_autopilot` invokes the same bounded mechanism from the conversational workflow and scopes it to the selected Business.

Use one work item per tick while first configuring a deployment:

```bash
cult tick --max-work-items 1
```

## Example: culture-sensitive physical product

For a physical creative product, the institutional path can look like this:

```text
Human and restricted intake Operator shape the Business
  -> Operator proposes an exact mandate draft
  -> human confirms the exact mandate version
  -> normal Operator creates initiative and WorkItems
  -> Market Intelligence researches communities and marketplaces
  -> Source / Evidence / Claim / MarketSignal
  -> complete fresh MarketStudy
  -> MARKET_RELEVANCE approval
  -> Strategist creates Decision, Hypothesis, and CreativeBrief
  -> Designer produces an exact artifact version
  -> human approves or rejects the exact AI-art hash
  -> IP Reviewer clears the exact artifact independently
  -> supplier selected and sample spend requested
  -> real physical sample ordered and received
  -> human completes the physical inspection checklist
  -> supplier qualification and unit economics
  -> exact Git SHA passes detached QA
  -> release action is reevaluated against every gate
```

If the US English MarketStudy is presented for a Quebec French target, the market gate fails applicability. If the study expires before a major expansion, the expansion blocks until a new study is created. If market relevance passes but IP, art, physical quality, economics, or QA fails, release still blocks.

## Operating Cult4

The common inspection commands are:

```bash
cult status
cult business list
cult human list
cult doctor
```

Human approvals, exact-SHA QA, repository recovery, Organization maintenance, backups, upgrades, and incident response have safety-sensitive procedures. Follow the [Cult4 runbook](RUNBOOK.md) when operating a persistent deployment.

Git acts as a durability and identity boundary. Cult4 requires clean synchronized private repositories, finalizes one logical commit at a time, verifies the pushed SHA, and runs independent QA against that exact SHA. It never repairs a repository by silently resetting, rebasing, force-pushing, or discarding local work.

## Storage layout

The default `CULT4_HOME=~/.cult4` layout is:

```text
~/.cult4/
  config.json       persistent non-secret operator preferences
  state.db          authoritative operational state
  organization/     Organization Git working copy
  businesses/       Business Git working copies
  objects/          content-addressed large objects
  runtime/          locks and temporary QA worktrees
  secrets/          protected provider credentials
```

Generated OpenCode agents, tools, and Skills default to the relevant directories under `~/.config/opencode/`.

Working copies are reconstructible, but SQLite operational state is not reconstructed from Git. See the [backup and restore procedure](RUNBOOK.md#backup-procedure) before protecting or moving a deployment.

## Safety properties

- External text and web content are untrusted data, never executable governance instructions.
- A new Business cannot enter autonomous execution without human confirmation of an exact hashed mandate version.
- Before confirmation, the restricted intake agent cannot research, edit files, use the shell, load Skills, delegate, spend, or create ordinary work.
- Agents cannot use arbitrary SQL or access arbitrary secrets through Cult4 tools.
- Sensitive actions are structured intents evaluated by deterministic policies.
- Human silence and timeouts never grant approval.
- Independent responsibilities prevent common self-review paths.
- Approval identity includes the exact mandate or artifact hash, product version, or Git SHA.
- Paid research services and datasets use the same finance rules as every other spend.
- Real physical quality requires inspection of a real received sample.
- Audit events are append-only at the SQLite trigger level.
- Local business policies may add restrictions but cannot weaken core policies.

## Current boundaries

Cult4 includes fail-closed contracts for finance, shipping, marketplace publication, and other external effects, but this repository intentionally does not ship production payment, shipping, marketplace, or account-creation adapters. Those require deployment-specific credentials and operator authorization.

Cult4 also intentionally avoids:

- a separate agent runtime;
- a continuous scraping or meme-monitoring daemon;
- a second workflow engine or queue;
- a vector database;
- a social graph or platform-specific evidence database;
- an automated legal determination;
- a universal business workflow.

The supplied external adapters and tests are simulation-safe. Activating a real adapter remains a deployment action governed by the same structured gates.

## Development

Useful commands:

```bash
npm run dev -- status     # run the TypeScript CLI directly
npm run format            # format source and documentation
npm run lint              # ESLint
npm run typecheck         # TypeScript without output
npm test                  # deterministic test suite; no model spend
npm run test:live         # real OpenCode/OpenRouter integration; spends credits
npm run check             # format check + lint + typecheck + deterministic tests
npm run build             # compile to dist/
npm run prepack           # full check followed by build
```

The deterministic suite covers mandate intake and confirmation, restricted-agent security, mandate-bound finance, policies, adversarial acceptance cases, migrations, CLI behavior, Cultural & Market Intelligence E21–E32, physical-product release, Git integrity, detached QA, and Organization Maintenance. Live tests verify a real model writing through a Cult4 tool and a complete real `cult tick` through OpenRouter.

Key implementation areas:

| Path                                | Purpose                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/policy.ts`, `src/assurance.ts` | Deterministic policies, Business-owned controls, material-claim assurance, and gate derivation |
| `src/work.ts`                       | Generic WorkItem graph and transitions                                                         |
| `src/mandate.ts`                    | Exact-version Business mandate proposal, validation, and confirmation                          |
| `src/settings.ts`                   | Persistent non-secret operator configuration                                                   |
| `src/market.ts`                     | Compact MarketStudy, MarketSignal, and CreativeBrief persistence/validation                    |
| `src/employee.ts`                   | Permanent employee identities and scoped bootstrap compilation                                 |
| `src/tools.ts`                      | Narrow validated tools exposed to employee sessions                                            |
| `src/tick.ts`                       | Bounded work selection and OpenCode execution loop                                             |
| `src/git.ts`, `src/review.ts`       | Repository integrity, finalization, and detached exact-SHA QA                                  |
| `src/approval.ts`, `src/human.ts`   | Gates, approvals, and asynchronous human participation                                         |
| `foundation/migrations/`            | Explicit ordered SQLite schema migrations                                                      |
| `foundation/policies/`              | Human-readable core-policy registry                                                            |
| `skills/`                           | Organization-owned methods loaded only when relevant                                           |
| `tests/`                            | Deterministic, integration, Git, adversarial, and live-provider tests                          |

For deeper detail, see [Architecture](specs/ARCHITECTURE.md), [Domain model](specs/DOMAIN_MODEL.md), [Security model](specs/SECURITY_MODEL.md), the [Cult4 runbook](RUNBOOK.md), and [specification traceability](specs/TRACEABILITY.md). The complete implementation specifications are kept under [`specs/`](specs/).

## License

Cult4 is licensed under the [MIT License](LICENSE).
