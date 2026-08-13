"""The transport surface, exercised against the real Silverstone pack.

The point of using the real pack here is that it is the failure mode: 1,875
zones, 2,404 edges and a coverage fraction in the low single digits. A console
tested only against a four-zone fixture would look fine right up until it was
pointed at a venue.
"""

from __future__ import annotations

import pytest
from crowdflow_api.app import create_app
from crowdflow_api.wire import FrameType, SessionStatus, SocketFrame, VenueGeometry
from crowdflow_contracts import CircuitPack
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client(repo_root):
    with TestClient(create_app(root=repo_root)) as c:
        yield c


def test_health_lists_only_built_packs(client):
    body = client.get("/api/health").json()
    assert body["ok"] is True
    assert "silverstone" in body["circuits"]
    assert body["status"] == SessionStatus.IDLE.value


def test_unknown_circuit_is_a_404_not_an_empty_venue(client):
    """An empty pack would render as a venue with nothing in it."""
    response = client.get("/api/circuits/monaco/geometry")
    assert response.status_code == 404
    assert "monaco" in response.json()["detail"]


def test_geometry_is_the_real_silverstone_graph(client):
    geometry = VenueGeometry.model_validate(
        client.get("/api/circuits/silverstone/geometry").json()
    )
    assert len(geometry.pack.zones) == 1875
    assert len(geometry.pack.edges) == 2404
    assert len(geometry.track) > 100, "track outline is what makes the map recognisable"
    assert geometry.integrity_problems == []


def test_geometry_round_trips_through_the_contract(client):
    """The dashboard's generated types are only worth anything if the payload
    actually validates against the same schema they were generated from."""
    payload = client.get("/api/circuits/silverstone/geometry").json()
    pack = CircuitPack.model_validate(payload["pack"])
    assert pack.validate_integrity() == []


def test_scenarios_name_the_zones_they_would_use(client):
    options = client.get("/api/circuits/silverstone/scenarios").json()
    assert options
    egress = next(o for o in options if o["id"] == "egress")
    assert egress["origins"] and egress["destination"]
    assert len(egress["origin_names"]) == len(egress["origins"])


def test_session_is_404_until_one_is_started(client):
    assert client.get("/api/session").status_code == 404
    assert client.post("/api/session/control", json={"action": "pause"}).status_code == 404


def test_starting_a_session_reports_every_parameter_that_changes_the_numbers(client):
    info = client.post(
        "/api/session",
        json={"circuit_id": "silverstone", "scenario": "egress", "population": 200,
              "seed": 11, "intervene": False},
    ).json()
    assert info["seed"] == 11
    assert info["population"] == 200
    assert 0 < info["participation"] <= 1
    assert info["tick_s"] > 0
    assert info["status"] == SessionStatus.PAUSED.value
    assert info["origins"] and info["destination"]


def test_unknown_scenario_is_rejected_with_the_alternatives(client):
    response = client.post(
        "/api/session", json={"circuit_id": "silverstone", "scenario": "podium-invasion"}
    )
    assert response.status_code == 400
    assert "egress" in response.json()["detail"]


def test_scenario_over_a_zone_that_is_not_in_the_pack_is_rejected(client):
    response = client.post(
        "/api/session",
        json={"circuit_id": "silverstone", "scenario": "egress", "origins": ["turn-nine"]},
    )
    assert response.status_code == 400
    assert "turn-nine" in response.json()["detail"]


def test_speed_control_requires_a_speed(client):
    client.post("/api/session", json={"population": 100, "intervene": False})
    assert client.post("/api/session/control", json={"action": "speed"}).status_code == 400
    ok = client.post("/api/session/control", json={"action": "speed", "speed": 8})
    assert ok.status_code == 200 and ok.json()["speed"] == 8


def test_standards_endpoint_serves_the_registry(client):
    body = client.get("/api/standards").json()
    assert [b["label"] for b in body["bands"]] == ["NOMINAL", "BUILDING", "CRITICAL"]
    assert [g["grade"] for g in body["los"]] == list("ABCDEF")
    assert "participation_rate" in body["measured_not_assumed"]


# -- the socket ------------------------------------------------------------


def test_socket_refuses_to_pretend_when_nothing_is_running(repo_root):
    """No session is not the same as a calm venue.

    A socket that accepted and then sent nothing would leave a console showing
    an empty map, which reads as an empty venue. It closes instead, with 1013
    (try again later) and a reason a human can act on.
    """
    from starlette.websockets import WebSocketDisconnect

    with TestClient(create_app(root=repo_root)) as bare, pytest.raises(
        WebSocketDisconnect
    ) as raised, bare.websocket_connect("/ws") as socket:
        socket.receive_text()
    assert raised.value.code == 1013
    assert "no session" in raised.value.reason


def test_hello_carries_the_legend_and_the_backlog(client):
    client.post("/api/session", json={"population": 150, "intervene": False, "seed": 5})
    with client.websocket_connect("/ws") as socket:
        frame = SocketFrame.model_validate_json(socket.receive_text())
    assert frame.type is FrameType.HELLO
    assert frame.standards is not None, "the console must not hard-code Fruin's numbers"
    assert frame.geometry_url == "/api/circuits/silverstone/geometry"
    assert frame.backlog, "a console joining late gets the history it missed"
    assert frame.session.seed == 5


def test_ticks_arrive_with_coverage_that_accounts_for_every_zone(client):
    client.post("/api/session", json={"population": 300, "intervene": False})
    client.post("/api/session/control", json={"action": "play"})
    with client.websocket_connect("/ws") as socket:
        socket.receive_text()  # hello
        for _ in range(40):
            frame = SocketFrame.model_validate_json(socket.receive_text())
            if frame.type is FrameType.TICK:
                break
        else:
            pytest.fail("no tick frame arrived")

    envelope = frame.tick
    assert envelope is not None
    coverage = envelope.coverage
    assert coverage.zones_total == 1875
    assert coverage.observed + coverage.unknown + coverage.silent == coverage.zones_total
    assert coverage.unknown > coverage.observed, (
        "most of a venue is unobserved under opportunistic uplinks — if this "
        "inverts, the state engine is inventing coverage"
    )


def test_live_spectator_endpoint_returns_the_generated_contract(client):
    client.post(
        "/api/session",
        json={"population": 100, "intervene": False, "seed": 9},
    )
    client.post("/api/session/control", json={"action": "step"})
    # Let the worker produce the requested tick through the same socket path a
    # console uses; a feed before the first observation is honestly unavailable.
    with client.websocket_connect("/ws") as socket:
        socket.receive_text()
        for _ in range(20):
            frame = SocketFrame.model_validate_json(socket.receive_text())
            if frame.type is FrameType.TICK:
                break

    info = client.get("/api/session").json()
    response = client.get(
        "/api/spectator/view",
        params={"origin": info["origins"][0], "destination": info["destination"]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["kind"] in {"walk", "ahead"}
    assert body["route"]["steps"]
    assert all(step["way_ahead"] in {"nominal", "building", "critical", "unknown"}
               for step in body["route"]["steps"])


def test_status_frames_keep_arriving_while_the_run_is_paused(client):
    """The difference between a thinking server and a dead link."""
    client.post("/api/session", json={"population": 100, "intervene": False})
    with client.websocket_connect("/ws") as socket:
        socket.receive_text()  # hello
        frame = SocketFrame.model_validate_json(socket.receive_text())
    assert frame.type is FrameType.STATUS
    assert frame.session.status == SessionStatus.PAUSED
    assert frame.tick is None
