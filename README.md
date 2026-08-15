# CrowdFlow product video

A 90-second Remotion product film for CrowdFlow Optimiser: the problem, the solution, the approach, a control-room demo, spectator guidance, and the offline mesh companion.

This branch holds the video only. The CrowdFlow control-room app it shows lives on the `lovable-mvp` branch.

## Composition

| | |
|---|---|
| Id | `CrowdFlowProductVideo` |
| Resolution | 1920x1080 |
| Frame rate | 30 fps |
| Duration | 2700 frames (90 s) |

Everything is defined in `video/CrowdFlowProductVideo.tsx`, registered through `video/Root.tsx` and `video/index.ts`.

## Preview

```sh
bun install
bun run studio
```

## Export

```sh
bun run render
bun run still
```

Outputs:

- `exports/crowdflow-product-video.mp4`
- `exports/crowdflow-cover.png`

Both scripts pass `--browser-executable=/usr/bin/google-chrome`. Drop that flag to let Remotion download its own headless browser.

## Assets

All assets are served from `public/video/` via Remotion's `staticFile`:

| Path | What it is |
|---|---|
| `screens/` | Pre-captured stills of the control-room app: live map, alerts, routing, evacuation, copilot, spectator, feeds, circuits |
| `fonts/` | Barlow, Chakra Petch and IBM Plex Mono |
| `audio/narration.mp3` | Voice track |
| `audio/ambient-bed.mp3` | Ambient bed, generated locally, no third-party recording |
| `narration.txt` | Narration script |
| `narration.srt` | Timed subtitles |

To refresh a screenshot, run the app from the `lovable-mvp` branch, capture the screen, and replace the file in `public/video/screens/`.

## Built with

- Remotion
- React
- TypeScript
