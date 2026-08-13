# Spectator app

Expo (React Native) app for the person walking around the circuit. It renders in
a phone frame on desktop so the whole race day can be reviewed in a browser.

```
npm install          # from apps/mobile
npm run web          # desktop: phone frame + a rail of the six states
npm run ios          # or android; the switcher becomes a bar along the bottom
npm test             # 72 vitest assertions over the pure modules
npm run typecheck
```

## The one job

Tell someone where to walk. The test applied to every element on every screen:
**does this change where the user puts their feet in the next sixty seconds?**
If not, it belongs on the operator console.

Always on screen: where you are, where you are going, how many minutes, whether
the way ahead is clear / slowing / backing up **in words**, when a crossing opens
or closes, and the honest cost of a redirect **before** the button.

Never on screen: density figures, capacity ratios, model confidence, prediction
horizons, the words congestion / intervention / bottleneck, a map of where other
people are, or any account or login. `src/copy.test.ts` enforces the vocabulary
against both the rendering layer's source and the feed data.

## Shape

```
src/feed/     the contract with the engine — types, words, formatting, safety
              gate, severity, and mock.ts (the only file that invents data)
src/ui/       six text sizes, a card, a pill, two buttons, a step list
src/screens/  one file per state of the day
src/demo/     phone frame and state switcher — scaffolding, never shipped
```

`src/feed/types.ts` is the important file. The phone receives conclusions — a
place name, a number of seconds, a band — not `VenueState`. There is no
threshold anywhere in `src/`, because there is nothing left here to threshold;
the classification happens in `packages/contracts/standards.py` and arrives as a
word. Types come from `packages/contracts/ts/index.ts`, generated from the
Pydantic source of truth, so a schema change breaks the build rather than the app.

## Attaching a real feed

Replace `buildDay` in `src/feed/mock.ts` with a subscription that decodes
`MeshMessage` payloads (`route_update`, `alert`, `reroute`) into `SpectatorView`.
Nothing else changes: every screen is a pure function of a view.
