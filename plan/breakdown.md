# CrowdFlow — Project Breakdown

A decomposition of [`plan.md`](./plan.md) into buildable subparts, with the interfaces between
them, what blocks what, and what can be built in parallel.

Structure and module boundaries: [`architecture.md`](./architecture.md).
Circuit pack format: [`circuits.md`](./circuits.md). Rationale: [`decisions.md`](./decisions.md).

---

## 0. The one structural insight

The whole system is a single pipeline:

```
telemetry → zone state → prediction → what-if → route → command → telemetry
```

Everything in the middle only ever sees **zone state**, and everything at the edges only
produces or consumes **telemetry**. That gives one hard seam:

```
        SOURCES                    CORE                     SINKS
   ┌───────────────┐        ┌────────────────┐       ┌───────────────┐
   │ Simulator     │──┐     │ State          │   ┌──►│ Dashboard     │
   │ Real phones   │──┼────►│ Prediction     │───┤   │ Phone app     │
   │ Event profile │──┘     │ Intervention   │   └──►│ Metrics       │
   └───────────────┘        │ Routing/Safety │       └───────────────┘
                            │ Agent          │
                            └────────────────┘
              ▲                                              │
              └──────────────  REROUTE COMMAND  ─────────────┘
```

If the telemetry schema is frozen on day one, the simulator track and the mobile track never
block each other, and the core is written once against a single input format. **Freezing the
contracts is Track P and it gates everything.**

---

## 1. Tracks

### Track P — Platform (P0, blocks everything)

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| P1 | Monorepo skeleton | `packages/`, `apps/`, `circuits/`, `events/`, `scenarios/`; Bun workspaces + one lockfile | — |
| P2 | Contracts | Authored TypeScript `CrowdNode`, `ZoneState`, `Forecast`, `InterventionCandidate`, `RerouteCommand`, `MeshMessage` | P1 |
| P3 | Codegen | TypeScript → deterministic JSON Schema; generated schemas committed and byte-checked | P2 |
| P4 | Core package shell | strict TypeScript `packages/core` with the no-I/O rule enforced | P1 |
| P5 | CLI shell | Bun entry point; `sim`, `mesh`, `refine`, `circuit` command groups | P4 |

*Done when:* simulator output and a hand-written fake phone payload both validate against the
same models, and the core cannot tell them apart.

### Track A — Circuit (foundation)

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| A1 | `CircuitPack` schema | The seven pack files, schema-validated on load | P2 |
| A2 | Local coordinate frame | x/y venue frame, lat-lon adapter, point→zone lookup | A1 |
| A3 | Graph builder | Pure TypeScript graph from pack; distances, travel times, edge capacity | A1, A2 |
| A4 | Time-gated edges | Availability windows, session-state graph rebuild | A3, J4 |
| A5 | Pack validator | `circuit validate` — orphan zones, unreachable exits, bad capacities | A1 |
| A6 | Renderer | SVG/GeoJSON export the dashboard and app both draw | A2, A3 |
| A7 | Circuit 1 (deep) | Fully modelled demo circuit, tuned for the scenario | A1–A6 |
| A8 | Circuit 2 (shallow) | Minimal second pack — proves the format generalises | A1–A6 |
| A9 | `SKILL.md` | Agent-facing operational playbook per circuit | A7, H4 |

*Done when:* `circuit validate` passes, and "shortest path Gate A → Exit B" answers from a real
pack with no code changes between circuits.

### Track B — Simulator (the demo's engine)

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| B1 | Crowd generator | Virtual spectators: origin, destination, speed, group size, behaviour | A3 |
| B2 | Movement model | Step along edges; speed falls as density rises; gradient effects | B1, A3 |
| B3 | Telemetry emitter | Emits `CrowdNode` — identical format to phones | B2, P2 |
| B4 | Demand model | Viewing areas as scheduled attractors driven by the event profile | A1, J4 |
| B5 | Scenario library | Normal, arrival wave, session end, gate closure, crossing shut, exit blocked | B1–B4 |
| B6 | Clock & control | Tick rate, pause, **seed**, speed-up, reset | B2 |
| B7 | Counterfactual fork | Clone current state, run N seconds forward under a modified policy | B2, A3 |

