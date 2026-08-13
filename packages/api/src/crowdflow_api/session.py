"""One live run of the control loop, paced for a screen.

`ControlLoop.tick()` is synchronous and, on an intervention tick, expensive: the
what-if engine forks the world five times and simulates two minutes of each. On
the Silverstone pack at 2,500 agents that is 8.5 measured seconds during which
nothing else happens. Three consequences shape this module:

  * **The tick runs on a worker thread.** Otherwise the WebSocket would stop
    answering mid-sweep and every console would look disconnected.
  * **The pause is reported, not hidden.** `compute_ms` rides on every envelope
    and the session reports COMPUTING with a live elapsed count. A console that
    silently shows nine-second-old state has told the operator the venue is calm
    when what it actually knows is nothing.
  * **Pacing is wall-clock.** One tick every `tick_s / speed` real seconds, so
    the screen runs at the rate the venue does. Falling behind is normal during a
    sweep and is corrected by shortening the next sleep, never by skipping ticks:
    a skipped tick is a hole in the metrics.

Nothing here decides anything about the crowd. Band changes are read off
`ZoneState.band`; whether a forecast is worth announcing is `Forecast.is_actionable`;
the metrics are `crowdflow_core.metrics.RunMetrics`. The adapter's own judgement
extends only to which of those transitions is worth a line in the feed.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from threading import Lock

from crowdflow_contracts import LOSBand, VenueState
from crowdflow_core.loop import ControlLoop, TickResult
from crowdflow_core.metrics import RunMetrics
from crowdflow_core.simulation.model import SimConfig, Simulation
from crowdflow_core.simulation.scenario import Scenario

from .packs import LoadedCircuit
from .wire import (
    ConsoleEvent,
    ControlAction,
    CoverageReport,
    EventKind,
    EventSeverity,
    MetricsSnapshot,
    NodeMark,
    PopulationSnapshot,
    ScenarioOption,
    SessionInfo,
    SessionStatus,
    TickEnvelope,
)

EVENT_LOG_CAPACITY = 400
"""Lines kept for a console that connects late.

ASSUMED and bounded on purpose — a session left running overnight must not grow
without limit. At the exception rate a busy egress produces (a few lines per
tick, most ticks silent) this is roughly the last twenty minutes of race control,
which is the window an operator taking over a desk actually reads back.
"""

CLIENT_QUEUE_DEPTH = 4
"""Frames buffered per console before it is dropped.

ASSUMED, and small deliberately: a console four ticks behind is displaying a
venue that no longer exists. Disconnecting it — which makes it reconnect and
replay the backlog — is better than letting it drift while looking live.
"""

STATUS_HEARTBEAT_S = 0.5
"""How often a status frame goes out while a tick is computing.

ASSUMED. It exists so the console's "last update" counter keeps moving during a
multi-second sweep, which is how an operator tells a thinking server from a dead
link. Nothing is classified on it.
"""

DEFAULT_SPEED = 1.0
"""Wall-clock multiplier. Real time is the default because that is the rate the
venue runs at and the rate an operator's judgement is calibrated to."""


@dataclass
class _ZoneMemory:
    """Last known band per zone, and whether a forecast has already been called.

    Kept so the feed reports *changes*. Without it every tick would restate the
    same forty conditions and the feed would be unreadable, which is the same
    failure as showing nothing.
    """

    band: dict[str, LOSBand] = field(default_factory=dict)
    announced: set[str] = field(default_factory=set)


