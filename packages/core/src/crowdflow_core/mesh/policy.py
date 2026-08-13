"""Three routing policies behind one interface, selected by traffic class.

Flooding everything is epidemic routing. It has the best delivery ratio of any
protocol — it is the upper bound, by construction, since every path is taken —
and it is unusable: buffer exhaustion at the node and battery drain at the radio,
paid by a phone in a pocket whose owner did not agree to be infrastructure. So
the message says what it is, and the class chooses what it costs:

  STATE   Spray-and-Wait with a bounded copy count L. Bounded copies is bounded
          battery, and the class is defined as loss-tolerant: one lost zone
          update is one sample missing from an aggregate over thousands.

  UPLINK  PRoPHET. The destination is not an address, it is ANY node with
          internet — and PRoPHET's delivery predictability is already the
          quantity "how likely is this node to reach the destination". Point it
          at a sentinel destination meaning 'the internet' and routing toward
          connectivity is not bolted on, it is what the algorithm computes. A
          node that is online sets its own predictability to certainty; everyone
          who meets it inherits a fraction of that through the transitivity term,
          and the gradient that results points at connectivity.

  URGENT  Epidemic, rate limited. Affordable precisely because it is rare, and
          the rate limit is what keeps 'rare' true when something misbehaves.

Every policy decision here is local: what this node knows, what this peer just
told it. No policy consults a topology it could not have observed from
encounters, because no device can.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import TYPE_CHECKING

from crowdflow_contracts import (
    PROPHET_BETA,
    PROPHET_GAMMA,
    PROPHET_P_INIT,
    PROPHET_TIME_UNIT_S,
    MeshClass,
    spray_copies_for,
)

from .buffer import Carried

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .node import MeshNode

UPLINK_DESTINATION = "*internet*"
"""The sentinel destination every class routes toward.

There is no fixed gateway (D7), so 'the dashboard' is not an address on the mesh.
It is a property some nodes have some of the time. Making it a destination label
means the routing algorithms need no modification to chase it."""


@dataclass(frozen=True)
class Transmission:
    """A policy's decision to hand a message to a peer.

    `copies` is the allowance transferred with it — Spray-and-Wait's currency.
    The other policies always transfer 1, which is not the same as transferring
    their whole allowance: they keep their own copy, which is why their
    copies-per-message grows and Spray's does not.
    """

    copies: int = 1
    focus_forwards: int = 0
    """Focus-phase duplications already spent by this copy, travelling WITH it.

    Leaving the counter behind instead of sending it makes the bound a lie: each
    handed-over copy would arrive with a fresh allowance and the retention chain
    would branch for as long as TTL allowed. Zero by default, so it is inert
    unless someone deliberately turns retention on."""


class DeliveryPredictability:
    """PRoPHET's P(a, d) table: this node's chance of delivering to d.

    Three updates, exactly as published (Lindgren et al. 2003, RFC 6693):

        direct       P(a,b) <- P(a,b) + (1 - P(a,b)) * P_INIT
        aging        P(a,d) <- P(a,d) * GAMMA^k
        transitivity P(a,c) <- P(a,c) + (1 - P(a,c)) * P(a,b) * P(b,c) * BETA

    The transitivity rule is the interesting one for this system. With d fixed to
    the uplink sentinel, "P(a, internet)" is built out of who a meets and how
    likely THEY are to reach the internet — which is the definition of an
    opportunistic gateway, arrived at without a special case.
    """

    def __init__(self, node_id: str, now: float = 0.0) -> None:
        self.node_id = node_id
        self._p: dict[str, float] = {}
        self._aged_at = now

    def get(self, destination: str) -> float:
        return self._p.get(destination, 0.0)

    def set(self, destination: str, value: float) -> None:
        self._p[destination] = max(0.0, min(1.0, value))

    def as_dict(self) -> dict[str, float]:
        return dict(self._p)

    def age(self, now: float) -> None:
        """Decay every entry by GAMMA^k, k in elapsed time units.

        Aging is what makes a stale acquaintance stop looking like a route. It is
        applied on encounter rather than on a timer because a node with no
        encounters has nothing to decide and no reason to wake its CPU.
        """
        elapsed = now - self._aged_at
        if elapsed <= 0:
            return
        k = elapsed / PROPHET_TIME_UNIT_S
        decay = PROPHET_GAMMA**k
        self._p = {d: p * decay for d, p in self._p.items()}
        self._aged_at = now

    def observe_encounter(self, peer_id: str, peer_table: dict[str, float], now: float) -> None:
        """Fold a peer's table into ours: direct update, then transitivity."""
        self.age(now)
        direct = self.get(peer_id)
        self.set(peer_id, direct + (1.0 - direct) * PROPHET_P_INIT)
        via = self.get(peer_id)
        for destination, peer_p in peer_table.items():
            if destination == self.node_id:
                continue
            current = self.get(destination)
            self.set(destination, current + (1.0 - current) * via * peer_p * PROPHET_BETA)


