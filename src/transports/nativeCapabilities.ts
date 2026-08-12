/** Pure native-module probes kept separate so export-name regressions are unit-testable. */
export function hasWifiDirectModule(
  platform: string,
  nativeModules: Readonly<Record<string, unknown>>,
): boolean {
  return platform === 'android' && Boolean(nativeModules.WiFiP2PManagerModule);
}
