# CrowdFlow — Open Questions

What is still undecided, why it matters, and a recommendation for each. Ordered by how much
rework the wrong answer causes.

Decisions already taken live in [`decisions.md`](./decisions.md). When one of these closes, it
moves there.

---

## Closed

| | Question | Resolution |
|---|---|---|
| Q1 | How long is the build? | **Not a constraint.** Build capacity comes from parallel Claude Code subagents, not headcount-days |
| Q2 | How many people, who owns what? | **Not a constraint.** Role-specialised subagents — reviewer, backend, frontend, AI, data analyst. The Android track is no longer at risk of being cut for capacity |
| Q3 | Which circuit is the deep one? | **Silverstone**, then the rest of the calendar in turn. All 23 rounds of 2026 are indexed in [`../circuits/index.yaml`](../circuits/index.yaml) |
| Q4 | Where does the venue structure come from? | **Imported from OSM + the official venue map**, before the event. See D6. Confirmed tractable: 17 tagged grandstands, 369 footways, 651 barriers at Silverstone |

Q1 and Q2 closing changes the shape of the plan: the milestone ladder in
[`breakdown.md`](./breakdown.md) is still the right *dependency order*, but it is no longer a
triage list. M6–M8 are not "if there's time" — they are scheduled work.

---

## Blocking — answer before the affected track starts

### Q5 · What is the UI design direction?

Still open, but no longer unanchored. Surveyed references are in
[`design-references.md`](./design-references.md): the established F1 live-timing conventions are
a far better starting point than anything invented, because spectators and race staff already
read them fluently.

Still needs deciding: whether to follow those conventions closely or only borrow their
information hierarchy, and whether to adopt a component library or author the visual layer.

**Recommendation:** borrow the information design wholesale (leaderboard-style dense rows,
mini-sector segmentation, live map with per-entity dots, race-control feed) and adopt a component
library for the visual layer. The novelty in this project is the prediction, not the chrome.

### Q6 · How does trace-to-graph inference actually work?

**Researched — see [`methods.md`](./methods.md) §1.** Map construction from trajectories is a
mature field with a public benchmark, seven compared algorithms, and open implementations. The
recommended pipeline is KDE density surface → alpha-shape walkable area → skeletonise →
junction refinement, borrowing CrowdInside's landmark trick: gates, crossings and grandstand
stairs are simultaneously drift-reset anchors and the semantic features we care about.

**Remaining decision:** whether to implement from the benchmark's existing code or build the
pipeline directly. Everything else is settled.

### Q7 · What is the cold-start behaviour at an unmapped venue?

**Researched — see [`methods.md`](./methods.md) §2.** Reframed as Bayesian rather than
sequential: track outline and OSM are a weak prior, traces are evidence, the graph is the
posterior. CrowdInside shows bootstrap-from-nothing is feasible, so this is a confidence-gating
problem, not an existence problem — inference feeds the model immediately, but the app only
after corroboration.

**Remaining decision:** the confidence threshold at which an inferred edge becomes routable.

### Q8 · Does the demo hardware support Wi-Fi Aware?

Unchanged and still worth doing first. Determines whether the mesh is Aware, Wi-Fi Direct,
BLE-only, or uplink-only. See D3 for the retreat path.

**Recommendation:** a thirty-minute check on the actual demo phones, before any mesh code is
written.

---

## Decide before the demo

### Q9 · How is participation rate obtained, and can we defend it?

**Researched — see [`methods.md`](./methods.md) §3.** Three routes: a ground-truth anchor from
turnstile/ticket counts (primary, and exact); **capture–recapture** where no ground truth exists,
which needs only overlap between two observation channels and therefore survives ID rotation;
and a dual-channel mesh-visible vs radio-visible ratio as cross-check. Unique counting uses
order-invariant private sketches, never stored IDs.

**Remaining decision:** whether a venue partner can supply per-session attendance. That single
number turns an estimate into a measurement, and is worth asking for early.

### Q10 · How much trace data leaves the phone, and in what form?

**Researched — see [`methods.md`](./methods.md) §4.** Resolved with geo-indistinguishability
(planar Laplace noise on-device) plus fragmentation, local aggregation, and private sketches for
counting.

The tension turns out to be smaller than it looked: map inference is density estimation over
thousands of traces, and zero-mean per-point noise averages out in aggregate. Strong per-user
deniability and an accurate inferred map are **compatible**, not traded. Worth stating plainly
in the pitch, because most location systems cannot say it.

**Remaining decision:** the ε / privacy radius, and the fragment length and rotation period —
which should be chosen together, then published in the app.

### Q11 · Which LLM, and are keys available?

Small but blocking for Track H. Cache the agent's demo-path responses regardless — live LLM
calls on venue wifi are an avoidable failure mode.

### Q12 · Is the "live" F1 feed a replayed session or synthetic?

Real-time OpenF1 is paid; historical from 2023 is free.

**Recommendation:** replay a real historical session and say so. Seeded, repeatable, free, and it
makes race-control-as-prediction-input concrete rather than hypothetical.

---

## Documents still to write

Neither blocks the critical path.

| Document | Contents | Write it when |
|---|---|---|
| `docs/protocol.md` | Mesh message spec: types, TTL policy, sequence windows, dedupe, relay rules, uplink election (D7), trace fragment format (Q10) | Before Track L8 |
| `docs/demo.md` | Run-of-show: scenario, seed, timings, fallbacks | After Q12 closes |

Also unspecified: exact metric formulas behind `breakdown.md` N1. "Peak density" and "bottleneck
duration" need definitions precise enough that before/after numbers compare across runs — now
anchored to the LOS bands in [`standards.md`](./standards.md), so this is narrower than it was.
