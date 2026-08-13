"""Local metric frame.

Everything inside the system is metres in a venue-local x/y frame. Latitude and
longitude appear in exactly two places: the circuit pack's origin, and the
device's location adapter. Working in degrees anywhere else makes distances,
widths and flow rates silently wrong (plan.md section 10).

Equirectangular projection about the venue origin. Over a few kilometres the
error against a proper projection is centimetres — far below GNSS accuracy — and
it is cheap, invertible and has no dependencies.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# WGS-84 derived constants. Metres per degree at the equator.
M_PER_DEG_LAT = 111_132.954
M_PER_DEG_LON_EQ = 111_319.488


@dataclass(frozen=True)
class Frame:
    """Projection between WGS-84 and the venue's local metric frame."""

    origin_lat: float
    origin_lon: float

    @property
    def _lon_scale(self) -> float:
        return M_PER_DEG_LON_EQ * math.cos(math.radians(self.origin_lat))

    def to_xy(self, lat: float, lon: float) -> tuple[float, float]:
        """WGS-84 -> metres east/north of origin."""
        return (
            (lon - self.origin_lon) * self._lon_scale,
            (lat - self.origin_lat) * M_PER_DEG_LAT,
        )

    def to_latlon(self, x: float, y: float) -> tuple[float, float]:
        """Metres -> WGS-84. Exact inverse of to_xy."""
        return (
            self.origin_lat + y / M_PER_DEG_LAT,
            self.origin_lon + x / self._lon_scale,
        )

    def project_all(self, coords: list[tuple[float, float]]) -> list[tuple[float, float]]:
        """Project a list of (lat, lon) pairs."""
        return [self.to_xy(lat, lon) for lat, lon in coords]


def polyline_length(points: list[tuple[float, float]]) -> float:
    """Total length of a projected polyline, in metres."""
    return sum(
        math.dist(points[i], points[i + 1])
        for i in range(len(points) - 1)
    )


def point_to_segment_distance(
    p: tuple[float, float],
    a: tuple[float, float],
    b: tuple[float, float],
) -> float:
    """Shortest distance from point p to segment ab."""
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def segments_intersect(
    p1: tuple[float, float], p2: tuple[float, float],
    p3: tuple[float, float], p4: tuple[float, float],
) -> bool:
    """Proper segment intersection test.

    Used for barrier subtraction: an edge that crosses a fence is not a walkable
    edge, however connected the underlying ways look.
    """
    def orient(a, b, c) -> float:
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    d1, d2 = orient(p3, p4, p1), orient(p3, p4, p2)
    d3, d4 = orient(p1, p2, p3), orient(p1, p2, p4)
    if ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)):
        return True
    return False
