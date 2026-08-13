# CrowdFlow — Constants and Their Sources

**No magic numbers.** Every threshold, rate, and coefficient in the system either cites a
published standard or is measured from data at runtime. If a value can be neither cited nor
measured, it does not belong in the code.

This document is the registry. A constant that is not listed here is a bug.

---

## 1. Why this matters more than it sounds

The first draft of this project had density bands at "40%" and "85%" of capacity. Both numbers
were invented. That is fatal for two reasons: a judge or a safety officer will ask where they
came from, and — worse — "capacity" was itself undefined, so the percentages were percentages of
nothing.

Pedestrian movement is a well-studied field with numbers that regulators actually use. We should
be using theirs.

---

## 2. Density and level of service

### Fruin's Level of Service (walkways)

The standard framework, from Fruin's *Pedestrian Planning and Design* (1971), still the basis of
most crowd-safety practice. Expressed as **flow rate: pedestrians per metre of width per minute**.

| LOS | Flow (ped/m/min) | Condition |
|---|---|---|
| A | < 23 | Free flow; slower pedestrians can be bypassed |
| B | 23 – 33 | Normal walking speed; bypassing possible in one-way flow |
| C | 33 – 49 | Some speeds restricted; two-way flow needs frequent adjustment |
| D | 49 – 66 | Majority of walking speeds restricted; frequent conflicts |
| E | 66 – 82 | Frequent stoppages and interruptions to flow |
| F | > 82 | Unavoidable contact; flow breaks down |

### Our three bands map onto it — but classify on DENSITY, not flow

The operator acts on three states, so LOS is collapsed into three, on **its** boundaries rather
than ours. But the classification runs on density, and that correction came out of building it:

| Band | LOS | Density (persons/m²) | Equivalent flow | Meaning |
|---|---|---|---|---|
| **Nominal** | A – C | < 0.75 | < 49 | People walk at chosen speed |
| **Building** | D – E | 0.75 – 2.0 | 49 – 82 | Restricted but still flowing &mdash; **the intervention window** |
| **Critical** | F | ≥ 2.0 | *unreachable* | At or past capacity; flow now collapses |

**Why not flow.** Flow is not monotonic in density — it rises, peaks, then falls. A jammed
corridor and an empty one show *similar* flow, so a flow reading cannot distinguish them. Worse,
Fruin's LOS E/F boundary of 82 ped/m/min sits **above** the physical maximum of this fundamental
diagram (80.4), which makes a flow-defined CRITICAL band unreachable in principle. The system
ran for an afternoon with a band that could never trigger before this surfaced.

The density boundaries are **derived, not typed**: inverting the Greenshields relation for a
target flow gives `d² − jam·d + (F·jam)/(60·v_free) = 0`, whose lower root is the free-flow-branch
density. `density_for_flow(49)` returns 0.7501; `density_for_flow(82)` returns `None`, which is
how the discrepancy was found. Change a source constant and the boundaries move with it.

CRITICAL is taken at **capacity density** rather than at a flow number, because that is the same
event the LOS E/F boundary was describing: the point at which flow stops improving and starts to
collapse.

The Building band is still the entire product. Below it there is nothing to do; above it it is
already too late.

### Cross-check worth verifying

The UK *Guide to Safety at Sports Grounds* (the "Green Guide", SGSA) is the governing document
for British venues including Silverstone, and its flow-rate figures for level surfaces and
stairways are commonly cited as **82** and **66 persons per metre width per minute** — the same
values as the LOS E/F and D/E boundaries above.

**Status: unverified.** Confirm against the current edition before quoting it in the pitch. If it
holds, the pitch line is strong: *our alert threshold is the same number the safety regulator
uses*. Do not claim it until someone has read it.

### An independent cross-check that did hold

The Greenshields fundamental diagram, parameterised with Fruin's jam density
(4 persons/m²) and the standard free-flow walking speed (1.34 m/s), peaks at
**80.4 ped/m/min** — within 2% of Fruin's own LOS E/F boundary at 82.

Those two numbers come from different places: one is the maximum of a physical
flow model, the other an empirical service-level threshold. They were not fitted
to each other. Their agreement is a real check that the constants in this file
are mutually consistent, and it means the CRITICAL band boundary is also, to
within measurement error, the capacity of the corridor.

Reproduce it: `crowdflow standards`, or `capacity_flow()` in
`crowdflow_core.state.flow`.

### Density measures

