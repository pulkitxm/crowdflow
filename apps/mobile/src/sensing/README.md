# `src/sensing` — placing a phone on the circuit

This directory answers one question: **where is this handset, in venue metres?**
Not "what is its latitude" — nothing above this layer uses latitude ([`plan.md`
§10](../../../../plan/plan.md)) — and not "who is holding it", which is the one
thing it is built never to be able to answer.

Three radios, one answer, and a person who was asked first.

```
        Wi-Fi scan            BLE scan             GNSS
     (Android only)      (both platforms)     (both platforms)
            │                    │                    │
      anchor_id + RSSI     anchor_id + RSSI      lat/lon + accuracy
            │                    │                    │
            └──── AnchorMap ─────┘                    │
                       │                              │
                 trilaterate()                    toVenue()
                       │                              │
                       └────── PositionFuser ─────────┘
                                    │
                              one PositionFix
                                    │
                            crowdNodeFrom()      ← rotating pseudonym
                                    │
                                 Uplink          ← queue, retry, epoch reset
                                    │
                            POST /api/nodes
```

## What is here and what is not

Nothing in this directory decides anything. The path-loss curve, the geometry,
the arbitration between radios, the pseudonym and the venue projection all live
in [`@crowdflow/core/positioning`](../../../../packages/core/src/positioning),
pure and tested against a simulated walk. What is left here is the radio
adapters, the permission sequence, a queue and a timer — the part that cannot be
unit-tested meaningfully because it is made of platform calls.

That split is the reason a bug in the ladder is found in milliseconds on a laptop
instead of at a circuit with a phone in your hand.

| file | what it owns |
|---|---|
| `types.ts` | the seam: `AnchorScanner` (hears anchors) vs `FixProvider` (reports a position) |
| `permissions.ts` | the staged request sequence, and the blockers as sentences |
| `wifi.ts` | Android Wi-Fi scan → observations. Unavailable on iOS, permanently |
| `ble.ts` | BLE scan → observations, identified by iBeacon triple |
| `gnss.ts` | `expo-location` watch → venue-frame fix |
| `rehearsal.ts` | the same three radios, simulated. How this is tested |
| `engine.ts` | scheduling and plumbing. ~200 lines, deliberately |
| `uplink.ts` | the queue: bounded by size, age and the epoch |
| `useSensing.ts` | one engine per circuit, started and stopped by consent |

## The three rungs are not a hierarchy of trust

The ladder picks on **measured accuracy**, not on a preference order. Which
radio wins differs between two phones standing next to each other and changes
when one walks under a stand. But the shape of the answer is knowable in advance,
and the accuracy harness in core will print it for any venue:

```
$ bun run crowdflow anchors plan silverstone --write
$ bun run crowdflow anchors accuracy silverstone
  heard enough to solve   465 of 500 (93.0%)
  fix accepted by ladder  438 of 500 (87.6%)
  true error              p50 5.26 m; p95 20.58 m
  error inside 3 sigma    99.8%

$ bun run crowdflow anchors accuracy silverstone --kinds ble_beacon
  fix accepted by ladder  6 of 500 (1.2%)
```

Read the second one carefully, because it is the honest correction to the obvious
plan. **BLE is not a venue-wide fallback for Wi-Fi.** Beacon range in a crowd is
twenty to forty metres against a hundred or more for an access point, so a
beacon estate at the gates makes *the gates* positionable by Bluetooth, not the
circuit. Bluetooth is the rung that rescues the places the other two fail —
under cover, indoors, in a tunnel — and it is a **local** fallback. Venue-wide
fallback is GNSS.

The three failure modes, stated plainly:

- **Wi-Fi** is Android-only. iOS has no public access-point scan API and never
  has, so on iPhone this rung does not exist. Android also throttles scans to
  four per two minutes (since 9), which is why the fuser dead-reckons: a
  Wi-Fi-only phone has thirty-second holes **by design**.
- **BLE** needs beacons installed and surveyed, and its range is short.
- **GNSS** needs sky. It is usually the best of the three at an open circuit and
  the worst under a grandstand — which is exactly where crowds jam.

## What leaves the phone

A position, a speed, a heading, an accuracy, and a pseudonym that is thrown away
every fifteen minutes. That is the whole of `NodeReport`.

What does **not** leave the phone is the scan itself. A list of the access points
and beacons around somebody is a location by another name and a far more
identifying one — it names the hardware in the room they are standing in.
Observations are resolved against the anchor map inside
`SensingEngine.sampleRadio` and discarded there, and `NodeReport` has nowhere to
put them. The only path where raw observations legitimately travel is
`SurveyReport`, which is a staff walk test on a separate endpoint under a
separate consent, so that no amount of refactoring widens the spectator path
into it.

