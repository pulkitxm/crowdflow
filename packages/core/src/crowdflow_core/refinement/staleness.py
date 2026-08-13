"""Which imported edges nobody actually walks.

OpenStreetMap contains paths that are gated during an event, paths that were
resurfaced into something else, and paths that were never there. Each one is a
route the system might send somebody down. Finding them is the cheap half of the
problem; the expensive half is not deleting a real path because nobody happened
to be carrying a participating phone along it.

That is invariant 5 applied to geometry: **unobserved is not empty.** Zero
traversals is evidence of absence only if the *neighbourhood* was observed. An
edge with no traces whose neighbours are also silent sits in a coverage hole,
and saying anything about it would be inventing a fact from an absence of data.
So every edge lands in exactly one of three states:

    USED         traces crossed it
    UNUSED       no traces crossed it, but its neighbours were busy
    UNOBSERVED   neither it nor its neighbourhood was seen at all

Only UNUSED is a candidate for removal, and it is *reported*, never removed. A
map edit at a live venue is an operator decision with a person's name against
it. This module produces the list that person reads.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from crowdflow_contracts import CircuitPack

from .trace import MatchedFragment


class UsageVerdict(str, Enum):
    USED = "used"
    UNUSED = "unused"
    UNOBSERVED = "unobserved"


@dataclass(frozen=True)
class EdgeUsage:
    """One imported edge, and how much walking was seen on and around it."""

    edge_id: str
    traversals: int
    neighbourhood_traversals: int
    """Traversals on edges sharing a zone with this one. The control: it
    separates 'nobody walks here' from 'nobody was watching here'."""

    verdict: UsageVerdict

    @property
    def removal_candidate(self) -> bool:
        return self.verdict is UsageVerdict.UNUSED

    def describe(self) -> str:
        if self.verdict is UsageVerdict.USED:
            return f"{self.edge_id}: {self.traversals} traversals"
        if self.verdict is UsageVerdict.UNUSED:
            return (
                f"{self.edge_id}: no traversals, but {self.neighbourhood_traversals} "
                "on adjoining edges — candidate for removal, review before deleting"
            )
        return (
            f"{self.edge_id}: no traversals and none nearby — unobserved, "
            "not evidence of absence"
        )


def audit(pack: CircuitPack, matched: list[MatchedFragment]) -> list[EdgeUsage]:
    """Classify every imported edge by observed usage.

    Every edge appears in the result, including the used ones: a report that
    lists only the suspicious edges gives no sense of how much data stood behind
    the judgement.
    """
    counts: dict[str, int] = {}
    for m in matched:
        for t in m.traversals:
            counts[t.edge_id] = counts.get(t.edge_id, 0) + 1

    # Edges incident to each zone, so a neighbourhood is one lookup rather than
    # a scan of all 2,404 edges per edge.
    by_zone: dict[str, list[str]] = {}
    for eid, e in pack.edges.items():
        by_zone.setdefault(e.source, []).append(eid)
        by_zone.setdefault(e.destination, []).append(eid)

    out: list[EdgeUsage] = []
    for eid, e in pack.edges.items():
        neighbours = set(by_zone.get(e.source, ())) | set(by_zone.get(e.destination, ()))
        neighbours.discard(eid)
        nearby = sum(counts.get(n, 0) for n in neighbours)
        mine = counts.get(eid, 0)

        if mine > 0:
            verdict = UsageVerdict.USED
        elif nearby > 0:
            verdict = UsageVerdict.UNUSED
        else:
            verdict = UsageVerdict.UNOBSERVED

        out.append(
            EdgeUsage(
                edge_id=eid,
                traversals=mine,
                neighbourhood_traversals=nearby,
                verdict=verdict,
            )
        )

    out.sort(key=lambda u: (u.verdict is not UsageVerdict.UNUSED, u.edge_id))
    return out


def removal_candidates(usage: list[EdgeUsage]) -> list[EdgeUsage]:
    """The subset an operator should look at. Still a report, still not a delete."""
    return [u for u in usage if u.removal_candidate]
