# Spectator app

Expo (React Native) app for the person walking around the circuit. It opens on a
landing page where the visitor picks their circuit, then renders guidance in a
phone frame on desktop so the whole race day can be reviewed in a browser.

```
bun install          # from the repository root
bun run web          # desktop: landing page, phone frame + a rail of the six states
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

## Landing page

The app opens on a landing page that asks which circuit the visitor is going to.
The circuit list and each circuit's map come from the same Bun API the operator
console uses (`/api/circuits`, `/api/circuits/{id}/geometry`), so the map in the
app and the map on the console are one drawing of one data set — editing
`circuits/<id>/pack/` updates both. The chosen circuit is remembered locally and
shown as the front page's card; "Continue" opens the guidance app.

Without an API configured, the picker falls back to a small bundled copy of the
seed circuit (`src/circuits/demo.ts`) so the flow still works in the demo build;
it is labelled "Demo build" and never pretends to be live.

## Consent, then sensing

The app opens on a two-stage disclosure. Stage one explains, in plain words, what the app does
with a position and asks the OS for nothing. Stage two requests three permissions one at a time —
location, Bluetooth, background — each with its reason and, next to it, what happens if you say
no. Location is the only one that gates anything, and "settled" includes refused: a screen that
will not let you past until you agree is not asking.

After that the phone places itself using **Wi-Fi, Bluetooth and GPS**, picking whichever is
currently most accurate, and reports a position — never the scan it was solved from — under a
pseudonym that is thrown away every fifteen minutes. Reporting stops at the venue boundary, and
there is a one-tap stop on the front page.

The whole thing, including how to test it without a phone or a venue, is documented in
[`src/sensing/README.md`](./src/sensing/README.md). The short version:

```
# the pure layer, against a simulated walk
bun run test

# a crowd of simulated handsets driving the real solve, ladder and ingest
bun packages/api/src/main.ts                                   # in the repo root
curl -X POST localhost:8099/api/live -H 'content-type: application/json' \
  -d '{"circuit_id":"silverstone","participation":0.18}'
bun run crowdflow live rehearse silverstone --phones 25

# this app, real code path, simulated radios
EXPO_PUBLIC_CROWDFLOW_API=http://localhost:8099 \
EXPO_PUBLIC_CROWDFLOW_SENSING=rehearsal bun run web
```

Wi-Fi scanning is **Android only** — iOS has no public access-point scan API — and Android
throttles scans to four per two minutes, which is why the fuser dead-reckons across the gaps.
Bluetooth is a *local* fallback, not a venue-wide one: beacon range in a crowd is short enough
that a beacon estate at the gates makes the gates positionable, not the circuit. Venue-wide
fallback is GPS.

## Shape

```
src/sensing/   the radio adapters, permission sequence, queue and loop — see its README
src/circuits/  circuit catalogue + geometry fetch, selection memory, MapView
src/feed/      the contract with the engine — types, words, formatting, safety
               gate, severity, and mock.ts (the only file that invents data)
src/ui/        six text sizes, a card, a pill, two buttons, a step list
src/screens/   one file per state of the day, plus the landing and picker
src/demo/      phone frame and state switcher — scaffolding, never shipped
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
