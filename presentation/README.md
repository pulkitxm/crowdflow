# VMAX presentation

The Reveal.js pitch deck is self-contained and intended for local use.

```sh
bunx serve presentation
```

Open the printed URL, use the arrow keys to navigate, `S` for speaker view, `O` for the overview,
and `F` for full screen. Add `?print-pdf` to the URL and print from Chromium to export a PDF.

The deck vendors Reveal.js and does not require a runtime CDN. Regenerate the circuit wall and
Silverstone venue graph with:

```sh
node presentation/scripts/build-circuit-wall.mjs
```

Circuit outlines come from
[`bacinger/f1-circuits`](https://github.com/bacinger/f1-circuits), copyright Tomislav Bacinger and
contributors under the MIT License. Its license is retained in
[`assets/circuits/LICENSE.md`](./assets/circuits/LICENSE.md).
