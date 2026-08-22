# Circuit catalogue

This catalogue contains all 78 venues from `julesr0y/f1-circuits-svg` at commit `9c93759b076d1b87eac265a009b21b399253220a`.

The source is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The circuit artwork and catalogue are attributed to ROY Jules (`julesr0y`). The pinned upstream license checksum is recorded in `catalogue.json`.

The SVG paths are visual artwork in an arbitrary 500 by 500 coordinate space. They are not georeferenced venue surveys. They do not identify track width, pedestrian routes, barriers, gates, bridges, tunnels, or access rules.

Generated packs have capability `synthetic_simulation`. Their pedestrian graph is an assumed rectangular perimeter outside an assumed track clearance. It exists only to exercise the simulator safely and deterministically. It must not be used for navigation, venue operations, emergency planning, or any claim about real-world distance or capacity.

Existing CrowdFlow IDs are retained through `aliases.json`. Every other venue uses the source catalogue ID.

Refresh the pinned source and regenerate:

```sh
bun scripts/generate-circuit-catalogue.mjs --refresh-source
```

Verify the pinned inputs, generated files, geometry clearance, graph reachability, and deterministic simulations:

```sh
bun scripts/generate-circuit-catalogue.mjs --check
bun scripts/validate-circuit-catalogue.mjs
```
