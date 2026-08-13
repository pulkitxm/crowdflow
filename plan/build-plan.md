# CrowdFlow — Build Plan

How to start, in what order, and why that order. Supersedes the M0–M8 milestone ladder in
[`breakdown.md`](./breakdown.md); the track inventory there is still the component list.

---

## 1. Ordering principle

Two rules decide the order, and they point the same way.

**The venue is a precondition, not an output.** The structure is what lets the system say *where*
congestion is — without it there are no zones, no capacities, and no congestion points, only a
cloud of dots. It must exist before the first spectator arrives, so it is built first
([`decisions.md`](./decisions.md) D6).

**Then prove the loop pays.** The product's claim is not "we can see the crowd" — plenty of
systems can. It is that *predicting and intervening measurably beats not doing so*. That is a
falsifiable claim, it is testable entirely in simulation, and it is cheap to test. So it comes
before any interface work.

Everything else — surfaces, mesh, agent — is downstream of those two.

---

## 2. Phases

| Phase | Builds | Proves |
|---|---|---|
| **0 · Foundations** | Monorepo tooling, contracts, codegen, CLI shell | Parallel work without collisions |
| **1 · Venue** | OSM extract → pedestrian graph → semantic labelling → validator → Silverstone pack | The system has a frame of reference |
| **2 · Loop** | Simulator, state engine, prediction, intervention what-if, routing, safety, tick loop | Congestion emerges, and is predicted before it forms |
| **3 · Proof** ⟵ gate | Metrics + A/B harness | **Intervention measurably beats no intervention** |
| **4 · Surfaces** | Console (dense), then app (simple) | It is usable, and D8 holds |
| **5 · Real data** | Expo shell, native Kotlin mesh, Spray-and-Wait + PRoPHET, uplink election, on-device privacy | It is not a simulation |
| **6 · Refinement** | Trace refinement (desire lines, measured capacity), Crowd Ops Agent, insights | It improves with every event, and explains itself |

**Phase 3 is the gate.** If a 30% reroute does not measurably reduce peak density and bottleneck
duration in simulation, there is no product, and we find that out in week one with no interface
built on top of it. The before/after table from `plan.md` §42 is not a demo artefact — it is the
experiment.

Phases 4 and 5 are independent of each other and can run in parallel.

---

## 3. Phase 1 in detail — the venue

This is now the critical path, and unlike inference it is engineering with a known method.

```
   Overpass query, venue bbox
        │
        ▼
   clip to venue           drop the village; keep the circuit envelope
        │
        ▼
   pedestrian graph        footway · path · steps · service · track
        │                  minus barriers (fence · hedge · wall) — the envelope
        ▼
   semantic labelling      building=grandstand  → viewing zones
        │                  barrier=gate         → gates
        │                  amenity=parking      → arrival sources
        │                  named features       → human-readable landmarks
        ▼
   enrich                  official venue map: capacities, block numbers
        │                  f1-circuits outline: track, coordinate frame
        │                  event profile: which crossings gate on session state
        ▼
   validate                orphan zones, unreachable exits, disconnected gates
        │
        ▼
   circuits/silverstone/pack/
```

Confirmed available for Silverstone: 17 tagged grandstands, 369 footways, 66 paths, 20 steps,
750 service roads, 216 tracks, 651 barrier segments, 64 gates, 82 car parks.

**Barriers are as important as paths.** They define where people *cannot* walk, which is what
makes a pedestrian graph correct rather than merely connected. A graph built from paths alone
will happily route someone through a fence.

**What OSM will not give us**, and where each gap is filled:

| Gap | Filled by |
|---|---|
| Grandstand capacities | Official venue map |
| Which crossings gate on session state | Event profile + operator input |
| Real corridor capacity | Measured at runtime ([`standards.md`](./standards.md) §3) |
| Desire lines — informal shortcuts | Trace refinement, Phase 6 |

---

## 4. Work split by agent role

| Role | Owns | Phase |
|---|---|---|
| **Backend** | contracts, codegen, core shape, CLI, API, tick loop | 0, 2 |
| **Data analyst** | OSM pipeline, graph construction, validator | 1 |
| **Simulation** | crowd generator, movement model, scenarios, counterfactual fork | 2 |
| **AI/ML** | prediction features, rule baseline, GBM, then the agent | 2, 6 |
| **Frontend** | console first, app second — different problems, do not merge | 4 |
| **Mobile** | Expo shell, native mesh, transports, routing protocols | 5 |
| **Reviewer** | the four invariants below, every merge | all |

### What the reviewer enforces

Not style. These four, because they are what this project will otherwise lose:

1. **No constant without a source.** Any literal not registered in
   [`standards.md`](./standards.md) is rejected. Most likely to erode under time pressure.
2. **The app's content budget (D8).** Every addition must change where someone puts their feet in
   the next sixty seconds. Expect to reject often; the pressure is always toward adding.
3. **Simulator and phone telemetry stay byte-identical.** The moment they diverge, the core has
   two input paths and one is untested.
4. **Nothing reaches the mesh without passing safety.** The agent recommends; it never acts.

---

## 5. The first three moves

**Move 1 — Contracts.** Blocks everything, cheap. Note one payload the original plan lacked:

```
CrowdNode        live position/velocity        →  state engine
TraceFragment    short, noised, rotated ID     →  refinement (Phase 6)
ZoneState        aggregated per zone           →  prediction, surfaces
Forecast         zone, time-to-event, conf.    →  intervention
InterventionCandidate                          →  routing
RerouteCommand   avoid/prefer sets             →  safety, mesh
MeshMessage      envelope: type, seq, ttl      →  transport
CircuitPack      imported + refined files      →  everything venue
EventProfile     session timetable             →  graph rebuild, features
```

`CrowdNode` and `TraceFragment` stay separate. Live state is aggregated and disposable;
fragments are noised and deliberately un-linkable. Conflating them leaks the trace through the
state path.

**Move 2 — Venue pipeline.** Silverstone from Overpass to validated pack, per §3. Ends with
`crowdflow circuit validate silverstone` passing and an SVG render that looks like the venue.

**Move 3 — Simulator on that graph.** Seeded agents with origins, destinations and schedules,
emitting `CrowdNode` telemetry. Ends when congestion emerges on its own in at least one scenario
without being scripted to.

Then Phase 2's pipeline, and Phase 3 decides whether the idea works.

---

## 6. What I need from you

Nothing blocking. The venue-structure question is closed.

| | Why | When |
|---|---|---|
| Who owns visual design | Phase 4 | Before surfaces start |
| Official Silverstone venue map | Grandstand capacities and block numbers OSM lacks | During Phase 1 |
| Per-session attendance from a venue contact | Turns participation from estimate to measurement | Anytime; capture–recapture is the fallback |
| Wi-Fi Aware check on the demo phones | Decides Phase 5 transport; 30 minutes | Early |
