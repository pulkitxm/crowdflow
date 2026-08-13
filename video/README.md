# CrowdFlow product video

A 90-second Remotion product film covering the problem, solution, approach, control-room demo, spectator guidance, and offline mesh companion.

## Preview

```sh
bun install
bun run video:studio
```

## Refresh demo screenshots

Start the app on port 4317, then capture the deterministic paused demo state:

```sh
bun run dev --host 127.0.0.1 --port 4317 --strictPort
VIDEO_DEMO_URL=http://127.0.0.1:4317 bun run video:capture
```

## Export

```sh
bun run video:render
bun run video:still
```

Outputs:

- `exports/crowdflow-product-video.mp4`
- `exports/crowdflow-cover.png`

Narration source and timed subtitles are in `public/video/narration.txt` and `public/video/narration.srt`. The ambient bed is generated locally and contains no third-party recording.