Three more rules that are enforced rather than documented:

- **The venue boundary.** The disclosure says reporting stops when you leave the
  circuit. `insideVenue` is checked on every fix in the fuser and again in
  `crowdNodeFrom`, against the pack's own `venue_bounds_m`.
- **The epoch is a hard cut.** On rotation the fuser's velocity history and the
  unsent queue are both dropped. A queue that survives a rotation is uploaded
  under the new pseudonym while describing the old one's walk, which links them.
- **Decimetres, and no further.** Coordinates are rounded before upload. The best
  fix this system will ever see has a sigma of metres, so the digits past the
  first decimal are noise — and the trailing digits of a coordinate are the most
  identifying part of it.

Server-side there is no trail at all: `LiveIngest` holds a thirty-second rolling
window and zone aggregates, and nothing indexes a `node_id` to a sequence of
positions. That is a stronger statement than a retention period, because there
is nowhere for a trail to live.

## Testing it

**1. On a laptop, no phone, no venue.** The pure layer, against a simulated walk:

```
bun run --filter @crowdflow/core test           # 37 positioning cases
bun run --filter crowdflow-spectator test       # queue policy, beacon parsing
```

**2. The accuracy of a layout, headless.** Whether radio positioning can work at
a venue at all, before anybody installs anything:

```
bun run crowdflow anchors plan silverstone --spacing 60 --write
bun run crowdflow anchors accuracy silverstone --samples 2000 --sigma 8
```

This measures the **geometry** of an anchor layout — whether the anchors are
spread well enough, at that spacing, to constrain a position. It cannot tell you
whether the log-distance law holds at your venue, because it assumes it. A layout
that fails here will fail on site; a layout that passes here has earned a walk
test, nothing more.

**3. The whole pipeline, no hardware.** Rehearsal mode swaps the three radios for
the simulator and changes nothing else — same solve, same ladder, same uplink,
same server, same console:

```
# terminal 1
bun packages/api/src/main.ts
curl -X POST localhost:8099/api/live \
  -H 'content-type: application/json' \
  -d '{"circuit_id":"silverstone","participation":0.18}'

# terminal 2
bun run --filter crowdflow-dashboard dev        # LIVE PHONES panel

# terminal 3
cd apps/mobile
EXPO_PUBLIC_CROWDFLOW_API=http://localhost:8099 \
EXPO_PUBLIC_CROWDFLOW_SENSING=rehearsal \
bun run web
```

Walk through the disclosure, pick Silverstone, and the console's LIVE PHONES
panel fills: devices reporting, batches by radio, zones observed, and the age of
the last batch counting up. The app's own status screen (the line under
"Continue") shows which radio is placing you, to what accuracy, how many samples
are queued, and how long until the pseudonym rotates.

**4. On a real Android phone.** Rehearsal mode off, and a development build —
Expo Go cannot include the native modules:

```
cd apps/mobile
EXPO_PUBLIC_CROWDFLOW_API=http://<your-lan-ip>:8099 bunx expo run:android
```

Point it at a LAN address, not `localhost`. What to check, in order: the three
permission dialogs appear one at a time with a reason beside each; the status
screen names a radio; switching Bluetooth off makes the Bluetooth rung report
"Bluetooth is switched off" rather than going silent; airplane mode makes the
queue depth climb and then drain when it comes back; and walking out of the
venue bounding box stops reporting.

## Known limits

- **The anchor pack is served whole.** A 60 m plan for Silverstone is 3,024
  anchors and 1.8 MB, downloaded over the same saturated cell network that
  justifies the mesh. A real deployment needs it scoped to the zones near the
  handset; that filter does not exist yet.
- **`react-native-wifi-reborn` and `react-native-ble-plx` are old-architecture
  community modules.** They run through the bridgeless interop layer on RN 0.86
  and that is not guaranteed. Both are required lazily and report themselves
  unavailable when missing, so removing either from `package.json` degrades the
  ladder without a code change.
- **Participation is assumed, not measured.** `estimated_population` is reporting
  devices divided by that rate, and the console labels it ASSUMED until a
  capture-recapture measurement exists (`estimateParticipation` in core has the
  machinery; MAC randomisation is the obstacle).
- **No anchor has ever been walked.** Every anchor pack this repository can
  produce is a plan, `surveyed_at` is null, and both the solver's weighting and
  the app's status screen say so.
