"""Statistics first, language second.

The temptation with a language model in the building is to hand it the tick log
and ask what it notices. That is the wrong shape for three reasons, and the
ordering here exists to avoid all of them:

  * **Cost and context.** A weekend at Silverstone is millions of zone-ticks. No
    context window holds them, and sampling to fit is choosing the answer.
  * **Reliability.** "Gate 4 is clearing 34% slower" is a claim about numbers. A
    number computed by a language model is a number nobody can reproduce, and
    this system's whole premise is that its claims are checkable.
  * **Detection quality.** Anomaly detection is a solved statistical problem.

So the engine computes rolling per-zone and per-gate baselines, detects
deviation with a **modified z-score** (median and MAD, per Iglewicz and Hoaglin
— see standards), and only then, optionally, asks a model to phrase the finding.
The model is shown the finished Insight and nothing else: no raw series ever
enters a prompt, and `narrate()` cannot change a number because the numbers are
already frozen on the model object.

Why median and MAD rather than mean and standard deviation: a crowd series
contains exactly the spikes being looked for, and each one drags a mean-based
threshold up behind it. The estimator has to be blind to the thing it is
detecting.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from statistics import median

from crowdflow_contracts import (
    MAD_TO_SIGMA,
    MODIFIED_Z_OUTLIER,
    CircuitPack,
    VenueState,
    ZoneKind,
)
from pydantic import BaseModel, ConfigDict, Field

from .client import Message, ModelClient

MIN_BASELINE_POINTS = 8
"""Observations before a zone has a baseline of its own.

ASSUMED, with reasoning: a median and a MAD need enough points that neither is
decided by one reading. Eight is the smallest count at which a single outlier
cannot move the median past its neighbour. Below it the engine reports nothing
rather than reporting from three points — silence is a defensible answer and a
false alarm at a live event is not.
"""

MIN_PEERS = 3
"""Peers required before a peer comparison means anything.

ASSUMED, with reasoning: with two gates, "the peer group" is just the other gate
and every difference is 100% of the variation. Three is the smallest group with
a middle."""

SESSION_WINDOW = 3
"""Sessions a peer comparison looks back over. Chosen to match how operators
already talk about a weekend ('across the last three sessions'), and reported in
the insight so the reader knows the span rather than inferring it."""


class InsightKind(str, Enum):
    SELF_BASELINE = "self_baseline"
    """A zone deviating from its own recent history."""

    PEER_GAP = "peer_gap"
    """A gate out of line with comparable gates."""


class Insight(BaseModel):
    """One statistically-detected finding, with everything needed to check it.

    Deliberately not in crowdflow_contracts: an insight never crosses the mesh
    and never reaches a phone. It is an operator-console artefact produced by the
    agent layer, and putting it in the shared schema would imply a contract with
    runtimes that will never see one.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    kind: InsightKind
    metric: str
    subject: str = Field(description="zone id the finding is about")
    subject_name: str
    peer: str | None = Field(default=None, description="zone compared against, for a peer gap")
    peer_name: str | None = None

    observed: float
    baseline: float = Field(description="the peer or historical value compared against")
    deviation: float = Field(description="modified z-score; sign follows the difference")
    relative_change: float = Field(description="(observed - baseline) / baseline")

    samples: int = Field(ge=0, description="observations behind the baseline")
    sessions: list[str] = Field(default_factory=list)

    headline: str = Field(
        description=(
            "Deterministically generated from the numbers above. This is the "
            "authoritative sentence; narration never replaces it."
        )
    )
    narration: str | None = Field(
        default=None, description="optional model phrasing; decorative, never load-bearing"
    )

    @property
    def is_significant(self) -> bool:
        return abs(self.deviation) >= MODIFIED_Z_OUTLIER


@dataclass
class _Series:
    """One (zone, metric) series inside one session."""

    values: list[float] = field(default_factory=list)

    def add(self, value: float, cap: int) -> None:
        self.values.append(value)
        del self.values[:-cap]


