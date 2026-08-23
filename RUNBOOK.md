# Cult4 operations runbook

This document is the operator runbook for an initialized Cult4 deployment. It is not an architecture or product specification. For installation, concepts, examples, and the CLI overview, start with [README.md](README.md).

## Non-negotiable operating invariants

- SQLite is the authoritative operational state.
- Every persistent Organization or Business repository has a reachable verified private remote.
- Persistent repositories remain clean, on `main`, and synchronized across local HEAD, `origin/main`, and SQLite.
- Human silence, overdue requests, and timeouts never grant approval.
- Autonomous work for a Business requires an exact human-confirmed operating-and-spirit mandate.
- Sensitive external effects execute only through structured action brokers and idempotent adapters.
- Audit rows are preserved.
- Dirty or divergent Git state is resolved manually; Cult4 never destroys it to recover automatically.

## Routine preflight

Run before scheduled ticks, after upgrades, after moving a working copy, and after policy or Organization changes:

```bash
cult doctor
cult status
cult human list
```

Do not start unattended work unless `cult doctor` reports success. In particular, verify:

- database integrity and current migrations;
- protected secret-directory permissions;
- generated employee and tool materialization;
- seeded policy and Market Intelligence structure;
- private remote verification;
- clean `main` working trees;
- identical local, remote, and recorded SHAs;
- no unresolved human request that should be handled before spending or release.
- every Business intended for autonomous work has a confirmed mandate that still reflects the human's intent and living creative direction.

## Running autonomous work

Before scheduling the first tick for a Business, complete its conversational onboarding through `cult` and confirm the rendered mandate. A merely created repository or a `BUSINESS_FOUNDATION` WorkItem is not authorization to begin. If the mandate feels generic, reductive, or unlike the intended Business, continue the Operator conversation and confirm a revised exact version instead.

Start conservatively:

```bash
cult tick --max-work-items 1 --max-duration-ms 600000 --max-cost-cents 500
```

Increase work count or cost only after observing successful repository finalization, provider usage, and human-request behavior. A tick is bounded by work count, wall time, provider cost, and a SQLite runtime lock. A second concurrent tick fails closed.

The normal conversational equivalent is an explicit request for sustained autonomous execution in `cult`. The Operator must represent the objective as ready non-interactive WorkItems and call `start_autopilot`; the host then interrupts the TUI, runs the same bounded loop scoped to that Business, and reopens the conversation with results. If a model turn yields while its WorkItem remains incomplete, the host may run it again within the requested bounds. `OPERATOR_INTERACTION` WorkItems are never selected by unattended ticks.

The foreground terminal prints the complete live operational trace during this loop: WorkItem, Employee, public agent messages, exact tool arguments and commands, file paths, stdout/stderr, errors, usage, elapsed time, cost, commits, completion, and failure events. Tool-specific colored views turn Cult4 state, shell commands, file operations, task lists, and web activity into readable cards; unknown tools retain a generic view. Press `D` to toggle complete payloads for large state tools. Secret values are redacted, terminal-control sequences are neutralized, and private model reasoning is excluded. Press `Esc` to stop at the next completed OpenCode tool or message boundary, checkpoint, close the autopilot intent, and return automatically to the Operator. Press `Ctrl+C` for an immediate controlled pause that terminates the child, checkpoints and pushes versioned changes, leaves unfinished work `READY`, releases locks, and returns to the shell. The next plain `cult` resumes that open autopilot intent directly with its recorded limits. Child termination escalates after five seconds, and a later lock acquisition recovers state left by a dead host.

Suitable schedulers include cron, systemd timers, or CI, but the scheduler should invoke the ordinary CLI rather than bypassing it. Capture stdout/stderr and the process exit code. Do not inject provider credentials directly into job logs or command arguments.

## Human queue procedure

Inspect the exact request and subject before acting:

```bash
cult human list
cult human show <request-id>
```

Then approve or reject with a useful durable note:

```bash
cult human approve <request-id> --notes "Reviewed exact subject and approved"
cult human reject <request-id> --notes "Reason and required correction"
```

For `PHYSICAL_INSPECTION`, inspect the actual received product and provide every checklist dimension through `--checklist-json`. Photos are evidence, not a substitute for the real inspection.

If a request expires, reevaluate the dependent action and create a new request. Do not edit the old record or infer approval from earlier conversation. Unrelated WorkItem branches may continue.

## MarketStudy freshness procedure

`cult tick` marks overdue complete MarketStudies as expired, expires their market gates, and creates one `MARKET_STUDY_REFRESH` WorkItem when no active refresh already exists.

An expired study is historical evidence. Never change it back to `COMPLETE` or extend its date. The Analyst creates a replacement study that records the prior study, reuses relevant context, and adds fresh evidence.

Before major culture-sensitive spend or release, confirm that the applicable MarketStudy is still fresh for the exact segment, market, language, and geography. Market relevance does not replace IP, creative, finance, physical, supplier, or QA review.

