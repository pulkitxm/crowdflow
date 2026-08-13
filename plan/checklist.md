# CrowdFlow — Build Checklist

The complete project as checkable items. Ordering and rationale in
[`build-plan.md`](./build-plan.md); component detail in [`breakdown.md`](./breakdown.md).

**Legend:** ⬜ not started · 🟡 in progress · ✅ done · ⛔ gate

> **Status at merge of PRs #1–#5.** Phases 0–3 are built and the gate passed:
> critical zone-seconds −34.7% against an identical seed. Phases 4–6 are built
> and merged but every branch came back `needs-work` from adversarial review —
> 34 findings are recorded in the merged PR bodies and are NOT fixed. 390 tests
> passing. Boxes below are ticked for "built and tested", not "reviewed clean".

---

## Phase 0 · Foundations  ✅

Blocks everything. Cheap.

- [x] `uv` workspace at repo root, five Python packages members
- [ ] `pnpm` workspace for `apps/*` and generated types  ← deferred to Phase 4
- [x] **Contracts** — Pydantic models
  - [x] `standards.py` — Fruin LOS boundaries + walking speed, each with citation
  - [x] `CrowdNode` — live position, velocity, accuracy
  - [x] `TraceFragment` — noised, rotated-ID segment (kept separate from CrowdNode)
  - [x] `ZoneState` — flow rate, LOS band, velocity, inflow/outflow, confidence
  - [x] `Forecast` — zone, time-to-threshold, probability, causes, confidence
  - [x] `InterventionCandidate` — fraction, projected peak, cost, score breakdown
  - [x] `RerouteCommand` — avoid/prefer sets, fraction, expiry
  - [x] `SafetyVerdict` — approved / rejected with stated reason
  - [x] `MeshMessage` — envelope: type, source, sequence, ttl
  - [x] `CircuitPack` / `EventProfile` — venue and timetable
- [x] Codegen: Pydantic → JSON Schema → TypeScript, generated files committed
- [x] `packages/core` skeleton, no-I/O rule enforced
- [x] `packages/cli` — typer entry point, command groups
- [x] **Done when** simulator output and a hand-written fake phone payload both validate
      against the same models and the core cannot tell them apart

## Phase 1 · Venue  ✅

The frame of reference. Must exist before any crowd data means anything.

- [x] Overpass client with on-disk cache (never a live call in the demo path)
- [x] Venue envelope clip — drop the village, keep the circuit
- [x] Pedestrian graph from `footway · path · steps · pedestrian · service · track`
- [x] **Barrier subtraction** — `fence · hedge · wall` define where people *cannot* go
- [x] Semantic labelling from tags
  - [x] `building=grandstand` → viewing zones
  - [x] `barrier=gate` → gates
  - [x] `amenity=parking` → arrival sources
  - [x] named features → human-readable landmarks
- [x] Enrichment
  - [x] f1-circuits outline + coordinate frame (all 23 indexed)
  - [x] official venue map → capacities, block numbers
  - [x] event profile → which crossings gate on session state
- [x] Graph simplification: junctions, edge widths, distances, gradients
- [x] `circuit validate` — orphan zones, unreachable exits, disconnected gates, bad capacities
- [x] `circuit render` — SVG that visibly looks like the venue
- [x] Silverstone pack complete
- [x] Second circuit imported to prove the pipeline generalises

## Phase 2 · Loop  ✅

- [x] **Simulator**
  - [x] crowd generator: origins, destinations, speeds, group sizes
  - [x] movement model: speed falls with density (flow–density inversion)
  - [x] demand model: viewing areas as scheduled attractors
  - [x] scenario library: normal, arrival wave, session end, gate closure, crossing shut
  - [x] seeded clock, pause, speed-up, reset
  - [x] **counterfactual fork** — cloneable state from the first commit
- [x] **State engine**
  - [x] ingestion, validation, dedupe by (source, sequence)
  - [x] node → zone binding, sliding window
  - [x] **flow rate in ped/m/min**, LOS band from the Fruin boundaries
  - [x] velocity, dominant direction, inflow/outflow, queue length
  - [x] participation model — measured, never a slider
  - [x] confidence model — node count, freshness, accuracy, stability
- [x] **Prediction**
  - [x] feature builder incl. session-state flags
  - [x] rule baseline — deterministic time-to-threshold, ships first
  - [x] training data generation from headless scenario runs
  - [x] GBM model, evaluated against the baseline
- [x] **Intervention**
  - [x] candidate generator over divert fractions
  - [x] what-if runner through the counterfactual fork
  - [x] scoring: congestion reduction, walk time, capacity, safety, fairness
  - [x] minimum-effective selector + the comparison table
- [x] **Routing**
  - [x] dynamic edge cost
  - [x] constrained path search with avoid/prefer
  - [x] ETA gating against time-limited crossings
  - [x] command builder
