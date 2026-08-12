# Expo runtime notes

The TypeScript UI and pure protocol code can be loaded by Metro, but the real radio product requires an Expo development build. Native dependencies include BLE scanning/advertising, BLE GATT, UDP, mDNS, and Android Wi-Fi Direct. Expo Go does not ship those modules.

Per Expo SDK 57 development-build guidance:

```bash
npm ci
npx expo prebuild --clean
npx expo run:android --device
npx expo start
```

Rebuild after adding/upgrading native libraries or changing `app.config.ts`. For cloud builds:

```bash
eas build --platform android --profile development
```

Do not commit generated `android/` or `ios/`; Expo prebuild derives them from configuration, the local manifest plugin, and dependency patches.

Per the SDK 57 Location and Pedometer references, `watchPositionAsync` and step-count updates are foreground-only. Keep the node screen open during the demo. A future background-node mode would require an explicit TaskManager/location-service design and separate radio lifecycle testing; it is not implied by the foreground-service permissions.
