# Cult4 TODO

## Findings from the live Mercator audit — 2026-08-24

These findings concern Cult4 orchestration. Mercator was still running when the
snapshot was taken, so unfinished implementation and incomplete QA coverage are
not considered failures by themselves.

### Task-graph integrity

- [ ] Make multi-step WorkItem creation atomic or explicitly abortable. A failed
      first attempt to create the Mercator plan left ten orphaned `PROPOSED`
      WorkItems with no request links; the successful retry created a second,
      correctly linked set.
- [ ] Add idempotency or semantic duplicate detection to WorkItem creation and
      retry. Reusing or repairing an existing draft must be preferred over
      silently creating another WorkItem with the same business scope and title.
- [ ] Provide a deterministic batch graph-building tool that returns all created
      WorkItem IDs and can create dependencies and request links in one
      transaction. Agents should not have to recover IDs from conversation logs.
- [ ] Add a cleanup path that marks abandoned partial graph attempts `CANCELLED`
      with an audit reason instead of leaving them indefinitely `PROPOSED`.

### Contract-to-work coverage

- [ ] Add a planning gate requiring every committed `MUST` official request to
      be linked to at least one active WorkItem before autonomous execution of
      the business plan proceeds. At the audit snapshot, all 36 requests were
      linked to the confirmed mandate, but only 25 were linked to WorkItems.
- [ ] Prevent a newly generated subplan from overlapping existing `READY` work.
      During the root `Build Mercator` turn, the Operator created repository,
      Opportunity Engine, Experiment Manager, Scale/Kill, and connector tasks
      while similarly scoped WorkItems already existed in the active graph.
- [ ] Require final QA to prove coverage of every committed request, including
      cross-cutting requirements such as non-catalog behavior, real-market
      observation, full landed cost, genuine automation, external voice,
      messages/learning, human physical operations, quality bar, success
      definition, and anti-objectives.

### Parent lifecycle and scheduling

- [ ] Give `BUSINESS_FOUNDATION` an explicit decomposition/roll-up lifecycle.
      Its implementation child completed and passed independent QA, but the root
      returned to `RUNNING` and began creating another overlapping subplan.
- [ ] Require generated implementation and QA WorkItems to reference their
      owning parent. Most of the active Mercator plan currently relies on
      dependencies but has no `parent_id`, which makes roll-up and duplicate
      detection ambiguous.
- [ ] Define when a planning/root WorkItem is complete versus when it should
      remain a durable umbrella. The scheduler must not execute an umbrella as
      if it were another leaf implementation task.

### Efficiency and assurance

- [ ] Reduce repeated authoritative-context payloads between Operator and QA.
      The first implementation and QA runs consumed roughly 77k and 91k input
      tokens respectively despite covering only the initial foundation slice.
- [ ] Add an assurance check that configurable business rules are not replaced
      by constants in engine implementations. In particular, future QA should
      inspect scoring normalizers and commercial thresholds, not only grep for
      product or category names.
- [ ] Add regression tests reproducing the observed sequence: partial graph
      creation failure, retry with recovered IDs, request linking, autonomous
      scheduling, child QA completion, and parent roll-up without duplicate work.

### Specialized employees and organizational learning

- [x] Add a permanent Builder with software-engineering responsibility, a
      maintained Skill, and implementation permissions distinct from Operator
      and QA.
- [x] Persist required capabilities on WorkItems, route new work to an active
      operationally equipped specialist, and reject Operator substitution.
- [x] Enforce role-specific OpenCode permissions: Operator coordinates without
      editing or shell access; Builder implements; QA tests without editing;
      research roles gather evidence without modifying the product.
- [x] Reserve recurring execution capacity for employee practice development:
      every four measured runs and every failure schedule postmortem and
      evidence-backed Skill/tool/playbook/method improvement work.
- [ ] Add independent evaluation and promotion workflows that turn approved
      improvement proposals into versioned organizational assets, compare the
      new method against prior performance, and roll back regressions.
- [ ] Track calibrated performance by Employee, capability, method version, and
      Business so future routing prefers demonstrated expertise rather than a
      static role label.

### Positive controls to preserve

- [ ] Preserve the behavior already observed working: exact confirmed mandate,
      request-linked WorkItems, Git commit by the trusted host, detached
      independent QA against the exact SHA, clean repository synchronization,
      resumable bounded autopilot, and visible live execution.
