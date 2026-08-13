"""Disk access for circuit packs — the API's half of the I/O rule.

Core may not call `open()`, so somebody has to. The reader itself is imported
from `crowdflow_cli.ingest` rather than written again here, and that is a
deliberate dependency: `read_pack` is the exact inverse of `write_pack`, they sit
in the same module, and a second reader in a second package is how a file format
quietly forks. The API depends on the CLI for four functions' worth of file
layout knowledge and nothing else — importing `crowdflow_cli.ingest` does not
pull in typer.

Packs are cached in memory after first load. A 1,875-zone pack costs about a
second to validate and never changes while the server is up.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from crowdflow_cli.ingest import read_pack, read_track
from crowdflow_contracts import CircuitPack, Position
from crowdflow_core.routing import VenueGraph

from .wire import CircuitSummary, VenueGeometry


class PackNotFound(LookupError):
    """Raised instead of returning an empty pack.

    An empty venue renders as a venue with nothing in it, which is exactly the
    lie this system exists to avoid — so a missing pack fails loudly.
    """


def repo_root(start: Path | None = None) -> Path:
    """Walk up for the circuits index. Mirrors the CLI's rule so both adapters
    agree on where the repository is, however they were launched."""
    here = (start or Path(__file__)).resolve()
    for parent in (here, *here.parents):
        if (parent / "circuits" / "index.yaml").exists():
            return parent
    raise PackNotFound("could not locate repo root (circuits/index.yaml missing)")


def available_circuits(root: Path) -> list[str]:
    """Circuit ids that actually have a built pack on disk.

    Not the index: the index lists every circuit of the season, most of which
    have never been imported. Offering one of those would produce a console with
    an empty map.
    """
    circuits = root / "circuits"
    if not circuits.is_dir():
        return []
    return sorted(
        d.name
        for d in circuits.iterdir()
        if d.is_dir() and (d / "pack" / "circuit.json").exists()
    )


@dataclass(frozen=True)
class LoadedCircuit:
    """A pack, its track outline and a graph built over it."""

    pack: CircuitPack
    track: list[Position]
    graph: VenueGraph

    def geometry(self) -> VenueGeometry:
        return VenueGeometry(
            pack=self.pack,
            track=self.track,
            integrity_problems=self.pack.validate_integrity(),
        )

    def summary(self) -> CircuitSummary:
        return CircuitSummary(
            id=self.pack.id,
            name=self.pack.name,
            zones=len(self.pack.zones),
            edges=len(self.pack.edges),
            crossings=len(self.pack.crossings),
            track_length_m=self.pack.track_length_m,
            untrustworthy_widths=sum(
                1 for e in self.pack.edges.values() if not e.width_m.is_trustworthy
            ),
        )


@lru_cache(maxsize=4)
def load(root: Path, circuit_id: str) -> LoadedCircuit:
    """Load and cache one circuit."""
    if not (root / "circuits" / circuit_id / "pack" / "circuit.json").exists():
        known = ", ".join(available_circuits(root)) or "none built"
        raise PackNotFound(f"no pack for {circuit_id!r}; built packs: {known}")
    pack = read_pack(root, circuit_id)
    track = [Position(x=x, y=y) for x, y in read_track(root, circuit_id)]
    return LoadedCircuit(pack=pack, track=track, graph=VenueGraph(pack))
