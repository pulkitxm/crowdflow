'use strict';

const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

/**
 * RxAndroidBle declares BLUETOOTH_SCAN as never-for-location in its AAR.
 * CrowdFlow uses RSSI for proximity density, so remove that lower-priority flag.
 */
module.exports = function withBluetoothScanLocation(config) {
  return withAndroidManifest(config, result => {
    AndroidConfig.Manifest.ensureToolsAvailable(result.modResults);
    const permissions = result.modResults.manifest['uses-permission'] || [];
    const scan = permissions.find(permission =>
      permission.$['android:name'] === 'android.permission.BLUETOOTH_SCAN');
    if (scan) {
      delete scan.$['android:usesPermissionFlags'];
      scan.$['tools:remove'] = 'android:usesPermissionFlags';
    }
    return result;
  });
};
