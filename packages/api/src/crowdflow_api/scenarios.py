"""Which scenario the console can start, and over which zones.

The scenarios themselves live in core (`crowdflow_core.simulation.scenario`).
What lives here is the *choice* — which car park, which grandstands — because
that is a question about this venue's graph rather than about crowd physics, and
because an operator comparing two runs has to be able to see that they used the
same zones.

The selection rule is the same one the CLI uses for `crowdflow sim run`: the
parking zone that reaches the most of the venue, and every grandstand connected
to it. That is a duplication worth flagging — if the rule changes it must change
in both adapters — but the alternative is an API that imports a private helper
out of a typer command module.
"""

from __future__ import annotations

from crowdflow_contracts import ZoneKind
from crowdflow_core.simulation import arrival, egress
from crowdflow_core.simulation.scenario import Scenario

from .packs import LoadedCircuit
from .wire import ScenarioOption

DEMO_POPULATION = 2500
"""Spectators simulated when the request does not say.

ASSUMED, and it is a *simulation size*, not an attendance figure — Silverstone's
race-day crowd is two orders of magnitude larger. It is set by what a single
machine can compute between ticks: measured on this repo's Silverstone pack, a
tick costs ~29 ms at 2,500 agents and ~80 ms at 6,000, while the intervention
sweep (five candidates x 120 s of forked simulation) costs 8.5 s and 24 s
respectively. Twenty-four seconds of frozen console is not an operator screen.

Nothing is classified on this number: density is per-zone and the bands come from
Fruin either way. Raising it on a bigger machine changes absolute counts only.
"""

EGRESS_SPREAD_S = 240.0
"""How long the flag-to-exit departure is spread over. Core's `egress()` default,
restated only so the console can display it; not a threshold."""


def _named(circuit: LoadedCircuit, zone_id: str) -> str:
    zone = circuit.pack.zones.get(zone_id)
    return (zone.name if zone and zone.name else zone_id) if zone else zone_id


def default_exit(circuit: LoadedCircuit) -> str | None:
    """The parking zone that reaches the most of the venue.

    Picking the best-connected car park rather than the nearest one keeps the
    scenario about the venue instead of about an accident of the import: a park
    that touches four zones produces a queue at its own gate and tells you
    nothing.
    """
    parks = [z.id for z in circuit.pack.zones.values() if z.kind is ZoneKind.PARKING]
    if not parks:
        return None
    return max(parks, key=lambda p: len(circuit.graph.reachable(p)))


def stands_reaching(circuit: LoadedCircuit, destination: str) -> list[str]:
    """Grandstands in the same connected component as the destination."""
    component = circuit.graph.reachable(destination)
    return sorted(
        z.id
        for z in circuit.pack.zones.values()
        if z.kind is ZoneKind.VIEWING and z.id in component
    )


def default_gate(circuit: LoadedCircuit, stand: str) -> str | None:
    component = circuit.graph.reachable(stand)
    gates = [
        z.id
        for z in circuit.pack.zones.values()
        if z.kind is ZoneKind.GATE and z.id in component
    ]
    if not gates:
        return None
    return max(gates, key=lambda g: len(circuit.graph.neighbours(g)))


def options(circuit: LoadedCircuit) -> list[ScenarioOption]:
    """Everything the console may start on this circuit."""
    out: list[ScenarioOption] = []

    exit_zone = default_exit(circuit)
    if exit_zone:
        stands = stands_reaching(circuit, exit_zone)
        if stands:
            out.append(
                ScenarioOption(
                    id="egress",
                    name="Post-race egress",
                    description=(
                        "Everyone leaves at the flag. The hardest twenty minutes of the "
                        "weekend and the movement an operator most needs warning of."
                    ),
                    origins=stands,
                    destination=exit_zone,
                    origin_names=[_named(circuit, s) for s in stands],
                    destination_name=_named(circuit, exit_zone),
                )
            )
            gate = default_gate(circuit, stands[0])
            if gate:
                out.append(
                    ScenarioOption(
                        id="arrival",
                        name="Gates open",
                        description=(
                            "Arrivals spread over an hour. Should stay NOMINAL "
                            "throughout — a scenario that never congests is as useful "
                            "a test as one that does."
                        ),
                        origins=[gate],
                        destination=stands[0],
                        origin_names=[_named(circuit, gate)],
                        destination_name=_named(circuit, stands[0]),
                    )
                )
    return out


def build(
    circuit: LoadedCircuit,
    scenario_id: str,
    *,
    population: int,
    seed: int,
    origins: list[str] | None = None,
    destination: str | None = None,
) -> tuple[Scenario, ScenarioOption]:
    """Resolve a scenario id plus overrides into a seeded core Scenario."""
    catalogue = {o.id: o for o in options(circuit)}
    option = catalogue.get(scenario_id)
    if option is None:
        known = ", ".join(catalogue) or "none available on this circuit"
        raise LookupError(f"unknown scenario {scenario_id!r}; available: {known}")

    chosen_origins = origins or option.origins
    chosen_destination = destination or option.destination
    unknown = [
        z
        for z in (*chosen_origins, chosen_destination)
        if z is not None and z not in circuit.pack.zones
    ]
    if unknown:
        raise LookupError(f"zones not in pack: {sorted(set(unknown))}")
    if not chosen_origins or chosen_destination is None:
        raise LookupError(f"scenario {scenario_id!r} needs an origin and a destination")

    resolved = option.model_copy(
        update={
            "origins": list(chosen_origins),
            "destination": chosen_destination,
            "origin_names": [_named(circuit, z) for z in chosen_origins],
            "destination_name": _named(circuit, chosen_destination),
        }
    )

    if scenario_id == "egress":
        scenario = egress(
            circuit.graph,
            list(chosen_origins),
            chosen_destination,
            count=population,
            seed=seed,
            spread_s=EGRESS_SPREAD_S,
        )
    else:
        scenario = arrival(
            circuit.graph,
            chosen_origins[0],
            chosen_destination,
            count=population,
            seed=seed,
        )
    return scenario, resolved
