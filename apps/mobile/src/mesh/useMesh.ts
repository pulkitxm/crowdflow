import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import Mesh from '../../modules/mesh';
import { MeshCoordinator, type DynamicMeshStatus } from './coordinator';

const UNAVAILABLE: DynamicMeshStatus = {
  running: false,
  online: false,
  peerCount: 0,
  discoveredCount: 0,
  connectedNodeIds: [],
  problem: null,
};

export function useMesh(enabled: boolean): DynamicMeshStatus {
  const [status, setStatus] = useState(UNAVAILABLE);
  const coordinator = useMemo(() => (Platform.OS === 'android' ? new MeshCoordinator(Mesh) : null), []);

  useEffect(() => {
    if (!coordinator) return;
    const unsubscribe = coordinator.subscribe(setStatus);
    return () => {
      unsubscribe();
      void coordinator.stop();
    };
  }, [coordinator]);

  useEffect(() => {
    if (!coordinator) return;
    if (enabled) void coordinator.start();
    else void coordinator.stop();
  }, [coordinator, enabled]);

  return status;
}
