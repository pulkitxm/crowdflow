import { getRandomBytes } from 'expo-crypto';
import { BleTransport } from '../transports/bleTransport';
import { WifiLanTransport } from '../transports/wifiLanTransport';
import { WifiDirectTransport } from '../transports/wifiDirectTransport';
import { LoopbackTransport } from '../transports/loopbackTransport';
import { TransportManager } from '../transports/transportManager';
import { SettingsStore } from '../storage/settings';
import { LocationEngine } from '../location/locationEngine';
import { demoVenue } from '../venue/demoVenue';
import { CrowdNodeRuntime } from './crowdNodeRuntime';

export async function createRuntime(): Promise<CrowdNodeRuntime> {
  const settings = new SettingsStore(); await settings.load();
  const transports = new TransportManager([
    new BleTransport(), new WifiLanTransport(), new WifiDirectTransport(),
    new LoopbackTransport(() => settings.backendUrl),
  ]);
  return new CrowdNodeRuntime(
    demoVenue, transports, new LocationEngine(demoVenue), settings,
    (length) => getRandomBytes(length),
  );
}
