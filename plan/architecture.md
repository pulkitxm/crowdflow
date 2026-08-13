# CrowdFlow — Architecture

Authoritative for repository structure, module boundaries, and runtime layout.
For *why* these choices were made, see [`decisions.md`](./decisions.md).
For the vision, [`plan.md`](./plan.md). For work decomposition, [`breakdown.md`](./breakdown.md).

---

## 1. Two seams hold the system together

Everything else is detail. Get these two right and the parts stay swappable.

### Seam 1 — core library vs adapters

```
              ┌──────────────────────────────┐
              │      packages/core           │
              │                              │
              │  venue · simulation · state  │
              │  prediction · intervention   │
              │  routing · safety            │
              │                              │
              │  pure functions over state   │
              │  no I/O, no sockets, no LLM  │
              └──────────────┬───────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         packages/cli   packages/api   packages/agent
           (Node)          (Node)        (tool layer)
```

The CLI is not a scaffold to be replaced by the API. Both are permanent, equal adapters.
The CLI is how the system is tested, evaluated, seeded, and demonstrated headlessly; the API
is how it is watched live.

**Rule:** if a function in `core` imports a web framework, a socket, or an LLM client, it is
in the wrong package.

### Seam 2 — TypeScript vs native, on the mobile side

```
     TypeScript  ── UI, map, route display, local routing,
          ▲          telemetry composition, app state
          │
  ════════╪════════  ← MeshNetwork interface  (plan.md §5)
          │
     Kotlin      ── Wi-Fi Aware / Direct / BLE, peer sessions,
                    TTL, sequence dedupe, relay decisions,
                    local aggregation, foreground service
```

The interface is deliberately narrow and low-frequency. Native does the chatty work —
per-packet receipt, dedupe, relay — and surfaces only aggregated zone state and inbound
commands to JS. This follows `plan.md` §8: aggregate locally, transmit summaries.

```
MeshNetwork
├── discoverPeers()      ├── sendMessage()
├── connectPeer()        ├── broadcast()
├── disconnectPeer()     ├── relayMessage()
└── getNearbyNodes()
```

---

## 2. Repository layout

```
vmax/
│
├── packages/
│   ├── contracts/        authored TS + JSON Schema [P0 — blocks everything]
│   ├── core/             the engines (pure TypeScript)
│   ├── cli/              Node adapter
│   ├── api/              Node HTTP/WebSocket adapter
│   └── agent/            crowd ops agent + tools
│
├── apps/
│   ├── dashboard/        operator web app
│   └── mobile/           expo spectator app
│       └── modules/mesh/ native Kotlin module
│
├── circuits/             per-circuit data packs + agent skills
├── events/               per-weekend session timetables
├── scenarios/            seeded simulation configs
├── models/               trained models + calibration
│
├── plan/                 planning documents (this folder)
└── docs/                 protocol.md, demo.md
```

### What belongs where

| Path | Owns | Must not contain |
|---|---|---|
| `packages/contracts` | Authored TypeScript contracts, runtime conclusions, generated JSON Schema | Business logic |
| `packages/core` | Venue graph, simulator, state, prediction, intervention, routing, safety | I/O, transport, LLM calls |
| `packages/cli` | Command surface, arg parsing, output formatting | Engine logic |
| `packages/api` | WebSocket/REST handlers, the tick loop, broadcast | Engine logic |
| `packages/agent` | Tool definitions, reasoning loop, memory | Direct control of actions — safety vetoes first |
| `apps/dashboard` | Rendering state it receives | Any computation of state |
| `apps/mobile` | Spectator UI, local routing | Mesh transport (that's `modules/mesh`) |
| `circuits/` | Data only, schema-validated | Code |
| `scenarios/` | Config only, seeded | Code |

The last two matter: **a circuit or scenario that needs code to load is a broken pack.**

---

## 3. Contracts and codegen

TypeScript is the source of truth for every runtime. JSON Schema is the generated,
machine-readable artefact.

```
   packages/contracts/src/types.ts        (TypeScript — authored here)
                 │
                 ├──────────────► core · api · agent · dashboard · mobile
                 │
                 ▼  deterministic Node codegen
   packages/contracts/schema/*.json       (JSON Schema — generated + committed)
```

Six contracts:

| Contract | Produced by | Consumed by |
|---|---|---|
| `CrowdNode` | simulator, phones | state engine |
| `ZoneState` | state engine | prediction, dashboard, agent |
| `Forecast` | prediction | intervention, dashboard |
| `InterventionCandidate` | intervention | routing, dashboard |
| `RerouteCommand` | routing → safety | gateway, phones |
| `MeshMessage` | phones | gateway |

Plus `CircuitPack` and `EventProfile` as validated data schemas (see [`circuits.md`](./circuits.md)).

Generated files are committed, so nobody is blocked waiting on a codegen step, and drift shows
up in review as a diff.

---

## 4. The tick loop

The closed loop from `plan.md` §49, implemented once in `packages/api` and reused by
`packages/cli` for headless runs. It is small, and it is the product.

```
   telemetry in  (simulator or mesh gateway)
        │
        ▼
   state.update()                    → ZoneState per zone
        │
        ▼
   prediction.forecast()             → Forecast, with confidence
        │
        ├── no risk ──────────────────────────────► broadcast, done
        ▼
   intervention.evaluate()           → candidates at 10/20/30/40%
        │
        ▼
   routing.build_command()           → RerouteCommand
        │
        ▼
   safety.review()                   → approved | rejected(reason)
        │
        ▼
   gateway.publish()  +  dashboard.broadcast()
        │
        └──────────────► phones reroute ──────► new telemetry
```

The agent observes and explains this loop; it does not sit inside it. Recommendations from the
agent re-enter at `safety.review()` like any other proposal.

---

## 5. Runtime topologies

**Development / evaluation — no network, no phones:**

```
scenarios/*.yaml → cli sim → cli state → cli predict → cli eval → report
```

**Demo — the M5 configuration:**

```
   simulator ──┐
               ├──► api tick loop ──► websocket ──► dashboard
   5 phones ───┘         │
     ▲                   │
     └── mesh gateway ◄──┘  (reroute commands)
```

**Degraded — gateway unreachable** (`plan.md` §37): phones keep meshing, aggregate locally,
route locally against the last known circuit pack, and reconcile on reconnect. The spectator
app must remain useful with no backend at all.

---

## 6. Tooling

| Concern | Choice | Note |
|---|---|---|
| Runtime/package manager | Node 24 + `npm` workspaces | One lockfile across packages and apps |
| Language | strict TypeScript | Contracts, core, CLI, API, agent and both app surfaces |
| Build orchestration | npm scripts + Make targets | Turborepo is overkill at this scale |
| CLI | Node + `tsx` | |
| Graph | local pure TypeScript implementation | No runtime framework dependency |
| Mobile | Expo dev client | **Not Expo Go** — native module required |

**Expo build discipline:** every native change requires a rebuild; JS changes are instant.
Build and freeze `modules/mesh` early, then live in TypeScript. Getting this order backwards
costs hours that will not exist later.

---

## 7. Invariants

Worth checking against before merging anything:

1. Simulator telemetry and phone telemetry are **byte-identical in format**. The core cannot
   tell which produced a record.
2. Nothing reaches the mesh without passing the safety engine.
3. The LLM never computes a route, a density, or a prediction. It reads, explains, and proposes.
4. Every simulation run is seeded and reproducible from a scenario file.
5. The dashboard computes nothing it could have been sent.
6. A circuit swap requires no code change.