| Value | Figure | Source |
|---|---|---|
| Jam density | ~0.25 m² per person (≈ 4 persons/m²) | Fruin, and widely replicated |
| Observed high density, large stadium | ~4.7 persons/m² | Reported around Wembley |
| Free-flow walking speed | ~1.3 – 1.4 m/s | Standard pedestrian planning figure |

Flow, density and speed are not independent — as density rises past the critical point, flow
*falls*. That inversion is why velocity is a better early indicator than headcount, and why the
state engine tracks both.

---

## 3. Constants that must be measured, never assumed

With the crowd-sourced architecture (see [`decisions.md`](./decisions.md) D6), most of what the
first draft hardcoded is directly observable. Each of these is now a **derived quantity with an
uncertainty**, not a config value.

| Quantity | How it was going to be faked | How it is actually obtained |
|---|---|---|
| Participation rate | A dashboard slider (10/20/30/50%) | Unique node IDs seen ÷ published attendance for that session. Measurable to within the accuracy of the attendance figure |
| Zone capacity | Declared per zone in a YAML file | Observed peak sustained flow through that zone across sessions. Capacity is what the space has actually carried |
| Corridor width | Hand-measured from a map | Inferred from the lateral spread of traces through it |
| Walking speed | Constant 1.3 m/s | Per-zone observed distribution; varies with gradient, surface, weather |
| Time-to-congestion | Model output with an invented horizon | Fitted to the observed distribution of time-from-onset-to-saturation |
| Prediction confidence | A number next to the prediction | Node count, data freshness, positional accuracy, prediction stability |

**Rule:** any of these that cannot yet be measured is displayed as *unknown*, never as a
plausible-looking default. A system that fabricates a capacity figure is worse than one that
admits it has not learned that zone yet.

---

## 4. Where each constant is consumed

```
Fruin LOS boundaries (49, 82 ped/m/min)
        │
        ├──► state engine      band assignment per zone
        ├──► prediction        the target it predicts crossing
        ├──► intervention      scoring: how far below 82 does each option land
        └──► dashboard         the three bands, with word and number

Measured participation ──► population estimate ──► every headcount shown
Measured capacity      ──► utilisation ──► routing edge cost
Measured speed         ──► ETA, and the ETA gate on time-limited crossings
```

---

## 5. Adding a constant

Anything new goes in this file with, in order of preference:

1. A citation to a published standard, or
2. A description of how it is measured at runtime and its uncertainty, or
3. An explicit `ASSUMED:` tag with the reasoning and what would falsify it.

Option 3 is allowed but must be visible in the UI wherever it affects a displayed number.

### Registered engineering assumptions

These do not classify a crowd and do not create a displayed fact, but they still
belong in the registry because they bound runtime behaviour:

| Constant | Value | Reasoning / falsifier |
|---|---:|---|
| Static route-cache entries | 4,096 | Keeps one graph's cache in the low-megabyte range and exceeds the seeded Silverstone gate's measured 702-entry working set. Replace from live-event eviction measurements if hit rate suffers. |
| Orphan-zone fallback geometry | 2 m × 25 m | Used only when imported geometry has no incident edge, so the state engine can fail visibly rather than divide by zero. Such a zone remains assumption-backed; replace as soon as geometry is sourced. |
| Uplink clock-skew filter window | 300 s | Long enough to observe a low-latency sample while handset drift remains negligible relative to mesh seconds. Replace from measured drift and one-way latency traces. |
| Console demo population | 2,500 agents | A simulation workload, not an attendance claim; keeps the live intervention sweep responsive on the reference machine. Recalibrate from measured tick/sweep latency on deployment hardware. |
| Anthropic thinking budget | 4,000 tokens | Above the provider's 1,024-token minimum and below the 16,000 output cap. Configurable with the model client; change only with measured task quality/latency/cost. |
| Private Bottom-k retained hashes | 32 | Approx. 18% relative standard error; increase only if measured participation error dominates attendance/channel uncertainty. |
| Private sketch epsilon | 1.0 per release epoch | ASSUMED pending a published app privacy budget; repeated releases require new accounting and cannot silently reuse the budget. |

---

## Sources

- [Fruin Level of Service](https://www.gkstill.com/Support/crowd-flow/fruin/index.html) &mdash; Prof. G. Keith Still's crowd-safety reference
- [Service level analysis](https://docs.idigitaltwin.org/docs/peddesign/service-level-analysis/) &mdash; LOS bands in ped/m/min
- [Crowd dynamics, flow vs density](https://www.gkstill.com/CV/PhD/Chapter3.html) &mdash; critical density and flow collapse
- *Guide to Safety at Sports Grounds* (SGSA) &mdash; **to be verified against the current edition**
