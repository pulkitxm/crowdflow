# CrowdFlow

Predictive crowd management for Grand Prix circuits. Participating phones become anonymous
crowd nodes; the system infers crowd state, predicts where congestion will form, simulates
interventions against a counterfactual, reviews them for safety, and reroutes people before
the bottleneck exists.

> We don't just detect crowds. We predict where they will get stuck and move them before they do.

```
OBSERVE -> UNDERSTAND -> PREDICT -> SIMULATE -> REDIRECT -> OBSERVE AGAIN
```

Planning documents live in [`plan/`](./plan/) (5,142 lines across 12 documents). This README is
the status report: what exists, what is wired to what, and what is still missing.

---

## Status at a glance

| | |
|---|---|
| Runtime | Bun 1.3.14, TypeScript 6, one workspace, one lockfile |
| Source | ~16,140 lines TS/TSX across 6 packages and 2 apps |
| Tests | 268 passing across 31 files, 8 workspaces |
| Typecheck | clean |
| Proof gate | passes, seeded, reproducible |
| Circuits | 1 of 23 committed (Silverstone); 0 radio-surveyed |
| Calendar | 2026 season imported, 23 rounds with published session times |
| Overall | core loop real and running; phone sensing connected end to end; mesh radio and LLM agent not connected |

The honest one-line summary: **the prediction and intervention loop is real and demonstrably
works, and real phones can now feed it — consent, radio positioning, ingest and an operator
picture all run end to end against a simulated crowd. What remains unplugged is the peer-to-peer
mesh radio and the LLM narration, and no venue has been radio-surveyed.**

---

## Repository layout

```
packages/
  contracts/   authored TypeScript wire contracts + 72 standards constants + JSON Schema codegen
  core/        pure engines, no I/O: state, routing, prediction, intervention, safety, mesh, refinement
  cli/         headless command surface (standards, circuit, sim, mesh, refine, anchors, live)
  api/         Bun HTTP + WebSocket server, scenario session, spectator feed, live handset ingest
  agent/       Crowd Ops LLM agent behind a safety-reviewed proposal seam
apps/
  dashboard/   operator console (Vite, vanilla TS, no framework)
  mobile/      spectator app (Expo / React Native) + radio sensing stack + native Kotlin mesh module
circuits/
  index.yaml   all 23 rounds of 2026 indexed with per-circuit coordinate frames
  silverstone/ the one committed data pack + rendered SVG (anchors.json is generated, never committed)
plan/          vision, architecture, decisions, standards, methods, open questions
```

---

## Verified working

Every item below was executed, not read off a checklist.

### The proof gate

```
bun run crowdflow -- sim ab silverstone --count 6000 --ticks 700 --seed 42
```

```
A/B - Silverstone Circuit, post-race-egress
  6000 spectators, seed 42, participation 18%
  identical seed both arms; only the intervention differs

  metric                                 without        with    change
  peak density (ped/m2)                      4.0         4.0     +0.0%
  critical zone-seconds                   2746.0      1792.0    -34.7%
  building zone-seconds                   7560.0      7050.0     -6.7%
  peak simultaneous critical zones           9.0         7.0    -22.2%
  peak queued (people)                    1808.0      1569.0    -13.2%
  arrived                                  270.0       270.0     +0.0%
  mean walk (s)                            992.0       992.0     +0.0%
  p95 walk (s)                            1236.0      1236.0     +0.0%
  interventions dispatched                   0.0         1.0     +0.0%
  rejected by safety                         0.0         0.0     +0.0%

  GATE PASSED
```

Both arms use the same seed. Only the intervention differs. This is a real counterfactual,
not a printed constant.

### The API

Boots, holds a session, streams ticks. Endpoints:

