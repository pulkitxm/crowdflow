import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKEND_KEY = '@crowdflow/backend';
const GATEWAY_KEY = '@crowdflow/gateway';
const DEFAULT_BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://10.0.2.2:8000';

export class SettingsStore {
  backendUrl = DEFAULT_BACKEND;
  gatewayEnabled = false;

  async load(): Promise<void> {
    const [backend, gateway] = await AsyncStorage.multiGet([BACKEND_KEY, GATEWAY_KEY]);
    this.backendUrl = backend[1] ?? DEFAULT_BACKEND;
    this.gatewayEnabled = gateway[1] === 'true';
  }

  async setBackendUrl(value: string): Promise<void> {
    const normalized = value.trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(normalized)) throw new Error('Backend URL must begin with http:// or https://');
    this.backendUrl = normalized; await AsyncStorage.setItem(BACKEND_KEY, normalized);
  }

  async setGatewayEnabled(value: boolean): Promise<void> {
    this.gatewayEnabled = value; await AsyncStorage.setItem(GATEWAY_KEY, String(value));
  }
}
