"""I/O adapter for venue import.

All network and disk access lives here, never in crowdflow_core. Two rules from
the plan are enforced at this boundary:

  * Every external fetch is cached to disk and replayed. Nothing in the demo path
    makes a live third-party call — venue wifi will not cooperate, and the system
    is committed to working offline (plan.md section 37).
  * Raw responses are kept alongside the derived pack, so an import is
    reproducible and auditable after the fact.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

QUERY_TEMPLATE = """
[out:json][timeout:180];
(
  way["highway"~"^(footway|path|pedestrian|steps|service|track|cycleway|living_street|residential|unclassified)$"]({bbox});
  way["barrier"]({bbox});
  way["building"="grandstand"]({bbox});
  way["amenity"="parking"]({bbox});
  node["barrier"~"^(gate|entrance|stile|cycle_barrier|kissing_gate)$"]({bbox});
  node["highway"="crossing"]({bbox});
);
out geom;
"""


def circuit_dir(repo_root: Path, circuit_id: str) -> Path:
    return repo_root / "circuits" / circuit_id


def fetch_osm(
    repo_root: Path,
    circuit_id: str,
    bbox: tuple[float, float, float, float],
    *,
    refresh: bool = False,
) -> tuple[dict, bool]:
    """Fetch Overpass data, cached on disk.

    Returns (payload, from_cache). bbox is (south, west, north, east).
    """
    raw_dir = circuit_dir(repo_root, circuit_id) / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    cache = raw_dir / "osm.json"

    if cache.exists() and not refresh:
        return json.loads(cache.read_text()), True

    query = QUERY_TEMPLATE.format(bbox=",".join(str(v) for v in bbox))
    request = urllib.request.Request(
        OVERPASS_URL,
        data=query.encode(),
        headers={"User-Agent": "crowdflow/0.1 (venue import)"},
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = json.loads(response.read().decode())
    except (urllib.error.URLError, TimeoutError) as exc:
        if cache.exists():
            return json.loads(cache.read_text()), True
        raise RuntimeError(f"Overpass unavailable and no cache present: {exc}") from exc

    cache.write_text(json.dumps(payload))
    return payload, False


def load_track_geometry(repo_root: Path, geometry_source: str) -> tuple[list[tuple[float, float]], dict]:
    """Load a circuit outline from the vendored f1-circuits GeoJSON.

    Fetches and caches on first use. Returns ((lat, lon) pairs, properties).
    """
    raw = repo_root / "circuits" / "_geometry"
    raw.mkdir(parents=True, exist_ok=True)
    cache = raw / f"{geometry_source}.geojson"

    if not cache.exists():
        url = (
            "https://raw.githubusercontent.com/bacinger/f1-circuits/master/"
            f"circuits/{geometry_source}.geojson"
        )
        with urllib.request.urlopen(url, timeout=60) as response:
            cache.write_bytes(response.read())

    data = json.loads(cache.read_text())
    feature = data["features"][0]
    coords = [(c[1], c[0]) for c in feature["geometry"]["coordinates"]]
    return coords, feature["properties"]


def bbox_for_track(
    coords: list[tuple[float, float]], pad_deg: float = 0.012
) -> tuple[float, float, float, float]:
    """A padded bounding box around the track, for the Overpass query.

    Padding is generous on purpose: car parks, campsites and park-and-ride sit
    well outside the track, and the venue envelope clip in core trims what this
    over-collects. Over-fetching once and clipping precisely beats guessing a
    tight box and silently losing arrival routes.
    """
    lats = [c[0] for c in coords]
    lons = [c[1] for c in coords]
    return (
        round(min(lats) - pad_deg, 6),
        round(min(lons) - pad_deg, 6),
        round(max(lats) + pad_deg, 6),
        round(max(lons) + pad_deg, 6),
    )


def write_pack(repo_root: Path, pack, track_xy: list[tuple[float, float]]) -> Path:
    """Serialise a CircuitPack.

    Generated files are JSON, not YAML: a 2,400-edge graph in YAML is slow to
    parse and unreadable anyway. Hand-authored files stay YAML. Both are
    versioned; neither is hand-edited once generated.
    """
    out = circuit_dir(repo_root, pack.id) / "pack"
    out.mkdir(parents=True, exist_ok=True)

    meta = pack.model_dump(mode="json")
    zones = meta.pop("zones")
    edges = meta.pop("edges")
    crossings = meta.pop("crossings")
    constraints = meta.pop("constraints")

    (out / "circuit.json").write_text(json.dumps(meta, indent=2) + "\n")
    (out / "graph.json").write_text(
        json.dumps({"zones": zones, "edges": edges}, separators=(",", ":")) + "\n"
    )
    (out / "crossings.json").write_text(json.dumps(crossings, indent=2) + "\n")
    (out / "constraints.json").write_text(json.dumps(constraints, indent=2) + "\n")
    (out / "track.json").write_text(
        json.dumps([[round(x, 2), round(y, 2)] for x, y in track_xy],
                   separators=(",", ":")) + "\n"
    )
    return out


def write_refined_pack(
    repo_root: Path,
    pack,
    *,
    source_circuit_id: str | None = None,
) -> Path:
    """Write refined graph facts while preserving imported geometry artefacts.

    The circuit pack is a generated artefact, so write-back goes through the same
    serializer as import. Track geometry is copied from the source pack; nothing
    in refinement fabricates or re-fetches it.
    """
    source_id = source_circuit_id or pack.id
    return write_pack(repo_root, pack, read_track(repo_root, source_id))


def read_trace_fragments(path: Path):
    """Read JSON/JSONL TraceFragment telemetry at the adapter boundary."""
    from crowdflow_contracts import TraceFragment

    text = path.read_text()
    if path.suffix == ".jsonl":
        rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    else:
        payload = json.loads(text)
        rows = payload if isinstance(payload, list) else payload.get("fragments", [])
    return [TraceFragment.model_validate(row) for row in rows]


def write_trace_fragments(path: Path, fragments) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(fragment.model_dump_json() + "\n" for fragment in fragments)
    )
    return path


def read_pack(repo_root: Path, circuit_id: str):
    """Load a pack back into a CircuitPack. The inverse of write_pack."""
    from crowdflow_contracts import CircuitPack

    out = circuit_dir(repo_root, circuit_id) / "pack"
    meta = json.loads((out / "circuit.json").read_text())
    graph = json.loads((out / "graph.json").read_text())
    meta["zones"] = graph["zones"]
    meta["edges"] = graph["edges"]
    meta["crossings"] = json.loads((out / "crossings.json").read_text())
    meta["constraints"] = json.loads((out / "constraints.json").read_text())
    return CircuitPack.model_validate(meta)


def read_track(repo_root: Path, circuit_id: str) -> list[tuple[float, float]]:
    path = circuit_dir(repo_root, circuit_id) / "pack" / "track.json"
    if not path.exists():
        return []
    return [(x, y) for x, y in json.loads(path.read_text())]