| Method | Path | Status |
|---|---|---|
| GET | `/api/health` | works |
| GET | `/api/standards` | works, returns Fruin LOS bands with citation |
| GET | `/api/circuits` | works, reports 1875 zones / 2404 edges |
| GET | `/api/circuits/:id/geometry` | works |
| GET | `/api/circuits/:id/scenarios` | works, resolves real stand and car park IDs |
| GET | `/api/session` | works |
| POST | `/api/session` | works, starts a seeded scenario |
| POST | `/api/session/control` | works, play / pause / step / speed |
| GET | `/api/spectator/view` | works, returns a routed path with per-leg walk times |
| GET | `/api/circuits/:id/anchors` | works, serves the radio survey; empty pack, never 404 |
| GET | `/api/events` | works, the season as races; `has_map` marks which are guidable |
| GET | `/api/events/current` | works, the race running now or the next one |
| GET | `/api/events/:id` | works |
| POST | `/api/live` | works, arms handset ingest; refuses without a participation estimate |
| GET | `/api/live` | works, the live phone picture with rejections named |
| DELETE | `/api/live` | works, forgets every sample and counter |
| POST | `/api/nodes` | works, one handset batch; 503 until ingest is armed |
| WS | `/ws` | works, hello frame then tick frames plus 500 ms heartbeat |

A tick envelope carries per-zone density, flow, queue excess, mean speed, Fruin LOS grade,
band, and a confidence object with observed node count, freshness, accuracy and a
`reportable` flag. Unobserved zones report `unknown`, never `empty`.

### The circuit pack

Real geometry imported from OSM and the f1-circuits dataset. Silverstone: 1,875 zones,
2,404 edges, 5,891 m track length, correct lat/lon origin and metric frame, 17 tagged
grandstands. Deterministic SVG render committed alongside it.

### The dashboard

Builds in 124 ms to 34 KB JS + 12 KB CSS. Seven panels: header, map, zone table, prediction,
intervention alternatives, event feed, metrics strip. Connects over the Vite proxy with `ws: true`.
Fetches geometry only after the socket hello names the circuit, and degrades to zone IDs rather
than blocking on a blank screen. Link state is drawn in the header and frame age counts up in
front of the operator.

### The CLI

```
crowdflow standards
crowdflow band <density-persons-m2>
crowdflow circuit list|show|import|validate|render [id]
crowdflow sim run|traces|ab [id] [--count N --ticks N --seed N]
crowdflow mesh compare [--nodes N --ticks N --seed N]
crowdflow refine run [id] --traces file.jsonl --participation 0.18 [--apply]
crowdflow anchors show|plan|accuracy [id] [--spacing M --write --samples N --sigma dB --kinds ...]
crowdflow live rehearse [id] [--api URL --phones N --ticks N --interval S --radios wifi,ble,gnss]
crowdflow calendar import|show [--season 2026 --write --jolpica-only]
```

All present and dispatching.

`calendar import` builds the season from two live sources and joins them **by race date**:
Jolpica (`api.jolpi.ca`) is the authority on which races exist — it is the Ergast replacement, and
ergast.com itself now returns 404 — and OpenF1 (`api.openf1.org`) is the authority on when
sessions run, since it publishes ends as well as starts. Joining on names would need a mapping
table for `spa` against `Spa-Francorchamps`; two grands prix never share a date. The result is
committed, because a venue with a saturated cell network must still be able to say when the race
ends.

`anchors accuracy` is the headless answer to "would radio positioning work at this venue": it
puts a known position in, generates the scan the log-distance law would produce, solves it blind
and measures the true error. `live rehearse` is the same idea one layer up — a crowd of simulated
handsets driving the real solve, ladder, pseudonym rotation and HTTP ingest, so the operator
picture can be exercised without a single device.

### Tests

| Workspace | Files | Tests |
|---|---:|---:|
| `@crowdflow/contracts` | 1 | 7 |
| `@crowdflow/core` | 6 | 56 |
| `@crowdflow/cli` | 1 | 3 |
| `@crowdflow/api` | 3 | 15 |
| `@crowdflow/agent` | 2 | 9 |
| `@crowdflow/hf` | 2 | 9 |
| `crowdflow-dashboard` | 2 | 22 |
| `crowdflow-spectator` | 14 | 147 |
| **Total** | **31** | **268** |

