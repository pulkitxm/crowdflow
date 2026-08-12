import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'CrowdFlow Mesh',
  slug: 'crowdflow-mesh',
  scheme: 'crowdflow',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'dev.crowdflow.bitchat',
    infoPlist: {
      NSBluetoothAlwaysUsageDescription:
        'CrowdFlow discovers anonymous nearby crowd nodes and relays local safety guidance.',
      NSBluetoothPeripheralUsageDescription:
        'CrowdFlow advertises a rotating anonymous node beacon to nearby phones.',
      NSLocationWhenInUseUsageDescription:
        'CrowdFlow converts your location into venue-relative metres for local route guidance.',
      NSLocalNetworkUsageDescription:
        'CrowdFlow discovers nearby venue nodes and exchanges offline guidance on the local network.',
      NSBonjourServices: ['_crowdflow._udp.', '_crowdflow._tcp.'],
    },
  },
  android: {
    package: 'dev.crowdflow.bitchat',
    adaptiveIcon: {
      backgroundColor: '#2D5B45',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: [
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_WIFI_STATE',
      'android.permission.CHANGE_WIFI_STATE',
      'android.permission.CHANGE_NETWORK_STATE',
      'android.permission.CHANGE_WIFI_MULTICAST_STATE',
      'android.permission.NEARBY_WIFI_DEVICES',
      'android.permission.BLUETOOTH',
      'android.permission.BLUETOOTH_ADMIN',
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_ADVERTISE',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.INTERNET',
      'android.permission.WAKE_LOCK',
    ],
  },
  plugins: [
    'expo-dev-client',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'CrowdFlow converts your location into venue-relative metres for local route guidance.',
      },
    ],
    [
      'react-native-ble-plx',
      {
        isBackgroundEnabled: true,
        modes: ['peripheral', 'central-client'],
        bluetoothAlwaysPermission:
          'CrowdFlow discovers anonymous nearby crowd nodes and relays local safety guidance.',
      },
    ],
  ],
  extra: {
    defaultBackendUrl: process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://10.0.2.2:8000',
    eas: {
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
    },
  },
});