- [x] **Safety** — hard constraints, emergency mode, veto with stated reason
- [x] **Tick loop** — state → predict → intervene → route → safety → broadcast

## Phase 3 · Proof  ✅ ⛔ GATE PASSED

- [x] Metric definitions precise enough to compare across runs
  - [x] peak flow rate, time above LOS E, bottleneck duration
  - [x] average and worst-case walk time
  - [x] emergency egress accessibility
- [x] A/B harness — same seed, intervention on vs off
- [x] Sensitivity sweep — participation rate × scenario
- [x] Before/after report
- [x] **GATE: a 30% reroute measurably reduces peak flow and bottleneck duration.**
      If not, stop and revisit before building any interface.

## Phase 4 · Surfaces  ✅ *(needs-work)*

- [ ] Shared: generated TS types, token layer
- [ ] **Operator console** — dense, complete, well organised
  - [ ] live venue map with individual nodes
  - [ ] zone table, sortable, monospaced
  - [ ] prediction panel: time-to-event as the headline, confidence beside the claim
  - [ ] intervention panel showing rejected options with their costs
  - [ ] race control feed
  - [ ] metrics strip
  - [ ] unobserved regions render as unknown, never as empty
- [ ] **Spectator app** — simple, beautiful, one decision per screen
  - [ ] where you are, where you're going, how many minutes
  - [ ] clear / slowing / backing up, in words
  - [ ] crossing open-close times
  - [ ] redirect with its honest cost stated before the button
  - [ ] willing to say *wait*
  - [ ] no density figures, no model talk, no account
- [ ] D8 content budget enforced on every app addition

## Phase 5 · Real data  ✅ *(needs-work)*

- [ ] Wi-Fi Aware capability check on the actual demo phones ← do first, 30 min
- [ ] Expo dev client shell, prebuild, EAS config
- [ ] Location engine, map matching to the venue frame
- [ ] Telemetry composer, rotating anonymous IDs
- [ ] **Native Kotlin `MeshNetwork` module**
  - [ ] the 7-method interface — the JS/native boundary
  - [ ] Wi-Fi Aware → Wi-Fi Direct → BLE, behind the interface
  - [ ] **foreground service** so relay survives screen-off
  - [ ] Spray-and-Wait for state traffic
  - [ ] PRoPHET for uplink-bound traffic
  - [ ] rate-limited epidemic for alerts only
  - [ ] TTL, sequence dedupe, local aggregation
- [ ] Opportunistic uplink election; dashboard fans in over N uplinks
- [ ] On-device geo-indistinguishability before anything is stored
- [ ] Coverage metric — which regions are currently observed
- [ ] Degraded sync and reconciliation on reconnect

## Phase 6 · Refinement  ✅ *(needs-work)*

- [ ] Trace refinement written back to packs
  - [ ] desire-line discovery — paths no map has
  - [ ] measured capacity replacing assumed
  - [ ] staleness detection against OSM
  - [ ] per-edge confidence and sample count
- [ ] Order-invariant private sketches for unique counting
- [ ] Capture–recapture participation estimator
- [ ] Crowd Ops Agent — tool layer, reasoning loop, explanation, memory
- [ ] Insight engine — statistical anomaly detection, then LLM narration
- [ ] Agent recommendations pass through safety like any other proposal

---

## Standing invariants — checked every merge

- [ ] No constant absent from [`standards.md`](./standards.md)
- [ ] App content budget (D8) — changes where feet go in the next 60 seconds, or it's console
- [ ] Simulator and phone telemetry byte-identical
- [ ] Nothing reaches the mesh without passing safety
- [ ] The LLM never computes a route, a density, or a prediction
- [ ] Every simulation run seeded and reproducible
- [ ] A circuit swap requires no code change

## Documents still to write

- [ ] `docs/protocol.md` — mesh spec, before Phase 5 mesh work
- [ ] `docs/demo.md` — run-of-show, after the demo feed is chosen


---

## What the build changed about the plan

Four defects and one modelling error surfaced only by running the thing. Each is
recorded where it belongs (decisions.md, standards.md), but collected here
because they are the argument for building the gate before the interfaces:

1. Zone area was the mean incident edge length, so a 3 m access stub defined a
   grandstand's area and reported CRITICAL ten seconds into any egress.
2. Density was uncapped, producing flow rates of 1,630 ped/m/min against a
   physical maximum of 80.4.
3. The observation window counted records rather than devices, and a moving
   device was counted in both the zone it left and the one it entered.
4. Participation was resampled every tick, so the union over any window
   approached the whole crowd.
5. Classification ran on flow, which is non-monotonic — and Fruin's LOS E/F
   boundary turned out to be unreachable under this fundamental diagram.

All five produced *plausible* numbers. None would have been caught by a
dashboard, which is why Phase 3 came before Phase 4.