`make test` runs typecheck then every suite. Both pass.

---

## Module inventory

### `@crowdflow/contracts`

Single source of truth. TypeScript is authored, JSON Schema is generated (48 schema files) with
a byte-for-byte drift test in CI via `make codegen`. 72 exported standards constants, each with
a citation or a measurement; anything unmeasured is prefixed `ASSUMED_` so it cannot hide.

The sensing contracts are here too — `RadioAnchor`, `RadioObservation`, `PositionFix`,
`NodeReport`, `IngestAck`, `SensingStatus` — and the shape of `NodeReport` is the privacy design:
it carries positions and nothing else, so there is nowhere to put the scan a position was solved
from. `SurveyReport` is the one contract that does carry raw observations, and it is a staff walk
test on a separate endpoint under a separate consent.

`Position` is metric x/y in the circuit's own frame. Latitude and longitude exist only at the
pack origin, deliberately.

### `@crowdflow/core`

Pure. Performs no I/O. 24 exported modules:

| Module | Purpose | State |
|---|---|---|
| `state/flow` + `state/engine` | density-based zone aggregation, confidence, LOS grading | working |
| `routing/graph` | dynamic graph, congestion-weighted Dijkstra, bounded LRU, crossing-aware | working |
| `prediction/baseline` | deterministic `baseline-v1`, needs 3 ticks of history | working |
| `intervention/whatif` | counterfactual over 5 diversion fractions, walk cost 8 per minute | working |
| `positioning/geo` | the only place lat/lon exists: local tangent-plane projection, venue rotation, boundary test | working |
| `positioning/pathloss` | log-distance ranging, per-anchor curves, range sigma from the model gradient | working |
| `positioning/solve` | weighted Gauss-Newton trilateration, colinearity fallback, covariance-floored accuracy | working |
| `positioning/anchors` | anchor index, dual-band collapse, unmatched-anchor counting | working |
| `positioning/fuse` | the Wi-Fi / BLE / GNSS ladder: hysteresis, ceiling, jump test, bounded dead reckoning | working |
| `positioning/track` | rotating pseudonym, `CrowdNode` shaping, decimetre rounding | working |
| `positioning/survey` | anchor deployment plans and the headless accuracy harness | working |
| `safety/engine` | mandatory review; nothing dispatches without a verdict | working |
| `loop` | the tick loop, 300 s command TTL | working |
| `metrics` | run metrics including the A/B gate figures | working |
| `simulation/model` + `scenario` | seeded crowd simulator, the only `CrowdNode` producer | working |
| `venue` + `venue-build` | OSM import, metric frame, barrier subtraction, width provenance | working |
| `participation` | private keyed Bottom-k, Chapman capture-recapture estimation | working |
| `mesh/privacy` | on-device planar-Laplace noise with epsilon attached | working, unused by any handset |
| `mesh/policy` + `uplink` + `fanin` | Spray-and-Wait, uplink election, dedupe and clock-skew fan-in | working, simulated only |
| `mesh/simulator` | seeded protocol comparison over one shared moving topology | working, transport-free by design |
| `refinement/*` | trace matching, capacity, staleness audit, desire lines, reports | working, dry-run first |
| `random` | seeded RNG, the reason every run reproduces | working |

### `@crowdflow/api`

HTTP + WebSocket over Bun's Node-compatible server. Owns `ScenarioSession` (the tick loop
adapter) and `SpectatorFeed` (translates operator conclusions into the small phone-facing view).
The operator envelope never reaches the app. Relative simulation freshness is converted to
wall-clock exactly once, at this boundary.

### `@crowdflow/cli`

Equal adapter to the API, not a wrapper around it. Owns circuit import, validation, SVG render,
seeded simulation, trace production and pack refinement write-back.

### `@crowdflow/agent`

`CrowdOpsAgent` with a `Toolbox`, an `InsightEngine` that computes statistical self and peer
baselines before any narration, and a proposal seam that can only produce
`{command, verdict}` records. It has no dispatch operation. Model client is abstracted behind
`ModelClient` with a `FakeModelClient` used by the tests.

