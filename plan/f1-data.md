# CrowdFlow — F1 Data Sources

What is freely available, what it gives us, where it plugs into the system, and — importantly
— what it does **not** give us.

---

## 1. The four sources worth using

| Source | Licence / cost | Gives us | Plugs into |
|---|---|---|---|
| **Jolpica-F1** | Free, open source, 200 req/hr unauth | Calendar, sessions, circuits, results, quali, standings, lap times | `events/*.yaml` |
| **OpenF1** | Historical (2023+) free, no auth; **real-time is paid** | Driver positions, car telemetry, race control messages, session/meeting state, weather | Session state machine, dashboard, app |
| **bacinger/f1-circuits** | Free, GeoJSON | Track outline per circuit, bbox, length, altitude | Circuit pack geometry |
| **FastF1 upstream data** | Free ecosystem dataset/API source; no runtime dependency | Corner positions, marshal sectors, track rotation, telemetry | Optional build-time viewing-area naming, sightlines |

### Jolpica-F1 — the Ergast replacement

Ergast was deprecated at the end of 2024. Jolpica is a drop-in, backwards-compatible
replacement at `http://api.jolpi.ca/ergast/f1/`, maintained by volunteers, aiming to break even
across the 2026 season.

Use it for the **calendar and session timetable** — which is exactly the `EventProfile` input
described in [`circuits.md`](./circuits.md) §4. This makes event profiles generated rather than
hand-typed:

```
GET /ergast/f1/2026/races.json     → round, circuitId, date, time, per-session times
GET /ergast/f1/circuits.json       → circuitId, name, locality, country, lat/long
```

**Watch the rate limit.** 200 requests/hour unauthenticated means fetch-and-cache at build
time, never per-request from the app.

### OpenF1 — live session state and driver positions

18 endpoints. The ones that matter to us:

| Endpoint | Content | Why we care |
|---|---|---|
| `sessions` / `meetings` | Session identity, start/end, type | Drives the session state machine → **crossing availability** |
| `race_control` | Flags, safety car, red flag, incidents | **Crowd-movement triggers** — see §3 |
| `position` | Driver classification over time | Dashboard + app context |
| `location` | Driver X/Y/Z on circuit | Track-side visual on the dashboard |
| `car_data` | Speed, throttle, brake, gear, RPM at ~3.7 Hz | Flavour only — not needed for crowd logic |
| `weather` | Track/air temp, rainfall | Rain slows walking; feeds the movement model |

**Critical constraint:** real-time OpenF1 requires a paid subscription; historical data from
2023 onward is free and unauthenticated. For a hackathon this is fine — **replay a real session
from history** and treat it as live. That is better than paying, and it also makes the demo
seeded and repeatable, which D2 wanted anyway.

### bacinger/f1-circuits — track geometry

Per-circuit GeoJSON, e.g. `circuits/gb-1948.geojson` for Silverstone:

```json
{
  "type": "FeatureCollection",
  "name": "gb-1948",
  "bbox": [ ... ],
  "features": [{
    "properties": {
      "id": "gb-1948", "Location": "Silverstone",
      "Name": "Silverstone Circuit",
      "opened": 1948, "firstgp": 1950,
      "length": 5891, "altitude": 196
    },
    "geometry": {
      "type": "LineString",
      "coordinates": [[-1.015349, 52.07879], [-1.01262, 52.078936], ...]
    }
  }]
}
```

Note `[longitude, latitude]` ordering, and that `length` is in metres. The `bbox` gives us the
circuit pack's coordinate frame bounds directly, and the first coordinate is a reasonable
choice of local origin.

### FastF1 — corners and sectors

`session.get_circuit_info()` returns corner locations, marshal lights, marshal sectors, and
track-map rotation. Corners come as a DataFrame with `X, Y, Number, Letter, Angle, Distance`.

The docs are explicit that this data is manually created and **not highly accurate** — it is
intended for annotating plots. That is fine for our use: naming grandstands by the corner they
overlook and defining sightlines. Do not use it as survey data.

---

## 2. The gap — and why it is not a problem

**None of these sources describe spectator infrastructure.**

There is no free API for grandstand locations, gate positions, concourse layouts, track
crossings, capacities, or fan-zone boundaries. Every source above describes *the track* — where
the cars go. CrowdFlow is about *the other side of the fence*.

```
   What the APIs give us          Where the rest comes from
   ─────────────────────          ─────────────────────────
   Track centreline          →    geometric anchor + coordinate frame
   Corner positions          →    naming and sightlines
   Session timetable         →    EventProfile
   Race control              →    prediction features  (see §3)
   Driver positions          →    operator context
   ───                            Gates, capacity      ← observed from traces
                                  Grandstands          ← observed from traces
                                  Concourses           ← observed from traces
                                  Crossings            ← observed from traces
```

