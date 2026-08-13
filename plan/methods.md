# CrowdFlow — Methods for the Hard Problems

Researched approaches to the questions that don't have obvious answers, with sources. Each of
these had a cheap answer available; the cheap answer is recorded alongside the better one so the
trade is visible.

Answers [`open-questions.md`](./open-questions.md) Q6, Q7, Q9, Q10, and revises the mesh routing
design in `breakdown.md` L8.

---

## 1. Trace → graph inference (Q6)

**Cheap answer:** bin traces into a grid, threshold occupancy, call the occupied cells walkable.
Produces an area, not a network — no junctions, no widths, no directionality, and nothing routing
can consume.

**The field is mature.** Map construction from GPS trajectories has a benchmark, public
implementations, and a comparative evaluation across seven algorithms and four datasets
(Ahmed, Karagiorgou, Pfoser & Wenk). The algorithms fall into three families:

| Family | Idea | Suits us? |
|---|---|---|
| **Point clustering / KDE** | Build a density surface over trace points, threshold, skeletonise to a centreline network | **Yes** — handles wide, free-form pedestrian space |
| **Incremental track insertion** | Insert traces one at a time, merging each into the graph built so far | Partly — assumes lane-like constraint |
| **Intersection linking** | Detect junctions first from turn patterns, then link them | **Yes, as a second stage** — junctions are exactly our chokepoints |

**Pedestrians are not vehicles**, and that matters more than it sounds. Cars are constrained to
lanes, which is what most map-construction work exploits. Spectators move through open space,
bidirectionally, at varying width. The closer literature is indoor crowdsourced mapping:

- **CrowdInside** — constructs building floorplans from smartphone inertial traces, using alpha
  shapes over the accumulated trace point cloud to recover walkable area, then detecting
  corridors and rooms as higher-level semantics.
- **Walkie-Markie** — defines *WiFi-Marks* as landmarks in the plane and infers pathway maps from
  them.
- **Jigsaw** — combines user mobility traces with position/size/orientation extracted from
  volunteer photographs.

### Recommended pipeline

```
   trace fragments
        │
        ▼
   density surface        KDE over trace points        (point-clustering family)
        │
        ▼
   walkable area          alpha shapes / thresholding  (CrowdInside)
        │
        ▼
   centreline network     skeletonise
        │
        ▼
   junction refinement    turn-pattern detection       (intersection linking)
        │
        ▼
   graph + per-edge {sample_count, width, confidence}
```

**The landmark idea is the part worth stealing.** CrowdInside resets inertial drift at
recognisable physical features — elevators, stairs. A circuit has exactly equivalent anchors,
and they are the *same features we care about operationally*:

| Landmark | Signature in the traces |
|---|---|
| Gate | Traces originate/terminate; queue-then-release timing pattern |
| Track crossing | Bidirectional chokepoint that appears and disappears on session state |
| Grandstand entry | Vertical movement, stair cadence in the accelerometer |
| Viewing area | Dwell cluster with low displacement and high dwell time |

Drift correction and semantic labelling are the same operation. That is a genuinely elegant fit,
not a coincidence — the places that constrain movement are the places that produce distinctive
sensor signatures.

---

## 2. Cold start (Q7)

**Cheap answer:** seed from OpenStreetMap and hope coverage is adequate. Fails wherever OSM is
thin, which is most circuits outside the main grandstand areas.

**Better framing: this is Bayesian, not sequential.** The prior is whatever is known before
anyone walks — the track outline (we have it for all 23 circuits), OSM footpaths where they
exist, and the physical constraint that nobody walks on the racing surface during a session. The
traces are evidence. The graph is the posterior, and it updates continuously.

That reframing removes the "seed then replace" awkwardness: OSM is never authoritative and never
discarded, it is just weak evidence that strong evidence overrides.

CrowdInside demonstrates that bootstrapping a floorplan from *nothing* but inertial traces is
feasible, so cold start is not an existence problem. It is a **confidence-gating** problem:

| Edge confidence | Behaviour |
|---|---|
| High (many corroborating traces) | Route normally |
| Low (prior only, or few traces) | Usable for prediction, **never** presented as a route |
| None (unobserved region) | Render as unknown; never as empty |