### `crowdflow-dashboard`

Vanilla TypeScript, no UI framework. Type-only imports from `@crowdflow/api/wire`, so nothing
crosses the bundle boundary at runtime and there is no generated alias to drift.

### `crowdflow-spectator`

Expo / React Native / React Native Web. Six screens: Ahead, Walk, Hold, Rerouted, Arrival,
Offline. Every screen is a pure function of a `SpectatorView`. Two shells: `LiveShell` (polls the
API every 2 s) and `DemoShell` (scripted mock day). Native Kotlin mesh module at
`modules/mesh` with a `MeshNetwork` interface, foreground service, and typed error surface.

---

## Connection map

```
contracts ──> core ──> cli ──> api ──> dashboard        FULLY CONNECTED, RUNNING
     │           │              │
     │           │              └──> mobile (HTTP, only when env-configured)
     │           │
     │           └──> core/positioning ──> mobile/sensing ──> POST /api/nodes
     │                                            │                  │
     │                                    Wi-Fi / BLE / GNSS      LiveIngest ──> LIVE PHONES panel
     │
     └──> mobile (type-only)

agent ──> (nothing)                                     ORPHANED
mesh Kotlin ──> StubMeshNetwork only                    STUBBED
phone radios ──> real adapters, unwalked anchor map     CONNECTED, UNSURVEYED
```

### Connected and exercised

- `contracts -> core -> cli`: the CLI drives the engines directly and produces the gate.
- `core -> api -> dashboard`: session ticks flow over WebSocket into live panels.
- `api -> mobile`: `LiveSpectatorFeed` polls `/api/spectator/view` and renders real routes.
- `core/positioning -> mobile/sensing -> api -> dashboard`: the sensing ladder solves a position
  from radio scans, shapes a `CrowdNode` under a rotating pseudonym, POSTs it to `/api/nodes`, and
  the LIVE PHONES panel draws it. Proven end to end by `packages/api/tests/rehearse.test.ts` and
  by `crowdflow live rehearse`, both of which drive the real solve, ladder and HTTP path with
  simulated radios.
- Both apps consume authored TypeScript contracts directly, so there is no codegen drift risk.

### Built but not connected

| Component | Reality |
|---|---|
| `@crowdflow/agent` | Zero importers outside its own tests. Not referenced by the API, CLI, dashboard, Makefile, or any config. No `ANTHROPIC_API_KEY` is read anywhere in the repo. It is a library with no caller. |
| `StubMeshNetwork` | The only `MeshNetwork` implementation. In-memory, `isOnline` hardcoded `false`, talks to nobody. No Wi-Fi Aware, Wi-Fi Direct or BLE exists. |
| Radio survey | **The one that matters.** No anchor has ever been walked. Every anchor pack this repo can produce comes from `crowdflow anchors plan`, which places hardware where hardware *would* go: `surveyed_at` is null, every `Sourced` value is `provenance: 'assumed'`, and both the solver's weighting and the app's status screen say so. `anchors accuracy` measures the **geometry** of a layout, not whether the log-distance law holds at the venue. Until a walk test exists, Wi-Fi and BLE positioning is demonstrable, not validated. |
| Wi-Fi on iOS | Permanently unavailable, not a gap to close. iOS has no public access-point scan API. The Wi-Fi rung exists on Android only, and the app reports that in words rather than appearing broken. |
| Radio native modules | `react-native-wifi-reborn` and `react-native-ble-plx` are old-architecture community modules running through the RN 0.86 bridgeless interop layer; that is unverified on a device. Both are `require`d lazily and report themselves unavailable when missing, so removing either from `package.json` degrades the ladder without a code change. |
| Anchor pack size | Served whole. An 80 m plan for Silverstone is ~2,300 anchors and over a megabyte, downloaded over the same saturated cell network that justifies the mesh. A per-zone filter does not exist yet. |
| Live participation rate | `POST /api/live` requires an operator estimate and `LiveSnapshot` labels it `assumed`. `estimated_population` is reporting devices divided by it, so the label is load-bearing. `estimateParticipation` (capture-recapture over private sketches) exists in core and is not wired to anything; MAC randomisation is the obstacle. |
| `StubMeshNetwork` as uplink | Handset reports go over HTTP directly. The opportunistic mesh uplink (D7) — batches relayed peer to peer to whichever phone has a data connection — is the design, and `Uplink` queues for it, but the transport underneath is still HTTP-or-nothing. |
| Mobile live guidance | `App.tsx` renders `LiveShell` only when `EXPO_PUBLIC_CROWDFLOW_API`, `_ORIGIN` and `_DESTINATION` are all set. Origin and destination are static config; the guidance does not yet re-route from the sensed position, even though that position is now available. |

