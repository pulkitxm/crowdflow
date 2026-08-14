# CrowdFlow — Current Build Checklist

The implementation status after adversarial review repair and the TypeScript runtime
cutover. Ordering and rationale remain in [`build-plan.md`](./build-plan.md).

## Runtime and contracts ✅

- [x] Bun 1.3 + one root workspace/lockfile
- [x] strict TypeScript runtime for contracts, core, CLI, API and agent
- [x] authored TypeScript wire contracts consumed directly by both apps
- [x] deterministic TypeScript → JSON Schema generation with byte-for-byte drift tests
- [x] no Python files, `pyproject.toml`, pytest path, Pydantic emitter, `uv` command or `uv.lock`
- [x] Kotlin confined to `apps/mobile/modules/mesh/android` for screen-off foreground service

## Venue, loop and proof ✅

- [x] cached OSM/f1-circuits venue import, metric frame and barrier subtraction
- [x] provenance-aware widths, conservative semantic attachment and deterministic SVG rendering
- [x] dynamic graph, crossing availability, bounded LRU and constrained routing
- [x] density-based state aggregation; unknown never means empty
- [x] deterministic prediction, counterfactual intervention, mandatory safety review and tick loop
- [x] seeded CLI simulation, trace production, dry-run-first refinement and A/B evaluation
- [x] Silverstone pack validates: 1,875 zones / 2,404 edges
- [x] full seed-42 gate: critical zone-seconds `2746 → 1792` (`−34.7%`), one dispatch

## Surfaces ✅

- [x] dense operator console: map, zone table, prediction, alternatives, event feed and metrics
- [x] phone-sized `SpectatorView` feed; operator envelope never reaches the app
- [x] unobserved route legs remain `unknown`
- [x] only the exact safety-dispatched reroute becomes an offer, retained only until expiry
- [x] relative simulation freshness translated once into wall-clock time at the API boundary
- [x] live mobile shell uses the API when configured; demo shell remains an explicit preview
- [x] app copy/content tests retain D8's next-sixty-seconds budget

## Mesh and privacy 🟡

- [x] native Expo module/autolinking and Android foreground-service lifecycle
- [x] bounded dedupe/buffer, Spray-and-Wait defaults and rate-limited urgent flooding
- [x] seeded shared-topology mesh comparison, opportunistic uplink election and explicit coverage
- [x] dashboard fan-in dedupes overlapping reports and reconciles one-way clock skew
- [x] on-device planar-Laplace trace noise with epsilon attached
- [x] private keyed Bottom-k, coordinated overlap and Chapman participation estimation
- [ ] representative handset capability and walk tests
- [ ] real Wi-Fi Aware → Direct → BLE transport behind `MeshNetwork`
- [ ] Android Kotlin compile on a host with `ANDROID_HOME` (local host has no SDK)

## Refinement and agent ✅

- [x] trace matching, privacy-debiased width, sustained capacity and staleness audit
- [x] desire lines are proposals; adoption requires explicit operator application
- [x] no recapture overlap returns unknown participation
- [x] statistical self/peer baselines before any LLM narration
- [x] Anthropic model configurable; supported extended-thinking request and signed block continuity
- [x] agent has no dispatch operation and creates only safety-reviewed `{command, verdict}` records

## Evidence still blocked / not claimed

- [ ] Silverstone crossing identities and schedules — `crossings.json` stays empty until sourced
- [ ] measured live-event participation, capacity, radio range and hop latency
- [ ] official second deep circuit pack; importer is generic but only Silverstone is committed
- [ ] current Expo/React Native/Metro advisories (18: 7 moderate, 11 high); no patched compatible
      dependency chain is published, and the package manager's suggested fix is an incompatible downgrade

## Standing invariants

- [x] assumptions are registered or labelled
- [x] core performs no I/O
- [x] density is the sole operational classifier
- [x] simulator and phone use one `CrowdNode` contract
- [x] nothing dispatches without `SafetyEngine.review()`
- [x] the LLM never computes a route, density or prediction
- [x] simulations and policy comparisons are seeded
- [x] circuit selection is data-driven