class ScenarioSession:
    """A seeded run, its clients, and its history.

    Reproducible by construction: the seed, population, participation and tick
    length are all on `SessionInfo`, so a photograph of the console header is
    enough to re-run it from the CLI (invariant 6).
    """

    def __init__(
        self,
        circuit: LoadedCircuit,
        scenario: Scenario,
        option: ScenarioOption,
        *,
        population: int,
        participation: float,
        tick_s: float,
        speed: float = DEFAULT_SPEED,
        intervene: bool = True,
    ) -> None:
        self.session_id = f"ses-{uuid.uuid4().hex[:8]}"
        self.circuit = circuit
        self.scenario = scenario
        self.option = option
        self.participation = participation
        self.speed = speed
        self.intervene = intervene

        self.sim: Simulation = scenario.build(
            circuit.graph, participation=participation, tick_s=tick_s
        )
        self.loop = ControlLoop(
            self.sim, circuit.graph, participation=participation, intervene=intervene
        )
        self.metrics = RunMetrics()
        self.population = population

        self.tick_index = 0
        self.status = SessionStatus.PAUSED
        self.computing_started: float | None = None
        self.last_envelope: TickEnvelope | None = None

        self.events: deque[ConsoleEvent] = deque(maxlen=EVENT_LOG_CAPACITY)
        self._pending: list[ConsoleEvent] = []
        self._seq = 0
        self._event_lock = Lock()
        self._memory = _ZoneMemory()
        self._subscribers: set[asyncio.Queue[TickEnvelope | None]] = set()
        self.dropped_consoles = 0
        """Consoles dropped for falling behind. Surfaced rather than swallowed:
        a rising count means the render loop cannot keep up with the tick rate."""
        self._task: asyncio.Task | None = None
        self._step_requested = False

        self._log(
            EventKind.SESSION,
            EventSeverity.INFO,
            f"session armed — {option.name.lower()}, {population} spectators, "
            f"seed {scenario.seed}, participation {participation:.0%}, "
            f"intervention {'ON' if intervene else 'OFF'}",
        )

    # -- properties --------------------------------------------------------

    @property
    def config(self) -> SimConfig:
        return self.sim.config

    @property
    def max_ticks(self) -> int:
        """The scenario's own declared duration. Not an arbitrary cutoff."""
        return int(self.scenario.duration_s / self.config.tick_s)

    def info(self) -> SessionInfo:
        computing = (
            (time.perf_counter() - self.computing_started) * 1000.0
            if self.computing_started is not None
            else 0.0
        )
        return SessionInfo(
            session_id=self.session_id,
            circuit_id=self.circuit.pack.id,
            scenario=self.option.id,
            description=self.scenario.description,
            status=self.status,
            seed=self.config.seed,
            population=self.population,
            participation=self.participation,
            compliance=self.config.compliance,
            tick_s=self.config.tick_s,
            speed=self.speed,
            intervene=self.intervene,
            origins=list(self.option.origins),
            destination=self.option.destination,
            tick=self.tick_index,
            time_s=self.sim.time_s,
            duration_s=self.scenario.duration_s,
            computing_ms=round(computing, 1),
        )

    # -- event log ---------------------------------------------------------

    def _log(
        self,
        kind: EventKind,
        severity: EventSeverity,
        message: str,
        *,
        zone_id: str | None = None,
        detail: str | None = None,
    ) -> ConsoleEvent:
        with self._event_lock:
            self._seq += 1
            event = ConsoleEvent(
                seq=self._seq,
                time_s=self.sim.time_s,
                kind=kind,
                severity=severity,
                message=message,
                zone_id=zone_id,
                detail=detail,
            )
            self.events.append(event)
            self._pending.append(event)
            return event

    def _zone_label(self, zone_id: str) -> str:
        zone = self.circuit.pack.zones.get(zone_id)
        return zone.name if zone and zone.name else zone_id

    # -- one tick ----------------------------------------------------------

    def _derive_events(self, result: TickResult, silent: set[str]) -> list[ConsoleEvent]:
        """Turn one tick into feed lines.

        Exceptions only. A band that has not moved is not news, and a feed that
        restates the whole venue every tick is as unreadable as no feed at all.
        The judgement here is *which transitions are worth a line*; the
        transitions themselves are core's.
        """
        # Control actions can log from FastAPI's worker thread while this tick is
        # computed on another. Drain atomically; clearing at tick start used to
        # erase every pause/play/speed line before a console could receive it.
        with self._event_lock:
            pending_before_tick = list(self._pending)
            self._pending.clear()
        state = result.state

        for zone_id, zone in state.zones.items():
            previous = self._memory.band.get(zone_id)
            self._memory.band[zone_id] = zone.band
            if previous is zone.band:
                continue
            if zone.band is LOSBand.NOMINAL and previous is None:
                continue  # first sight of a quiet zone is not an event
            severity = {
                LOSBand.NOMINAL: EventSeverity.INFO,
                LOSBand.BUILDING: EventSeverity.WARNING,
                LOSBand.CRITICAL: EventSeverity.CRITICAL,
            }[zone.band]
            self._log(
                EventKind.BAND,
                severity,
                f"{self._zone_label(zone_id)} "
                f"{previous.label if previous else 'UNKNOWN'} -> {zone.band.label}",
                zone_id=zone_id,
                detail=(
                    f"{zone.density_persons_m2:.2f} ped/m2, "
                    f"{zone.flow_ped_m_min:.0f} ped/m/min, "
                    f"LOS {zone.los_grade}, {zone.observed_nodes} nodes"
                ),
            )

        # Losing sight of a zone that mattered is an event in its own right.
        # No threshold is involved: it is a zone that was BUILDING or CRITICAL
        # last tick and has no reading this one.
        lost = set(self._memory.band) - set(state.zones)
        for zone_id in sorted(lost):
            previous = self._memory.band.pop(zone_id)
            if previous is LOSBand.NOMINAL:
                continue
            self._log(
                EventKind.COVERAGE,
                EventSeverity.WARNING,
                f"{self._zone_label(zone_id)} lost coverage while {previous.label}",
                zone_id=zone_id,
                detail=(
                    "no reporting device this tick — "
                    f"{'declared unobserved' if zone_id not in silent else 'silent, seen recently'}"
                ),
            )

        for forecast in result.forecasts:
            actionable = forecast.is_actionable
            already = forecast.zone_id in self._memory.announced
            if actionable and not already:
                self._memory.announced.add(forecast.zone_id)
                self._log(
                    EventKind.FORECAST,
                    EventSeverity.WARNING,
                    f"{self._zone_label(forecast.zone_id)} -> "
                    f"{forecast.target_band.label} in "
                    f"{forecast.time_to_threshold_s:.0f}s",
                    zone_id=forecast.zone_id,
                    detail=(
                        f"p={forecast.probability:.0%} conf={forecast.confidence:.0%} "
                        f"model={forecast.model_id}"
                        + (f" — {forecast.causes[0]}" if forecast.causes else "")
                    ),
                )
            elif not actionable and already:
                self._memory.announced.discard(forecast.zone_id)

        if result.candidates:
            selected = next((c for c in result.candidates if c.selected), None)
            rejected = [c for c in result.candidates if not c.selected]
            if selected is None:
                self._log(
                    EventKind.INTERVENTION,
                    EventSeverity.INFO,
                    f"{len(result.candidates)} options evaluated, none beats doing nothing",
                    detail="; ".join(
                        f"{c.candidate_id} score {c.score.total:+.1f}"
                        for c in result.candidates
                    ),
                )
            else:
                self._log(
                    EventKind.INTERVENTION,
                    EventSeverity.WARNING,
                    f"selected {selected.description}",
                    detail=(
                        f"score {selected.score.total:+.1f} vs "
                        + ", ".join(
                            f"{c.candidate_id} {c.score.total:+.1f}" for c in rejected
                        )
                    ),
                )

        if result.command is not None:
            self._log(
                EventKind.COMMAND,
                EventSeverity.WARNING,
                f"reroute proposed {self._zone_label(result.command.source_zone)} -> "
                f"{self._zone_label(result.command.destination_zone)}",
                zone_id=result.command.source_zone,
                detail=(
                    f"{result.command.target_fraction:.0%} of walkers, "
                    f"+{result.command.expected_cost_s:.0f}s walk, "
                    f"expires t+{result.command.expires_at - result.time_s:.0f}s — "
                    f"{result.command.reason}"
                ),
            )
        if result.verdict is not None:
            self._log(
                EventKind.SAFETY,
                EventSeverity.INFO
                if result.verdict.may_dispatch
                else EventSeverity.CRITICAL,
                f"safety {result.verdict.outcome.value.upper()}"
                + (" — DISPATCHED" if result.dispatched else ""),
                detail=result.verdict.reason
                + (
                    f" [{', '.join(result.verdict.violated_constraints)}]"
                    if result.verdict.violated_constraints
                    else ""
                ),
            )

        with self._event_lock:
            generated = list(self._pending)
            self._pending.clear()
        return pending_before_tick + generated

    def _coverage(self, state: VenueState, silent: list[str]) -> CoverageReport:
        total = len(self.circuit.pack.zones)
        low = [z for z, s in state.zones.items() if not s.confidence.is_reportable]
        return CoverageReport(
            zones_total=total,
            observed=len(state.zones),
            unknown=len(state.unobserved_zones),
            silent=len(silent),
            low_confidence=len(low),
            fraction_observed=(len(state.zones) / total) if total else 0.0,
        )

    def _population(self, state: VenueState) -> PopulationSnapshot:
        active = self.sim.active
        arrived = self.sim.arrived
        return PopulationSnapshot(
            total=len(self.sim.agents),
            waiting=len(self.sim.agents) - active - arrived,
            active=active,
            arrived=arrived,
            observed_nodes=state.total_observed_nodes,
            estimated_present=state.estimated_present,
        )

    def _metrics(self) -> MetricsSnapshot:
        self.metrics.finalise(self.sim.arrived_walk_times)
        return MetricsSnapshot(
            peak_density=round(self.metrics.peak_density, 4),
            critical_zone_seconds=round(self.metrics.critical_zone_seconds, 1),
            building_zone_seconds=round(self.metrics.building_zone_seconds, 1),
            peak_critical_zones=self.metrics.peak_critical_zones,
            total_queue_peak=round(self.metrics.total_queue_peak, 1),
            arrived=self.metrics.arrived,
            mean_walk_s=round(self.metrics.mean_walk_s, 1),
            p95_walk_s=round(self.metrics.p95_walk_s, 1),
            interventions=self.metrics.interventions,
            rejected_by_safety=self.metrics.rejected_by_safety,
            samples=self.metrics.samples,
        )

    def tick_once(self) -> TickEnvelope:
        """Advance the loop one tick. Blocking — always called off the event loop."""
        started = time.perf_counter()
        result = self.loop.tick()
        compute_ms = (time.perf_counter() - started) * 1000.0
        self.tick_index += 1

        self.metrics.observe(result.state, self.config.tick_s)
        if result.dispatched:
            self.metrics.interventions += 1
        if result.verdict is not None and not result.verdict.may_dispatch:
            self.metrics.rejected_by_safety += 1

        state = result.state
        # A zone in neither list reported inside the stale window but not this
        # tick. The state engine calls it neither observed nor unobserved; the
        # console must still draw something, and drawing it as quiet would be
        # the exact failure invariant 5 forbids.
        accounted = set(state.zones) | set(state.unobserved_zones)
        silent = sorted(set(self.circuit.pack.zones) - accounted)
        low_confidence = sorted(
            z for z, s in state.zones.items() if not s.confidence.is_reportable
        )

        events = self._derive_events(result, set(silent))

        # Re-emitting is deterministic: `Simulation.emit` seeds a local RNG from
        # (seed ^ int(time_s)) and mutates nothing, so this is the same telemetry
        # the state engine just consumed, not a second sample.
        nodes = [
            NodeMark(
                x=n.position.x,
                y=n.position.y,
                speed_ms=n.speed_ms,
                accuracy_m=n.accuracy_m,
            )
            for n in self.sim.emit()
        ]

        envelope = TickEnvelope(
            tick=self.tick_index,
            time_s=result.time_s,
            compute_ms=round(compute_ms, 1),
            state=state,
            forecasts=result.forecasts,
            actionable=[f.zone_id for f in result.forecasts if f.is_actionable],
            candidates=result.candidates,
            command=result.command,
            verdict=result.verdict,
            dispatched=result.dispatched,
            silent_zones=silent,
            low_confidence_zones=low_confidence,
            coverage=self._coverage(state, silent),
            population=self._population(state),
            metrics=self._metrics(),
            nodes=nodes,
            events=events,
        )
        self.last_envelope = envelope
        return envelope

    # -- subscribers -------------------------------------------------------

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=CLIENT_QUEUE_DEPTH)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    def _broadcast(self, envelope: TickEnvelope) -> None:
        """Push to every console, dropping any that has fallen behind.

        A dropped console MUST be told. Discarding the queue silently leaves the
        socket open and the handler blocked on a queue nobody writes to any more,
        so it falls through to the heartbeat branch and keeps reporting healthy
        session status forever — a control-room screen showing a live header over
        a venue picture that stopped updating minutes ago. That is verbatim the
        failure this transport exists to prevent.

        The queue is drained before the sentinel goes in, for two reasons: it is
        full by definition, and everything in it is stale anyway. The console
        reconnects and replays from last_envelope.
        """
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(envelope)
            except asyncio.QueueFull:
                self._subscribers.discard(queue)
                while not queue.empty():
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                try:
                    queue.put_nowait(None)
                except asyncio.QueueFull:
                    pass
                self.dropped_consoles += 1

    # -- control -----------------------------------------------------------

    def control(self, action: ControlAction, speed: float | None = None) -> SessionInfo:
        if action is ControlAction.PLAY:
            if self.status is not SessionStatus.FINISHED:
                self.status = SessionStatus.RUNNING
                self._log(EventKind.SESSION, EventSeverity.INFO, "run resumed")
        elif action is ControlAction.PAUSE:
            if self.status in (SessionStatus.RUNNING, SessionStatus.COMPUTING):
                self.status = SessionStatus.PAUSED
                self._log(EventKind.SESSION, EventSeverity.INFO, "run paused")
        elif action is ControlAction.STEP:
            if self.status is not SessionStatus.FINISHED:
                self._step_requested = True
        elif action is ControlAction.SPEED:
            if speed is None:
                raise ValueError("action=speed requires a speed")
            self.speed = speed
            self._log(
                EventKind.SESSION, EventSeverity.INFO, f"clock set to {speed:g}x real time"
            )
        return self.info()

    # -- the paced loop ----------------------------------------------------

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name=f"session-{self.session_id}")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        for queue in list(self._subscribers):
            if not queue.full():
                queue.put_nowait(None)  # sentinel: the socket handler closes on it
        self._subscribers.clear()

    async def _run(self) -> None:
        """Pace ticks against the wall clock.

        The sleep is computed from when the tick *started*, so a slow tick eats
        into the next interval rather than adding to it. Ticks are never skipped:
        the metrics are integrals over ticks and a hole in them is a wrong number,
        not a dropped frame.
        """
        while True:
            if self.status not in (SessionStatus.RUNNING, SessionStatus.COMPUTING):
                if self._step_requested:
                    self._step_requested = False
                    await self._one_tick()
                else:
                    await asyncio.sleep(STATUS_HEARTBEAT_S)
                continue

            if self.tick_index >= self.max_ticks:
                self.status = SessionStatus.FINISHED
                self._log(
                    EventKind.SESSION,
                    EventSeverity.INFO,
                    f"scenario complete — {self.sim.arrived} of {len(self.sim.agents)} arrived",
                )
                continue

            started = time.perf_counter()
            await self._one_tick()
            interval = self.config.tick_s / max(self.speed, 1e-6)
            remaining = interval - (time.perf_counter() - started)
            if remaining > 0:
                await asyncio.sleep(remaining)

    async def _one_tick(self) -> None:
        was = self.status
        self.status = SessionStatus.COMPUTING
        self.computing_started = time.perf_counter()
        try:
            envelope = await asyncio.to_thread(self.tick_once)
        finally:
            self.computing_started = None
            if self.status is SessionStatus.COMPUTING:
                self.status = was
        self._broadcast(envelope)
