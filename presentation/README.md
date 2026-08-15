# CrowdFlow hackathon pitch

A self-contained Reveal.js deck for the CrowdFlow hackathon pitch, published at
[vmax.pulkit.page](https://vmax.pulkit.page).

## Present locally

Any static server works:

```sh
bunx serve presentation
```

Then open the printed local URL. Use the arrow keys to navigate, `S` for speaker view,
`O` for the slide overview, and `F` for full screen. Add `?print-pdf` to the URL and print
from Chromium to export a PDF.

## Deployment boundary

`.github/workflows/pages.yml` uploads `presentation/` directly as the GitHub Pages artifact.
No application source, package, plan, or repository-root file is included in the published
site.

The deck vendors Reveal.js so the presentation does not rely on a runtime CDN. Product UI
screens came from the `crowdflow-product-video` branch and are identified in the deck as
prototype views. Claims on the proof slide come from the seeded, reproducible A/B gate on
`main`.
