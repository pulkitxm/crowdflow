import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const kotlin = readFileSync(path.join(root, 'android/src/main/java/com/crowdflow/mesh/MeshModule.kt'), 'utf8');
const service = readFileSync(
  path.join(root, 'android/src/main/java/com/crowdflow/mesh/MeshForegroundService.kt'),
  'utf8',
);
const gradle = readFileSync(path.join(root, 'android/build.gradle'), 'utf8');
const metadata = JSON.parse(readFileSync(path.join(root, 'expo-module.config.json'), 'utf8'));

describe('native mesh bridge parity', () => {
  it('implements every promised callable method', () => {
    for (const method of [
      'start',
      'stop',
      'getStatus',
      'getNearbyNodes',
      'connect',
      'disconnect',
      'send',
      'broadcast',
    ]) {
      expect(kotlin).toContain(`AsyncFunction("${method}")`);
    }
  });

  it('emits both promised streams', () => {
    expect(kotlin).toContain('sendEvent("onPeersChanged"');
    expect(kotlin).toContain('sendEvent("onMessage"');
  });

  it('starts a real foreground service with a user stop action', () => {
    expect(service).toContain('startForeground(NOTIFICATION_ID, notification)');
    expect(service).toContain('ACTION_STOP');
    expect(service).toContain('stopForeground(STOP_FOREGROUND_REMOVE)');
  });

  it('is an autolinkable Expo Android module', () => {
    expect(gradle).toContain("id 'expo-module-gradle-plugin'");
    expect(metadata.android.modules).toContain('com.crowdflow.mesh.MeshModule');
  });
});