def modified_z(
    value: float, sample: list[float], *, min_points: int = MIN_BASELINE_POINTS
) -> float | None:
    """Modified z-score of `value` against `sample`.

    `min_points` differs by what the sample *is*. A time series needs
    MIN_BASELINE_POINTS readings before a median means anything; a peer group of
    five gates is five points and that is all it will ever be, so applying the
    time-series floor there would silently disable peer comparison at every
    venue with fewer than eight gates.

    Returns None when the score is not computable, which happens more often than
    it looks: a perfectly flat series has MAD zero, and the textbook formula
    divides by it. A flat series is not evidence of an anomaly of infinite size,
    it is evidence of a sensor reporting a constant — so None, not inf.
    """
    if len(sample) < min_points:
        return None
    centre = median(sample)
    mad = median([abs(v - centre) for v in sample])
    if mad <= 0:
        return None
    return (value - centre) / (MAD_TO_SIGMA * mad)


TRACKED = ("density_persons_m2", "outflow_per_min", "mean_speed_ms")
"""Metrics the engine keeps baselines for.

outflow_per_min is how fast a gate clears, which is the number an operator
actually argues about; density is the classifier (never flow — see invariant 3);
speed is the early warning that falls before either moves.
"""

_SLOWER_IS_LOWER = {"outflow_per_min", "mean_speed_ms"}
"""Metrics where a lower value is the bad direction. Used only for wording."""


class InsightEngine:
    """Rolling baselines per zone and per gate, per session.

    Stateful across ticks and across sessions, and pure in the sense that
    matters: it holds only what it was given and computes only what it can show.
    """

    def __init__(
        self,
        pack: CircuitPack,
        *,
        history: int = 240,
        session_window: int = SESSION_WINDOW,
    ) -> None:
        self.pack = pack
        self.history = history
        self.session_window = session_window
        self._series: dict[tuple[str, str, str], _Series] = defaultdict(_Series)
        self._sessions: list[str] = []
        self._latest: dict[tuple[str, str], float] = {}

    # -- ingest ------------------------------------------------------------

    def observe(self, state: VenueState) -> None:
        """Absorb one tick. Session id buckets the history; None is one bucket."""
        session = state.session_id or "unassigned"
        if session not in self._sessions:
            self._sessions.append(session)
        for zone_id, zone in state.zones.items():
            for metric in TRACKED:
                value = float(getattr(zone, metric))
                self._series[(zone_id, session, metric)].add(value, self.history)
                self._latest[(zone_id, metric)] = value

    # -- naming ------------------------------------------------------------

    def _name(self, zone_id: str) -> str:
        zone = self.pack.zones.get(zone_id)
        return (zone.name if zone and zone.name else zone_id)

    @property
    def recent_sessions(self) -> list[str]:
        return self._sessions[-self.session_window :]

    # -- detection ---------------------------------------------------------

    def _self_baseline(self) -> list[Insight]:
        """Zones deviating from their own recent history.

        The comparison excludes the newest reading: scoring a point against a
        baseline that contains it pulls the baseline toward the point and
        systematically under-reports the very spikes worth reporting.
        """
        out: list[Insight] = []
        session = self._sessions[-1] if self._sessions else "unassigned"
        for (zone_id, series_session, metric), series in self._series.items():
            if series_session != session or len(series.values) <= MIN_BASELINE_POINTS:
                continue
            observed = series.values[-1]
            baseline_sample = series.values[:-1]
            score = modified_z(observed, baseline_sample)
            if score is None or abs(score) < MODIFIED_Z_OUTLIER:
                continue
            centre = median(baseline_sample)
            out.append(
                Insight(
                    id=f"self-{zone_id}-{metric}",
                    kind=InsightKind.SELF_BASELINE,
                    metric=metric,
                    subject=zone_id,
                    subject_name=self._name(zone_id),
                    observed=round(observed, 3),
                    baseline=round(centre, 3),
                    deviation=round(score, 2),
                    relative_change=round(_relative(observed, centre), 4),
                    samples=len(baseline_sample),
                    sessions=[session],
                    headline=_self_headline(
                        self._name(zone_id), metric, observed, centre, score
                    ),
                )
            )
        return out

    def _peer_gap(self) -> list[Insight]:
        """Gates out of line with the other gates, across recent sessions.

        Aggregated per session first, then across sessions, so a gate that was
        merely busy for one session does not read as chronically slow.
        """
        sessions = self.recent_sessions
        gates = [
            zid for zid, z in self.pack.zones.items() if z.kind is ZoneKind.GATE
        ]
        out: list[Insight] = []

        # Read through, never index: this is a defaultdict, and probing it for a
        # gate that never reported would silently create an empty baseline.
        def values(gate: str, session: str, metric: str) -> list[float]:
            series = self._series.get((gate, session, metric))
            return series.values if series else []

        for metric in TRACKED:
            per_gate: dict[str, float] = {}
            counts: dict[str, int] = {}
            for gate in gates:
                per_session = [
                    median(values(gate, s, metric))
                    for s in sessions
                    if len(values(gate, s, metric)) >= MIN_BASELINE_POINTS
                ]
                if not per_session:
                    continue
                per_gate[gate] = median(per_session)
                counts[gate] = sum(len(values(gate, s, metric)) for s in sessions)
            # The score sample includes the subject itself. MIN_PEERS describes
            # peers, so a valid comparison needs that many *other* gates plus the
            # subject. The old guard admitted exactly three gates and then asked
            # modified_z for four points, silently producing no insight.
            if len(per_gate) < MIN_PEERS + 1:
                continue

            for gate, value in per_gate.items():
                peers = {g: v for g, v in per_gate.items() if g != gate}
                # The subject stays in the sample: excluding it would centre the
                # comparison on a group the subject is not part of, which
                # exaggerates every gap. +1 because the group includes it.
                score = modified_z(
                    value,
                    list(peers.values()) + [value],
                    min_points=MIN_PEERS + 1,
                )
                if score is None or abs(score) < MODIFIED_Z_OUTLIER:
                    continue
                # Compare against the peer at the good end of the metric: an
                # operator reroutes toward a specific gate, not toward a median.
                best = (max if metric in _SLOWER_IS_LOWER else min)(
                    peers, key=lambda g: peers[g]
                )
                out.append(
                    Insight(
                        id=f"peer-{gate}-{metric}",
                        kind=InsightKind.PEER_GAP,
                        metric=metric,
                        subject=gate,
                        subject_name=self._name(gate),
                        peer=best,
                        peer_name=self._name(best),
                        observed=round(value, 3),
                        baseline=round(peers[best], 3),
                        deviation=round(score, 2),
                        relative_change=round(_relative(value, peers[best]), 4),
                        samples=counts[gate],
                        sessions=list(sessions),
                        headline=_peer_headline(
                            self._name(gate),
                            self._name(best),
                            metric,
                            _relative(value, peers[best]),
                            len(sessions),
                        ),
                    )
                )
        return out

    def insights(self, *, limit: int | None = None) -> list[Insight]:
        """Everything currently detectable, strongest deviation first."""
        found = self._peer_gap() + self._self_baseline()
        found.sort(key=lambda i: abs(i.deviation), reverse=True)
        return found[:limit] if limit else found


