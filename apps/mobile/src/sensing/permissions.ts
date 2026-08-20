/**
 * Asking, in an order that makes sense to the person being asked.
 *
 * The rule this file exists to enforce: nothing is requested before the screen
 * that explains why it is needed. An app that fires three system dialogs on
 * launch gets denied three times, and the person is left with a broken app and
 * no idea what they turned down.
 *
 * So the sequence is staged, and each stage is requested only when the feature
 * that needs it is about to run:
 *
 *   1. Foreground location. The floor. Without it there is no GNSS fix, and on
 *      Android the Wi-Fi scan list and BLE scan results come back EMPTY rather
 *      than denied — the platform ties both to location permission, because
 *      hearing the radios around you is a location by another name.
 *   2. Bluetooth scan. Android 12+ split this out of location. Deliberately
 *      declared WITHOUT `neverForLocation`: that flag is an assertion that the
 *      app does not derive location from BLE, and this app does exactly that.
 *      Claiming otherwise to skip a dialog would be a false statement to the
 *      platform and to the user.
 *   3. Background location. Asked last, separately, and only if the person opts
 *      in to sensing with the screen off — which is the normal state of a phone
 *      at a race. Android shows this as a second, sterner dialog and rightly so.
 *
 * iOS is a different shape and the difference is not a gap to close. There is no
 * public Wi-Fi scan API on iOS and there never has been, so the Wi-Fi rung of
 * the ladder is permanently unavailable there and the app says so rather than
 * appearing broken.
 */

import { PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';

export interface PermissionState {
  foreground: boolean;
  background: boolean;
  bluetooth: boolean;
  /** Location Services / GPS switched on at the OS level. Granted permission
   *  with the radio off yields no fixes and no error, which is the confusing
   *  failure this flag exists to name. */
  servicesEnabled: boolean;
  /** Human-readable blockers, for the status screen. */
  blockedBy: string[];
}

export async function currentPermissions(): Promise<PermissionState> {
  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync().catch(() => ({ granted: false }));
  const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => false);
  const bluetooth = await bluetoothGranted();
  return describe({
    foreground: foreground.granted,
    background: background.granted,
    bluetooth,
    servicesEnabled,
    blockedBy: [],
  });
}

/** Stage 1. Called by the disclosure screen, immediately after the person has
 *  read what it is for. */
export async function requestForeground(): Promise<PermissionState> {
  await Location.requestForegroundPermissionsAsync();
  return currentPermissions();
}

/**
 * Stage 2. Bluetooth scanning.
 *
 * Only Android 12 (API 31) and above has a separate scan permission; below that,
 * location permission covers it, so on older Android and on iOS this is a no-op
 * that reports the current state rather than a dialog nobody needs.
 */
export async function requestBluetooth(): Promise<PermissionState> {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 31) {
    await PermissionsAndroid.requestMultiple([
      'android.permission.BLUETOOTH_SCAN' as never,
      'android.permission.BLUETOOTH_CONNECT' as never,
    ]);
  }
  return currentPermissions();
}

/**
 * Stage 3. Sensing with the screen off.
 *
 * Kept behind its own explicit opt-in because it is the request people most
 * reasonably refuse, and because refusing it must not break the app: without it
 * the ladder still works whenever the app is open, which is enough to be guided
 * through a circuit. It is coverage that suffers, not function.
 */
export async function requestBackground(): Promise<PermissionState> {
  const foreground = await Location.getForegroundPermissionsAsync();
  // Android will deny a background request outright if foreground was never
  // granted, and the denial is permanent-looking to the user. Ask in order.
  if (!foreground.granted) return currentPermissions();
  await Location.requestBackgroundPermissionsAsync();
  return currentPermissions();
}

async function bluetoothGranted(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) < 31) {
    // Pre-12, a BLE scan is gated on location permission alone.
    return (await Location.getForegroundPermissionsAsync()).granted;
  }
  try {
    return await PermissionsAndroid.check('android.permission.BLUETOOTH_SCAN' as never);
  } catch {
    return false;
  }
}

function describe(state: PermissionState): PermissionState {
  const blockedBy: string[] = [];
  if (!state.foreground) blockedBy.push('Location permission is off, so we cannot place you on the circuit.');
  else if (!state.servicesEnabled) blockedBy.push('Location Services are switched off on this phone.');
  if (!state.bluetooth) blockedBy.push('Bluetooth scanning is off, so we cannot use nearby beacons where the signal is weak.');
  if (state.foreground && !state.background) blockedBy.push('Sharing pauses when you lock your phone. Allow background location to keep helping while it is in your pocket.');
  return { ...state, blockedBy };
}
