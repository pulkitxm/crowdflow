# Build verification

Last verified locally on the `bitchat` branch after a clean dependency install:

- Node.js 24.19
- Expo SDK 57.0.12
- React Native 0.86.2
- JDK 17
- Android compile/target SDK 36
- Gradle 9.3.1
- Vitest 4.1.10

Commands:

```bash
npm ci
npm run typecheck
npm test
npm run doctor
CI=1 npx expo prebuild --clean --platform android --no-install
CI=1 npx expo export --platform android --output-dir /tmp/crowdflow-export --clear
./android/gradlew -p android assembleDebug
```

Results:

- Reproducible patches: 3/3 applied during `npm ci`
- TypeScript: pass
- Vitest: 14 files / 30 tests pass
- Expo Doctor: 20/20 checks pass
- Android production JS/Hermes bundle: pass (821 modules)
- Clean Expo Android prebuild: pass
- Merged manifest: `BLUETOOTH_SCAN` present without the inaccurate `neverForLocation` flag
- Android development APK: pass (`BUILD SUCCESSFUL`, 703 tasks in the final clean writable copy)
- Generated APK: `android/app/build/outputs/apk/debug/app-debug.apk` (about 183 MB, uncommitted)

The build emits upstream deprecation and C compiler warnings from Expo Dev Launcher and the bundled mDNS responder, but no compilation errors. The generated APK and native projects are intentionally ignored.

## What this verification does not prove

Compilation cannot validate vendor radio behavior. BLE advertising/GATT, Wi-Fi Direct group formation, mDNS discovery, relay hops, and radio recovery still require the physical-phone plan in `docs/TEST_PLAN.md`. Expo SDK 57's `watchPositionAsync` and pedometer subscriptions are foreground-only; this demo node is intended to remain open while operating and does not claim background mesh execution.

`npm audit` currently reports no critical issue after upgrading Vitest. Remaining notices are transitive Expo/React Native build-tool advisories whose automated fix proposes unsupported SDK downgrades; they should be revisited with upstream SDK updates rather than force-fixed.

Final APK SHA-256: `aca1381287458462501395e10bdc3aa8b23299204e7f4bcc1482f73a9a49006d`.
