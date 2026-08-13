"""One participating device, as protocol state.

A node knows only what a phone can know: its own position, whether its own data
connection is working this second, which peers are in radio range right now, and
what those peers have told it. It never consults a topology, a node list or a
server, because there is no moment at which a phone in a pocket at a circuit has
one of those.

`encounter` is the whole protocol: two nodes in range exchange predictability
tables, then offer each other messages, and every offer is filtered by dedupe and
TTL before it costs a transmission.
"""

from __future__ import annotations

from dataclasses import dataclass

from crowdflow_contracts import (
    ASSUMED_MESH_BUFFER_MESSAGES,
    ASSUMED_URGENT_BURST_RELAYS,
    ASSUMED_URGENT_RELAYS_PER_MIN,
    MESH_TTL_MAX,
    MeshClass,
    MeshMessage,
    MeshMessageType,
    Position,
)

from .buffer import Carried, DedupeCache, MessageBuffer, MessageKey, TokenBucket, key_of
from .policy import UPLINK_DESTINATION, RoutingPolicy, default_policies, initial_copies

ONLINE_CERTAINTY = 1.0
"""A node with a working data connection delivers to the internet with certainty.

Not a tuned parameter — it is the definition of the destination. Everything else
in the predictability table is an estimate; this one is an observation."""


@dataclass(frozen=True)
class Delivery:
    """A message that reached the internet, recorded where it arrived.

    Carries `hops` and `origin_timestamp` because the dashboard cannot ask later:
    the path is gone by the time the observation lands, and an observation whose
    age is unknown is an observation that cannot be trusted or discarded.
    """

    key: MessageKey
    traffic_class: MeshClass
    message: MeshMessage
    uplink_id: str
    hops: int
    origin_timestamp: float
    delivered_at: float

    @property
    def transit_s(self) -> float:
        return self.delivered_at - self.origin_timestamp


@dataclass
class NodeRadio:
    """Physical facts about a device, separated from protocol state.

    Kept apart because these are the things a real deployment measures and the
    protocol must merely react to — including `online`, which is not a setting
    but an observation that flips when the cell network saturates.
    """

    position: Position
    online: bool = False
    battery: float = 1.0
    uplink_throughput_kbps: float = 0.0
    """Measured, not assumed. Zero when offline; used only to break ties in
    uplink election, where a node with a working-but-crawling connection should
    lose to one with headroom."""


