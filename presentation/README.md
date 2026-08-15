# VMAX hackathon pitch

A self-contained Reveal.js deck for the VMAX hackathon pitch, published at
[vmax.pulkit.page](https://vmax.pulkit.page).

## Present locally

Any static server works:

```sh
bunx serve presentation
```

Then open the printed local URL. Use the arrow keys to navigate, `S` for speaker view,
`O` for the slide overview, and `F` for full screen. Add `?print-pdf` to the URL and print
from Chromium to export a PDF.

Slide content animations start automatically. One right-arrow press always advances directly
to the next slide; no extra clicks are required to reveal steps or bullets.

The ten-slide judging path is timed for **4:45**, leaving 15 seconds of safety inside the
five-minute presentation limit. Per-slide timing is built into Reveal's speaker view. See
[`RUN_OF_SHOW.md`](./RUN_OF_SHOW.md) for the talk track, online-round checklist, rubric map,
and two-minute Q&A bank. The exact four-person script and handoffs are in
[`SPEAKER_NOTES.md`](./SPEAKER_NOTES.md).

## Deployment boundary

`.github/workflows/pages.yml` uploads `presentation/` directly as the GitHub Pages artifact.
No application source, package, plan, or repository-root file is included in the published
site.

The deck vendors Reveal.js so the presentation does not rely on a runtime CDN. The circuit wall,
Silverstone outline, venue graph and moving race car are code-native SVG/CSS graphics generated
from the actual circuit and graph sources on `main`. The only raster assets are the four locally
stored profile pictures requested for the team slide. Claims on the proof slide
come from the seeded, reproducible A/B gate on `main`.

## Circuit graphics

Regenerate the vector circuit wall and Silverstone venue graph with:

```sh
node presentation/scripts/build-circuit-wall.mjs
```

Circuit outlines come from
[`bacinger/f1-circuits`](https://github.com/bacinger/f1-circuits), copyright Tomislav Bacinger
and contributors, under the MIT License. The source license is preserved at
[`assets/circuits/LICENSE.md`](./assets/circuits/LICENSE.md). The venue graph comes directly from
`circuits/silverstone/pack/graph.json` in this repository. Formula One names and marks belong to
their respective owners; this is an unofficial hackathon project.
