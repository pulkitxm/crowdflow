# Spectator app

Expo (React Native) app for the person walking around the circuit. It renders in
a phone frame on desktop so the whole race day can be reviewed in a browser.

```
bun install          # from the repository root
bun run web          # desktop: phone frame + a rail of the six states
bun run ios          # or android; the switcher becomes a bar along the bottom
bun run test         # vitest cases over feed, copy and token behaviour
bun run typecheck
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

`packages/contracts/src/types.ts` is the source of truth for the feed. The phone
receives conclusions — a place name, a number of seconds, a band — not
`VenueState`. `src/feed/types.ts` only re-exports workspace types; it owns no
shadow interface and no threshold. Classification happens in
`packages/contracts/src/standards.ts` and arrives as a word.

## Attaching a real feed

Set `EXPO_PUBLIC_CROWDFLOW_API`, `EXPO_PUBLIC_CROWDFLOW_ORIGIN` and
`EXPO_PUBLIC_CROWDFLOW_DESTINATION` to use `LiveShell`; without them the app uses
`DemoShell` explicitly. HTTP and mesh-decoded `SpectatorView` values both enter
through `LiveSpectatorFeed.accept`, so every screen remains a pure function of a
view.