def _relative(observed: float, baseline: float) -> float:
    if baseline == 0:
        return 0.0
    return (observed - baseline) / abs(baseline)


def _self_headline(
    name: str, metric: str, observed: float, baseline: float, score: float
) -> str:
    direction = "above" if observed > baseline else "below"
    return (
        f"{name} {metric} is {observed:.2f}, {abs(score):.1f} deviations {direction} "
        f"its own baseline of {baseline:.2f}"
    )


def _peer_headline(
    subject: str, peer: str, metric: str, relative: float, sessions: int
) -> str:
    if metric == "outflow_per_min":
        word = "slower" if relative < 0 else "faster"
        return (
            f"{subject} is clearing {abs(relative):.0%} {word} than {peer} "
            f"across the last {sessions} session{'s' if sessions != 1 else ''}"
        )
    word = "lower" if relative < 0 else "higher"
    return (
        f"{subject} {metric} is {abs(relative):.0%} {word} than {peer} "
        f"across the last {sessions} session{'s' if sessions != 1 else ''}"
    )


NARRATION_SYSTEM = (
    "You are writing one sentence for a crowd-safety operator. You are given a "
    "finding that has already been computed by a statistical engine. Rephrase it "
    "in plain language for a busy reader. Do not compute anything, do not add a "
    "number that is not in the finding, and do not speculate about the cause. If "
    "the finding is unclear, say so rather than inventing detail."
)


def narrate(insight: Insight, client: ModelClient) -> Insight:
    """Ask a model to phrase a finding. Returns a copy carrying the narration.

    What is sent is the finished Insight and nothing else — no series, no ticks,
    no zone states. The model is a writer here, not an analyst, and the
    deterministic `headline` remains the authoritative sentence whatever it says.
    """
    payload = insight.model_dump_json(exclude={"narration"})
    response = client.complete(
        system=NARRATION_SYSTEM,
        messages=[Message(role="user", text=payload)],
        tools=[],
    )
    return insight.model_copy(update={"narration": response.text})
