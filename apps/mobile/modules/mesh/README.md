# `modules/mesh` — the native transport boundary

This module owns exactly one thing: getting bytes from one handset to another
handset that is standing nearby. It does not decide what to send, when to send
it, how many copies to make, or which peer is a good custodian. All of that is
routing, routing is algorithmic, and algorithms belong in
`packages/core/src/crowdflow_core/mesh/` where they can be simulated with a
hundred and fifty imaginary phones instead of a hundred and fifty real ones.

## Why this is native and not JavaScript

The JS runtime suspends when the app backgrounds. On Android the JS thread is
paused within seconds of the screen locking, and iOS is stricter still.

At a race, almost every phone is in a pocket with the screen off. That is not an
edge case to handle later — it is the normal state of the entire mesh. A node
that stops relaying when the screen locks is not a node; it is a phone that
occasionally helps while someone is looking at it. If relaying lived in JS, the
mesh would exist only in the seconds when people happened to be checking the app,
which is the opposite of when a crowd-safety system needs it.

So the relay loop runs in a **foreground service** with a persistent
notification, in Kotlin, outside the JS runtime's lifecycle. The notification is
not a formality to be minimised away: Android will kill a background process
doing sustained radio work, and the user is entitled to know their phone is
carrying other people's data. Both facts point the same way.

**Requirement, not a preference:** `MeshForegroundService` must be running for
`MeshNetwork` to relay. Every implementation of this interface either runs inside
that service or documents loudly that it stops when the app backgrounds. An
implementation that quietly degrades is worse than one that refuses to start.

## Why the JS side never learns which transport won

`MeshNetwork` names no transport. Underneath it, an implementation may use:

| Transport      | Good at                                  | Bad at |
|----------------|------------------------------------------|--------|
| Wi-Fi Aware    | range, throughput, many simultaneous peers | availability — needs Android 8+ and OEM support that is not universal |
| Wi-Fi Direct   | throughput, wide device support           | slow group negotiation; awkward with more than a handful of peers |
| BLE            | availability, power                       | throughput; payloads measured in hundreds of bytes |

Which one wins depends on the handset, the OS version, the OEM's power policy and
what the radio is already doing. It will differ between two phones standing next
to each other, and it will change mid-event when one drops to BLE to save
battery. If any of that reached the JS side, every caller would grow a special
case for it, and those special cases would be wrong on the handsets nobody
tested.

So the seam is here. Above it: messages, peers, delivery. Below it: whatever
worked. The one thing that does cross the boundary is `MeshPeer.transport`, and
it is diagnostic only — for a support screen, never for a routing decision.

## Layout

```
android/src/main/
  AndroidManifest.xml                      permissions and the service declaration
  java/com/crowdflow/mesh/
    MeshNetwork.kt                         the interface — the actual boundary
    MeshTypes.kt                           peer, message, traffic class, transport
    MeshForegroundService.kt               real foreground lifecycle + user stop action
    StubMeshNetwork.kt                     in-memory transport for wiring up
  build.gradle                              Expo local-module Android build
index.ts                                   typed JS bridge and event subscriptions
expo-module.config.json                    autolinking metadata
package.json                               local-module metadata
```

`StubMeshNetwork` remains an in-memory transport on purpose. The bridge and
foreground-service lifecycle are executable and autolinked, but no source file
claims to be Wi-Fi Aware, Direct or BLE: choosing one without the required demo-
handset capability/walk test would be fabricating hardware support. The measured
routing policies in `crowdflow_core.mesh` are ready behind the seam; replacing
the in-memory transport is explicitly the hardware-dependent remainder.
