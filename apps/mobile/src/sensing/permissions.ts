
import { PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';

export interface PermissionState {
  foreground: boolean;
  background: boolean;
  bluetooth: boolean;
  servicesEnabled: boolean;
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

export async function requestForeground(): Promise<PermissionState> {
  await Location.requestForegroundPermissionsAsync();
  return currentPermissions();
}

export async function requestBluetooth(): Promise<PermissionState> {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 31) {
    await PermissionsAndroid.requestMultiple([
      'android.permission.BLUETOOTH_SCAN' as never,
      'android.permission.BLUETOOTH_CONNECT' as never,
    ]);
  }
  return currentPermissions();
}

export async function requestBackground(): Promise<PermissionState> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) return currentPermissions();
  await Location.requestBackgroundPermissionsAsync();
  return currentPermissions();
}

async function bluetoothGranted(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) < 31) {
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
