"""The fundamental diagram of pedestrian traffic.

One module, used by both the simulator and the state engine. That is deliberate:
if the simulator moved people under different physics from the one the state
engine measures, every prediction validated in simulation would be validated
against a fiction.

The relation:

    density = people / (length * width)          persons per m^2
    speed   = free_speed * (1 - density/jam)     Greenshields form
    flow    = density * speed * 60               ped per metre width per minute

Flow is NOT monotonic in density. It rises, peaks, then collapses — which is why
the system tracks velocity as well as headcount. A falling speed at constant
headcount is the early warning; a headcount alone cannot tell "busy and moving"
from "jammed".
"""

from __future__ import annotations

from crowdflow_contracts import FREE_FLOW_SPEED_MS, JAM_DENSITY_PERSONS_M2

MIN_SPEED_MS = 0.05
"""Never report exactly zero: a jammed crowd still shuffles, and zero speed makes
travel-time estimates infinite rather than merely large."""


def density(people: float, length_m: float, width_m: float) -> float:
    """Persons per square metre over a corridor."""
    area = max(length_m * width_m, 1e-6)
    return max(0.0, people) / area


def speed_at_density(
    persons_per_m2: float,
    free_speed_ms: float = FREE_FLOW_SPEED_MS,
    jam_density: float = JAM_DENSITY_PERSONS_M2,
) -> float:
    """Walking speed as a function of density (Greenshields form).

    Linear in density, clamped. Simple enough to reason about and to invert, and
    the qualitative behaviour — the collapse near jam density — is what drives
    every downstream signal.
    """
    if persons_per_m2 <= 0:
        return free_speed_ms
    ratio = min(1.0, persons_per_m2 / jam_density)
    return max(MIN_SPEED_MS, free_speed_ms * (1.0 - ratio))


def flow_rate(persons_per_m2: float, speed_ms: float) -> float:
    """Pedestrians per metre of width per minute — the unit LOS is defined in."""
    return max(0.0, persons_per_m2) * max(0.0, speed_ms) * 60.0


def flow_from_occupancy(people: float, length_m: float, width_m: float,
                        speed_ms: float | None = None) -> tuple[float, float, float]:
    """Convenience: occupancy -> (density, speed, flow).

    Two clamps, both physical rather than cosmetic:

    **Density is capped at jam density.** You cannot fit more than ~4 persons/m²
    into a space; people beyond that are *queued somewhere else*, backed up along
    the approach. Without the cap, a node that everyone is trying to leave at
    once reports densities of 30+/m² and flow rates in the hundreds — numbers
    that cannot occur and that make every downstream band meaningless. Use
    `queue_excess` to recover the people the cap displaced.

    **Speed cannot exceed what the density allows.** An observed speed is better
    evidence than the model *until* it contradicts the physics — a reading of
    1.3 m/s at jam density is a stale sample, not a fast crowd.
    """
    raw = density(people, length_m, width_m)
    d = min(raw, JAM_DENSITY_PERSONS_M2)
    model_v = speed_at_density(d)
    v = model_v if speed_ms is None else min(max(MIN_SPEED_MS, speed_ms), model_v)
    return d, v, flow_rate(d, v)


def queue_excess(people: float, length_m: float, width_m: float) -> float:
    """People who do not fit at jam density, i.e. the queue backed up behind.

    The counterpart to the density cap: they have not vanished, they are waiting.
    Queue length is a first-class operator signal, not an artefact.
    """
    area = max(length_m * width_m, 1e-6)
    return max(0.0, people - JAM_DENSITY_PERSONS_M2 * area)


def capacity_flow(free_speed_ms: float = FREE_FLOW_SPEED_MS,
                  jam_density: float = JAM_DENSITY_PERSONS_M2) -> tuple[float, float]:
    """Peak of the fundamental diagram: (density_at_capacity, max_flow).

    Under Greenshields the maximum is at half jam density. Above this point extra
    people reduce throughput — the counter-intuitive fact the whole product rests
    on, and the reason intervening early beats intervening hard.
    """
    d_cap = jam_density / 2.0
    return d_cap, flow_rate(d_cap, speed_at_density(d_cap, free_speed_ms, jam_density))