The failure mode being defended against is walking someone into a fence because a Laplace-noised
trace clipped a corner. The rule is that inference feeds the *model* immediately but the *app*
only after corroboration.

---

## 3. Participation rate (Q9)

**Cheap answer:** a dashboard slider. Every population figure in the system then inherits an
invented constant.

Three real routes, in order of preference:

### a. Ground-truth anchor — measured, not estimated

The venue already counts people: turnstile scans and ticket sales. One number per session,
compared against unique app nodes, gives the participation rate **exactly**, with the only error
being the attendance figure itself.

This needs one thing from the venue and nothing from the algorithm. It should be the primary
path, and it is a good reason to have a venue partner rather than scraping around one.

### b. Capture–recapture — when there is no ground truth

The classical population-estimation method from ecology (Lincoln–Petersen): draw two independent
samples, and the size of their overlap estimates the total. Long since extended from wildlife to
human populations in epidemiology and criminology.

For us the two samples are two independent observation channels — e.g. nodes seen at one gate and
nodes seen at another, or two disjoint time windows. **The overlap does the work, so no
persistent identity is needed** beyond the linking window, which is exactly what makes it
compatible with ID rotation.

### c. Dual-channel ratio

A device can see participating peers (over the mesh) and non-participating devices (radio-visible
but not running the app). The ratio is participation, directly. MAC randomisation limits distinct
counting, so treat this as a cross-check on (a) and (b), not a primary source.

### Counting unique participants without keeping identities

Naive approach is to store node IDs and count distinct — which defeats rotation and creates
exactly the identity database `plan.md` §35 promises not to build.

Use **mergeable privacy-preserving sketches** instead: P2KMV (a privacy-preserving k-minimum-
values sketch) and HyperLogLog/Bloom hybrids that union bucket-wise, so each mesh region can
count locally and the counts combine at the uplink without ever centralising IDs.

**Important caveat, and it is not optional:** cardinality estimators are *not* private by
default — there is published work showing sketches leak membership. The follow-up result is that
*order-invariant* estimators are differentially private. So: use an order-invariant estimator,
add noise, and do not assume a sketch is private because it is a sketch.

---

## 4. Trace privacy (Q10)

**Cheap answer:** shorten the traces and rotate IDs, then assert it is fine. No formal guarantee,
and trajectory re-identification from sparse points is well established.

**Geo-indistinguishability** (Andrés et al., CCS 2013) is the standard mechanism: add planar
Laplacian noise on the device, giving a formal guarantee that the true location is
indistinguishable within a radius *r*, with the privacy level scaling with *r*. It is a metric
generalisation of differential privacy, and it runs locally — nothing untreated ever leaves the
phone.

### Why this is nearly free for us — the key result

Map inference is **density estimation over thousands of traces**. Zero-mean noise added
independently per point averages out in aggregate: the density surface converges to the true one
as sample count grows, while each individual contribution remains deniable.

```
   per-user guarantee            aggregate accuracy
   ──────────────────            ──────────────────
   strong (noise per point)  +   converges with N traces   =  both, not a trade
```

This is the rare case where the privacy mechanism and the analytical objective are compatible
rather than opposed. Most location systems trade one for the other; we should say so explicitly,
because it is a strong claim and it is true.

### The full stack

1. **Geo-indistinguishability at the sensor** — planar Laplace noise before anything is stored.
2. **Fragmentation** — contribute short segments, rotate the ID per fragment, so no fragment
   chain reconstructs one person's day.
3. **Local aggregation before transmission** — already `plan.md` §8; zone summaries, not point
   streams, for everything except the inference pipeline.
4. **Order-invariant private sketches** for any counting (see §3).
5. **Formal option** — local differential privacy for trajectory collection is an active field
   (TraCS, L-SRR) if a stronger guarantee is wanted than geo-indistinguishability alone.

Resolves the tension flagged in Q10: inference needs traces, §35 forbids person history. Noised,
fragmented, locally-aggregated traces satisfy both.

---

## 5. Mesh routing (revises L8)

**Cheap answer:** flood everything with a TTL. That is *epidemic routing*, and the literature is
blunt about it: very high delivery probability and low latency, at the cost of extreme
communication overhead, rapid buffer exhaustion, and high energy consumption.

