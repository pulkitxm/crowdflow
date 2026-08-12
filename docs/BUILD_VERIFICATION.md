# Build verification

Last verified locally on the `bitchat` branch:

- Node.js 24.19
- Expo SDK 57.0.12
- React Native 0.86.2
- JDK 17
- Android compile/target SDK 36
- Gradle 9.3.1

Commands:

```bash
npm run typecheck
npm test
CI=1 npx expo prebuild --platform android --no-install
./android/gradlew -p android assembleDebug
```

Results:

- TypeScript: pass
- Vitest: 7 files / 13 tests pass
- Expo prebuild: pass
- Android development APK: pass (`BUILD SUCCESSFUL`, 705 tasks after BLE GATT server integration)

The generated APK is not committed. Recreate it with `npm run android` or the commands above. Android 13+ GATT notification compatibility is fixed reproducibly by `patches/react-native-multi-ble-peripheral+0.1.8.patch` during `npm install`.

Radio behavior must still be validated on physical phones. A successful compile cannot prove vendor BLE/Wi-Fi behavior.