### Data holes in the committed pack

| File | State | Consequence |
|---|---|---|
| `crossings.json` | `{}` | D5 (time-gated crossings) is implemented in `routing/graph` but never exercised |
| `constraints.json` | three empty arrays | no-route zones, emergency exits and accessible routes are all unconstrained |
| widths | 2,402 of 2,404 edges untrustworthy | capacity figures lean on assumed defaults |
| circuits | 1 of 23 committed | importer is generic, only Silverstone is proven |

---

## Checkpoints

### Done

**Runtime and contracts**
- [x] Bun 1.3 with one root workspace and one lockfile
- [x] strict TypeScript across contracts, core, CLI, API and agent
- [x] authored TypeScript wire contracts consumed directly by both apps
- [x] deterministic TypeScript to JSON Schema generation with drift tests (39 schemas)
- [x] 48 standards constants, each cited, measured, or explicitly `ASSUMED_`
- [x] Kotlin confined to `apps/mobile/modules/mesh/android`
- [x] no Python, no second package manager, no second lockfile

**Venue and loop**
- [x] cached OSM / f1-circuits import, metric frame, barrier subtraction
- [x] provenance-aware widths and conservative semantic attachment
- [x] deterministic SVG render
- [x] dynamic graph, crossing availability, bounded LRU, constrained routing
- [x] density-based state aggregation; unknown never means empty
- [x] deterministic prediction, counterfactual intervention, mandatory safety review
- [x] tick loop with command TTL
- [x] seeded CLI simulation, trace production, dry-run-first refinement, A/B evaluation
- [x] Silverstone pack validates at 1,875 zones / 2,404 edges
- [x] full seed-42 gate: critical zone-seconds 2746 to 1792, one dispatch

**Surfaces**
- [x] dense operator console: map, zone table, prediction, alternatives, feed, metrics
- [x] link state and frame age visible to the operator at all times
- [x] phone-sized spectator view; operator envelope never reaches the app
- [x] unobserved route legs remain `unknown`
- [x] only the exact safety-dispatched reroute becomes an offer, retained until expiry
- [x] freshness translated to wall-clock exactly once, at the API boundary
- [x] live mobile shell uses the API when configured

**Mesh and privacy (simulated)**
- [x] native Expo module, autolinking, Android foreground-service lifecycle
- [x] bounded dedupe and buffer, Spray-and-Wait defaults, rate-limited urgent flooding
- [x] seeded shared-topology protocol comparison with explicit coverage reporting
- [x] opportunistic uplink election
- [x] fan-in dedupes overlapping reports and reconciles one-way clock skew
- [x] on-device planar-Laplace trace noise with epsilon attached
- [x] private keyed Bottom-k, coordinated overlap, Chapman participation estimation

**Refinement and agent**
- [x] trace matching, privacy-debiased width, sustained capacity, staleness audit
- [x] desire lines are proposals; adoption requires explicit operator application
- [x] no recapture overlap returns unknown participation
- [x] statistical self and peer baselines computed before any narration
- [x] agent has no dispatch operation, only safety-reviewed `{command, verdict}` records

### Not done

