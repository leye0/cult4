# Cult4 — Cultural & Market Intelligence
## Integration Specification for the Existing Cult4 V1

> **Status:** GO/NO-GO V1 requirement  
> **Purpose of this document:** integrate Cultural & Market Intelligence into the existing Cult4 architecture **without creating a parallel subsystem, a second workflow engine, or a new orchestration layer**.

---

# 0. Why this document exists

The previous `CULT4_CULTURAL_MARKET_INTELLIGENCE_SPEC.md` described the behavior that Cult4 must eventually exhibit:

- study real human preferences;
- inspect Reddit and other communities;
- identify memes, tropes, aesthetics, language, fatigue, backlash and cultural lifecycle;
- distinguish cultural popularity from commercial opportunity;
- produce fresh market studies;
- feed evidence into strategy and creative work;
- prevent AI-generated generic slop;
- keep monitoring the market after launch.

That specification is correct in intent, but it is **not sufficient as an implementation document for a codebase that is already being finished**.

The implementation MUST NOT create a new independent “market intelligence system” alongside Cult4.

Instead, it must extend the primitives that already exist in the main Cult4 specification:

```text
Employee
Responsibility
WorkItem
Policy
Gate
Approval
Evidence
Source
Claim
Decision
Experiment
Metric
Memory
HumanRequest
Artifact
Business
Product
```

The Market Intelligence feature must therefore be implemented as:

```text
existing Cult4 primitives
+
a very small number of market-specific records
+
one core policy
+
one permanent Employee seed
+
several Skills/Tools
+
new acceptance tests
```

The feature is successful only if it feels like **Cult4 learning a new institutional responsibility**, not like a plugin bolted beside it.

---

# 1. Architectural rule

The implementation rule is:

> **Do not create a separate cultural-intelligence orchestrator.**

OpenCode remains the agent runtime.

Cult4 remains the Foundation.

The Cultural & Market Intelligence Analyst is simply another permanent Cult4 Employee operating through the same mechanisms as QA, Treasurer, Strategist and Researcher.

The flow must use the existing:

```text
WorkItem graph
Responsibility ownership
Policy engine
Gate resolution
Evidence engine
Memory scopes
HumanRequest system
Employee bootstrap
OpenCode adapter
Git discipline
Audit trail
```

No new scheduler.

No new daemon.

No custom queue.

No second SQLite database.

No separate “trend engine” service.

No standalone agent runtime.

---

# 2. Mapping to the main Cult4 specification

This feature extends the following existing Cult4 specs directly.

## 2.1 Evidence

Extends:

```text
Spec 15 — Evidence Engine
Spec 16 — hierarchy of evidence
Spec 17 — books and business corpus
Spec 18 — reconstructible decisions
Spec 19 — hypotheses and experiments
```

Market intelligence data MUST be stored using the existing:

```text
Source
Evidence
Claim
Decision
```

primitives.

Do not invent:

```text
RedditEvidence
TikTokEvidence
MarketplaceEvidence
```

as separate top-level evidence systems.

Platform/source type is metadata on `Source` / `Evidence`.

---

## 2.2 Work orchestration

Extends:

```text
Spec 20 — WorkItem
Spec 21 — Responsibility / Capability / Assignment / Authority
Spec 22 — persistent Responsibilities
Spec 23 — Gates
Spec 24 — deterministic Policy Engine
Spec 25 — dynamic workflows, fixed obligations
```

Market research is performed through WorkItems.

The Market Intelligence Analyst owns a responsibility.

The Foundation derives a required gate for culturally sensitive commercial work.

The agents decide how to perform the research.

The Foundation decides whether sufficient institutional obligations exist before progression.

---

## 2.3 Human participation

Extends:

```text
Spec 29–33 — HumanRequest
```

Market Intelligence may request human cultural judgment when needed.

The same persistent HumanRequest system is used.

No market-specific ask mechanism.

A missing human response blocks only dependent branches.

Timeout never means approval.

---

## 2.4 Creative/IP pipeline

Extends:

```text
Spec 45 — provenance
Spec 46 — human AI-art approval
Spec 47 — hash-bound approval
Spec 48–50 — IP responsibility and clearance
Spec 56 — combined physical artistic release gates
Spec 57 — generic policies
```

Market relevance is an **additional independent gate**.

It does not replace:

```text
HUMAN_CREATIVE_APPROVAL
IP_CLEARANCE
DIGITAL_QA
PHYSICAL_SAMPLE_APPROVAL
SUPPLIER_QUALIFICATION
FINANCIAL_APPROVAL
```

---

## 2.5 Dynamic business structure

Extends:

```text
Spec 58 — dynamic business structure
Spec 59 — Operator can evolve organization
Spec 60 — business-local policies
```

The Market Intelligence Analyst is a seeded permanent employee because Cult4 V1 explicitly requires this capability.

Future businesses may add specialized analysts or local Skills without changing Cult4 core.

---

## 2.6 OpenCode/runtime

Extends:

```text
Spec 61–73
```

OpenCode performs:

```text
web research
subagent delegation
tool usage
context handling
session execution
```

Cult4 does NOT implement those capabilities itself.

The Market Intelligence Analyst is materialized as a standard Cult4/OpenCode Employee.

---

## 2.7 Data ownership

Extends:

```text
Spec 74 — SQLite authoritative operational state
Spec 75 — relational V1 schema
Spec 76 — explicit SQL + Zod
Spec 77 — code budget
```

Market studies and current signals are SQLite state.

Long research reports MAY be stored as versioned artifacts or object-store documents if useful.

The structured claims required by policies remain in SQLite.

---

## 2.8 Sticker V1 acceptance test

Extends:

```text
Spec 78 — sticker business integration test
```

The sticker acceptance test is now incomplete unless it includes:

```text
fresh cultural/market study
→ opportunity analysis
→ CreativeBrief
→ design
→ human creative approval
→ IP
→ QA
→ sample
→ physical human QA
→ supplier qualification
→ finance
→ release
```

---

# 3. New permanent Employee

Add one seeded Employee during **Phase 6 — Employee model and OpenCode materialization**.

Canonical ID:

```text
cultural-market-intelligence
```

Display name:

```text
Cultural & Market Intelligence Analyst
```

Short UI name may be:

```text
Market Intelligence Analyst
```

This is a permanent Employee, not an ephemeral subagent.

Reason:

- the role benefits from accumulated knowledge;
- it learns communities and platform biases;
- it maintains research Skills and tools;
- it develops better sampling methods;
- it remembers which cultural hypotheses succeeded or failed;
- it accumulates postmortems;
- it becomes cheaper and more reliable over time.

The Employee session remains disposable.

The Employee identity and accumulated organizational capital remain persistent.

---

# 4. Employee charter

Create the Employee using the standard Employee mechanism.

The bootstrap/charter should remain concise.

Example conceptual charter:

```text
You are Cult4's Cultural & Market Intelligence Analyst.

You are institutionally responsible for understanding
the current human market and cultural context relevant
to Cult4 businesses.

You do not treat model memory as current market evidence.

You research real human behavior, language, preferences,
communities, memes, tropes, aesthetics, commercial signals,
saturation, backlash and market gaps.

You preserve source provenance, freshness, contradictions
and uncertainty.

You distinguish cultural popularity from willingness to pay
and from actual commercial opportunity.

You may delegate research subtasks to temporary subagents.

You maintain and improve your research Skills, tools and
playbooks through the normal Organization Maintenance flow.

You do not approve strategy, IP, artistic quality,
physical quality or financial spending unless separately
granted those responsibilities.
```

