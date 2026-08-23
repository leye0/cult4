# Specification traceability

The implementation follows the “capacity or guarantee?” boundary: OpenCode owns reasoning, sessions, subagents, shell/web/files and Skills; Cult4 owns deterministic state and authorization.

| Specifications     | Implementation                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01–03              | `FOUNDATION.md`, architecture/security/domain documents, organization/business Git management, out-of-Git home layout, E01–E20 tests                                       |
| 04–08              | relational Employee/Actor records, seed roles as data, justified creation/evaluation, dynamic bootstrap, idempotent OpenCode agent materialization                         |
| 09–10              | organization Skills, organizational asset ownership/lifecycle, improvement proposals and narrow custom tools                                                               |
| 11–14              | SQLite FTS5 memory, enforced scope context, epistemic kinds/status, independent copy-based knowledge promotion                                                             |
| 15–18              | Source/Claim/Evidence/Decision records, provenance and contradiction, research Skill, reconstructible decision links                                                       |
| 19                 | Hypothesis/Metric/Measurement/Experiment state with readiness invariant                                                                                                    |
| 20–22              | generic WorkItem DAG/state machine, dependency eligibility, capability/assignment/responsibility/authority separation, persistent ownership                                |
| 23–28              | deterministic gates/policies, exact-version approvals, authority and self-review checks, expiration/invalidation, Git commit review worktrees                              |
| 29–33              | persistent HumanRequests, timers, structured human UX, exact subjects, branch-local waiting, human Actor authority                                                         |
| 34–40              | append-only audit triggers, versioned policies, structured ActionIntent broker, secret-free adapters, restrictive OpenCode permissions and injection blast-radius controls |
| 41–44              | transactional spend broker, integer minor units, budget/commitment/transaction separation, configurable stricter thresholds and human risk floor                           |
| 45–50              | artifact hashes/provenance/source licenses, mandatory exact human AI-art gate, independent conservative IP clearance/evidence                                              |
| 51–57              | exact real physical sample state, complete human checklist, supplier context qualification/requalification, generic multi-gate physical release                            |
| 58–60              | dynamic business/product/service/segment/channel/objective/risk primitives and additive local restrictions                                                                 |
| 61–65              | thin CLI, bounded `cult tick`, one replaceable `OpenCodeRunner`, verified CLI JSON/session/usage parsing                                                                   |
| 66–70              | scoped OpenCode custom tools, no internal MCP, linked global/local Skills, organization write denial, explicit maintenance proposals and dedicated maintenance sessions    |
| 71–75              | employee run/cost/token/failure metrics, durable results independent of sessions, SQLite/Git/object placement, explicit relational schema                                  |
| 76–79              | TypeScript + explicit SQL migrations + Zod + Git/OpenCode CLI, compact functional modules, generic physical acceptance with no category branch, architecture PR test       |
| 80–81              | recommended module APIs and all seven versioned core policies                                                                                                              |
| E01–E20            | `tests/foundation.test.ts`; deterministic and LLM-free                                                                                                                     |
| Sticker acceptance | `tests/integration.test.ts` exercises the generic AI-created physical commercial path without “sticker” logic                                                              |

## Cultural & Market Intelligence integration

| Requirement              | Implementation                                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structured state         | migration 004; `market_study`, evidence joins, generic `market_signal`, signal evidence joins, and `creative_brief` in the same SQLite database                                           |
| Permanent institution    | seeded `cultural-market-intelligence` Employee, `CULTURAL_MARKET_INTELLIGENCE` Responsibility, narrow authority, organization Skills, and normal OpenCode materialization                 |
| Deterministic obligation | `MARKET_RELEVANCE_REQUIRED@1` derives from subject classifications and blocks design/release/major investment without a fresh applicable study and exact approval                         |
| Evidence contract        | `src/market.ts` requires sourced non-LLM evidence, cultural/commercial/saturation/opportunity signals, linked evidence, confidence, methodology, limitations, and counter-signal research |
| Handoffs                 | Strategist creates a current CreativeBrief; Strategist and Designer bootstraps receive synthesis and references rather than raw community corpora                                         |
| Freshness                | study/signal/memory expiry, stale-aware retrieval, approval expiry, ordinary refresh WorkItems created by bounded `cult tick`                                                             |
| Independent controls     | existing human exact-hash AI-art, IP, physical sample, supplier, finance, release-quality, and Git SHA gates remain independent                                                           |
| Acceptance               | `tests/market.test.ts` covers E21–E32 plus WorkItem completion; existing integration and Git suites prove independent physical and exact-SHA controls                                     |

## Git Integrity & QA completion

| Requirement              | Implementation                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| GIT-001–010              | Repository registry, private-remote verification, clean synchronized `main`, credential-free URLs, writer locks   |
| GIT-011–020              | Health classification, exact local/remote/SQLite SHA checks, detached QA worktrees, exact approvals and cleanup   |
| Builder finalization     | Cult4-owned checks, path validation, one commit with trailers, verified push, `git_commit`, automatic QA WorkItem |
| Organization Maintenance | Exact base SHA, protected Foundation, clean finalization, verified push and maintenance result SHA                |
| Restore                  | Missing clone and safe fast-forward only; safe doctor repair; dirty and divergent repositories refused            |
| Release                  | Durable `release_candidate(repository_id, sha)` with non-transferable QA approval                                 |
| Foundation path          | Generated Organization repos use `foundation/FOUNDATION.md`; doctor rejects a root duplicate                      |

The milestone phases involving real money, shipping, and marketplace publication are intentionally adapter-driven: the repository supplies production contracts and fail-closed brokers, but does not invent credentials, vendors, orders, or marketplace results. Activating a real adapter remains an operator deployment action governed by the same gates.
