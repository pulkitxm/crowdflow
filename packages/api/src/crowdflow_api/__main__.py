"""Run the operator API.

    uv run crowdflow-api            # or: uv run python -m crowdflow_api

A session is armed at startup on purpose: the console should show a venue the
moment it is opened. An empty screen at a demo is indistinguishable from a broken
one, and the whole product is about that distinction.
"""

from __future__ import annotations

import argparse

import uvicorn
from crowdflow_core.simulation.model import SimConfig

from . import packs, scenarios
from .app import Console, create_app
from .session import DEFAULT_SPEED, ScenarioSession
from .wire import ControlAction

DEFAULT_PORT = 8099
"""Chosen to stay clear of whatever else a laptop is running on 8000/8080 during
a race weekend. Nothing depends on it; the dashboard's dev proxy reads it."""


def main() -> int:
    defaults = SimConfig()
    parser = argparse.ArgumentParser(description="CrowdFlow operator API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--circuit", default="silverstone")
    parser.add_argument("--scenario", default="egress")
    parser.add_argument("--population", type=int, default=scenarios.DEMO_POPULATION)
    parser.add_argument("--seed", type=int, default=defaults.seed)
    parser.add_argument(
        "--participation",
        type=float,
        default=defaults.participation,
        help="measured share of spectators running the app",
    )
    parser.add_argument(
        "--speed", type=float, default=DEFAULT_SPEED,
        help="wall-clock multiplier; 1.0 is real time",
    )
    parser.add_argument(
        "--no-intervene", action="store_true",
        help="observe only — the A/B 'without' arm",
    )
    parser.add_argument(
        "--paused", action="store_true", help="arm the session but hold the clock",
    )
    args = parser.parse_args()

    async def arm(console: Console) -> None:
        loaded = packs.load(console.root, args.circuit)
        scenario, option = scenarios.build(
            loaded, args.scenario, population=args.population, seed=args.seed
        )
        session = ScenarioSession(
            loaded,
            scenario,
            option,
            population=args.population,
            participation=args.participation,
            tick_s=defaults.tick_s,
            speed=args.speed,
            intervene=not args.no_intervene,
        )
        await console.replace(session)
        if not args.paused:
            session.control(ControlAction.PLAY)

    uvicorn.run(create_app(bootstrap=arm), host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