Do not put the entire cultural-research methodology into this prompt.

Methodology lives primarily in:

```text
Skills
playbooks
tools
organization knowledge
```

and is loaded only when relevant.

---

# 5. New Responsibility records

Seed these Responsibilities using the existing Responsibility model.

Required V1 responsibility:

```text
CULTURAL_MARKET_INTELLIGENCE
```

Assign it to:

```text
cultural-market-intelligence
```

This responsibility means:

> accountable for producing and maintaining current evidence about the human market/cultural context used by the business.

Optional named sub-responsibilities may be represented as capabilities rather than additional Foundation concepts:

```text
trend-monitoring
customer-language-analysis
marketplace-analysis
community-analysis
saturation-analysis
```

Do NOT create a giant responsibility taxonomy unless the runtime actually needs independent authority/gates for them.

The Foundation needs only the responsibility that can satisfy `MARKET_RELEVANCE`.

---

# 6. New Gate

Add one gate:

```text
MARKET_RELEVANCE
```

It is satisfied by the responsibility:

```text
CULTURAL_MARKET_INTELLIGENCE
```

But a simple human-like “PASS” is not enough.

The policy must verify that the subject references a valid MarketStudy meeting minimum structural requirements.

The gate therefore carries:

```text
subject
market_study_id
study_version/status
valid_until
```

The gate is not:

```text
"Analyst said looks good"
```

It is:

```text
A qualifying, current MarketStudy exists and
the responsible actor has signed off on its use
for this subject.
```

---

# 7. New core policy

Add one deterministic core policy to the existing `policy.ts`.

Canonical ID:

```text
MARKET_RELEVANCE_REQUIRED
```

Suggested logic:

```ts
if (
  subject.commercial === true &&
  (
    subject.creative === true ||
    subject.cultureSensitive === true ||
    subject.trendSensitive === true ||
    subject.identitySensitive === true
  )
) {
  requireGate("MARKET_RELEVANCE");
}
```

This should be intentionally boring.

The policy does NOT decide:

- which subreddit to inspect;
- which marketplace to search;
- how many posts to sample;
- what is trending;
- whether bundles are better;
- which aesthetic to use.

The policy only guarantees:

> current human-market evidence is mandatory before the relevant progression.

---

# 8. Where the Gate applies

Do NOT attach `MARKET_RELEVANCE` only at final release.

That would be too late.

The primary gate should block the transition into **serious creative execution**.

For a creative/culture-sensitive commercial initiative:

```text
DISCOVERY
→ MARKET_RESEARCH
→ STRATEGY
→ DESIGN_READY
```

`DESIGN_READY` requires `MARKET_RELEVANCE`.

This prevents the system from spending design/tooling effort on a purely LLM-invented cultural premise.

A second freshness check should occur before major spend/release if the study has expired.

Thus there are two practical checks:

```text
1. Before design commitment:
   require fresh MarketStudy

2. Before major investment/release:
   re-check MarketStudy freshness
```

Do not create two different gate types unless necessary.

The same `MARKET_RELEVANCE` gate can be reevaluated against freshness.

---

# 9. Subject classification

Cult4 already intends to derive policy requirements from subject attributes rather than hardcoded business types.

Add or standardize these booleans/classifications on the relevant subject representation:

```text
commercial
creative
culture_sensitive
trend_sensitive
identity_sensitive
physical
ai_generated
outsourced_manufacturing
```

For the sticker V1 scenario:

```text
commercial = true
creative = true
culture_sensitive = true
trend_sensitive = potentially true
identity_sensitive = potentially true
physical = true
ai_generated = likely true
outsourced_manufacturing = true
```

Do NOT write:

```ts
if (business.type === "stickers")
```

The same policy must work for t-shirts, posters, mugs, digital art, brand campaigns, etc.

---

# 10. New structured record: MarketStudy

This is one of the few market-specific tables justified in V1.

Add:

```sql
CREATE TABLE market_study (
  id TEXT PRIMARY KEY,

  business_id TEXT NOT NULL,
  initiative_id TEXT,

  target_segment TEXT NOT NULL,
  market TEXT NOT NULL,
  language TEXT,
  geography TEXT,

  research_question TEXT NOT NULL,

  status TEXT NOT NULL,
  -- draft | researching | complete | expired | invalidated

  confidence TEXT,
  -- low | medium | high

  analyst_employee_id TEXT NOT NULL,

  started_at TEXT NOT NULL,
  completed_at TEXT,
  valid_until TEXT,

  summary TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

The study itself is a container/anchor.

Detailed facts MUST continue using the existing Evidence Engine.

---

# 11. MarketStudy ↔ Evidence

Add a join table rather than duplicating evidence content:

```sql
CREATE TABLE market_study_evidence (
  market_study_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,

  role TEXT NOT NULL,
  -- supporting | contradicting | contextual | commercial
  -- saturation | cultural | risk | methodology

  PRIMARY KEY (market_study_id, evidence_id)
);
```

This is important.

A Reddit comment is still:

```text
Source → Evidence
```

not a row copied into a separate MarketStudy blob.

The study references Evidence.

The same Evidence can later support a Decision or Experiment.

---

# 12. New structured record: MarketSignal

Add one generic table instead of separate CulturalSignal, CommercialSignal, OpportunitySignal and CulturalTrope tables.

```sql
CREATE TABLE market_signal (
  id TEXT PRIMARY KEY,

  market_study_id TEXT NOT NULL,

  kind TEXT NOT NULL,
  -- cultural | commercial | opportunity | saturation | risk

  subtype TEXT,
  -- trope | phrase | aesthetic | complaint | purchase_intent
  -- review_velocity | gap | backlash | etc.

  title TEXT NOT NULL,
  description TEXT NOT NULL,

  lifecycle TEXT,
  -- emerging | rising | mainstream | saturated
  -- declining | dead | unknown

  confidence TEXT NOT NULL,

  observed_at TEXT,
  expires_at TEXT,

  created_at TEXT NOT NULL
);
```

Then link signals to Evidence:

```sql
CREATE TABLE market_signal_evidence (
  market_signal_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  PRIMARY KEY (market_signal_id, evidence_id)
);
```

This keeps the schema compact.

A trope is simply:

```text
kind = cultural
subtype = trope
```

A recurring phrase is:

```text
kind = cultural
subtype = phrase
```

A marketplace gap is:

```text
kind = opportunity
subtype = gap
```

A saturation observation is:

```text
kind = saturation
```

Do NOT build 15 specialized tables in V1.

---

# 13. New structured record: CreativeBrief

Add:

```sql
CREATE TABLE creative_brief (
  id TEXT PRIMARY KEY,

  business_id TEXT NOT NULL,
  initiative_id TEXT,

  market_study_id TEXT NOT NULL,

  strategist_employee_id TEXT NOT NULL,

  status TEXT NOT NULL,
  -- draft | ready | superseded | invalidated

  target_audience TEXT NOT NULL,
  desired_response TEXT,

  cultural_context TEXT NOT NULL,
  relevant_tropes TEXT,
  customer_language TEXT,
  aesthetic_territory TEXT,

  saturated_ideas_to_avoid TEXT,
  ip_danger_areas TEXT,
  commercial_constraints TEXT,

  valid_until TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

This is intentionally not a giant design-system schema.

The CreativeBrief is a durable structured handoff:

```text
Market Intelligence
→ Strategist
→ Designer
```

The Strategist remains responsible for interpreting evidence into strategy.

The Market Intelligence Analyst does NOT directly control creative strategy.

---

# 14. Do not duplicate CommunityMap in V1 unless needed

The previous cultural spec proposed a possible `CommunityMap`.

For the first finishable Cult4 V1:

**do not add a new table unless real implementation needs it.**

Initially community knowledge can live in:

```text
Source metadata
Evidence
scoped Knowledge/Memory
```

Example:

```text
scope = employee:cultural-market-intelligence
kind = procedure/verified_fact
```

If maintaining hundreds of communities later becomes painful, add `community` as a V2 optimization.

This keeps the first version small.

---

# 15. Do not add a trend database service

Trend state lives in:

```text
market_signal.lifecycle
market_signal.observed_at
market_signal.expires_at
Evidence
```

No background trend microservice.

No separate timeseries DB.

If historical signal comparison becomes valuable, store successive signal rows and query them.

SQLite is enough for V1.

---

# 16. Source integration

Use the existing `source` table.

Add source-type values if the current implementation uses an enum/check constraint:

```text
reddit
forum
marketplace_listing
marketplace_review
social_post
social_comment
search_trend
official_statistics
book
academic
blog
news
internal_business_data
customer_feedback
```

Do not introduce a separate table for every platform.

Platform-specific metadata can live in:

```text
metadata_json
```

if that pattern already exists.

Required social provenance when available:

```text
platform
url/id
publication date
retrieved_at
community/thread
content type
language
geography if known
```

---

# 17. Evidence types

Use existing Evidence.

If Evidence already has `kind`, extend allowed values only if necessary.

The critical distinction is epistemic status:

```text
OBSERVED
ESTIMATED
INFERRED
UNKNOWN
```

This can be:

```text
evidence.observation_type
```

or existing metadata.

Do not create a second Evidence model.

Example:

```text
342 reviews
→ OBSERVED

seller probably earns $12k/month
→ ESTIMATED

this aesthetic appears saturated
→ INFERRED
```

The Analyst must preserve these distinctions.

---

# 18. Claims

Use the existing `Claim`.

Examples:

```text
Generic "plant mom" language appears culturally saturated.
Collector self-deprecation is currently active in houseplant communities.
Bundle discussions show stronger gift intent than single-item discussions.
```

Claims must point to Evidence.

No cultural conclusion should exist only inside a markdown report.

---

# 19. Decisions

Use the existing `Decision`.

The Strategist consumes MarketStudy + Claims + Signals.

Example:

```text
Decision:
Test collector-humor sticker bundles.

Evidence:
E1, E2, E8, E14

Counter evidence:
E9, E11

Uncertainty:
actual willingness to pay unknown

Decision type:
EXPERIMENT
```

Do not introduce `MarketDecision`.

---

# 20. Experiments

Use the existing:

```text
Hypothesis
Experiment
Metric
```

A MarketStudy does NOT authorize a full launch merely because it found an attractive niche.

Expected flow:

```text
MarketStudy
→ strategic interpretation
→ hypothesis
→ experiment
→ business-specific data
```

Over time, the business’s own data becomes more important than external cultural inference.

---

# 21. Memory integration

Use the existing scoped Memory system.

When the Analyst works for Plant Goblin, bootstrap retrieval includes:

```text
organization knowledge
employee:cultural-market-intelligence
business:plant-goblin
employee_business:cultural-market-intelligence:plant-goblin
```

Examples of durable Employee know-how:

```text
Reddit comments reveal community language better than post titles.
Marketplace review velocity is only a weak sales proxy.
Subreddit X is useful for houseplant collector behavior.
```

Examples of temporary cultural facts:

```text
Meme X is rising.
Phrase Y is currently common.
Aesthetic Z is declining.
```

Temporary facts MUST have freshness/expiry metadata.

---

# 22. Promotion rules

Existing knowledge promotion rules apply.

Business-specific observation:

```text
Plant Goblin buyers prefer bundles.
```

stays business-scoped unless generalized evidence exists.

Methodological learning:

```text
When analyzing sticker niches, review text reveals gifting intent
more reliably than listing titles.
```

may become employee/organization knowledge after validation.

Never promote:

```text
"Meme X is hot"
```

into permanent timeless organizational knowledge.

---

# 23. Skill integration

Add initial Skills in the Organization repo, not in core TypeScript.

Suggested V1 Skills:

```text
market-study
reddit-community-research
marketplace-research
counter-signal-research
cultural-language-analysis
creative-brief-preparation
```

These are not required to be six separate files if a smaller decomposition is cleaner.

A minimal initial set could be:

```text
market-study
community-research
marketplace-research
```

The Employee may split them later through Organization Maintenance.

Core rule:

> methodology belongs in Skills; institutional obligations belong in Policy code.

---

# 24. Tool integration

Do not build a giant scraping framework before V1.

Use OpenCode/web capabilities and existing integrations first.

Tools may later emerge for repeated tasks:

```text
reddit sampling
comment extraction
listing sampling
price distribution
phrase frequency
cross-platform comparison
```

But tools must follow the existing Tool lifecycle:

```text
experimental
→ tested
→ reviewed
→ Organization Maintenance
→ committed/pushed
→ available organization-wide
```

The Market Intelligence feature does NOT get a bypass around Organization Git discipline.

---

# 25. OpenCode subagents

The permanent Analyst may delegate temporary research tasks:

```text
Cultural & Market Intelligence Analyst
    ├── Reddit research subagent
    ├── marketplace research subagent
    ├── competitor research subagent
    └── trend research subagent
```

These are disposable OpenCode subagents.

Their findings are NOT authoritative merely because they came from a subagent.

The permanent Analyst must consolidate them into:

```text
Source
Evidence
Claim
MarketSignal
MarketStudy
```

before the work is considered durable.

---

# 26. WorkItems to add

Do not add a custom workflow engine.

Use ordinary WorkItems with conventional types.

Recommended V1 types:

```text
MARKET_STUDY
MARKET_STUDY_REFRESH
CREATIVE_BRIEF
MARKET_MONITORING
```

These types are data values, not subclasses.

The same generic `work_item` table and dependency graph are used.

Examples:

```text
MARKET_STUDY
depends on:
  initiative exists

CREATIVE_BRIEF
depends on:
  MarketStudy COMPLETE
  MARKET_RELEVANCE gate satisfiable

DESIGN
depends on:
  CreativeBrief READY
```

---

# 27. Initial creation flow

When user says:

```text
Create an autonomous sticker business.
```

The Operator should classify the initiative:

```text
commercial = true
creative = true
culture_sensitive = true
physical = true
outsourced_manufacturing = likely true
```

The Policy Engine evaluates the future transition toward design and derives:

```text
MARKET_RELEVANCE required
```

The Operator creates:

```text
WorkItem: MARKET_STUDY
assigned/resolved to:
Cultural & Market Intelligence Analyst
```

It must NOT jump directly to Designer.

---

# 28. MarketStudy completion contract

A `MARKET_STUDY` WorkItem cannot become `DONE` simply because the Analyst wrote a report.

Completion requires structurally:

```text
MarketStudy.status = COMPLETE
completed_at != null
valid_until != null
target_segment != null
market != null
research_question != null

>= 1 source
>= meaningful Evidence records

signals include:
  cultural
  commercial OR explicit commercial UNKNOWN
  saturation
  opportunity OR explicit no-opportunity conclusion

counter-signal evidence exists OR explicit documented search with none found

confidence recorded
limitations/unknowns recorded
```

Do not hardcode arbitrary sample counts.

The requirement is methodological completeness, not a magic number.

---

# 29. Gate satisfaction contract

`MARKET_RELEVANCE` is satisfiable only when:

```text
study exists
study.status == COMPLETE
now <= study.valid_until
study target/market applies to the subject
responsible Analyst approval exists
required evidence structure is present
```

If any fails:

```text
MARKET_RELEVANCE = UNSATISFIED
```

---

# 30. Freshness

Use MarketStudy validity in the deterministic Policy/Gate layer.

The Employee may choose/recommend validity based on market speed.

Foundation can enforce maximum default bounds if desired.

Example methodology defaults:

```text
fast meme market       ~7 days
viral aesthetic        ~14 days
fashion/aesthetic      ~30 days
creative hobby         ~60 days
slower consumer niche  ~90 days
slow B2B              ~180 days
```

These values belong in configurable policy defaults, not scattered in prompts.

The agent may shorten validity.

It should not silently extend an expired study to avoid work.

---

# 31. Refresh

When an expired study is required:

```text
MARKET_RELEVANCE = UNSATISFIED
```

Operator creates:

```text
MARKET_STUDY_REFRESH
```

The refresh should preferentially reuse:

```text
old study
old sources
known communities
known signals
previous uncertainties
```

but obtain fresh evidence.

It should not rerun the entire research blindly unless justified.

---

# 32. Large-spend freshness check

Finance remains the authority for spending.

However, when a proposed spend is materially tied to a culture-sensitive creative strategy, the financial flow may add a dependency:

```text
fresh MARKET_RELEVANCE
```

Example:

```text
old MarketStudy
+
$2,000 ad/production expansion
```

should trigger refresh before Treasurer/human final authorization.

Do not move this logic into Treasurer prompt.

The WorkItem/policy graph must make the dependency explicit.

---

# 33. CreativeBrief flow

Once MarketStudy is complete:

```text
Market Intelligence Analyst
→ MarketStudy COMPLETE
```

Then:

```text
Strategist WorkItem
→ interpret study
→ record Decision/Hypothesis
→ create CreativeBrief
```

The Analyst does not bypass Strategist.

The CreativeBrief should reference:

```text
market_study_id
relevant claims
relevant signals
```

The Designer bootstrap receives the CreativeBrief.

---

# 34. Designer bootstrap integration

When Designer starts work on a creative item, bootstrap should retrieve:

```text
current WorkItem
CreativeBrief
MarketStudy summary
relevant MarketSignals
relevant Claims/Evidence references
business-specific creative knowledge
Designer Skills
```

It should NOT inject thousands of raw Reddit comments.

The Designer needs the synthesized evidence-backed brief, not the entire research corpus.

This is important for token efficiency.

---

# 35. Human Creative Approval

Nothing changes to the existing Human Creative policy.

Even with excellent Market Intelligence:

```text
MARKET_RELEVANCE PASS
```

does NOT imply:

```text
HUMAN_CREATIVE_APPROVAL PASS
```

For AI-generated visual art:

```text
human aesthetic approval remains mandatory
and bound to exact artifact hash.
```

The Market Intelligence Analyst cannot satisfy it.

---

# 36. IP integration

Market Intelligence may detect a culturally powerful copyrighted meme, character, logo or phrase.

It records:

```text
cultural signal
```

but the IP flow remains independent.

The CreativeBrief should include:

```text
ip_danger_areas
```

The Designer is expected to extract underlying cultural mechanisms, not copy protected expression.

Then the existing IP Reviewer performs:

```text
IP_CLEARANCE
```

No new copyright subsystem is required.

---

# 37. Physical-product integration

Nothing changes to physical-product policies.

For stickers:

```text
MarketStudy
→ CreativeBrief
→ Design
→ Human Creative Approval
→ IP Clearance
→ Digital QA
→ Supplier Selection
→ Sample Order
→ Human Physical QA
→ Supplier Qualification
→ Financial Review
→ Release
```

Cultural Intelligence is simply the missing first institutional gate.

---

# 38. Git integration

Market studies are primarily operational/evidence state.

Do NOT commit every raw Reddit result into Git.

Use:

```text
SQLite:
Source
Evidence
Claim
MarketStudy
MarketSignal
Decision

Git/Object artifacts:
optional human-readable final reports
playbooks
Skills
tools
employee charter improvements
```

If a MarketStudy report is versioned in a Business repo:

```text
it follows normal Git discipline
→ commit
→ push
→ SHA
```

But release approval should rely on structured MarketStudy state + exact creative/code/artifact versions, not merely on the presence of a markdown report.

---

# 39. Organization Git integration

If the Analyst learns a durable new method and improves:

```text
organization/skills/market-study/
organization/tools/...
employees/cultural-market-intelligence/...
```

that work MUST go through the existing Organization Maintenance pipeline:

```text
clean organization repo
→ exact base SHA
→ maintenance session
→ tests/evals
→ Cult4 commit
→ clean postcondition
→ push private remote
→ SQLite organization SHA update
```

The normal Business session has Organization repo read-only.

No exception.

---

# 40. QA Git integration

Market Intelligence does not replace Git QA.

If the Builder later creates software/assets in a Business repo:

```text
Builder
→ exact commit SHA
→ detached QA worktree
→ QA PASS/FAIL on exact SHA
```

Still required.

`MARKET_RELEVANCE` is about whether the work should exist and fits the human market.

`RELEASE_QUALITY` is about whether the produced implementation is correct.

They are independent.

---

# 41. `cult tick` integration

Do not add special Market Intelligence scheduling code.

Existing `cult tick` algorithm remains:

```text
process HumanRequests
reevaluate blocked WorkItems
find READY work
rank
resolve Employee
run OpenCode
record result
repeat
```

Because `MARKET_STUDY` and `MARKET_MONITORING` are ordinary WorkItems, they naturally participate.

The only addition is that persistent responsibility may generate monitoring WorkItems periodically or when triggers occur.

---

# 42. Persistent responsibility / monitoring

`CULTURAL_MARKET_INTELLIGENCE` is a persistent Responsibility.

The Employee can create work when:

```text
MarketStudy expires
major spend proposed
new product line proposed
new geography proposed
sales decline unexpectedly
major competitor appears
significant cultural backlash emerges
trend changes materially
```

For V1, do not build a continuous web-monitoring daemon.

Use:

```text
cult tick
+
scheduled WorkItems
+
explicit refresh triggers
```

Keep it simple.

---

# 43. Scheduling V1

A lightweight implementation can create:

```text
MARKET_MONITORING
```

WorkItems with:

```text
not_before
```

or whatever scheduling field the existing WorkItem model supports.

If the current WorkItem model has no scheduling field yet, do NOT add a general-purpose cron framework just for this.

V1 can generate refresh work when:

- `cult tick` notices expiry;
- relevant new initiative starts;
- Strategist/Operator requests refresh;
- finance/release policy finds stale evidence.

Continuous monitoring is not required to finish the first version.

The **ability to refresh and block on stale data is required**.

---

# 44. HumanRequest integration

Use existing HumanRequest.

New possible request types do not require a new table.

Examples:

```text
CULTURAL_JUDGMENT
LOCAL_LANGUAGE_JUDGMENT
BRAND_RISK_JUDGMENT
```

These can be values in existing type/category fields.

Example:

```text
Question:
Does this Quebec French slogan actually sound natural/funny?

Requested responsibility:
human_cultural_judgment

Blocking:
CreativeBrief finalization
```

If user is unavailable:

```text
WAITING_HUMAN
```

Only dependent branch blocks.

No timeout approval.

---

# 45. Business geography/language

MarketStudy must bind itself to:

```text
market
language
geography
target_segment
```

This matters because:

```text
US internet trend
≠ Quebec customer preference
```

The Gate must verify applicability.

A MarketStudy for:

```text
English-speaking US houseplant hobbyists
```

must not silently satisfy a product targeting:

```text
French-speaking Quebec plant hobbyists
```

unless Strategist/Analyst explicitly determines applicability and records it.

---

# 46. Evidence hierarchy integration

Keep the main Cult4 evidence philosophy.

For claims about current culture:

```text
current direct community observation
may be more relevant than old business literature
```

For claims about pricing economics:

```text
business data / experiments / economic literature
may be more relevant than Reddit
```

Therefore do NOT hardcode one universal ranking.

The Market Intelligence Skill should teach source fitness by claim type.

The Evidence Engine stores provenance and type; the responsible Employee interprets applicability.

---

# 47. Reddit implementation requirements

The system must not treat:

```text
"searched Reddit"
```

as sufficient.

A MarketStudy using Reddit should record methodology metadata such as:

```text
subreddits/communities searched
query themes
time window
approximate sample size
posts vs comments
limitations
```

This can be stored:

- in MarketStudy summary/methodology field;
- as an Artifact report;
- or in Evidence metadata.

Do not create a Reddit-specific database unless required later.

---

# 48. Counter-signal requirement

MarketStudy completion requires one of:

```text
contradicting Evidence exists
```

or:

```text
explicit record that counter-signal search was performed
and none material was found.
```

This prevents a purely confirmatory LLM research flow.

Recommended schema addition if needed:

```text
market_study.counter_signal_summary TEXT
```

or store it in the MarketStudy report.

The Foundation only needs to know the requirement was fulfilled.

---

# 49. Saturation requirement

MarketStudy must include at least one saturation conclusion.

Represent it as:

```text
market_signal.kind = saturation
```

with Evidence.

Possible claims:

```text
generic botanical icons are saturated
collector humor has medium saturation
specific aesthetic is rising but already crowded
```

If saturation cannot be measured:

```text
UNKNOWN
```

is valid.

Missing analysis is not.

---

# 50. Commercial signal requirement

The study must not infer commercial opportunity from cultural activity alone.

It must include:

```text
market_signal.kind = commercial
```

or explicit:

```text
commercial signal UNKNOWN
```

Possible evidence:

```text
marketplace reviews
purchase discussion
search behavior
pricing persistence
internal conversion data
seller/product proxies
```

If UNKNOWN, Strategist should generally choose a cheap validation experiment.

---

# 51. Opportunity signal

Opportunity signal is an interpretation built from:

```text
cultural relevance
commercial evidence
saturation
product fit
risk
```

It should not be a magical numeric score unless there is a defensible method.

Prefer structured labels + evidence.

Example:

```text
Cultural relevance: HIGH
Commercial evidence: MEDIUM
Saturation: MEDIUM
IP risk: LOW
Product fit: HIGH

Opportunity conclusion:
PROMISING FOR LOW-COST VALIDATION
```

---

# 52. Cultural lifecycle

`market_signal.lifecycle` is optional for signals where it makes sense.

Allowed values:

```text
EMERGING
RISING
MAINSTREAM
SATURATED
DECLINING
DEAD
UNKNOWN
```

Do not require lifecycle for every complaint or phrase.

Use it for memes, tropes, aesthetics and fast-moving themes.

---

# 53. Freshness in Memory retrieval

Update `memory.ts` retrieval ranking if necessary so culture-sensitive queries prefer:

```text
non-expired
recent
business-relevant
market-relevant
```

records.

Do not delete old cultural records automatically.

Historical information is useful for postmortems.

But the bootstrap should not present stale cultural facts as current without an expiration warning.

---

# 54. Employee performance

Reuse existing Employee performance mechanisms.

Do not create a new analytics service.

Possible Market Intelligence outcomes:

```text
opportunities later validated
false-positive opportunities
saturation correctly detected
research freshness
useful customer-language insights
research cost
```

These can initially be recorded as postmortem/experience entries, not a complex KPI engine.

---

# 55. Postmortems

When a culturally-informed experiment fails, create ordinary Cult4 postmortem knowledge.

Questions:

```text
Was the cultural signal real?
Was the audience wrong?
Was Reddit unrepresentative?
Was saturation underestimated?
Did people like the joke but not want merchandise?
Was the art weak?
Was pricing wrong?
Was the trend decaying?
Was the platform mismatched?
```

Useful methodological lessons may later be promoted to the Analyst’s Skills/playbooks.

---

# 56. Minimal module changes

The goal is to integrate by extending existing modules.

Expected changes:

```text
src/policy.ts
src/employee.ts
src/work.ts
src/evidence.ts
src/memory.ts
src/db.ts / migrations
src/opencode.ts or bootstrap builder
```

Optional small new module:

```text
src/market.ts
```

`market.ts` should contain only market-specific persistence/validation helpers such as:

```text
createMarketStudy()
completeMarketStudy()
getApplicableMarketStudy()
isMarketStudyFresh()
createMarketSignal()
createCreativeBrief()
```

Do NOT put orchestration, web crawling or agent logic in `market.ts`.

That belongs to Employee/OpenCode/Skills.

---

# 57. Suggested `market.ts` API

Keep it small:

```ts
createMarketStudy(input)
getMarketStudy(id)
listMarketStudies(businessId)

attachEvidenceToMarketStudy(studyId, evidenceId, role)

createMarketSignal(input)
linkSignalEvidence(signalId, evidenceId)

completeMarketStudy(studyId, completion)

findApplicableFreshMarketStudy(subject)

createCreativeBrief(input)
getCreativeBrief(id)
```

Maybe:

```ts
expireMarketStudies(now)
```

if useful.

Do not introduce classes unless current code style already uses them.

---

# 58. Tool surface exposed to agents

If Cult4 exposes internal custom tools, add only high-value operations.

Possible additions:

```text
cult4_create_market_study
cult4_add_market_signal
cult4_complete_market_study
cult4_get_market_study
cult4_create_creative_brief
```

But first check whether existing generic tools can already create structured records.

If:

```text
cult4_record_evidence
cult4_record_decision
cult4_update_work
```

plus a generic `cult4_get_state` are enough, only add tools that reduce error or enforce validation.

Do NOT balloon from ~12 tools to 40.

---

# 59. Bootstrap compiler changes

Employee bootstrap for the Market Intelligence Analyst should include:

```text
employee charter
current business
current WorkItem
target market/segment
relevant prior MarketStudies
fresh relevant memories
known communities/methodological knowledge
available Skills/tools
active Foundation policies
```

Strategist bootstrap should include:

```text
latest applicable MarketStudy
MarketSignals
key Claims
counter-signals
unknowns
```

Designer bootstrap should include:

```text
CreativeBrief
selected relevant MarketSignals/Claims
not raw research corpus
```

Treasurer bootstrap does not need all cultural research unless the spend decision depends on it.

This preserves token discipline.

---

# 60. OpenCode permissions

No special elevated permissions are required for Market Intelligence merely because it researches the web.

Organization repo remains read-only during Business research.

The Employee can use:

```text
web/browser/search tools available to OpenCode
business repo read/write only if the WorkItem needs report artifacts
Cult4 evidence tools
```

It cannot:

```text
edit Foundation
edit Organization Skills directly
bypass policy
access secrets
spend money without broker
```

---

# 61. Research cost

If external research incurs paid API/tool cost, that cost goes through existing Finance rules.

Do NOT allow the Market Intelligence Employee to silently buy datasets or subscribe to tools.

If a research method requires a paid service:

```text
SpendRequest
→ Treasurer/policy
→ Human if threshold requires
```

same as everything else.

---

# 62. No automatic copyright shortcut

Cultural Intelligence should explicitly surface:

```text
IP danger
```

but not decide final IP clearance unless it separately owns that Responsibility.

The existing IP Reviewer remains independent.

The same employee should not be allowed to both:

```text
propose copying a trend
and
independently clear its IP risk
```

unless Foundation explicitly allows it—which V1 should not.

---

# 63. Separation of duties

Recommended V1 separation:

```text
Market Intelligence Analyst
  owns current cultural/market understanding

Strategist
  owns business interpretation / strategy

Designer
  owns creative production

Human
  owns AI-art aesthetic approval

IP Reviewer
  owns IP clearance

QA
  owns release quality

Treasurer
  owns financial sanity

Human
  owns high-risk approvals / physical product judgment
```

This is exactly the institutional behavior Cult4 is meant to enforce.

---

# 64. Audit trail

Use existing append-only audit events.

Add event types only if useful:

```text
MARKET_STUDY_CREATED
MARKET_STUDY_COMPLETED
MARKET_STUDY_EXPIRED
MARKET_RELEVANCE_SATISFIED
MARKET_RELEVANCE_BLOCKED
CREATIVE_BRIEF_CREATED
```

Avoid logging every web query.

The detailed methodology belongs to the study/report/Evidence records.

---

# 65. Git/Organization version provenance

When an Analyst performs a MarketStudy, record the Organization SHA in the same way as other employees.

This allows reconstruction:

```text
MarketStudy X
was produced using
organization version orgSHA
```

If later the market-research Skill changes, historical studies remain attributable to the method version used at the time.

This uses the Git integration already specified in `CULT4_GIT_QA_PIPELINE_SPEC.md`.

No new mechanism.

---

# 66. Schema migration order

Implement migrations in this order:

1. Add `market_study`.
2. Add `market_study_evidence`.
3. Add `market_signal`.
4. Add `market_signal_evidence`.
5. Add `creative_brief`.
6. Add indexes.
7. Seed Responsibility.
8. Seed Employee.
9. Seed core policy metadata/version if policies are registered in DB.
10. Add/adjust subject classification fields only if not already present.

Suggested indexes:

```sql
CREATE INDEX idx_market_study_business
ON market_study(business_id);

CREATE INDEX idx_market_study_valid_until
ON market_study(valid_until);

CREATE INDEX idx_market_signal_study
ON market_signal(market_study_id);

CREATE INDEX idx_creative_brief_study
ON creative_brief(market_study_id);
```

Do not over-index V1.

---

# 67. Validation schemas

Add Zod schemas consistent with the existing code style.

At minimum:

```text
MarketStudyCreate
MarketStudyComplete
MarketSignalCreate
CreativeBriefCreate
```

Validation should ensure:

```text
valid_until > completed_at
confidence in allowed values
status transitions valid
required strings nonempty
signal kind allowed
```

Do not put market intelligence reasoning inside Zod.

---

# 68. Policy validation helper

`findApplicableFreshMarketStudy(subject)` should verify applicability.

Suggested matching:

```text
business_id matches
target segment compatible
geography compatible
language compatible where material
subject date <= valid_until
status == COMPLETE
```

If applicability is ambiguous, return unsatisfied and create/require analysis rather than silently matching.

---

# 69. MarketStudy status transitions

Allowed:

```text
DRAFT → RESEARCHING
RESEARCHING → COMPLETE
COMPLETE → EXPIRED
COMPLETE → INVALIDATED
EXPIRED → replaced by new study
INVALIDATED → replaced by new study
```

Avoid:

```text
EXPIRED → COMPLETE
```

by simply changing the date.

A refresh should create a new study or a clearly versioned replacement, preserving historical evidence.

---

# 70. CreativeBrief invalidation

A CreativeBrief should become invalid/superseded if:

```text
MarketStudy expires before design starts materially
target segment changes
geography changes
strategy changes materially
critical new IP/cultural risk appears
```

Do not automatically invalidate already-produced artwork merely because a trend study expired after production.

Instead, policy reevaluates freshness at later investment/release points.

---

# 71. What is hardcoded vs dynamic

Hardcoded deterministic Foundation:

```text
culture-sensitive commercial work requires MARKET_RELEVANCE
study must be complete
study must be applicable
study must be fresh
study must have provenance/evidence
counter-signal requirement exists
saturation analysis exists
commercial-signal analysis exists
```

Dynamic Employee methodology:

```text
which platforms
which communities
which search queries
sample size
how to cluster tropes
how to assess meme lifecycle
how to interpret aesthetics
how to compare marketplaces
which temporary subagents
```

This boundary MUST be preserved.

---

# 72. Phase integration into existing implementation plan

Do NOT add a separate giant “Phase 21”.

Integrate changes into the existing phases.

## Existing Phase 3 — Responsibility, Authority, Gate, Approval

Add:

```text
Responsibility:
CULTURAL_MARKET_INTELLIGENCE

Gate:
MARKET_RELEVANCE
```

Add gate satisfaction tests.

---

## Existing Phase 4 — Policy Engine

Add:

```text
MARKET_RELEVANCE_REQUIRED
```

Add classification-based derivation.

---

## Existing Phase 6 — Employee model

Seed:

```text
Cultural & Market Intelligence Analyst
```

Materialize as OpenCode agent.

---

## Existing Phase 8 — Memory

Add freshness-aware retrieval for volatile cultural facts.

Add/verify scopes used by Analyst.

---

## Existing Phase 9 — Evidence and Research discipline

This is where the bulk of the feature belongs.

Add:

```text
MarketStudy
MarketSignal
study ↔ Evidence links
counter-signal contract
saturation contract
commercial-signal contract
methodology metadata
```

Seed research Skills.

---

## Existing Phase 10 — Experiments and Metrics

Ensure MarketStudy recommendations become:

```text
Hypothesis
Experiment
Metric
```

rather than direct permanent business changes.

---

## Existing Phase 12 — Artifacts/hash/creative approval

Add CreativeBrief retrieval before Designer work.

No change to human art hash approval.

---

## Existing Phase 13 — IP

Ensure CreativeBrief carries `ip_danger_areas`.

No new IP engine.

---

## Existing Phase 14 — Physical goods

No new physical mechanism.

Update integration test ordering so Market Intelligence precedes creative production.

---

## Existing Phase 15 — Organization Maintenance

Enable Analyst to propose improved Skills/tools/playbooks.

All promotions follow Organization Git discipline.

---

## Existing Phase 16 — `cult tick`

No special scheduling engine.

Ensure expired required MarketStudies create/ready refresh work instead of letting downstream work progress.

---

## Existing Phase 17 — Sticker sandbox

Expand acceptance scenario to begin with Cultural/Market Intelligence.

This is mandatory.

---

# 73. Updated sticker scenario

The definitive V1 sticker flow is now:

```text
User:
"Create an autonomous sticker business."

↓
Operator creates Initiative

↓
subject classification:
commercial
creative
culture_sensitive
physical
outsourced_manufacturing

↓
Policy Engine:
MARKET_RELEVANCE required

↓
WorkItem:
MARKET_STUDY

↓
Cultural & Market Intelligence Analyst

Researches:
- Reddit/community language
- memes/tropes
- aesthetic signals
- complaints
- backlash/fatigue
- marketplaces
- pricing proxies
- commercial signals
- competitors
- saturation
- counter-signals
- IP danger areas

↓
Source / Evidence / Claim / MarketSignal
records created

↓
MarketStudy COMPLETE + valid_until

↓
MARKET_RELEVANCE satisfied

↓
Strategist
interprets evidence

↓
Decision / Hypothesis

↓
CreativeBrief

↓
Designer

↓
HUMAN_CREATIVE_APPROVAL
(bound to exact art hash)

↓
IP_CLEARANCE

↓
Builder / digital assets if needed
→ Git commit
→ private remote push
→ exact SHA

↓
QA detached worktree
→ exact SHA PASS/FAIL

↓
Supplier selection

↓
SpendRequest for sample if required

↓
Sample Order

↓
WAITING_EXTERNAL

↓
Human receives product

↓
HUMAN_PHYSICAL_SAMPLE_APPROVAL

↓
SUPPLIER_QUALIFICATION

↓
Treasurer final economics

↓
release candidate tied to exact SHA/assets

↓
all gates reevaluated
including MarketStudy freshness if relevant

↓
Launch

↓
Experiments + internal business data

↓
future MarketStudy refresh / monitoring
```

This is the V1 integration test.

---

# 74. Updated `cult doctor`

Do not turn `cult doctor` into a content-quality analyzer.

But add structural diagnostics if useful:

```text
Market Intelligence
✓ seeded Employee exists
✓ CULTURAL_MARKET_INTELLIGENCE responsibility has owner
✓ MARKET_RELEVANCE policy registered
✓ no COMPLETE MarketStudy missing valid_until
✓ no active culture-sensitive design WorkItem bypassing required gate
```

Do not have doctor crawl Reddit or judge whether a meme is actually trendy.

That is Employee work.

---

# 75. Failure modes that MUST block

## MI-001 — No MarketStudy

Creative/culture-sensitive commercial work wants `DESIGN_READY`.

Result:

```text
DENY
MARKET_RELEVANCE_MISSING
```

---

## MI-002 — Study expired

Result:

```text
DENY
MARKET_RELEVANCE_EXPIRED
```

Create/ready refresh WorkItem.

---

## MI-003 — Study has no evidence

Result:

```text
MarketStudy cannot COMPLETE
```

---

## MI-004 — Only internal LLM knowledge

If no external/internal-business Source/Evidence exists:

```text
MarketStudy cannot COMPLETE
```

---

## MI-005 — No saturation analysis

Result:

```text
MarketStudy incomplete
```

---

## MI-006 — No commercial signal analysis

Result:

```text
MarketStudy incomplete
```

Commercial signal may be explicitly UNKNOWN, but the analysis must exist.

---

## MI-007 — No counter-signal search

Result:

```text
MarketStudy incomplete
```

---

## MI-008 — Wrong geography/segment

A US English study cannot silently satisfy a Quebec French product.

Result:

```text
MARKET_RELEVANCE_NOT_APPLICABLE
```

---

## MI-009 — Trend high, IP dangerous

Market relevance may PASS.

IP Clearance fails independently.

Correct behavior:

```text
MARKET_RELEVANCE = PASS
IP_CLEARANCE = FAIL
release = DENY
```

---

## MI-010 — Market relevance PASS, AI art ugly

Human Creative Approval fails/rejects.

Correct behavior:

```text
release = DENY
```

---

# 76. Acceptance tests

Add these tests to the Foundation/eval suite.

## E21 — Creative work without MarketStudy

```text
creative + commercial + culture_sensitive
no study
→ DESIGN_READY denied
```

---

## E22 — Expired study

```text
study.valid_until < now
→ MARKET_RELEVANCE unsatisfied
```

---

## E23 — LLM-only study

```text
MarketStudy exists
Evidence count = 0
→ cannot COMPLETE
```

---

## E24 — No counter-signals

```text
supporting evidence exists
counter-signal requirement not fulfilled
→ cannot COMPLETE
```

---

## E25 — Cultural signal only

```text
cultural signal HIGH
commercial analysis missing
→ study incomplete
```

---

## E26 — Commercial signal explicitly unknown

```text
cultural signal HIGH
commercial signal UNKNOWN
saturation analyzed
counter-signals analyzed
→ study may COMPLETE
→ Strategist expected to propose low-cost validation
```

---

## E27 — Wrong geography

```text
study = US English
subject = Quebec French
no applicability decision
→ gate unsatisfied
```

---

## E28 — Copyrighted trend

```text
market relevance PASS
IP clearance FAIL
→ release denied
```

---

## E29 — Human creative rejection

```text
market relevance PASS
IP PASS
human art FAIL
→ production/publication denied
```

---

## E30 — Physical product still needs sample

```text
market relevance PASS
art PASS
IP PASS
digital QA PASS
no physical sample
→ commercial release denied
```

---

## E31 — Designer tries to bypass study

Designer/Operator says market study is unnecessary.

Policy still derives:

```text
MARKET_RELEVANCE
```

Result:

```text
DENY
```

---

## E32 — Study becomes stale before major expansion

```text
initial launch had fresh study
months pass
large creative expansion proposed
study expired
→ refresh required
```

---

# 77. Integration test with Git QA

Use one end-to-end test that also covers the Git supplement.

Example:

```text
1. Create Business.
2. Private remote exists.
3. MarketStudy completed.
4. MARKET_RELEVANCE satisfied.
5. CreativeBrief created.
6. Designer output human-approved.
7. IP PASS.
8. Builder modifies repo.
9. Cult4 creates commit BBB.
10. Push origin/main BBB.
11. SQLite repository SHA = BBB.
12. QA worktree detached at BBB.
13. QA PASS on BBB.
14. Worktree removed.
15. Builder creates CCC later.
16. Approval BBB cannot satisfy CCC.
17. MarketStudy expires.
18. New culturally-sensitive expansion blocked.
19. Refresh study.
20. QA/other gates continue normally.
```

This demonstrates Cultural Intelligence is integrated into the same institutional system.

---

# 78. Code-size guardrail

This feature should NOT add thousands of lines of orchestration code.

Expected deterministic-code footprint should be roughly:

```text
schema/migrations        modest
market.ts                a few hundred lines
policy additions         small
bootstrap additions      small
tests/evals              substantial
Skills/prompts            organizational assets
```

Most intelligence must live in:

```text
OpenCode Employee
Skills
Tools
Evidence
Memory
```

not TypeScript business logic.

If implementation starts creating:

```text
TrendScheduler
RedditOrchestrator
CulturalPipelineEngine
PlatformAdapterFramework
ResearchWorkflowRuntime
```

STOP.

That is Cult5 starting to happen.

---

# 79. Concrete implementation checklist

The coding agent should complete these in order.

## Database

- [ ] Add `market_study`.
- [ ] Add `market_study_evidence`.
- [ ] Add `market_signal`.
- [ ] Add `market_signal_evidence`.
- [ ] Add `creative_brief`.
- [ ] Add minimal indexes.
- [ ] Add any missing classification attributes on initiative/product/subject.
- [ ] Add migrations and migration tests.

## Employee / responsibilities

- [ ] Seed `cultural-market-intelligence`.
- [ ] Seed `CULTURAL_MARKET_INTELLIGENCE`.
- [ ] Assign responsibility to employee.
- [ ] Materialize employee as OpenCode agent.
- [ ] Ensure Organization SHA is included in bootstrap provenance.

## Policy / gates

- [ ] Add `MARKET_RELEVANCE`.
- [ ] Add `MARKET_RELEVANCE_REQUIRED`.
- [ ] Implement subject classification matching.
- [ ] Implement MarketStudy applicability/freshness validation.
- [ ] Prevent `DESIGN_READY` when gate missing.
- [ ] Reevaluate freshness before large relevant downstream actions.

## Evidence

- [ ] Ensure social/community source types are supported.
- [ ] Ensure observed/estimated/inferred/unknown distinction is possible.
- [ ] Link Evidence to MarketStudy.
- [ ] Link Evidence to MarketSignals.
- [ ] Enforce completion structure.
- [ ] Enforce counter-signal requirement.
- [ ] Enforce saturation analysis.
- [ ] Enforce commercial-signal analysis.

## WorkItems

- [ ] Add/use `MARKET_STUDY`.
- [ ] Add/use `MARKET_STUDY_REFRESH`.
- [ ] Add/use `CREATIVE_BRIEF`.
- [ ] Optionally add/use `MARKET_MONITORING`.
- [ ] Ensure these are ordinary WorkItems.
- [ ] Ensure dependencies use existing work graph.

## Skills

- [ ] Create initial market-study Skill.
- [ ] Create initial community/Reddit research methodology.
- [ ] Create initial marketplace research methodology.
- [ ] Include counter-signal discipline.
- [ ] Include freshness discipline.
- [ ] Include source-provenance discipline.
- [ ] Include IP danger surfacing.
- [ ] Keep methodologies outside Foundation code.

## Bootstrap

- [ ] Analyst gets current business/market context.
- [ ] Analyst gets relevant prior knowledge, not all history.
- [ ] Strategist receives summarized MarketStudy/Signals.
- [ ] Designer receives CreativeBrief, not raw research corpus.
- [ ] Expired cultural knowledge is visibly stale.

## Creative flow

- [ ] MarketStudy precedes serious design.
- [ ] Strategist creates CreativeBrief.
- [ ] Designer consumes CreativeBrief.
- [ ] Human AI-art gate remains mandatory.
- [ ] IP gate remains independent.
- [ ] Physical sample gate remains independent.

## Git

- [ ] Organization Skill/tool improvements use Organization Maintenance.
- [ ] Business reports/artifacts use normal Business Git if versioned.
- [ ] No raw operational research memory dumped into Git.
- [ ] Organization SHA captured in research provenance.

## Human

- [ ] Cultural judgment can create HumanRequest.
- [ ] Human absence blocks only dependent branch.
- [ ] Timeout never approves.
- [ ] Human Creative Approval remains separate.

## Tests

- [ ] Add E21–E32.
- [ ] Expand sticker integration test.
- [ ] Add Cultural + Git QA integration test.
- [ ] Add wrong-geography applicability test.
- [ ] Add stale-study test.
- [ ] Add LLM-only fake-study test.

---

# 80. What NOT to build in V1

Explicitly defer:

```text
dedicated vector DB
continuous scraping daemon
real-time meme firehose
Kafka/message broker
platform-specific database per social network
custom Reddit crawler framework
social graph database
machine-learning trend classifier service
automated cultural score neural model
multi-provider research orchestration engine
separate market-intelligence UI application
```

All of these can be added if real usage proves they are needed.

They are not required to achieve the institutional behavior.

---

# 81. Definition of Done

Cultural & Market Intelligence is integrated into Cult4 V1 only when all of these are true:

```text
1. A creative culture-sensitive business automatically
   requires MARKET_RELEVANCE.

2. The requirement is enforced by deterministic Foundation code,
   not by agent prompt.

3. A permanent Cultural & Market Intelligence Employee exists.

4. That Employee works through normal Cult4/OpenCode mechanisms.

5. MarketStudy is structured and stored in the same SQLite state.

6. Evidence uses the existing Source/Evidence/Claim system.

7. Current cultural signals have freshness/expiry semantics.

8. Studies require saturation analysis.

9. Studies require commercial-signal analysis.

10. Studies require counter-signal research.

11. Strategist receives the study and creates strategy.

12. Designer receives a CreativeBrief.

13. AI art still requires exact-hash Human Creative Approval.

14. IP Clearance remains independent.

15. Physical products still require sample + human physical QA
    + supplier qualification.

16. Money still goes through Finance.

17. Business code/assets still go through exact-SHA Git QA.

18. Organization Skill/tool improvements go through
    Organization Maintenance Git discipline.

19. Human absence uses existing HumanRequest semantics.

20. `cult tick` schedules this work using the existing WorkItem graph.

21. No market-specific orchestrator exists.

22. No sticker-specific code exists.

23. The full sticker acceptance scenario succeeds end-to-end.
```

---

# 82. Final architectural rule

The implementation agent must preserve this separation:

```text
Foundation decides:
WHAT MUST BE TRUE

Employees decide:
HOW TO LEARN / HOW TO WORK

Evidence records:
WHY WE BELIEVE IT

Strategist decides:
WHAT BUSINESS ACTION TO TRY

Experiments determine:
WHETHER IT ACTUALLY WORKS

Git identifies:
EXACTLY WHAT WAS BUILT

QA determines:
WHETHER THAT EXACT VERSION IS ACCEPTABLE

Humans decide:
THE JUDGMENTS CULT4 MUST NOT DELEGATE
```

For Cultural & Market Intelligence specifically:

```text
Foundation:
"A fresh, evidence-backed understanding
of the human market is required."

Market Intelligence Analyst:
"Here is how I will research Reddit,
marketplaces, language, memes, tropes,
aesthetics, saturation and counter-signals."

Strategist:
"Given that evidence, here is the hypothesis
worth testing."

Designer:
"Given that CreativeBrief, here is the work."

Human:
"This art is actually good enough."

IP Reviewer:
"We may commercially use it."

QA:
"This exact version works."

Physical Human QA:
"The real manufactured product is good."

Treasurer:
"The economics are acceptable."

Cult4:
"All required responsibilities and gates
are satisfied. This exact subject may proceed."
```

That is the intended integration.

**Do not implement Cultural & Market Intelligence beside Cult4. Implement it through Cult4.**
