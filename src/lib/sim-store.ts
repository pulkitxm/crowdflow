import { useEffect, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_PARAMS,
  SIM_END,
  createState,
  step,
  type SimParams,
  type SimState,
} from "./sim";
import { CIRCUIT_SPECS, DEFAULT_CIRCUIT_ID, getCircuit, setCircuit } from "./venue";

interface Store {
  circuitId: string;
  state: SimState;
  params: SimParams;
  playing: boolean;
  speed: number; // simulated minutes per tick
  history: { t: number; inside: number; queued: number; hotspots: number }[];
}

/** Start the demo mid-morning, when the venue is already busy. */
function warmState(params: SimParams) {
  let s = createState();
  for (let i = 0; i < 150; i++) s = step(s, params, 1);
  return s;
}

const initialParams: SimParams = {
  ...DEFAULT_PARAMS,
  crowdSize: getCircuit(DEFAULT_CIRCUIT_ID).attendance,
};

const STORAGE_KEY = "cfo.circuit";
const savedId =
  typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
const bootId =
  savedId && CIRCUIT_SPECS.some((c) => c.id === savedId) ? savedId : DEFAULT_CIRCUIT_ID;
if (bootId !== DEFAULT_CIRCUIT_ID) setCircuit(bootId);

let store: Store = {
  circuitId: bootId,
  state: warmState({ ...initialParams, crowdSize: getCircuit(bootId).attendance }),
  params: { ...initialParams, crowdSize: getCircuit(bootId).attendance },
  playing: true,
  speed: 2,
  history: [],
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(l: () => void) {
  listeners.add(l);
  ensureTicking();
  return () => {
    listeners.delete(l);
  };
}

let timer: ReturnType<typeof setInterval> | null = null;

function ensureTicking() {
  if (timer || typeof window === "undefined") return;
  timer = setInterval(() => {
    if (!store.playing) return;
    tick(store.speed);
  }, 900);
}

function tick(minutes: number) {
  let s = store.state;
  for (let i = 0; i < minutes; i++) s = step(s, store.params, 1);
  if (s.t > SIM_END) {
    s = createState();
  }
  const hotspots = Object.entries(s.occupancy).filter(([, v]) => v > 0).length;
  store = {
    ...store,
    state: s,
    history: [
      ...store.history,
      {
        t: s.t,
        inside: Object.values(s.occupancy).reduce((a, b) => a + b, 0),
        queued: Object.values(s.queues).reduce((a, b) => a + b, 0),
        hotspots,
      },
    ].slice(-180),
  };
  emit();
}

export const simActions = {
  circuits: CIRCUIT_SPECS,
  setCircuit: (id: string) => {
    if (id === store.circuitId) return;
    const circuit = setCircuit(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, circuit.id);
    const params: SimParams = {
      ...store.params,
      crowdSize: circuit.attendance,
      closedEdges: [],
    };
    store = {
      ...store,
      circuitId: circuit.id,
      params,
      state: warmState(params),
      history: [],
    };
    emit();
  },
  play: () => {
    store = { ...store, playing: true };
    emit();
  },
  pause: () => {
    store = { ...store, playing: false };
    emit();
  },
  togglePlay: () => {
    store = { ...store, playing: !store.playing };
    emit();
  },
  setSpeed: (speed: number) => {
    store = { ...store, speed };
    emit();
  },
  stepOnce: (minutes = 5) => tick(minutes),
  reset: () => {
    store = { ...store, state: warmState(store.params), history: [] };
    emit();
  },
  setParams: (patch: Partial<SimParams>) => {
    store = { ...store, params: { ...store.params, ...patch } };
    emit();
  },
  toggleEdge: (key: string) => {
    const closed = store.params.closedEdges.includes(key)
      ? store.params.closedEdges.filter((k) => k !== key)
      : [...store.params.closedEdges, key];
    store = { ...store, params: { ...store.params, closedEdges: closed } };
    emit();
  },
  jumpTo: (minute: number) => {
    let s = createState();
    for (let i = 0; i < minute; i++) s = step(s, store.params, 1);
    store = { ...store, state: s, history: [] };
    emit();
  },
};

const serverSnapshot: Store = {
  circuitId: DEFAULT_CIRCUIT_ID,
  state: warmState(initialParams),
  params: { ...initialParams },
  playing: false,
  speed: 2,
  history: [],
};

export function useSim() {
  const live = useSyncExternalStore(
    subscribe,
    () => store,
    () => serverSnapshot,
  );
  // Render the deterministic server snapshot for the first client paint so the
  // markup matches what the server sent, then switch to the live store.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated ? live : serverSnapshot;
}