class MeshNode:
    """A device on the mesh."""

    def __init__(
        self,
        node_id: str,
        position: Position,
        *,
        online: bool = False,
        battery: float = 1.0,
        now: float = 0.0,
        buffer_capacity: int = ASSUMED_MESH_BUFFER_MESSAGES,
        policies: dict[MeshClass, RoutingPolicy] | None = None,
        population_hint: int = 0,
        dedupe_retention_s: float | None = None,
    ) -> None:
        self.id = node_id
        self.radio = NodeRadio(position=position, online=online, battery=battery)
        self.clock = now
        self.buffer = MessageBuffer(capacity=buffer_capacity)
        self.seen = DedupeCache(retention_s=dedupe_retention_s)
        self.policies = policies if policies is not None else default_policies()
        self.relay_budget = TokenBucket(
            rate_per_s=ASSUMED_URGENT_RELAYS_PER_MIN / 60.0,
            capacity=ASSUMED_URGENT_BURST_RELAYS,
            now=now,
        )
        self.population_hint = population_hint
        """Best local estimate of how many nodes are reachable, which sets the
        Spray-and-Wait copy bound. A device estimates it from how many distinct
        peers it has met; the simulator can supply the true figure so the two can
        be compared."""

        from .policy import DeliveryPredictability

        self.predictabilities = DeliveryPredictability(node_id, now=now)
        self.uplinked: list[Delivery] = []
        self.transmissions = 0
        self.transmissions_by_class: dict[MeshClass, int] = {c: 0 for c in MeshClass}
        """Per class, because the comparison that justifies not flooding is a
        per-class cost and a global counter cannot make it."""
        self.sequence = 0
        self.peers_met: set[str] = set()
        self.contacts: set[str] = set()
        self.previous_contacts: set[str] = set()
        """Peers in radio range now, and last tick. The difference is what counts
        as a new CONTACT, which is the event PRoPHET's update is defined on."""

        if online:
            self.predictabilities.set(UPLINK_DESTINATION, ONLINE_CERTAINTY)

    # -- physical state ----------------------------------------------------

    @property
    def position(self) -> Position:
        return self.radio.position

    @property
    def online(self) -> bool:
        return self.radio.online

    def set_online(self, online: bool, now: float) -> None:
        """Connectivity changed. Predictability follows, and decays on its own.

        Going offline does NOT zero the entry: a node that had internet a minute
        ago is genuinely a better custodian than one that never has, and letting
        GAMMA age the value is exactly the claim PRoPHET makes about history.
        """
        self.radio.online = online
        if online:
            self.predictabilities.age(now)
            self.predictabilities.set(UPLINK_DESTINATION, ONLINE_CERTAINTY)

    def move_to(self, position: Position) -> None:
        self.radio.position = position

    def advance(self, now: float, peers: set[str] | None = None) -> None:
        """Tick housekeeping: rotate contacts, expire dedupe entries and dead messages.

        `peers` is who is in radio range right now. Rotating it here is what lets
        `encounter` tell a new contact from a contact that has merely persisted —
        see the defect note there.
        """
        self.clock = now
        self.previous_contacts = self.contacts
        self.contacts = set(peers) if peers is not None else set()
        self.seen.expire(now)
        self.buffer.prune_expired()
        if self.online:
            self.predictabilities.set(UPLINK_DESTINATION, ONLINE_CERTAINTY)

    # -- protocol state ----------------------------------------------------

    def holds(self, key: MessageKey) -> bool:
        return key in self.buffer

    def has_seen(self, key: MessageKey) -> bool:
        """What this node would advertise in a summary vector.

        Strictly stronger than [holds]: a node that already delivered a message
        to an uplink, or already let its TTL run out, no longer holds it but must
        still say it has seen it. Offering on `holds` alone re-sends to exactly
        those nodes, and the transmission is spent before the receiver's dedupe
        gets to refuse it — the peer pays nothing and the sender pays everything,
        which is the worst way round.
        """
        return self.seen.seen(key)

    def predictability(self, destination: str) -> float:
        return self.predictabilities.get(destination)

    def originate(
        self,
        message_type: MeshMessageType,
        traffic_class: MeshClass,
        payload: dict,
        now: float,
        ttl: int = MESH_TTL_MAX,
    ) -> MeshMessage:
        """Create a message here. Sequence is per-source and monotonic."""
        message = MeshMessage(
            type=message_type,
            traffic_class=traffic_class,
            source=self.id,
            sequence=self.sequence,
            ttl=ttl,
            timestamp=now,
            payload=payload,
        )
        self.sequence += 1
        self.accept(message, now, initial_ttl=ttl)
        return message

    def accept(
        self,
        message: MeshMessage,
        now: float,
        initial_ttl: int = MESH_TTL_MAX,
        copies: int | None = None,
        focus_forwards: int = 0,
    ) -> bool:
        """Take custody of a message. False if dropped.

        `copies` is the allowance handed over by the sender; None means this node
        originated the message and takes the class's full opening allowance.

        Order matters and is the reason this is one function rather than three
        checks scattered over the caller:

          1. Dedupe first — a duplicate costs nothing further, whatever its TTL.
          2. Deliver second — if this node is an uplink the message has ARRIVED,
             and an expired message that arrived is still a delivery. Refusing it
             for TTL here would throw away a completed journey to enforce a rule
             about journeys not yet taken.
          3. Store last, and only if it can still travel AND this node is not
             itself the destination. An uplink that stores a delivered message
             goes on relaying traffic that has already arrived — which is not a
             small inefficiency, it is a node spending its battery to spread a
             message whose job is done, forever.

        Every class here is destined for the internet, so `self.online` is the
        destination test. Traffic travelling the other way — an alert the
        dashboard pushes back out to spectators — is a separate path with a
        different destination and is not modelled by this method.
        """
        key = key_of(message)
        if not self.seen.check_and_add(key, now):
            return False

        if self.online:
            self.uplinked.append(
                Delivery(
                    key=key,
                    traffic_class=message.traffic_class,
                    message=message,
                    uplink_id=self.id,
                    hops=initial_ttl - message.ttl,
                    origin_timestamp=message.timestamp,
                    delivered_at=now,
                )
            )
            return False

        if message.expired:
            return False
        allowance = (
            initial_copies(message.traffic_class, self.population_hint)
            if copies is None
            else copies
        )
        return self.buffer.add(
            Carried(
                message=message,
                initial_ttl=initial_ttl,
                received_at=now,
                copies=allowance,
                focus_forwards=focus_forwards,
            )
        )