class RoutingPolicy(ABC):
    """One decision: does this message go to this peer, and with what allowance?

    Deliberately not "route this message" — no node in a delay-tolerant network
    has a route. It has a peer in front of it right now and has to decide.
    """

    traffic_class: MeshClass
    name: str

    @abstractmethod
    def consider(
        self, carried: Carried, local: MeshNode, peer: MeshNode, now: float
    ) -> Transmission | None:
        """Return a Transmission to send, or None to keep carrying."""

    def commit(self, carried: Carried, transmission: Transmission, local: MeshNode) -> None:
        """Account for a transmission that actually happened."""


class SprayAndWait(RoutingPolicy):
    """Binary Spray-and-Wait (Spyropoulos et al. 2005) for STATE traffic.

    Spray phase: hand half your remaining copies to any peer that lacks the
    message. Wait phase (one copy left): transmit only to the destination itself.
    Binary handover rather than source-spray because it reaches L custodians in
    log(L) encounter generations instead of L, for the same copy bound.

    The bound is the whole point. Whatever the topology does, this message costs
    at most L transmissions, so the battery cost of the STATE class is known
    before the event rather than discovered during it.
    """

    traffic_class = MeshClass.STATE
    name = "spray-and-wait"

    def consider(self, carried, local, peer, now):
        if peer.id in carried.forwarded_to or peer.has_seen(carried.key):
            return None
        if carried.copies <= 1:
            # Wait phase: direct delivery only. `peer.online` is the destination
            # test, because the destination is a property, not an address.
            return Transmission(copies=1) if peer.online else None
        return Transmission(copies=carried.copies // 2)

    def commit(self, carried, transmission, local):
        carried.copies = max(1, carried.copies - transmission.copies)


class Prophet(RoutingPolicy):
    """PRoPHET delivery predictability for UPLINK traffic.

    The forwarding test is PRoPHET's GRTR rule: hand the message over when the
    peer is more likely than we are to reach the destination. The destination is
    the uplink sentinel, so "more likely to reach the destination" reads directly
    as "more likely to reach connectivity", computed from encounter history by
    the algorithm's own recursion. A peer that is online right now is an
    unconditional forward — it can deliver this second, and no estimate beats an
    observation.

    On top of GRTR sits a COPY BUDGET, and it is there because of a measurement
    rather than because a paper said so. Published GRTR keeps its own copy after
    forwarding, which is fine when the destination is one node and delivery ends
    the message's life. It is not fine when the destination is "anyone with
    internet" and connectivity is scarce: an undelivered message survives its
    whole TTL and spawns a fresh copy at every encounter with a marginally better
    peer. TTL bounds how FAR a message travels, not how many times it is
    duplicated. Measured at 5% connectivity, 150 nodes, 200 ticks:

        GRTR alone        delivery 0.987    733 copies/message
        GRTR + budget     delivery 0.978     49 copies/message

    Fifteen times the radio traffic for nine parts in a thousand of delivery.
    `copy_budget=False` restores literal GRTR, kept because that comparison is
    the evidence for this paragraph and should stay re-runnable.

    With the budget on, this is Spray and Focus (Spyropoulos et al. 2007) using
    PRoPHET's predictability as the focus utility: binary spraying bounds how
    many copies exist, PRoPHET decides who should hold them, and in the focus
    phase the last copy moves by handing over custody rather than duplicating.
    Both halves are published and each fixes what the other lacks — Spray-and-Wait
    chooses custodians blindly, GRTR chooses well and never stops choosing.

    `retain_focus_forwards` lets a copy duplicate rather than transfer custody,
    that many times, before it starts moving. It defaults to 0 — the published
    algorithm, no invented constant — and the history is worth keeping because it
    is a good example of a knob covering for a bug. It was added at 1 when
    custody transfer measured 0.72 delivery against blind spraying's 0.95, and
    it did help. The actual cause was elsewhere (see `MeshNode.has_seen`): a copy
    handed to a peer that then refused it on dedupe was dropped by the sender,
    so the message simply ceased to exist. With that fixed the curve flattens
    and the knob stops paying for itself:

        retain=0   delivery 0.978     49 copies/message
        retain=1   delivery 0.980     76 copies/message
        retain=2   delivery 0.982    110 copies/message
        retain=3   delivery 0.987    151 copies/message
    """

    traffic_class = MeshClass.UPLINK
    name = "prophet"

    def __init__(
        self,
        destination: str = UPLINK_DESTINATION,
        copy_budget: bool = True,
        retain_focus_forwards: int = 0,
    ) -> None:
        self.destination = destination
        self.copy_budget = copy_budget
        self.retain_focus_forwards = retain_focus_forwards

    def consider(self, carried, local, peer, now):
        if peer.id in carried.forwarded_to or peer.has_seen(carried.key):
            return None
        if peer.online:
            return Transmission()
        if not self.copy_budget:
            # Literal GRTR: forward to anyone better, keep the copy.
            better = peer.predictability(self.destination) > local.predictability(
                self.destination
            )
            return Transmission() if better else None

        if carried.copies > 1:
            # Spray phase, and it is deliberately BLIND — the same rule as
            # Spray-and-Wait. Gating the spray on predictability as well looks
            # like more intelligence and measures as less: it creates far fewer
            # custodians, and with the copy count already bounded there is no
            # cost to spreading them widely. Selectivity is worth paying for
            # when it decides where the LAST copy goes, not where the first
            # thirteen go. (Measured: gating the spray dropped UPLINK delivery
            # from 0.94 to 0.76 at 5% connectivity, for no saving.)
            return Transmission(copies=carried.copies // 2)

        # Focus phase: one copy left, so it moves rather than multiplies, and it
        # moves only up the predictability gradient. This is where PRoPHET earns
        # its place — a Spray-and-Wait custodian in the same position simply
        # waits.
        if peer.predictability(self.destination) <= local.predictability(self.destination):
            return None
        retaining = carried.focus_forwards < self.retain_focus_forwards
        return Transmission(
            focus_forwards=carried.focus_forwards + 1 if retaining else carried.focus_forwards
        )

    def commit(self, carried, transmission, local):
        if not self.copy_budget:
            return
        remaining = carried.copies - transmission.copies
        if remaining >= 1:
            carried.copies = remaining
            return
        if carried.focus_forwards < self.retain_focus_forwards:
            # Keep this copy AND the one just handed over. Bounded: the retained
            # copy carries the spent counter with it, so it cannot do this again.
            carried.focus_forwards += 1
            return
        # Focus phase: the last copy was handed over, not duplicated. Custody has
        # moved, so continuing to carry it would be exactly the duplication this
        # budget exists to prevent.
        local.buffer.drop(carried.key)


class RateLimitedEpidemic(RoutingPolicy):
    """Epidemic routing with a token bucket, for URGENT traffic.

    Give a copy to every peer that does not have one — the highest delivery ratio
    available, and the shortest delay, because every path is tried at once. The
    token bucket is what makes it a policy rather than a fault: a node can flood
    its neighbourhood in a burst, then must wait to refill before it can do so
    again. If URGENT ever stops being rare, the limiter degrades it toward
    direct delivery instead of degrading the whole mesh.
    """

    traffic_class = MeshClass.URGENT
    name = "rate-limited-epidemic"

    def consider(self, carried, local, peer, now):
        if peer.id in carried.forwarded_to or peer.has_seen(carried.key):
            return None
        if not local.relay_budget.available(now):
            return None
        return Transmission()

    def commit(self, carried, transmission, local):
        local.relay_budget.take(local.clock)


def default_policies() -> dict[MeshClass, RoutingPolicy]:
    """The class -> policy table. One place, so a class cannot silently fall
    back to flooding by being forgotten."""
    return {
        MeshClass.STATE: SprayAndWait(),
        MeshClass.UPLINK: Prophet(),
        MeshClass.URGENT: RateLimitedEpidemic(),
    }


def initial_copies(traffic_class: MeshClass, reachable_nodes: int) -> int:
    """Copy allowance a freshly originated message starts with.

    The two bounded classes get the same L, from the same population estimate.
    Giving UPLINK a bigger budget would confuse the comparison: the two policies
    differ in whom they hand copies to, and holding the budget equal is what
    makes that difference measurable. URGENT gets no allowance because epidemic
    routing is defined by not having one — its bound is the rate limiter.

    L comes from the population rather than a constant because the copy count
    that keeps delay near optimal grows with the crowd.
    """
    if traffic_class is MeshClass.URGENT:
        return 1
    return spray_copies_for(reachable_nodes)
