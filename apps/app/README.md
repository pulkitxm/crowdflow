# Unified app

A control-room screen for race staff, read from three metres away mid-session.
Its brief is the opposite of the spectator app's: **complete, dense, well
organised**. Forty numbers on screen is correct if they are arranged well;
withholding information from an operator is the failure mode.

## Run it

From the repository root:

```
make app
```

then open <http://127.0.0.1:5199/dashboard>. The live scenario control center is
available at <http://127.0.0.1:5199/simulator>, the HTTP endpoints are under `/api`, and
live dashboard updates use `/ws` on the same server.

Overridable: `CIRCUIT SCENARIO POPULATION SEED SPEED APP_PORT`.

```
make app POPULATION=6000 SEED=7 SPEED=1
```

`make test` runs every workspace's `tsc --noEmit` and Vitest suite.

## Scenario control center

The simulator page owns the authoritative run configuration, lifecycle controls,
emergency controls, live metrics, portal status, and event history. It can start,
pause, resume, stop, and reset a run without a separate API process. Reset and
clearing every hazard require typed confirmation.

Fire, gate, walkway, and exit hazards change the server-side venue graph. Closed
routes are excluded, restricted routes receive a capacity penalty, affected
people are rerouted, and people without a valid route remain in an awaiting-safe-
route state. Clearing a hazard restores its graph capacity without clearing other
active hazards. Emergency evacuation respects every active restriction and
reports progress, throughput, congestion, and estimated clearance time.

The documented large run is accepted directly by the browser form:

```
Population: 500000
Join rate per second: 1000
Tick interval: 1000
Duration: 86400
Movement scale: 90
```

Large runs use bounded modeled agents, reporting nodes, cohorts, and aggregate
counts. The dashboard does not create one DOM or canvas object per spectator.

## Control protocol

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/session/state` | Read the current authoritative scenario snapshot. |
| `POST` | `/api/session` | Validate configuration and start a session. |
| `POST` | `/api/session/control` | Pause, resume, stop, reset, or change speed. |
| `POST` | `/api/session/hazards` | Apply a fire, gate, walkway, or exit hazard. |
| `DELETE` | `/api/session/hazards/:id` | Clear one hazard by stable ID. |
| `DELETE` | `/api/session/hazards` | Clear all hazards with `CLEAR ALL` confirmation. |
| `POST` | `/api/session/evacuation` | Enable emergency evacuation mode. |

Every `/ws` connection receives an authoritative snapshot, including idle
connections and reconnects. Scenario revisions are monotonic, so browser clients
discard older updates. The simulator and dashboard receive lifecycle, hazard,
portal availability, rerouting, evacuation, congestion, and event-history changes
on the same origin.

## What is on the screen

| Panel | Headline | Why it is there |
|---|---|---|
| Header | run parameters + feed age | A photograph of this strip reproduces the run. The age counter is driven by the console's own clock, so it keeps moving when the server stops. |
| Map | the real Silverstone graph | Schematic, not cartographic. 1,875 zones, 2,404 edges, the circuit outline, and every reporting device plotted individually. |
| Zones | one dense row per zone | Sortable by any column. Absent measurements never sort as zero. |
| Prediction | **time to event** | Not the current value. "T-02:47 to CRITICAL" drives a decision; "87% full" does not. Confidence sits beside the claim and the model is named. |
| Intervention | every option, rejected ones included | A recommendation without its alternatives is an assertion. The do-nothing baseline is always shown, and sometimes it wins. |
| Gates & exits | live portal status | Entry and egress only — density band, net flow, queue. Click a row to focus it on the map. |
| Metrics | the A/B harness's own definitions | So the wall cannot flatter a run the Phase 3 gate would fail. |

## Rules the code enforces

**Every state shows a word and a number.** `dom.ts:stateCell` is the only way to
render a status and it takes both, so "colour alone" is not expressible.

**Unknown is not empty.** Three visibilities, three renderings — OBSERVED,
SILENT (reported inside the stale window, nothing this tick) and UNKNOWN (no
reporting device). On Silverstone about 97% of zones are UNKNOWN at any instant;
they are drawn as crosses, counted in the legend, listed behind a toggle, and
never shown as a zero. `src/model.test.ts` is mostly about this.

**No thresholds live here.** Band boundaries arrive from `/api/standards`, which
reads `@crowdflow/contracts/standards` at runtime. Bands arrive already classified
on `ZoneState.band`. Whether a forecast is actionable arrives as
`TickEnvelope.actionable`, computed by the contract runtime. The console
displays numbers; it does not compare them.

**Payload types are authored once.** The console imports `@crowdflow/contracts`
and `@crowdflow/contracts/wire` directly from Bun workspaces. JSON Schema is generated
from those TypeScript definitions and byte-for-byte checked by `make codegen`.
