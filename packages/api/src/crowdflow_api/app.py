"""HTTP and WebSocket surface.

Shape of the thing:

    GET  /api/health                       is the server up, what is loaded
    GET  /api/standards                    Fruin's numbers, served not hard-coded
    GET  /api/circuits                     built packs only
    GET  /api/circuits/{id}                counts and integrity
    GET  /api/circuits/{id}/geometry       zones, edges, track — sent once
    GET  /api/circuits/{id}/scenarios      what can be started, over which zones
    GET  /api/session                      what is running, with its seed
    POST /api/session                      start or replace a run
    POST /api/session/control              play | pause | step | speed
    WS   /ws                               hello, then a frame per tick

One session at a time, deliberately. This is a control-room screen for one
venue; several consoles watch the same run, and the alternative — every browser
tab forking its own simulation — would make two operators disagree about the
venue in front of them.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from crowdflow_contracts import (
    CAPACITY_DENSITY,
    DENSITY_BUILDING_MAX,
    DENSITY_NOMINAL_MAX,
    FREE_FLOW_SPEED_MS,
    JAM_DENSITY_PERSONS_M2,
    LOS_A_MAX,
    LOS_B_MAX,
    LOS_C_MAX,
    LOS_D_MAX,
    LOS_E_MAX,
    MEASURED_NOT_ASSUMED,
    LOSBand,
)
from crowdflow_core.simulation.model import SimConfig
from crowdflow_core.state.flow import capacity_flow
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import packs, scenarios
from .session import DEFAULT_SPEED, STATUS_HEARTBEAT_S, ScenarioSession
from .wire import (
    BandBoundary,
    CircuitSummary,
    ControlRequest,
    FrameType,
    LosGrade,
    ScenarioOption,
    SessionInfo,
    SessionRequest,
    SessionStatus,
    SocketFrame,
    StandardsReport,
    VenueGeometry,
)

FRUIN_SOURCE = 'Fruin, "Pedestrian Planning and Design" (1971), walkway LOS'


class Console:
    """Server-wide state: where the repo is, and the one running session."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or packs.repo_root()
        self.session: ScenarioSession | None = None

    async def replace(self, session: ScenarioSession) -> ScenarioSession:
        if self.session is not None:
            await self.session.stop()
        self.session = session
        session.start()
        return session


def standards_report() -> StandardsReport:
    """The constants registry, straight out of `crowdflow_contracts`.

    Nothing here is typed twice. If a boundary moves in `standards.py`, the
    legend on the console moves with it — which is the only way the promise that
    every threshold cites a standard survives contact with a front end.
    """
    _, max_flow = capacity_flow()
    return StandardsReport(
        source=FRUIN_SOURCE,
        bands=[
            BandBoundary(
                band=LOSBand.NOMINAL,
                label=LOSBand.NOMINAL.label,
                los_grades=LOSBand.NOMINAL.los_grades,
                density_min=0.0,
                density_max=DENSITY_NOMINAL_MAX,
            ),
            BandBoundary(
                band=LOSBand.BUILDING,
                label=LOSBand.BUILDING.label,
                los_grades=LOSBand.BUILDING.los_grades,
                density_min=DENSITY_NOMINAL_MAX,
                density_max=DENSITY_BUILDING_MAX,
            ),
            BandBoundary(
                band=LOSBand.CRITICAL,
                label=LOSBand.CRITICAL.label,
                los_grades=LOSBand.CRITICAL.los_grades,
                density_min=DENSITY_BUILDING_MAX,
                density_max=None,
            ),
        ],
        los=[
            LosGrade(grade="A", flow_min=0.0, flow_max=LOS_A_MAX,
                     note="free flow, bypassing possible"),
            LosGrade(grade="B", flow_min=LOS_A_MAX, flow_max=LOS_B_MAX,
                     note="normal speed, one-way bypassing"),
            LosGrade(grade="C", flow_min=LOS_B_MAX, flow_max=LOS_C_MAX,
                     note="some speeds restricted"),
            LosGrade(grade="D", flow_min=LOS_C_MAX, flow_max=LOS_D_MAX,
                     note="majority restricted, frequent conflicts"),
            LosGrade(grade="E", flow_min=LOS_D_MAX, flow_max=LOS_E_MAX,
                     note="frequent stoppages"),
            LosGrade(grade="F", flow_min=LOS_E_MAX, flow_max=None,
                     note="flow breaks down"),
        ],
        capacity_density=CAPACITY_DENSITY,
        jam_density=JAM_DENSITY_PERSONS_M2,
        free_flow_speed_ms=FREE_FLOW_SPEED_MS,
        max_achievable_flow=round(max_flow, 2),
        measured_not_assumed=list(MEASURED_NOT_ASSUMED),
    )


