"""One pass over the traces, three answers.

Desire lines, measured capacity and staleness all start from the same expensive
step — matching fragments onto the imported graph — so they share it here rather
than each paying for it. The report is the object an adapter renders and an
operator reads.

Nothing in this module changes the pack. `RefinementReport.apply` returns a new
CircuitPack and is the only function that builds one, so that adopting
refinements is a single visible call at a single visible moment rather than
something that quietly happened during analysis.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from crowdflow_contracts import CircuitPack, Edge, TraceFragment

from ..routing.graph import VenueGraph
from . import capacity as capacity_mod
from . import desire as desire_mod
from . import staleness as staleness_mod
from .capacity import EdgeMeasurement
from .desire import DesireLine
from .staleness import EdgeUsage, UsageVerdict
from .trace import MatchedFragment, TraceMatcher


@dataclass
class RefinementReport:
    """What the traces had to say about the imported map."""

    circuit_id: str
    fragments: int
    matched_points: int
    off_graph_points: int

    desire_lines: list[DesireLine] = field(default_factory=list)
    measurements: dict[str, EdgeMeasurement] = field(default_factory=dict)
    usage: list[EdgeUsage] = field(default_factory=list)
    refined_edges: dict[str, Edge] = field(default_factory=dict)
    """Edges whose measurement is a genuine upgrade on the import."""

    @property
    def off_graph_share(self) -> float:
        """Share of trace points the imported graph could not explain.

        A high share is not necessarily a discovery — it is equally a sign that
        the import is bad or the noise is large — which is why it is reported
        beside the desire lines rather than inside them.
        """
        total = self.matched_points + self.off_graph_points
        return self.off_graph_points / total if total else 0.0

    @property
    def removal_candidates(self) -> list[EdgeUsage]:
        return staleness_mod.removal_candidates(self.usage)

    @property
    def unobserved_edges(self) -> list[EdgeUsage]:
        return [u for u in self.usage if u.verdict is UsageVerdict.UNOBSERVED]

    @property
    def proposed_edges(self) -> dict[str, Edge]:
        """Desire lines with enough support and a measurable width."""
        return desire_mod.propose_edges(self.desire_lines)

    def summary(self) -> list[str]:
        trusted = sum(1 for line in self.desire_lines if line.is_trustworthy)
        return [
            f"{self.fragments} fragments, {self.off_graph_share:.1%} of points off-graph",
            f"{len(self.desire_lines)} desire lines ({trusted} with enough support)",
            f"{len(self.refined_edges)} edges refined from measurement",
            f"{len(self.removal_candidates)} edges unused where their neighbours were busy",
            f"{len(self.unobserved_edges)} edges unobserved (no conclusion drawn)",
        ]

    def apply(self, pack: CircuitPack, *, adopt_proposals: bool = False) -> CircuitPack:
        """Return a pack with the refinements folded in.

        Refined widths and speeds are adopted by default because they replace a
        stated guess with a measurement of the same thing. Proposed *edges* are
        not, because adding geometry changes where the system will send people
        and that is an operator's call, not an analysis step. Removal candidates
        are never applied at all — deletion is reported and nothing else.
        """
        edges = dict(pack.edges)
        edges.update(self.refined_edges)
        if adopt_proposals:
            edges.update(self.proposed_edges)
        return pack.model_copy(update={"edges": edges})


def refine(
    pack: CircuitPack,
    fragments: list[TraceFragment],
    participation_rate: float,
    *,
    graph: VenueGraph | None = None,
    min_support: int | None = None,
) -> RefinementReport:
    """Match once, then answer all three questions from the same match."""
    matcher = TraceMatcher(pack)
    matched: list[MatchedFragment] = [matcher.match(f) for f in fragments]

    on = sum(1 for m in matched for x in m.matches if x.on_graph)
    off = sum(1 for m in matched for x in m.matches if not x.on_graph)

    kwargs = {} if min_support is None else {"min_support": min_support}
    lines = desire_mod.discover(pack, fragments, matched=matched, graph=graph, **kwargs)
    measurements = capacity_mod.measure_edges(pack, matched, participation_rate)

    report = RefinementReport(
        circuit_id=pack.id,
        fragments=len(fragments),
        matched_points=on,
        off_graph_points=off,
        desire_lines=lines,
        measurements=measurements,
        usage=staleness_mod.audit(pack, matched),
        refined_edges=capacity_mod.apply_measurements(pack, measurements),
    )
    return report