**Blocking a real deployment**
- [ ] no location acquisition on the phone at all: add `expo-location`, permissions, iOS usage
      description, and a foreground position stream
- [ ] no path from a handset to a `CrowdNode`: the contract and privacy layer exist, nothing fills them
- [ ] origin and destination are static env vars; the app does not know where the user is or
      that they have moved
- [ ] real Wi-Fi Aware to Wi-Fi Direct to BLE transport behind `MeshNetwork`
- [ ] Android Kotlin has never been compiled; this host has no `ANDROID_HOME`
- [ ] no handset capability or walk tests

**Wiring already-built components**
- [ ] `@crowdflow/agent` is not reachable from any surface: no API route, no CLI subcommand, no
      dashboard panel, no key plumbing
- [ ] agent default model is `claude-opus-4-6`, a generation behind current
      (`packages/agent/src/client.ts:20`)
- [ ] agent sends `thinking: {type: 'enabled', budget_tokens}`, which is deprecated on 4.6 and
      returns a 400 on Opus 5, Sonnet 5 and 4.7 or later; it needs `{type: 'adaptive'}` plus
      `output_config.effort` (`packages/agent/src/client.ts:26`)
- [ ] mobile defaults to the mock feed; live mode is opt-in via three env vars

**Data**
- [ ] Silverstone crossing identities and schedules; `crossings.json` is empty
- [ ] venue constraints: no-route zones, emergency exits, accessible routes all empty
- [ ] edge widths: 2,402 of 2,404 remain untrustworthy
- [ ] a second deep circuit pack; the importer is generic but unproven beyond one venue
- [ ] no `SKILL.md` exists for any circuit, so the agent half of D4 is unimplemented
- [ ] measured live-event participation, capacity, radio range and hop latency

**Housekeeping**
- [ ] Expo / React Native / Metro advisories: 18 open (7 moderate, 11 high). No patched
      compatible dependency chain is published; the package manager's suggested fix is an
      incompatible downgrade

---

## Running it

```
make install     bun install --frozen-lockfile
make console     API + dashboard, http://127.0.0.1:5199
make api         API only, http://127.0.0.1:8099
make dashboard   console only
make test        typecheck + every Vitest suite
make codegen     regenerate JSON Schema and fail on drift
make gate        the seeded Silverstone intervention A/B
make build       build every workspace
```

Mobile, live mode:

```
EXPO_PUBLIC_CROWDFLOW_API=http://127.0.0.1:8099 \
EXPO_PUBLIC_CROWDFLOW_ORIGIN=stand_227342440 \
EXPO_PUBLIC_CROWDFLOW_DESTINATION=park_1120614867 \
bun run --filter crowdflow-spectator start
```

Without those three variables the app renders the scripted demo instead.

---

## Standing invariants

These hold today and should be treated as load-bearing:

- assumptions are registered or labelled `ASSUMED_`
- `core` performs no I/O
- density is the sole operational classifier, never flow
- simulator and phone share one `CrowdNode` contract
- nothing dispatches without `SafetyEngine.review()`
- the LLM never computes a route, density or prediction
- simulations and policy comparisons are seeded
- circuit selection is data-driven, never hardcoded

---

## Decisions

| | Decision |
|---|---|
| D1 | Bun/TypeScript monorepo; contracts authored once in TypeScript, JSON Schema generated |
| D2 | CLI-first over a pure core library; API and CLI are equal adapters |
| D3 | React Native + Expo; mesh is a native Kotlin module at the `MeshNetwork` seam |
| D4 | Each circuit is a data pack plus a `SKILL.md` for the agent |
| D5 | Track crossings are time-gated, so routing is time-dependent |
| D6 | Venue structure is imported from OSM and the official map; traces refine it, never create it |
| D7 | Any connected node is a gateway; no fixed uplink infrastructure |
| D8 | The surfaces are deliberately asymmetric: app simple and beautiful, console dense and organised |

Rationale, alternatives and revisit conditions are in [`plan/decisions.md`](./plan/decisions.md).
