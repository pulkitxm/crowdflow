"""Build the deliberately small spectator feed from served engine conclusions.

This adapter translates a live ``TickEnvelope`` plus a route request into the
Pydantic ``SpectatorView`` contract.  It does not classify density, choose an
intervention or bypass safety.  Bands come from ``ZoneState``; routes come from
``VenueGraph``; reroutes are exposed only when the exact command was dispatched
through ``SafetyEngine.review()`` by the control loop.

The phone receives one decision, not the operator state.  Unknown legs stay
unknown, crossing availability comes from the pack, and route duration is priced
once here rather than reconstructed in TypeScript.
"""

from __future__ import annotations

from crowdflow_contracts import (
    AheadView,
    CrossingClosed,
    CrossingNotice,
    CrossingOpen,
    LinkStatus,
    OfflineView,
    RerouteOffer,
    Route,
    SpectatorView,
    Step,
    WalkView,
    WayAhead,
)
from crowdflow_core.routing import VenueGraph

from .session import ScenarioSession
from .wire import TickEnvelope


class SpectatorFeedUnavailable(LookupError):
    """The requested route cannot honestly be rendered from current evidence."""


def _label(graph: VenueGraph, zone_id: str) -> str:
    zone = graph.pack.zones.get(zone_id)
    return zone.name if zone and zone.name else zone_id


def _edge_between(graph: VenueGraph, source: str, destination: str) -> str | None:
    return next((eid for nxt, eid in graph.neighbours(source) if nxt == destination), None)


def _crossing_for_edge(
    graph: VenueGraph,
    edge_id: str,
    *,
    session_state: str | None,
) -> CrossingNotice | None:
    crossing = next(
        (item for item in graph.pack.crossings.values() if item.edge_id == edge_id),
        None,
    )
    if crossing is None:
        return None
    is_open = crossing.availability.is_open_during(session_state)
    state = CrossingOpen(open=True, closes_at=None) if is_open else CrossingClosed(
        open=False, opens_at=None
    )
    return CrossingNotice(name=crossing.id.replace("_", " "), state=state)


def build_route(
    graph: VenueGraph,
    envelope: TickEnvelope,
    *,
    origin: str,
    destination: str,
    avoid: set[str] | None = None,
    prefer: set[str] | None = None,
    route_id: str = "current-route",
) -> Route:
    """Price one route and attach already-computed crowd conclusions to its legs."""
    result = graph.route(origin, destination, avoid=avoid, prefer=prefer)
    if not result.found:
        raise SpectatorFeedUnavailable(result.rejected_reason or "no route")

    steps: list[Step] = []
    session_state = envelope.state.session_id
    for index, (source, target) in enumerate(zip(result.path, result.path[1:], strict=False)):
        edge_id = _edge_between(graph, source, target)
        if edge_id is None:
            raise SpectatorFeedUnavailable(f"route edge missing: {source} -> {target}")
        edge = graph.pack.edges[edge_id]
        state = envelope.state.zones.get(target) or envelope.state.zones.get(source)
        way = WayAhead(state.band.value) if state is not None else WayAhead.UNKNOWN
        measured_speed = state.mean_speed_ms if state is not None else None
        speed = measured_speed or (
            edge.free_speed_ms.value if edge.free_speed_ms is not None else None
        )
        # ``result.eta_s`` already contains the standards free-speed fallback.
        # Allocate that total by edge length when this leg has no observed speed,
        # rather than introducing a second fallback constant here.
        if speed is not None and speed > 0:
            walk_s = edge.length_m / speed
        elif result.distance_m > 0:
            walk_s = result.eta_s * edge.length_m / result.distance_m
        else:
            walk_s = 0.0
        steps.append(
            Step(
                id=f"{route_id}-leg-{index}",
                to=_label(graph, target),
                walk_s=round(walk_s, 1),
                way_ahead=way,
                crossing=_crossing_for_edge(
                    graph, edge_id, session_state=session_state
                ),
            )
        )

    return Route.model_validate(
        {
            "id": route_id,
            "from": _label(graph, origin),
            "to": _label(graph, destination),
            "steps": steps,
            "total_walk_s": round(result.eta_s, 1),
        }
    )


def build_spectator_view(
    session: ScenarioSession,
    *,
    origin: str,
    destination: str,
    online: bool = True,
    mesh_peers: int = 0,
) -> SpectatorView:
    """Current walk/offline/ahead view for one route request.

    ``online`` and ``mesh_peers`` are transport observations supplied by the
    requesting device. They never alter a band or route; they only select the
    honest freshness treatment on the phone.
    """
    envelope = session.last_envelope
    if envelope is None:
        raise SpectatorFeedUnavailable("no crowd tick is available yet")
    if mesh_peers < 0:
        raise ValueError("mesh_peers must be non-negative")

    graph = session.circuit.graph
    route = build_route(
        graph,
        envelope,
        origin=origin,
        destination=destination,
    )
    link = LinkStatus(
        online=online,
        mesh_peers=mesh_peers,
        updated_at=envelope.state.timestamp,
    )

    if not online:
        return SpectatorView(
            root=OfflineView(kind="offline", now=envelope.time_s, link=link, route=route)
        )

    command = envelope.command
    verdict = envelope.verdict
    path = graph.route(origin, destination).path
    if (
        envelope.dispatched
        and command is not None
        and verdict is not None
        and command.is_valid_at(envelope.time_s)
        and command.source_zone in path
    ):
        instead = build_route(
            graph,
            envelope,
            origin=origin,
            destination=destination,
            avoid=set(command.avoid),
            prefer=set(command.prefer),
            route_id=f"{route.id}-reroute",
        )
        step_index = path.index(command.source_zone)
        if not route.steps:
            raise SpectatorFeedUnavailable("an affected route has no walkable leg")
        step_id = route.steps[min(step_index, len(route.steps) - 1)].id
        return SpectatorView(
            root=AheadView(
                kind="ahead",
                now=envelope.time_s,
                link=link,
                route=route,
                step_id=step_id,
                offer=RerouteOffer(command=command, verdict=verdict, instead=instead),
            )
        )

    return SpectatorView(
        root=WalkView(kind="walk", now=envelope.time_s, link=link, route=route)
    )
