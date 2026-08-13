# CrowdFlow — Design References

Surveyed rather than invented. F1 already has a mature, widely-read visual language for exactly
our problem shape: many entities moving around a circuit, changing state, needing to be read at a
glance under time pressure. Spectators and race staff parse it fluently. We should borrow it
rather than compete with it.

Answers [`open-questions.md`](./open-questions.md) Q5.

---

## 1. What exists

| Project | What it is | Worth taking |
|---|---|---|
| [slowlydev/f1-dash](https://github.com/slowlydev/f1-dash) | The most-used open-source live timing dashboard (~2k stars). Rust backend, Next.js frontend, SignalR ingest | Leaderboard density, mini-sector treatment, and — notably — it ships a **simulation module**, same as our Track B |
| [matteocelani/f1-telemetry](https://github.com/matteocelani/f1-telemetry) | Decodes the official F1 SignalR feed to WebSocket. Full leaderboard plus an **interactive SVG circuit map with live driver positions** | The closest existing analogue to our map pane: entities as dots on an SVG circuit, updating live |
| [f1stuff/f1-live-data](https://github.com/f1stuff/f1-live-data) | Weather, race control messages, timing | Race-control feed as a first-class panel — which our prediction engine consumes as input |
| [FraserTarbet/F1Dash](https://github.com/FraserTarbet/F1Dash) | Analytical dashboard over timing/telemetry | Post-session analysis framing, closer to our metrics view |
| [OpenF1](https://openf1.org/docs/) | The data layer several of the above sit on | Already our F1 data source — see [`f1-data.md`](./f1-data.md) |

Common architecture across all of them, worth noting because it matches ours independently:
**ingest → normalise → WebSocket → dense client UI**, with a simulation/replay path for
development.

---

## 2. Conventions to adopt

These are established F1 timing conventions. Their value is that they are *already understood* —
using them costs nothing to explain.

### Colour carries state, and the mapping is fixed

F1 timing uses purple / green / yellow for fastest-overall / personal-best / slower, universally
and without a legend, because the mapping never varies. The lesson is not the specific hues but
the discipline: **one fixed semantic mapping, never reused for anything else.**

Ours is the three LOS bands from [`standards.md`](./standards.md). Same rule: fixed meaning,
never borrowed for decoration, always paired with a word and a number so the reading survives
colour-blindness and a projector.

### Mini-sector segmentation

Timing screens break each lap into many small segments, each individually coloured. It shows
*where* on the circuit something happened, not just that it happened.

Direct analogue: segment each corridor and colour per segment rather than shading a whole zone.
A bottleneck forms at a point, not across a region, and segment-level rendering shows the front
of a queue advancing — which is exactly the leading indicator the operator needs.

### The leaderboard is dense and monospaced

Rows are tight, numbers are tabular, and a lot fits on one screen. Race staff read forty rows at
a glance. This is the right register for the zone list — resist the urge to make cards.

### The track map is schematic, not cartographic

Live timing maps are simplified outlines, not satellite imagery. Detail is spent on *entity
position and state*, not terrain.

Ours should follow: real circuit geometry from the f1-circuits dataset (it is the actual shape,
and recognisable), rendered flat and low-contrast so the crowd nodes on top carry all the visual
weight.

### Race control is a feed, and it is load-bearing

Every serious F1 dashboard shows race-control messages as a running list. For us it is not
context — the chequered flag is the largest crowd-movement trigger of the day, and the feed is a
prediction *input*. See [`f1-data.md`](./f1-data.md) §3.

---

## 3. What not to copy

- **Driver-centric framing.** Their entity is a car; ours is a zone. Do not build a leaderboard of
  people.
- **Telemetry depth.** Throttle traces and gear plots are irrelevant to crowd flow. Resist adding
  them because the data is available.
- **Dark-only.** Timing screens are dark because they are read in a garage. Our spectator app is
  read outdoors at midday and must be light. Same system, opposite ground.

---

## 4. The surfaces are not the same product

Governed by [`decisions.md`](./decisions.md) **D8**, and it overrides everything else in this
document. The references above are drawn from operator-grade timing screens, and most of what
makes them good is **actively wrong for the app**.

```
   SPECTATOR APP                      OPERATOR CONSOLE
   ─────────────                      ────────────────
   simple · beautiful · calm          complete · dense · organised
   one decision per screen            forty numbers, arranged
   minutes, and nothing else          every figure, with uncertainty
   plain words                        technical vocabulary
   read walking, in sunlight          read seated, trained, focused
```

**The test for any element: does it change where the user puts their feet in the next sixty
seconds?** If not, it belongs on the console. The app's restraint is not minimalism as taste —
it is that the app is used exactly when its user is least able to concentrate.

Beauty is a functional requirement for the app specifically. It is a consumer product competing
for attention at a live event; an ugly one does not get opened, and a system nobody opens has no
sensor network. For the console, beauty means *organisation* — legibility under time pressure,
not restraint.

Nothing is discarded, only routed: everything the app does not show goes to the console.

---

## 5. Standing rules for both surfaces

Carried forward as information-design constraints regardless of visual direction:

1. Density renders as **three ordinal bands**, never a continuous gradient. Operators act on
   three states.
2. Every state carries **a word and a number**. Colour is never the only channel.
3. **Time-to-event is the headline**, not the current value. "2:47 until capacity" drives a
   decision; "87% full" does not.
4. **Confidence sits next to the claim it qualifies**, always.
5. **Show the rejected options.** An intervention recommendation without its alternatives is an
   assertion; with them it is an argument.
6. **State the cost.** If a reroute adds walking time, that number appears beside the benefit.
7. **Unobserved is not empty.** With opportunistic uplinks (D7), regions can go unreported.
   They must render as unknown, never as quiet.