For phones in pockets at a race, battery and buffer are the binding constraints. Flooding is the
one thing we cannot afford.

| Protocol | Mechanism | Cost |
|---|---|---|
| **Epidemic** | Copy to every node encountered | Highest delivery, worst overhead/battery |
| **PRoPHET** | Forward only to nodes with higher *delivery predictability*, learned from encounter history | Efficient, scalable, needs history |
| **Spray-and-Wait** | Bounded copies: *spray* L copies, then *wait* for direct delivery | Predictable, tunable overhead |

### Recommendation — split by traffic class

```
   STATE UPDATES  (zone summaries, high volume, loss-tolerant)
        └─► Spray-and-Wait, small L
            bounded copy count = bounded battery cost, and losing one is harmless

   UPLINK-BOUND   (traffic that must reach the dashboard)
        └─► PRoPHET-style delivery predictability
            forward toward nodes that historically encounter an uplink

   REROUTE / ALERT  (low volume, must arrive, latency-critical)
        └─► Epidemic, strictly rate-limited
            flooding is affordable precisely because these are rare
```

The middle row is the elegant part. In D7 the destination is not an address — it is *any node
with internet*. PRoPHET's encounter-history predictability is exactly a measure of "how likely is
this node to reach connectivity", so the protocol's native metric and D7's opportunistic-gateway
model are the same quantity. Routing toward connectivity falls out of the algorithm rather than
needing to be bolted on.

---

## Sources

**Map inference**
- [A Survey and Quantitative Study on Map Inference Algorithms from GPS Trajectories](https://dl.acm.org/doi/abs/10.1109/TKDE.2020.2977034) — IEEE TKDE
- Ahmed, Karagiorgou, Pfoser & Wenk, *Map Construction Algorithms*; comparison in GeoInformatica 19(3):601–632 (2015). Benchmark data, source code and evaluation measures at mapconstruction.org
- [A Map Inference Approach Using Signal Processing from Crowd-sourced GPS Data](https://dl.acm.org/doi/10.1145/3431785) — ACM TSAS

**Crowdsourced pedestrian mapping**
- [CrowdInside: Automatic Construction of Indoor Floorplans](https://www.researchgate.net/publication/230868294_CrowdInside_Automatic_Construction_of_Indoor_Floorplans)
- [Jigsaw: Indoor Floor Plan Reconstruction via Mobile Crowdsensing](https://people.csail.mit.edu/mingmin/papers/jigsaw-paper.pdf)

**Privacy**
- [Geo-indistinguishability: differential privacy for location-based systems](https://dl.acm.org/doi/10.1145/2508859.2516735) — Andrés et al., CCS 2013
- [TraCS: Trajectory Collection in Continuous Space under Local Differential Privacy](https://arxiv.org/pdf/2412.00620)
- [L-SRR: Local Differential Privacy for Location-Based Services](https://yhongcs.github.io/pub/ccs22.pdf)
- [Cardinality Estimators do not Preserve Privacy](https://arxiv.org/pdf/1808.05879) — the caveat
- [Order-Invariant Cardinality Estimators Are Differentially Private](https://arxiv.org/pdf/2203.15400) — the resolution
- [P2KMV: A Privacy-preserving Counting Sketch](https://www.semanticscholar.org/paper/P2KMV:-A-Privacy-preserving-Counting-Sketch-for-and-Sparka-Tschorsch/becba5311bf135ebd09860ff900ee5eb56b1a9a3)

**Population estimation**
- [Capture–Recapture Methods and Models: Estimating Population Size](https://www.sciencedirect.com/science/article/abs/pii/S0169716118300877)
- [Respondent-driven capture–recapture with anonymity](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0195959)

**Opportunistic routing**
- [Analysis of Epidemic, PRoPHET and Spray-and-Wait Routing Protocols in Mobile Opportunistic Networks](https://www.eurekaselect.com/node/177697/article/analysis-of-epidemic-prophet-and-spray-and-wait-routing-protocols-in-the-mobile-opportunistic-networks)
- [Epidemic Routing for Partially-Connected Ad Hoc Networks](https://www.researchgate.net/publication/2633330_Epidemic_Routing_for_Partially-Connected_Ad_Hoc_Networks)
- [Congestion Aware Spray and Wait](https://arxiv.org/pdf/1601.01527)