*B7 is the quiet dependency of the intervention engine — design B2 state as cloneable from the
first commit or you rewrite the simulator at M4.*

*Done when:* 500 spectators move through the circuit and congestion emerges on its own in at
least one scenario.

### Track C — Crowd State Engine

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| C1 | Ingestion | Intake, validation, dedupe by (source, sequence) | P2 |
| C2 | Node→zone binding | Positions to zones/edges, sliding time window | A2, C1 |
| C3 | Aggregation | Density, mean velocity, dominant direction, occupancy, pressure | C2 |
| C4 | Flow counters | Inflow/outflow per zone per minute, queue length estimate | C2 |
| C5 | Participation model | Observed ÷ participation rate → estimated population (10–50%, configurable) | C3 |
| C6 | Confidence model | Node count, freshness, accuracy, stability, **pack `sensing.yaml`** | C3, C5, A1 |

*Done when:* a live heatmap updates from simulator telemetry and every zone carries a
confidence value that drops in declared low-GNSS areas.

### Track D — Prediction Engine

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| D1 | Feature builder | Density, deltas, velocity deltas, flows, capacity ratio, queue growth, session flags | C3–C5, J4 |
| D2 | Rule baseline | Deterministic time-to-capacity from flow trend — **ships first, always works** | D1 |
| D3 | Training data gen | Headless scenario runs, labelled "congested within 180s" | B5, D1, P5 |
| D4 | ML model | XGBoost/LightGBM → probability, time-to-congestion, peak density | D3 |
| D5 | Evaluation | Accuracy, lead time, false-positive rate vs baseline | D2, D4 |

### Track E — Intervention Engine

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| E1 | Candidate generator | Reroute fractions (10/20/30/40%), gate and crossing choices | F1 |
| E2 | What-if runner | Each candidate through B7; collect projected peak density | B7 |
| E3 | Scoring | Congestion reduction, travel time, capacity, safety, distance, fairness → one score | E2 |
| E4 | Selector | Minimum effective intervention + the comparison table for the dashboard | E3 |

### Track F — Routing Engine

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| F1 | Dynamic edge cost | `travel_time + congestion + risk + capacity` penalties, per tick | A3, C3 |
| F2 | Path search | Constrained shortest path with avoid/prefer sets | F1 |
| F3 | ETA gating | Reject paths whose crossing closes before the walker arrives | F2, A4 |
| F4 | Command builder | Emit `RerouteCommand` (avoid/prefer, not per-person routes) | F3, P2 |

### Track G — Safety Engine

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| G1 | Hard constraints | Never through blocked or `never_route_through`; never exceed capacity; never away from emergency exits in evac | A1, F2 |
| G2 | Emergency mode | Disables optimisation, switches to evacuation policy | G1 |
| G3 | Veto + explanation | Allow/reject any recommendation with a stated reason | G1, H1 |

*Sits between the agent and any action — nothing reaches the mesh without passing G.*

### Track H — Crowd Ops Agent

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| H1 | Tool layer | `get_zone_state`, `get_predictions`, `simulate_intervention`, `find_alternative_route`, `create_reroute`, … | C, D, E, F |
| H2 | Reasoning loop | One tool-calling agent (analyst/routing/event as *tools*, not separate LLM calls) | H1 |
| H3 | Explanation | "Why this zone, why 30%, what it buys you" | H2 |
| H4 | Memory | Circuit `SKILL.md`, historical bottlenecks, past interventions, event profile | H2, A9 |

### Track I — Insights Engine

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| I1 | Baselines | Rolling per-zone and per-gate statistics | C3 |
| I2 | Anomaly detection | Statistical deviation first — no LLM over raw points | I1 |
| I3 | Narration | LLM turns a detected anomaly into an operator-readable insight | I2, H2 |

### Track J — API / Control Plane

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| J1 | REST | Circuit, scenario control, metrics | A, B6 |
| J2 | WebSocket | Telemetry in; state/prediction/intervention out at fixed tick | C, D, E |
| J3 | Tick loop | state → predict → intervene → route → safety → broadcast | C–G |
| J4 | Event profile | `EventProfile` loading, session state machine, session-change hooks | P2, A1 |

*J3 is the closed loop from §49. It is small and it is the heart. J4 feeds A4, B4 and D1 —
build it earlier than its position suggests.*

