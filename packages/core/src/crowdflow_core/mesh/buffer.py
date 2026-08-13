"""What a node remembers, and what it refuses to remember twice.

Two mechanisms, both enforced at EVERY hop rather than at the destination:

  * **Sequence dedupe.** A store-carry-forward mesh has cycles by construction —
    A gives to B, B walks past C, C walks back past A. Deduping only at the
    destination means the copy still crossed every radio in between, which is the
    cost that matters: battery is spent on transmission, not on delivery. So the
    check happens the moment a message is offered.
  * **TTL.** Decremented on relay, checked before relay. A message whose TTL has
    run out is still delivered locally if this node happens to be an uplink — it
    arrived, and refusing it at the door would throw away a completed delivery —
    but it is never transmitted again.

The buffer is bounded, because unbounded buffers hide the failure mode this whole
module exists to argue about. Eviction is by traffic class first: STATE is
defined as loss-tolerant, so STATE is what gets dropped when a flood arrives.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from crowdflow_contracts import (
    ASSUMED_MESH_BUFFER_MESSAGES,
    MeshClass,
    MeshMessage,
    dedupe_retention_s,
)

MessageKey = tuple[str, int]
"""(source, sequence). The identity of a message, independent of which copy."""


def key_of(message: MeshMessage) -> MessageKey:
    return (message.source, message.sequence)


@dataclass
class Carried:
    """One message as held by one node, with the per-policy state it needs.

    `copies` is Spray-and-Wait's allowance and is meaningless to the other two
    policies; keeping it here rather than in the policy means a node's buffer is
    a single homogeneous store, which is what a real device has.
    """

    message: MeshMessage
    initial_ttl: int
    received_at: float
    copies: int = 1
    focus_forwards: int = 0
    forwarded_to: set[str] = field(default_factory=set)
    """Peers already given this message. Re-offering it to the same peer on the
    next tick is pure battery cost: encounters last many ticks."""

    @property
    def key(self) -> MessageKey:
        return key_of(self.message)

    @property
    def hops(self) -> int:
        """How far this copy has travelled. TTL counts down from initial_ttl."""
        return self.initial_ttl - self.message.ttl

    @property
    def relayable(self) -> bool:
        return not self.message.expired


class DedupeCache:
    """(source, sequence) seen-set with a retention window.

    Bounded by time rather than by count on purpose: the correctness condition is
    "remember at least as long as a message can survive", and that is a duration
    (ttl * hop latency), not a number of entries. A count-bounded cache under
    load forgets the oldest entry first — which is exactly the message still
    circulating.
    """

    def __init__(self, retention_s: float | None = None) -> None:
        self.retention_s = dedupe_retention_s() if retention_s is None else retention_s
        self._seen: dict[MessageKey, float] = {}

    def __len__(self) -> int:
        return len(self._seen)

    def seen(self, key: MessageKey) -> bool:
        return key in self._seen

    def check_and_add(self, key: MessageKey, now: float) -> bool:
        """True if this is the first sight of `key`. False means duplicate.

        Refreshes the timestamp on a duplicate: a message still being offered is
        still in flight, and forgetting it while it circulates reopens the loop.
        """
        first = key not in self._seen
        self._seen[key] = now
        return first

    def expire(self, now: float) -> int:
        stale = [k for k, t in self._seen.items() if now - t > self.retention_s]
        for k in stale:
            del self._seen[k]
        return len(stale)


EVICTION_ORDER = (MeshClass.STATE, MeshClass.UPLINK, MeshClass.URGENT)
"""Which class is sacrificed first when the buffer is full.

Not a tuning knob: it is the definition of the classes. STATE is the class whose
contract says losing one zone update is harmless, so STATE is the class that may
be lost. URGENT is evicted only when the buffer holds nothing else, and then only
the oldest — a device that has been carrying an alert for longer than the alert
can matter is not helping anyone.
"""


class MessageBuffer:
    """Bounded store-carry-forward buffer."""

    def __init__(self, capacity: int = ASSUMED_MESH_BUFFER_MESSAGES) -> None:
        self.capacity = capacity
        self.evictions = 0
        self.evictions_by_class: dict[MeshClass, int] = {c: 0 for c in MeshClass}
        """Per class, because "who paid for the flood" is the interesting half of
        the answer and a total cannot say."""
        self._held: dict[MessageKey, Carried] = {}

    def __len__(self) -> int:
        return len(self._held)

    def __contains__(self, key: MessageKey) -> bool:
        return key in self._held

    def get(self, key: MessageKey) -> Carried | None:
        return self._held.get(key)

    def add(self, carried: Carried) -> bool:
        """Store a message, evicting if necessary. False if it was not stored.

        A message can fail to be stored only by losing the eviction contest
        against everything already held, which happens when an URGENT flood
        arrives at a buffer already full of URGENT.
        """
        if carried.key in self._held:
            return False
        if len(self._held) >= self.capacity:
            victim = self._eviction_candidate()
            # Refuse the newcomer when it is the MOST droppable thing in the
            # room, not when it is the least: `rank` sorts droppable-first, so
            # the comparison reads backwards from the usual "is this better".
            if victim is None or self._rank(carried) <= self._rank(victim):
                return False
            del self._held[victim.key]
            self.evictions += 1
            self.evictions_by_class[victim.message.traffic_class] += 1
        self._held[carried.key] = carried
        return True

    def _rank(self, carried: Carried) -> tuple[int, float]:
        """Sort key for eviction: lower is dropped first."""
        return (EVICTION_ORDER.index(carried.message.traffic_class), carried.received_at)

    def _eviction_candidate(self) -> Carried | None:
        if not self._held:
            return None
        return min(self._held.values(), key=self._rank)

    def drop(self, key: MessageKey) -> None:
        self._held.pop(key, None)

    def relayable(self) -> list[Carried]:
        """Messages this node may still transmit, oldest first.

        Oldest first because a message that has been carried longest is the one
        closest to being useless, so it gets the next encounter.
        """
        return sorted(
            (c for c in self._held.values() if c.relayable),
            key=lambda c: c.received_at,
        )

    def prune_expired(self) -> int:
        """Discard messages that can no longer be relayed.

        Separate from the TTL check on the relay path so that a node holding only
        dead messages actually frees the memory, rather than carrying them until
        something else needs the space.
        """
        dead = [k for k, c in self._held.items() if not c.relayable]
        for k in dead:
            del self._held[k]
        return len(dead)


class TokenBucket:
    """Rate limiter for the one policy that is allowed to flood.

    Standard token bucket: `capacity` tokens for a burst, refilled at `rate_per_s`.
    A burst matters here — an alert must reach every peer standing around the node
    on the first encounter, not be metered out one peer per tick — but the refill
    is what makes epidemic routing affordable at all.
    """

    def __init__(self, rate_per_s: float, capacity: float, now: float = 0.0) -> None:
        self.rate_per_s = rate_per_s
        self.capacity = capacity
        self._tokens = float(capacity)
        self._last = now

    def _refill(self, now: float) -> None:
        if now > self._last:
            self._tokens = min(self.capacity, self._tokens + (now - self._last) * self.rate_per_s)
            self._last = now

    def available(self, now: float) -> bool:
        self._refill(now)
        return self._tokens >= 1.0

    def take(self, now: float) -> bool:
        if not self.available(now):
            return False
        self._tokens -= 1.0
        return True
