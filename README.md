# CrowdFlow Mesh — Expo Bitchat Node

A standalone Expo React Native implementation of the **P3 Mesh & Mobile** slice from the CrowdFlow Grand Prix spec. The `bitchat` branch is an orphan branch: it inherits no dashboard code or commit history.

## Included

- Simultaneous discoverability over **Bluetooth LE and Wi-Fi**
  - BLE rotating-node advertisements + scans + bidirectional GATT mailbox
  - Wi-Fi LAN mDNS publication/discovery + UDP packets
  - Android Wi-Fi Direct peer discovery/message fallback
  - HTTP loopback only when all physical radios fail
- Application-layer multi-hop mesh: `(source, sequence)` dedupe, 512-entry LRU, TTL, relay jitter, and source rate limits
- Packed 18-byte `STATE_UPDATE` packets; all radio packets capped at 255 bytes
- CSPRNG 4-hex node IDs rotating every 15 minutes and never persisted
- Venue-relative location, graph map matching, and on-device Dijkstra routing
- Broadcast reroutes with deterministic fraction selection, emergency override, and mandatory expiry
- Canonical `NodeTelemetry` upload and gateway expansion as `mesh_relay`
- Bounded 15-minute outage buffer and replay after connectivity restoration
- Expo UI for user guidance, venue map, explicit offline mode, privacy disclosure, and separate Bluetooth/Wi-Fi diagnostics

## Why a development build

This cannot run fully in Expo Go. Expo Go does not include BLE peripheral advertising, UDP/mDNS, or Android Wi-Fi Direct native modules. Use an Expo development build, as documented for SDK 57.

```bash
npm install
npm run typecheck
npm test
npx expo prebuild --clean
npm run android          # physical Android phone strongly recommended
npm start                # Metro for an installed development build
```

The first native build takes longer because it compiles React Native, Expo modules, and the mDNS responder. Physical devices are required to validate BLE advertising and Wi-Fi Direct; emulators do not model those radios accurately.

## Native dependency note

Expo Doctor flags some specialized radio libraries because React Native Directory lacks metadata or marks them unmaintained/untested on the New Architecture. They are explicitly excluded from that metadata-only check after a clean SDK 36 APK compile. Keep the physical-phone test plan mandatory; a directory badge is not a substitute for testing vendor radios.

## Verification

```bash
npm run typecheck
npm test
npm run doctor
```

A clean Expo prebuild and Android `assembleDebug` were run successfully against SDK 36 / JDK 17, including the BLE peripheral/GATT server. Generated `android/` and `ios/` projects are intentionally ignored; native compatibility changes live in `patches/` and are reapplied by `postinstall`.

## Phone test

1. Install the development APK on at least two Android phones.
2. Enable Bluetooth and Wi-Fi, then grant Bluetooth, nearby Wi-Fi, location, and notification permissions.
3. Start the node on both phones.
4. The **Visible nearby** card should show green Bluetooth and Wi-Fi indicators.
5. Long-press **CROWDFLOW** for per-radio peer counts and packet counters.
6. Turn internet access off while leaving Bluetooth/Wi-Fi enabled; guidance and the local mesh continue, and telemetry buffers briefly.
7. Restore internet access; buffered telemetry replays and the status briefly shows **RESTORED**.

Wi-Fi Aware itself is vendor/hardware dependent and is not exposed by a stable Expo community module. This build provides Wi-Fi detection through cross-platform LAN mDNS/UDP plus Android Wi-Fi Direct, while keeping the transport abstraction ready for an Aware Expo module later.

## Backend surfaces

- `POST /ingest/telemetry` — `{ "batch": [NodeTelemetry, ...] }`
- `POST /mesh/message` — packed bytes for loopback fallback

The backend URL and gateway relay toggle are in the long-press diagnostics screen. The emulator default is `http://10.0.2.2:8000`; use your laptop's LAN address on physical phones.

## Privacy

The wire encoder rejects forbidden identity keys. The app never emits names, accounts, contacts, IMEI, Android ID, advertising ID, stable radio identifiers, or geographic coordinates. BLE and Wi-Fi physical handles remain inside transport drivers and become random session handles above that layer.