def create_app(
    root: Path | None = None,
    bootstrap: Callable[[Console], Awaitable[None]] | None = None,
) -> FastAPI:
    """Build the app. `bootstrap` runs once the event loop exists.

    Arming a session at startup is a server-launch concern, not a route's, and
    it cannot happen at import time because a session owns an asyncio task.
    """
    console = Console(root)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if bootstrap is not None:
            await bootstrap(console)
        yield
        if console.session is not None:
            await console.session.stop()

    app = FastAPI(
        title="CrowdFlow operator API",
        version="0.1.0",
        summary="Adapter over crowdflow-core. Computes nothing.",
        lifespan=lifespan,
    )
    # The dashboard is served by Vite on another port in development. Same
    # machine, same operator; the API holds no secrets and no user data.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.console = console

    def circuit(circuit_id: str):
        try:
            return packs.load(console.root, circuit_id)
        except packs.PackNotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    # -- metadata ----------------------------------------------------------

    @app.get("/api/health")
    def health() -> dict:
        session = console.session
        return {
            "ok": True,
            "root": str(console.root),
            "circuits": packs.available_circuits(console.root),
            "session": session.session_id if session else None,
            "status": (session.status if session else SessionStatus.IDLE).value,
        }

    @app.get("/api/standards", response_model=StandardsReport)
    def standards() -> StandardsReport:
        return standards_report()

    @app.get("/api/circuits", response_model=list[CircuitSummary])
    def circuits() -> list[CircuitSummary]:
        return [
            circuit(cid).summary() for cid in packs.available_circuits(console.root)
        ]

    @app.get("/api/circuits/{circuit_id}", response_model=CircuitSummary)
    def circuit_detail(circuit_id: str) -> CircuitSummary:
        return circuit(circuit_id).summary()

    @app.get("/api/circuits/{circuit_id}/geometry", response_model=VenueGeometry)
    def geometry(circuit_id: str) -> VenueGeometry:
        """The whole graph, once. ~900 kB for Silverstone; the console caches it."""
        return circuit(circuit_id).geometry()

    @app.get("/api/circuits/{circuit_id}/scenarios", response_model=list[ScenarioOption])
    def circuit_scenarios(circuit_id: str) -> list[ScenarioOption]:
        return scenarios.options(circuit(circuit_id))

    # -- session -----------------------------------------------------------

    @app.get("/api/session", response_model=SessionInfo)
    def session_info() -> SessionInfo:
        if console.session is None:
            raise HTTPException(status_code=404, detail="no session started")
        return console.session.info()

    @app.post("/api/session", response_model=SessionInfo)
    async def start_session(request: SessionRequest) -> SessionInfo:
        """Start a run, replacing any current one.

        Every unset field falls back to `SimConfig`'s value rather than to a
        literal typed here, so the API and the CLI cannot drift on what a default
        participation rate is.
        """
        loaded = circuit(request.circuit_id)
        defaults = SimConfig()
        seed = request.seed if request.seed is not None else defaults.seed
        population = request.population or scenarios.DEMO_POPULATION
        participation = (
            request.participation
            if request.participation is not None
            else defaults.participation
        )
        tick_s = request.tick_s or defaults.tick_s

        try:
            scenario, option = scenarios.build(
                loaded,
                request.scenario,
                population=population,
                seed=seed,
                origins=request.origins,
                destination=request.destination,
            )
        except LookupError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        session = ScenarioSession(
            loaded,
            scenario,
            option,
            population=population,
            participation=participation,
            tick_s=tick_s,
            speed=request.speed or DEFAULT_SPEED,
            intervene=request.intervene,
        )
        await console.replace(session)
        return session.info()

    @app.post("/api/session/control", response_model=SessionInfo)
    def control(request: ControlRequest) -> SessionInfo:
        if console.session is None:
            raise HTTPException(status_code=404, detail="no session started")
        try:
            return console.session.control(request.action, request.speed)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # -- live feed ---------------------------------------------------------

    @app.websocket("/ws")
    async def ticks(socket: WebSocket) -> None:
        """Hello, then one frame per tick, then status frames while it thinks.

        The hello carries the last envelope so a console that connects between
        ticks — or during an eight-second intervention sweep — renders the venue
        immediately instead of showing an empty map, which would read as an empty
        venue.
        """
        await socket.accept()
        session = console.session
        if session is None:
            await socket.close(code=1013, reason="no session started")
            return

        await socket.send_text(
            SocketFrame(
                type=FrameType.HELLO,
                session=session.info(),
                standards=standards_report(),
                geometry_url=f"/api/circuits/{session.circuit.pack.id}/geometry",
                backlog=list(session.events),
                last_tick=session.last_envelope,
            ).model_dump_json()
        )

        queue = session.subscribe()
        try:
            while True:
                try:
                    envelope = await asyncio.wait_for(
                        queue.get(), timeout=STATUS_HEARTBEAT_S
                    )
                except TimeoutError:
                    # Nothing new. Say so — with the run state attached, so the
                    # console can tell "computing" from "the link is dead".
                    await socket.send_text(
                        SocketFrame(
                            type=FrameType.STATUS, session=session.info()
                        ).model_dump_json()
                    )
                    continue
                if envelope is None:
                    break
                await socket.send_text(
                    SocketFrame(
                        type=FrameType.TICK,
                        session=session.info(),
                        tick=envelope,
                    ).model_dump_json()
                )
        except WebSocketDisconnect:
            pass
        finally:
            session.unsubscribe(queue)

    return app