def encounter(a: MeshNode, b: MeshNode, now: float) -> int:
    """Two nodes in radio range. Returns transmissions spent.

    Symmetric: both directions are offered, because in a store-carry-forward
    network the peer that has something for you is as likely to be either one.
    Predictability tables are exchanged first — a peer's estimate is only useful
    to the forwarding decision that follows it, in that order.

    The predictability update fires ONCE PER CONTACT, not once per timestep, and
    this is not a detail. Two people walking together are in range for minutes; a
    tick-rate update applies P <- P + (1-P)*0.75 to that one relationship dozens
    of times and drives it to 1, and transitivity then drives everyone ELSE's
    estimate to 1 as well. Every node then believes it is a perfect custodian,
    the forwarding test `peer is better than me` becomes a coin flip on
    floating-point noise, and PRoPHET silently degenerates into epidemic routing
    while still reporting itself as PRoPHET. Measured here at 5-10x the copies
    per message before the fix, with no change in delivery ratio to show for it.
    """
    a.peers_met.add(b.id)
    b.peers_met.add(a.id)

    if b.id not in a.previous_contacts or a.id not in b.previous_contacts:
        table_a = a.predictabilities.as_dict()
        table_b = b.predictabilities.as_dict()
        if b.online:
            table_b[UPLINK_DESTINATION] = ONLINE_CERTAINTY
        if a.online:
            table_a[UPLINK_DESTINATION] = ONLINE_CERTAINTY
        a.predictabilities.observe_encounter(b.id, table_b, now)
        b.predictabilities.observe_encounter(a.id, table_a, now)
    else:
        # Contact persisting: no new evidence, but time still passes and stale
        # confidence still has to decay.
        a.predictabilities.age(now)
        b.predictabilities.age(now)

    return _offer_all(a, b, now) + _offer_all(b, a, now)


def _offer_all(sender: MeshNode, receiver: MeshNode, now: float) -> int:
    sent = 0
    for carried in sender.buffer.relayable():
        policy = sender.policies.get(carried.message.traffic_class)
        if policy is None:
            continue
        decision = policy.consider(carried, sender, receiver, now)
        if decision is None:
            continue

        # TTL is spent on the wire, before the receiver has a say. Decrementing
        # at the receiver instead would let a message with one hop left cross an
        # unbounded number of radios as long as nobody stored it.
        relayed = carried.message.hop()
        receiver.accept(
            relayed,
            now,
            initial_ttl=carried.initial_ttl,
            copies=decision.copies,
            focus_forwards=decision.focus_forwards,
        )
        sender.transmissions += 1
        sender.transmissions_by_class[carried.message.traffic_class] += 1
        sent += 1
        carried.forwarded_to.add(receiver.id)
        policy.commit(carried, decision, sender)

        if receiver.online:
            # Handed to the destination over a bidirectional link, so the sender
            # knows it arrived and has no reason to carry it further. Without
            # this, a custodian in Spray-and-Wait's wait phase re-delivers to
            # every uplink it ever meets and the copy bound — the entire reason
            # for choosing the policy — silently stops holding.
            sender.buffer.drop(carried.key)
    return sent
