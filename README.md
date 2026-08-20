# CrowdFlow

CrowdFlow predicts congestion at large venues, evaluates interventions against a counterfactual,
and only offers reroutes that pass a safety review. The monorepo contains the shared contracts,
simulation and prediction engines, operator API and dashboard, spectator mobile app, and a
reproducible Silverstone scenario.

## Requirements

- Bun 1.3.14 or newer
- Node.js only for the presentation asset generator
- Android tooling when compiling the native mobile module

Install the locked workspace dependencies:

```sh
bun install --frozen-lockfile
```

## Repository layout

```text
apps/
  dashboard/       Vite operator console
  mobile/          Expo spectator app and native Android mesh module
packages/
  contracts/       Wire contracts and JSON Schema generation
  core/            Simulation, routing, prediction, safety, and positioning
  hf/              Hugging Face inference adapters
  agent/           Safety-constrained operational insights
  cli/             Command-line workflows
  api/             Bun HTTP and WebSocket service
circuits/           Venue indexes, source data, and generated packs
presentation/       Local Reveal.js pitch deck
scripts/            Repository quality and affected-project tooling
```

All packages share one Bun lockfile and the strict TypeScript configuration in
`tsconfig.base.json`. Reusable numerical operations live in `@crowdflow/core/statistics` rather
than being reimplemented by consumers.

## Run locally

Start the API and dashboard together:

```sh
make console
```

The API listens on `http://127.0.0.1:8099` and the dashboard on
`http://127.0.0.1:5199`. They can also be started separately:

```sh
make api
make dashboard
```

Run the spectator app:

```sh
EXPO_PUBLIC_CROWDFLOW_API=http://127.0.0.1:8099 \
bun run --filter crowdflow-spectator start
```

The first screen accepts a positive sequential person ID. The app registers that ID against the
selected circuit, asks for location permissions, then uploads the latest position resolved from
GPS, Wi-Fi, or Bluetooth. The operator dashboard receives joins and position updates over its
WebSocket connection.

Live mobile guidance requires all three values:

```sh
EXPO_PUBLIC_CROWDFLOW_API=http://127.0.0.1:8099 \
EXPO_PUBLIC_CROWDFLOW_ORIGIN=stand_227342440 \
EXPO_PUBLIC_CROWDFLOW_DESTINATION=park_1120614867 \
bun run --filter crowdflow-spectator start
```

Without them, the app uses its deterministic demonstration feed.

## Live crowd simulator

With `make console` running in another terminal, populate the circuit from several connected gates:

```sh
make simulator SIM_PEOPLE=500 SIM_RATE=50 SIM_DURATION=30
```

Start from an empty people database and live dashboard state by adding `--reset` to the direct
simulator command:

```sh
bun run crowdflow -- live simulate silverstone --reset --people 500 --rate 50 --duration 30
```

The equivalent Make command is:

```sh
make simulator SIM_RESET=1 SIM_PEOPLE=500 SIM_RATE=50 SIM_DURATION=30
```

`SIM_RATE` is the number of new people per second, `SIM_TICK_MS` controls movement update frequency,
`SIM_START_ID` sets the first sequential ID, and `SIM_GATES` accepts a comma-separated list of gate
IDs. If no gates are supplied, the simulator chooses up to six connected gates. `--reset` deletes
the selected circuit's people and current locations, clears its live WebSocket state, then starts
again from person ID 1 unless `--start-id` is supplied. People and their current locations are stored
locally in `.data/crowdflow.sqlite`.

The dashboard starts with the grid hidden. `GRID OFF` enables it at 100 m, then it switches through
50 m and 25 m cells down to a minimum 10 m grid as the map is enlarged. `FULL MAP` expands the
circuit to the viewport. Full-map mode, zoom, map center, orientation, layer, and grid visibility
are kept in the URL query string and restored after reload.

Query a four-corner area with a result limit and zoom level:

```sh
curl -sS http://127.0.0.1:8099/api/circuits/silverstone/people/query \
  -H 'content-type: application/json' \
  -d '{"coordinates":[{"x":0,"y":0},{"x":1000,"y":0},{"x":1000,"y":1800},{"x":0,"y":1800}],"zoom":8,"count":100}'
```

The response contains exact current person-location JSON in `people`, the total polygon match in
`matched_count`, the limited result count in `returned_count`, and occupied cells in `cells`.

## Quality gates

Run the complete local gate before opening a pull request:

```sh
make check
```

It rejects newly introduced source comments, applies Biome lint rules, type-checks every
workspace, runs all tests, and builds every project. Individual gates are also available:

```sh
make comments
make lint
make typecheck
make test
make build
```

The GitHub Actions quality workflow calculates the affected workspace set from the changed paths.
Lint, type-check, test, and build jobs run only for changed projects and their dependents. Changes
to root tooling or shared configuration intentionally fan out to the full workspace. The workflow
has read-only permissions and contains no publishing or deployment job.

## Reproducible simulation

Run the seeded intervention comparison:

```sh
make gate
```

The command evaluates identical seeded populations with and without the selected intervention, so
the reported difference comes from the intervention rather than a changed input population.

Useful CLI entry points include:

```sh
bun run crowdflow -- standards
bun run crowdflow -- circuit validate silverstone
bun run crowdflow -- sim ab silverstone --count 6000 --ticks 700 --seed 42
```

## Contracts and generated data

TypeScript contracts are the source of truth. Regenerate their JSON Schemas with:

```sh
make codegen
```

The command fails if generation leaves an uncommitted schema diff. Generated venue anchors,
temporary circuit geometry, build output, Expo state, Gradle caches, and dependency directories are
excluded from version control.

## Architecture boundaries

- `packages/core` is deterministic and performs no network or filesystem I/O.
- `packages/contracts` owns data exchanged across process and application boundaries.
- `packages/api` translates simulation state into operator and spectator views.
- Mobile clients receive spectator-safe guidance, never the operator control envelope.
- Agent output is advisory and cannot bypass deterministic safety review.
- Unknown observations remain unknown and are never converted into empty-space evidence.

The committed Silverstone pack is a reproducible demonstration dataset. It is not a surveyed venue
model and must not be treated as deployment-ready operational data.
