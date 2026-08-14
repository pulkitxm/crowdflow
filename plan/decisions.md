# CrowdFlow — Decision Log

Decisions taken after [`plan.md`](./plan.md) was written, with the reasoning that produced
them. Each records what would make it worth revisiting.

---

## D1 — Monorepo, with contracts generated rather than duplicated

**Status:** accepted

**Context.** The Bun backend, TypeScript dashboard, React Native app and native Android
service all exchange the same telemetry and command payloads.

**Decision.** One Bun-workspace repository. Contracts are authored once in TypeScript and
consumed directly by all JavaScript runtimes; deterministic Bun codegen exports committed
JSON Schema for non-TypeScript boundaries. Kotlin remains only for the Android foreground
mesh service.

**Rationale.** A monorepo that only co-locates folders buys nothing. The real win is that the
app and backend cannot silently drift on the telemetry schema — the failure mode that surfaces
around hour 30 as data that validates on one side and not the other. Codegen makes drift a
review diff instead of a debugging session.

**Consequences.** `packages/contracts` is P0 and blocks every other package. A schema change
means regenerate and commit JSON Schema. `bun install --frozen-lockfile`, Vitest and `tsc` are the only repository
install/test path; there is no parallel language runtime to drift.

**Revisit if.** A non-TypeScript service becomes authoritative, in which case schema ownership
must move deliberately rather than being duplicated.

---

## D2 — CLI-first, over a pure core library

**Status:** accepted

**Context.** The system is a pipeline. It could have been built API-first with the dashboard
as the only way to drive it.

**Decision.** `packages/core` is a pure library with no I/O. `packages/cli` and `packages/api`
are equal, permanent adapters over it. The CLI is built first.

**Rationale.** Four things need headless execution and none of them are comfortable through a UI:

- **Repeatability.** `--seed 42` makes the demo bit-identical. Clicking through a dashboard at
  3am does not, and the demo depends on congestion emerging on cue (`plan.md` §27).
- **A/B evaluation.** The before/after table in §42 is "run with intervention off, run with it
  on, diff" — a shell loop. That table is the actual proof to judges.
- **Training data.** §16 needs hundreds of labelled scenario runs. That is batch, or nothing.
- **Purity pressure.** If the engines must be callable from a command, they never entangle with
  socket handlers.

There is also a failure-mode argument: if the dashboard breaks an hour before the demo, a
working system still exists in a terminal.

**Consequences.** The CLI is maintained forever as the evaluation harness, not discarded.

**Trap to avoid.** Do not spend day one on polished subcommand help. Build the pipeline; wrap
it thinly.

**Revisit if.** Never, realistically — the harness outlives the demo.

---

## D3 — React Native + Expo for the app, mesh as a native Kotlin module

**Status:** accepted

**Context.** `plan.md` §44 originally specified Kotlin + Jetpack Compose. The team works in
TypeScript and the dashboard is already web.

**Decision.** The spectator app is Expo (dev client, not Expo Go). The mesh — transports,
relay, TTL, dedupe, local aggregation — is a native Kotlin module exposed to JS through the
`MeshNetwork` interface from §5.

**Rationale.** The app has two halves and Expo treats them very differently.

| Half | Expo verdict |
|---|---|
| UI (§23), location, local routing, shared types with dashboard | Excellent |
| Mesh (L3–L5) | No help whatsoever |

Three reasons the mesh cannot be JavaScript, in order of force:

1. **The JS runtime suspends when the app backgrounds.** At a race nearly every phone is in a
   pocket with the screen off. A node that stops relaying when the screen locks is not a node.
   No library fixes this — it is the runtime model, not an ecosystem gap.
2. **Wi-Fi Aware has no JS binding.** BLE central is well covered; BLE peripheral is patchy and
   a mesh needs both roles; Wi-Fi Direct packages are unevenly maintained; Aware has nothing.
   *(Ecosystem state moves — verify before relying on it.)*
3. **Bridge chattiness.** Per-packet round trips buy nothing. Native aggregates, JS receives
   summaries — which §8 wanted anyway.

**Consequences.**
- Expo Go is unusable; dev client + native builds required.
- Native module must be built and **frozen early**; rebuild cycles are slow and JS iteration is
  instant.
- The bridge boundary is also the **retreat path**: Aware → BLE-only → gateway-only, with no
  change above the interface.
- Mesh risk sits entirely in milestone M6, off the critical path — M5 needs zero phones.

**Alternatives considered.**

| Option | Rejected because |
|---|---|
| BLE-only via RN libraries | Doesn't solve backgrounding; loses the Aware headline. Payloads are small (§7) so throughput was never the constraint |
| No mesh, phones → gateway | Discards the §47 differentiator. Kept as final fallback |
| Separate bare Kotlin node app | Two apps, split story |

**Revisit if.** Target hardware turns out to lack Aware entirely, or the native module has not
landed by the M6 boundary — in which case take the retreat path deliberately and pitch it
honestly.

---

## D4 — Circuits as data packs, plus a separate agent skill

**Status:** accepted