**The app supplies what the APIs cannot.** Every participating phone contributes anonymous
geotagged movement over the mesh, and the union of those traces is a direct observation of the
spectator side: where people can walk, how fast, in which direction, at what hour, and how many
fit before flow breaks down. See [`decisions.md`](./decisions.md) D6.

So the division is clean, and neither half depends on the other being purchased:

| Layer | Source | Cost |
|---|---|---|
| The track | Public open data | Free, available today for all 23 circuits |
| The spectator side | The crowd itself | Free, and improves with every event |

This is a better position than owning a hand-built venue model. A traced seating map is a static
asset that rots as the venue changes; an inferred graph re-derives itself every event, and
carries capacities that reflect what the space has *actually* carried rather than what a plan
says it should.

The open work is not acquisition but inference — see [`open-questions.md`](./open-questions.md)
Q6 for the trace-to-graph methods, and Q7 for cold start at a venue nobody has walked yet.

---

## 3. The insight worth building on: race events move crowds

Race control messages are not decoration. They are **leading indicators of crowd movement**:

```
   race_control event              crowd response
   ──────────────────              ──────────────
   Session ends              →     mass egress from viewing areas    (largest signal)
   Red flag                  →     partial egress, concourse surge
   Safety car / incident     →     movement toward the incident sector
   Session about to start    →     crossings close, infield commits
   Podium ends               →     the true peak — everyone leaves at once
```

This closes the loop with `plan.md` §40. The prediction engine gains features that are *not
derivable from movement alone*: it knows a surge is coming because it knows the chequered flag
just fell, roughly eight minutes before density confirms it.

That is the difference between predicting from the crowd and predicting from the **event**.

---

## 4. Where each source enters the architecture

```
   Jolpica /races          ──►  events/*.yaml  ──►  session state machine (J4)
                                                          │
   OpenF1 /sessions        ──────────────────────────────►│
   OpenF1 /race_control    ──────────────────────────────►│──►  crossing availability (A4)
                                                          │──►  prediction features (D1)
                                                          └──►  simulator demand (B4)

   f1-circuits GeoJSON     ──►  circuit pack frame + track outline  ──►  renderer (A6)
   FastF1 circuit_info     ──►  corner names, sightlines            ──►  viewing.yaml

   OpenF1 /position        ──►  dashboard context strip
   OpenF1 /location        ──►  dashboard track visual
   OpenF1 /weather         ──►  movement model (rain → slower walking)
```

Everything that affects crowd logic passes through the session state machine. Everything else
is presentation.

---

## 5. What the app and dashboard should surface

**Spectator app** — keep it minimal (`plan.md` §23). F1 context earns its place only where it
helps the user decide where to walk:

- Current session + time remaining
- Live classification, top 3 (a reason to open the app at all)
- Their grandstand / viewing zone
- **Route and congestion** — the actual product
- Crossing status: *"Farm crossing closes in 6 min"* ← genuinely useful, uniquely ours

**Operator dashboard** — F1 context is operational:

- Session state and countdown, because it gates crossings
- Race control feed, because it predicts surges
- Live classification, because it predicts *where* people gather
- Weather, because it changes walking speed

---

## 6. Integration plan

| Phase | Work | Track |
|---|---|---|
| 1 | Vendor circuit GeoJSON into packs; derive frame + bounds | A1, A2 |
| 2 | Generate `events/*.yaml` from Jolpica; cache locally | J4 |
| 3 | Replay a historical OpenF1 session as the demo's "live" feed | J4, O4 |
| 4 | Map `race_control` events to prediction features | D1 |
| 5 | Driver classification strip on dashboard and app | M, L5 |

**Rule:** every external API is fetched, cached to disk, and replayed. Nothing in the demo path
makes a live third-party call — hackathon Wi-Fi will not cooperate, and `plan.md` §37 already
committed us to working offline.

---

## Sources

- [jolpica/jolpica-f1](https://github.com/jolpica/jolpica-f1) — Ergast-compatible replacement API
- [Ergast deprecation discussion](https://github.com/theOehrly/Fast-F1/discussions/445) — context on the 2024 shutdown
- [OpenF1 API docs](https://openf1.org/docs/) — 18 endpoints, real-time and historical
- [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) — circuit outlines in GeoJSON
- [FastF1 circuit info](https://docs.fastf1.dev/circuit_info.html) — corners, marshal sectors, rotation
- [FastF1 corner annotation example](https://docs.fastf1.dev/gen_modules/examples_gallery/plot_annotate_corners.html)
