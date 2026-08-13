"""Scenarios.

A scenario is a seeded, declarative description of demand — not a script that
forces a bottleneck. Congestion has to emerge from demand meeting capacity, or
the prediction it validates is circular.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..routing.graph import VenueGraph
from .model import SimConfig, Simulation


@dataclass(frozen=True)
class Cohort:
    count: int
    origin: str
    destination: str
    start_s: float = 0.0
    spread_s: float = 0.0


@dataclass(frozen=True)
class Scenario:
    name: str
    description: str
    cohorts: list[Cohort] = field(default_factory=list)
    duration_s: float = 900.0
    seed: int = 42

    def build(self, graph: VenueGraph, **overrides) -> Simulation:
        config = SimConfig(seed=self.seed, **overrides)
        sim = Simulation(graph, config)
        for c in self.cohorts:
            sim.add_agents(
                c.count, c.origin, c.destination,
                start_s=c.start_s, spread_s=c.spread_s,
            )
        return sim


def egress(graph: VenueGraph, origins: list[str] | str, exit_zone: str,
           count: int = 2000, seed: int = 42, spread_s: float = 240.0) -> Scenario:
    """The hardest twenty minutes of the weekend: everyone leaves at once.

    Not a gentle ramp — a step. Post-race egress is the largest crowd movement of
    the day and the one an operator most needs warning of.

    Takes several origins on purpose. A real crowd leaves from every grandstand
    simultaneously; funnelling the whole population out of a single node produces
    a queue at that node and tells you nothing about the venue, which is a
    property of the scenario rather than of the venue.
    """
    if isinstance(origins, str):
        origins = [origins]
    per = max(1, count // len(origins))
    return Scenario(
        name="post-race-egress",
        description=(
            f"{per * len(origins)} spectators leave {len(origins)} stand(s) "
            f"for {exit_zone} at the flag"
        ),
        cohorts=[
            Cohort(count=per, origin=o, destination=exit_zone,
                   start_s=0.0, spread_s=spread_s)
            for o in origins
        ],
        duration_s=1800.0,
        seed=seed,
    )


def arrival(graph: VenueGraph, gate: str, stand: str, count: int = 1500,
            seed: int = 42) -> Scenario:
    """Gates open. Spread over an hour, so this should stay nominal — a scenario
    that never congests is as useful a test as one that does."""
    return Scenario(
        name="arrival",
        description=f"{count} spectators arrive at {gate} for {stand}",
        cohorts=[Cohort(count=count, origin=gate, destination=stand,
                        start_s=0.0, spread_s=3600.0)],
        duration_s=1800.0,
        seed=seed,
    )