**Context.** Every Grand Prix circuit differs in gates, capacity, viewing areas, crossings, and
sensing conditions. The system should not be hardcoded to one venue.

**Decision.** Each circuit is a **Circuit Pack** — schema-validated data loaded by the engines
— paired with a **`SKILL.md`**, an operational playbook read by the Crowd Ops Agent.

```
circuits/silverstone/
├── pack/        DATA — engines. deterministic. no LLM.
└── SKILL.md     KNOWLEDGE — agent. operational lore.
```

**Rationale.** The split is the whole point. The venue graph is consumed by the simulator,
state engine, and routing engine, all deterministic. Putting it inside an LLM-loaded skill
would place a graph behind a language model, which §48 already names as bad architecture.
Meanwhile the *lore* — "the tunnel exit backs up for twenty minutes after the podium" — is
exactly the agent memory §39 was reaching for, and has no home in a data file.

Beyond correctness, this generalises the product: same core, swap the circuit, works anywhere.
That is a far better pitch than one hardcoded venue.

**Consequences.**
- `CircuitPack` becomes a validated contract; a malformed pack fails at a linter, not as a NaN
  in the routing engine.
- Scope discipline required: **one circuit deep, one shallow.** The second pack's entire job is
  proving the format generalises — ten seconds of demo, large credibility, small effort.
- Prefer a sprawling circuit over a street circuit for the deep one: open sky means GNSS alone
  suffices, crowd movements are large and legible on a heatmap, and there is no hand-modelling
  of balcony access. Street circuits tell the better story but cost far more per unit of demo.

**Revisit if.** Nothing foreseeable. The format may grow fields; the split should not move.

---

## D5 — Time-gated edges in the venue graph

**Status:** accepted

**Context.** Surfaced by D4. On a circuit, spectators can only cross the track at specific
points, and only at specific times — crossings close whenever cars are running.

**Decision.** `RouteEdge.blocked: bool` is replaced by availability windows tied to session
state. Routing becomes time-dependent: a path is valid only if each edge is still open when the
walker would actually reach it.

**Rationale.** `blocked: bool` cannot express "open until quali, then closed for sixty
minutes." And routing someone toward a crossing that shuts before they arrive is worse than not
rerouting them — it manufactures the bottleneck it was trying to prevent.

Crossings are also *the* dominant bottleneck mechanism at a real circuit, so this is the most
authentic thing the model can capture. The prediction engine will find them without being told.

**Consequences.**
- The graph is rebuilt on session-state change, not just re-weighted per tick.
- Candidate paths are rejected if a crossing closes before the walker's ETA.
- Circuit geography (static) and weekend timetable (per-event) are separated — see
  [`circuits.md`](./circuits.md).

**Scope.** Full time-dependent shortest path is a nice-to-have. The hackathon version is
rebuild-on-session-change plus ETA rejection.

**Revisit if.** The demo circuit has no time-gated crossings, in which case implement the
schema but leave the routing simple.

---

## D6 — The venue structure is imported; traces refine it

**Status:** accepted &mdash; **revises the first draft of D6**, which wrongly made inference the
source of the graph

**Context.** D4 assumed the spectator layer would be hand-authored. The first version of this
decision over-corrected: it made the venue graph an emergent property of accumulated traces.

That fails a basic test. **The structure is what lets the system say *where* congestion is.**
Without it there are no zones, no capacities, and no congestion points — only a cloud of dots. A
system whose map emerges over the course of the event has no product on day one, and a
safety-adjacent system cannot be asked to bootstrap its own frame of reference while people are
already walking through it.

The structure is a precondition, not an output.

**Decision.** The venue structure is **imported before the event** and refined by traces during
and after it.

```
   IMPORTED  (before anyone arrives)        REFINED  (from traces, continuously)
   ─────────────────────────────────        ──────────────────────────────────
   OpenStreetMap extract                →   desire lines the maps do not have
     footways, steps, service roads         real capacity, from observed peak flow
     barriers (the walkable envelope)       corrections where OSM is stale
     grandstands, gates, car parks          which crossings actually open, and when
   Official venue map                   →   sensing quality per zone
     names, capacities, block numbers       true walking speeds by gradient/surface
   Track outline (f1-circuits)          →
```

**Evidence this is tractable.** An Overpass query over the Silverstone venue bounding box
returns real coverage — not a hopeful assumption:

| Feature | Count |
|---|---|
| `building=grandstand` | 17 |
| footway / path / steps | 369 / 66 / 20 |
| service road / track | 750 / 216 |
| barriers (fence, hedge, wall) | 651 |
| gates | 64 |
| car parks | 82, several named |

Barriers matter as much as paths: they define where people *cannot* go, which is what makes a
pedestrian graph correct rather than merely connected.

**Rationale.** Splitting it this way puts each source where it is strongest. Maps are good at
geometry and terrible at behaviour; traces are the reverse. An imported graph is available on day
one and wrong in interesting ways; traces are exactly the instrument for finding out how.

The genuinely valuable part of the original idea survives intact — and is arguably better framed
as refinement than as origin:

- **Desire lines.** The informal shortcut across the grass that no official map contains but that
  carries real crowd flow. Only traces reveal these, and they are often exactly where congestion
  forms.
- **Real capacity.** What a space has *actually* carried, versus what a plan says it should. See
  [`standards.md`](./standards.md) §3.
- **Staleness detection.** Venues change between seasons; traces notice before anyone updates a
  map.

**Consequences.**

- Venue import is a build task with a known method, not a research risk. It moves onto the
  critical path in place of inference.
- The app's job is what was actually specified: **measuring the crowd**, within a known structure.
- Trace refinement becomes a later, additive layer — valuable, but nothing depends on it working
  on day one.
- Cold start largely dissolves: any venue with OSM coverage is usable immediately.
- The privacy work in [`methods.md`](./methods.md) §4 still applies, and is now cheaper — refining
  a known graph needs less positional fidelity than building one from nothing.

**Revisit if.** A target venue has thin OSM coverage, in which case trace-based construction
returns as the fallback for that venue rather than the default for all of them.

---

## D7 — Any connected node is a gateway

**Status:** accepted

**Context.** The original design had a fixed mesh gateway: a known piece of infrastructure that
phones talk to, bridging the mesh to the backend. That is a single point of failure sitting
exactly where failure is most likely.

**Decision.** There is no dedicated gateway. **Any meshed device that happens to have internet
becomes an uplink**, and the operator dashboard subscribes to however many are currently
reachable. Uplink is an opportunistic role a node takes, not a box someone installs.

```
        mesh (no internet needed)
   ○──○──○──●──○──○──●──○──○
            │        │
            └────────┴──── whichever nodes currently have signal
                     │
                 dashboard  (subscribes to N uplinks, dedupes by sequence)
```

**Rationale.** This is the Bitchat / mesh-relay model, and it matches the failure mode we
actually care about: cell networks saturate exactly when crowd density peaks. A fixed gateway
saturates with them. A floating one degrades gracefully — you lose resolution as uplinks drop,
not the system.

It also removes a deployment dependency. Nothing has to be installed at the venue for the
dashboard to see the crowd.

**Consequences.**

- The dashboard must handle **N uplinks reporting overlapping views** — dedupe by
  `(source, sequence)`, and reconcile clock skew across uplinks.
- Data arrives with **variable lag** depending on how many hops from an uplink a node sat. Every
  observation needs an age, and the freshness term in the confidence model does real work.
- Coverage becomes a first-class metric: *how much of the venue is currently within reach of an
  uplink?* A region with no connected node is unobserved, and must render as unobserved rather
  than as empty.
- Track K stops being "build a gateway service" and becomes "uplink election, and fan-in on the
  dashboard side".

**Revisit if.** Nothing foreseeable. Even with reliable venue wifi this is the better design.

---

## D8 — The two surfaces are deliberately asymmetric

**Status:** accepted

**Context.** The same system serves a spectator holding a phone in a crowd and an operator at a
console. The tempting move is one design language applied consistently to both. That is wrong,
and it fails in a predictable direction: the app accumulates operator features until it is a
small dashboard nobody can read while walking.

**Decision.**

| | Spectator app | Operator console |
|---|---|---|
| Goal | **Simple, beautiful, immediately legible** | **Complete, dense, well organised** |
| Content budget | Hard cap — one decision per screen | No cap — organisation carries the load |
| Language | Plain: "crowd building", "keeps moving" | Technical: density, LOS band, confidence |
| Numbers | Minutes, and nothing else | Every figure, with units and uncertainty |
| Read in | Sunlight, walking, one hand, distracted | Control room, seated, trained, focused |
| Failure if wrong | User ignores it and walks into the queue | Operator misses the window to act |

**The rule for any new element:** does this change where the user puts their feet in the next
sixty seconds? If not, it belongs on the console, not in the app. There is no third option and
no "just this once".

**Rationale.** The two audiences differ on every axis that matters — expertise, environment,
attention, and the number of decisions they are making. A spectator makes exactly one decision:
which way to walk. Every element that does not serve that decision makes it slower, and the app
is used precisely when the user is least able to concentrate.

The operator is the inverse. They are trained, seated, and making many decisions under time
pressure, and *withholding* information from them is the failure mode. Density figures,
confidence intervals, rejected intervention options, and raw race-control text all belong there.

Symmetry between the two would mean either an app that is too heavy or a console that is too
thin. Both are worse than the asymmetry.

**Consequences.**

- The app has a content budget that is enforced in review, not aspired to.
- The two surfaces may share tokens and components but will not share layouts or density.
- Copy is written twice, deliberately, in two registers. The app never says "congestion",
  "intervention", "density", or "confidence".
- Beauty is a functional requirement for the app specifically: it is a consumer product competing
  with the user's attention at a live event, and an ugly one does not get opened.
- Everything the app *doesn't* show still exists — it goes to the console. Nothing is discarded,
  only routed.

**Revisit if.** Never for the app. The console may earn a simplified overview mode for wall
displays, which is an addition rather than a relaxation.