### Track K — Mesh Gateway

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| K1 | Uplink bridge | Accept mesh-relayed batches, unwrap, dedupe, respect TTL | P2, C1 |
| K2 | Downlink | Push `RerouteCommand` / `ALERT` into the mesh | F4 |
| K3 | Degraded sync | Buffer while gateway is down, reconcile on reconnect | K1 |

### Track L — Mobile (Expo + native mesh)

**JavaScript side**

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| L1 | Expo app shell | Dev client, prebuild, EAS config. **Not Expo Go** | P1 |
| L2 | Location | Expo Location, map matching to the circuit frame | A6, L1 |
| L3 | Telemetry composer | Build `CrowdNode`, rotating anonymous IDs, local buffering | P3, L2 |
| L4 | Local routing | On-device path calc honouring avoid/prefer from a `RerouteCommand` | A3, F1 |
| L5 | UI | You-are-here, green/red route, reroute banner. Nothing else (§23) | L4 |

**Native side — `apps/mobile/modules/mesh`**

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| L6 | `MeshNetwork` bridge | The 7-method interface; the JS/native boundary | P3 |
| L7 | Transports | Wi-Fi Aware (preferred) → Wi-Fi Direct (fallback) → BLE (discovery) | L6 |
| L8 | Application mesh | Multi-hop overlay: TTL, sequence dedupe, relay decisions | L6, P2 |
| L9 | Foreground service | Keeps relay alive with the screen off — **the whole point** | L7, L8 |
| L10 | Local aggregation | Zone summaries natively, so the bridge stays low-frequency (§8) | L8 |

*L6 before L7 is non-negotiable — device support for Aware is uneven and nothing above the
interface may know which transport won. L9 is what makes it a mesh rather than a demo trick.*

### Track M — Dashboard

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| M1 | Live circuit map | Nodes, heatmap, flow arrows | A6, J2 |
| M2 | Prediction panel | Zone, time-to-bottleneck, confidence | D, J2 |
| M3 | Intervention panel | The 10/20/30/40% comparison table and the chosen action | E4 |
| M4 | Metrics panel | Before/after table | N |
| M5 | Insights feed | Streamed anomalies and agent narration | I3 |

### Track N — Metrics & Evaluation

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| N1 | Metric collection | Peak/avg density, travel time, bottleneck count and duration, exit accessibility | C3, B2 |
| N2 | A/B harness | Same seed, same scenario, intervention on vs off | B6, N1, P5 |
| N3 | Report | The before/after table from §42 — the actual proof | N1, N2 |

### Track O — Demo

| # | Subpart | Contents | Depends on |
|---|---|---|---|
| O1 | Scripted scenario | The 500-spectator §27 story, seeded and repeatable | B5, B6 |
| O2 | Circuit swap moment | Load circuit 2 live — "same system, different circuit" | A8 |
| O3 | Phone segment | 5 real phones, physical bottleneck, live detection | L, K |
| O4 | Fallbacks | Recorded telemetry replay if mesh or venue Wi-Fi misbehaves | B3, P5 |

---

## 2. Dependency graph

```
                        P PLATFORM
                     (contracts + codegen)
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   A CIRCUIT ──────────► B SIMULATOR         L MOBILE
        │  ▲                 │              (JS ── native)
        │  │ J4 events       │                    │
        │  │                 ▼                    ▼
        └──┴────────────► C STATE ◄──────────── K GATEWAY
                             │
                             ▼
                        D PREDICTION
                             │
                        ┌────┴────┐
                        ▼         ▼
                   F ROUTING   E INTERVENTION ──► needs B7
                        │         │
                        └────┬────┘
                             ▼
                        G SAFETY
                             │
                        ┌────┴────┐
                        ▼         ▼
                    H AGENT   J CONTROL PLANE
                        │         │
                        └────┬────┘
                             ▼
                     M DASHBOARD / N METRICS / O DEMO
```

**Critical path:** `P → A → B → C → D → E/F → J3 → M → N`.
That path alone is the entire "must have" list from §47 and produces the killer demo without a
single phone.

**Parallel tracks** once P lands:

| Track | Parts | Blocks the demo? |
|---|---|---|
| 1 — critical | A → B → C → D → E/F → J → M | Yes |
| 2 — independent | L mobile + K gateway | No |
| 3 — late-attach | G safety, H agent, I insights | No — plug into J3 after the loop runs |
| 4 — continuous | N metrics | Instrument as C and B land, not at the end |

---

## 3. Build order

> **Superseded.** The ladder below predates D6 and D7, which moved trace inference onto the
> critical path and re-ranked the mesh from differentiator to foundation. See
> [`build-plan.md`](./build-plan.md) for the current phase order. The tracks above remain the
> component inventory.

| Milestone | Parts | Proves |
|---|---|---|
| **M0 — Foundations** | P1–P5 | Contracts generate; CLI runs; core importable |
| **M1 — Circuit is real** | A1–A3, A5–A7 | Pack validates, graph queryable, renders |
| **M2 — Crowd moves** | B1–B6, C1–C4, J4 | Live heatmap from simulated spectators |
| **M3 — It sees the future** | D1–D2, C5–C6 | "Congestion in 3 min", with confidence |
| **M4 — It acts** | B7, E1–E4, F1–F4, J3 | The 10/20/30/40% table and a chosen reroute |
| **M5 — The loop closes** | J2, M1–M3, N1–N3 | Before/after table: 118% → 87% |
| **M6 — It's not a mock** | L, K, O3 | Real phones feeding the same pipeline |
| **M7 — It explains itself** | G, H, I, A9, M4–M5 | Agent narrates cause, action, expected effect |
| **M8 — It generalises** | A8, O2 | Circuit swap on stage |

**M5 is the demo.** M6–M8 are differentiators. If time runs out, it runs out after M5.

---

## 4. Risk register

| Risk | Part | Why it bites | Mitigation |
|---|---|---|---|
| JS suspends in background | L9 | Phones are in pockets; a suspended node stops relaying and there is no mesh | Foreground service in native. This is why the mesh is Kotlin |
| Multi-hop is app-level work | L8 | Wi-Fi Aware gives peer links, not a routed mesh | Budget L8 separately; single-hop + gateway is an acceptable fallback |
| Wi-Fi Aware device support | L7 | Demo phones may not all support it | L6 abstraction, BLE path, test on **actual demo hardware** early |
| Native rebuild cycle | L6–L10 | Every native change costs a build; hours vanish | Build and **freeze** native early, then live in TypeScript |
| Counterfactual not forkable | B7 | Blocks the entire intervention engine, discovered late | Design B2 state as cloneable from the first commit |
| Participation rate is a guess | C5 | Density is only as good as this constant | Visible dashboard control; tie to confidence, don't hide it |
| ML doesn't converge in time | D4 | Prediction is the pitch | D2 rule baseline ships first and is demo-sufficient |
| Circuit modelling sprawl | A7, A8 | Five half-circuits instead of one good one | One deep, one shallow. Hard rule |
| GNSS drift in tunnels/trees | L2, C6 | Wrong zone assignment corrupts state | Prefer sprawling circuit; declare `sensing.yaml`; map-match |
| Agent given real control | H, G | An LLM moving crowds is bad architecture | G is mandatory. Agent recommends, safety approves |
| Demo depends on live networking | O | Hackathon venue Wi-Fi | O4 recorded-telemetry replay |

---

## 5. What each part owes the others

Interfaces worth writing down before code:

```
Circuit pack ──► VenueGraph        ──► Simulator, State, Routing
Event profile ─► SessionState      ──► Graph rebuild, Demand, Features
Simulator    ──► CrowdNode[]       ──► State engine
Phones       ──► CrowdNode[]       ──► Gateway ──► State engine
State        ──► ZoneState{}       ──► Prediction, Dashboard, Agent
Prediction   ──► Forecast{}        ──► Intervention, Dashboard
Intervention ──► Candidate[]       ──► Routing, Dashboard
Routing      ──► RerouteCommand    ──► Safety
Safety       ──► Approved | Rejected{reason} ──► Gateway, Dashboard
Gateway      ──► MeshMessage       ──► Phones
Phones       ──► local route change ──► CrowdNode[]   (loop closes)
```

If every part honours exactly this and nothing more, the parts stay swappable — which is what
lets the simulator stand in for the crowd, the crowd stand in for the simulator, and any
circuit stand in for any other.