## Repository health procedure

Use `cult doctor` and `cult status` to identify the repository state.

| State                         | Operator action                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Missing working copy          | Use `cult git restore organization`, `cult git restore business <slug>`, or `cult git restore --all`          |
| Missing remote                | Connect an existing private remote or provision one with `cult git connect` / `cult git provision`            |
| Remote unverifiable or public | Stop work, correct remote privacy/access, then rerun `cult doctor`                                            |
| Dirty                         | Inspect and preserve the changes; finish or revert them through an explicit human-controlled process          |
| Ahead                         | Inspect unpublished local commits; do not let Cult4 rewrite or silently push unknown history                  |
| Behind                        | Inspect the remote change and update the working copy explicitly outside autonomous work                      |
| Diverged                      | Stop autonomous work and reconcile history manually; never force-push as repair                               |
| SHA mismatch                  | Determine whether local, remote, or SQLite reflects an incomplete external operation before changing anything |

Safe repair is intentionally limited:

```bash
cult doctor --repair
```

It can clone a wholly missing working copy, prune stale worktree metadata/runtime directories, and refresh remote/privacy caches. It does not reset, merge, rebase, clean, force-push, or discard dirty work.

## Exact-SHA QA procedure

Run generated QA work only through:

```bash
cult qa run <digital-qa-work-id>
```

Cult4 creates a detached read-only worktree at the registered SHA, runs the QA employee, persists checks and evidence, and removes the worktree on every outcome. Verify that the QA record and approval reference the intended repository and full SHA.

Any later commit is a new subject and requires new QA. Never transfer approval notes from an older commit.

## Organization maintenance procedure

Business sessions cannot write the Organization repository. Run reviewed asset, Skill, tool, playbook, or employee changes through:

```bash
cult organization maintain <work-id>
```

Confirm the maintenance WorkItem has the correct base SHA and responsibility. Cult4 must leave the Organization repository clean, push the exact result to the private remote, and update SQLite only after remote verification.

Foundation changes additionally require an exact `FOUNDATION_CHANGE`, human Foundation approval, and independent QA. Do not manually remove the normal Foundation write restriction.

## Backup procedure

Back up three independent durability domains:

1. `state.db` using SQLite's online backup mechanism.
2. The content-addressed `objects/` directory.
3. Organization and Business private Git remotes.

Do not treat Git as a backup of SQLite. WorkItems, gates, approvals, finance, memory, market evidence, HumanRequests, and audit state are not reconstructed from repositories.

Do not include `secrets/` in ordinary backups. If provider credentials must be backed up, use a separate encrypted secret-management process with restricted recovery access.

Periodically perform a restore drill in an isolated `CULT4_HOME`:

- restore a copy of the SQLite database and object store;
- restore or clone registered repositories;
- verify privacy and SHAs;
- run `cult doctor` without autonomous work;
- confirm pending HumanRequests, gates, and audit history are intact.

## Upgrade procedure

Before upgrading:

1. Stop scheduled ticks.
2. Confirm no tick or repository writer lock is active.
3. Run `cult doctor` and resolve failures.
4. Back up SQLite and objects.
5. Record current Organization and Business SHAs.

Then install/build the new version and run:

```bash
npm install
npm run build
cult init
cult doctor
npm test
```

`cult init` applies ordered migrations and rematerializes seeded employees and tools idempotently. Resume scheduling only after diagnostics and deterministic tests pass. Run `npm run test:live` when provider integration changed or when validating a new deployment credential; it spends real credits.

## Incident response

When a consequential action, credential, repository, or business is suspect:

1. Stop scheduled ticks and prevent new external adapter execution.
2. Pause the affected business through an explicit administrative change.
3. Preserve SQLite, audit, object, repository, and external-reference evidence.
4. Revoke affected external credentials using the provider's control plane.
5. Identify exact WorkItems, action intents, gates, approvals, commits, and adapter idempotency keys involved.
6. Reconcile external state with commitments and transaction records without fabricating success.
7. Create corrective WorkItems and a durable postmortem.
8. Reevaluate every changed subject version before resuming.

Do not delete audit rows or rewrite repository history to make state appear clean. A Git rollback produces a new subject version and therefore triggers policy reevaluation and new approvals where applicable.

## External adapter activation

The repository's external layers are simulation-safe. Before enabling a real payment, marketplace, account, publication, dataset, or shipping adapter, verify that it:

- accepts only authorized structured intents;
- uses an idempotency key;
- returns a durable external reference before Cult4 records success;
- filters secret-bearing errors and responses;
- has a reconciliation procedure;
- fails closed on ambiguous provider results;
- starts with a deliberately small loss-tolerant limit;
- routes paid research through normal SpendRequests;
- cannot bypass human, finance, market, IP, physical, or QA gates.

There is no direct-payment or direct-publication fallback when the broker blocks.
