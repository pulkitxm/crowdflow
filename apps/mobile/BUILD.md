# Getting this on a phone

Expo Go cannot run this app. The Wi-Fi and Bluetooth rungs are native modules,
and Expo Go ships a fixed set of native code that does not include them — so a
build is required. That is not a limitation to work around; it is the same
reason `plan/decisions.md` D3 already assumed a development client.

There are three ways in, in increasing order of setup.

## 1. A browser, right now — zero setup

```
bun run web
```

Allow location when the browser asks. The location check screen shows **your real
position on a map** — OpenStreetMap tiles, a dot, and a ring drawn to scale from
the reported accuracy — plus the raw latitude, longitude, accuracy and the age of
the reading. There is a link that opens the same coordinate on
openstreetmap.org, which is the independent check: if both pins land in the same
place, the coordinate is right.

The Wi-Fi and Bluetooth rows will say **unavailable**, and that is correct rather
than broken: no browser lets a page scan for access points, and the sensors
report exactly that. This path verifies the position pipeline and the frame
conversion. It cannot verify the radios.

## 2. A phone, no local Android SDK — EAS build in Expo's cloud

Needs a free Expo account and `eas-cli`. Nothing else installs locally.

```
bunx eas-cli@latest login
bunx eas-cli@latest build --profile development --platform android
```

It builds remotely and gives you an APK link. Install it on the phone, then:

```
bun run start        # from apps/mobile, on the same Wi-Fi as the phone
```

Scan the QR code with the development build (not Expo Go). All three radios are
real from here on.

## 3. A phone, local build — needs Android Studio

Requires the Android SDK, `adb` on PATH and `ANDROID_HOME` set. This machine
currently has none of those, which is why option 2 exists.

```
bunx expo run:android
```

## Pointing it at a venue

The location check screen needs no server. For everything else, pass a LAN
address — not `localhost`, which on a phone means the phone:

```
EXPO_PUBLIC_CROWDFLOW_API=http://192.168.1.x:8099 bun run start
```

And to exercise the full stack with simulated radios instead of real ones:

```
EXPO_PUBLIC_CROWDFLOW_SENSING=rehearsal bun run web
```
