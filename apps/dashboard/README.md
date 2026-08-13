# Operator console

A control-room screen for race staff, read from three metres away mid-session.
Its brief is the opposite of the spectator app's: **complete, dense, well
organised**. Forty numbers on screen is correct if they are arranged well;
withholding information from an operator is the failure mode.

## Run it

From the repository root:

```
make console      # API + dashboard together, one Ctrl-C kills both
```

then open <http://127.0.0.1:5199>. Or run the halves separately, which is the
first thing to do when something misbehaves:

```
make api          # http://127.0.0.1:8099/api/health
make dashboard    # proxies /api and /ws to the API
```

Overridable: `CIRCUIT SCENARIO POPULATION SEED SPEED API_PORT UI_PORT`.

```
make console POPULATION=6000 SEED=7 SPEED=1
```

`make test` runs every workspace's `tsc --noEmit` and Vitest suite.

## What is on the screen

| Panel | Headline | Why it is there |
|---|---|---|
| Header | run parameters + feed age | A photograph of this strip reproduces the run. The age counter is driven by the console's own clock, so it keeps moving when the server stops. |
| Map | the real Silverstone graph | Schematic, not cartographic. 1,875 zones, 2,404 edges, the circuit outline, and every reporting device plotted individually. |
| Zones | one dense row per zone | Sortable by any column. Absent measurements never sort as zero. |
| Prediction | **time to event** | Not the current value. "T-02:47 to CRITICAL" drives a decision; "87% full" does not. Confidence sits beside the claim and the model is named. |
| Intervention | every option, rejected ones included | A recommendation without its alternatives is an assertion. The do-nothing baseline is always shown, and sometimes it wins. |
| Race control | timestamped transitions | The only panel with memory. Replayed on reconnect. |
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
and `@crowdflow/api/wire` directly from npm workspaces. JSON Schema is generated
from those TypeScript definitions and byte-for-byte checked by `make codegen`.
