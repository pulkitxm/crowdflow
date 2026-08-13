"""SVG rendering of a circuit pack.

Pure: returns a string. Writing it is the caller's problem.

Schematic, not cartographic — the same choice live timing screens make. Detail is
spent on entity position and state, not terrain. The track is drawn low-contrast
so that whatever is laid on top (crowd nodes, density) carries the visual weight.
"""

from __future__ import annotations

from crowdflow_contracts import CircuitPack, ZoneKind

_KIND_STYLE = {
    ZoneKind.GATE: ("#E6002B", 3.4),
    ZoneKind.VIEWING: ("#BE8A0E", 4.2),
    ZoneKind.PARKING: ("#4C545C", 3.0),
    ZoneKind.CROSSING: ("#E6002B", 3.4),
    ZoneKind.EXIT: ("#E6002B", 3.4),
    ZoneKind.CONCOURSE: ("#3A424A", 1.0),
    ZoneKind.AMENITY: ("#4C545C", 2.0),
}


def render_svg(
    pack: CircuitPack,
    track_xy: list[tuple[float, float]] | None = None,
    width_px: int = 1400,
    margin: int = 40,
) -> str:
    """Render the pack as a standalone SVG document."""
    xs = [z.position.x for z in pack.zones.values()]
    ys = [z.position.y for z in pack.zones.values()]
    if track_xy:
        xs += [p[0] for p in track_xy]
        ys += [p[1] for p in track_xy]
    if not xs:
        return '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max(max_x - min_x, 1.0)
    span_y = max(max_y - min_y, 1.0)
    scale = (width_px - 2 * margin) / span_x
    height_px = int(span_y * scale + 2 * margin)

    def px(x: float, y: float) -> tuple[float, float]:
        # SVG y grows downward; the venue frame grows north
        return (margin + (x - min_x) * scale, height_px - margin - (y - min_y) * scale)

    out: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width_px}" '
        f'height="{height_px}" viewBox="0 0 {width_px} {height_px}">',
        '<rect width="100%" height="100%" fill="#0E1013"/>',
        f"<title>{pack.name}</title>",
    ]

    if track_xy:
        pts = " ".join(f"{a:.1f},{b:.1f}" for a, b in (px(x, y) for x, y in track_xy))
        out.append(f'<polyline points="{pts}" fill="none" stroke="#2E343B" stroke-width="9"/>')
        out.append(
            f'<polyline points="{pts}" fill="none" stroke="#4B535B" '
            f'stroke-width="1" stroke-dasharray="6 8"/>'
        )

    out.append('<g stroke="#5A626B" stroke-width="0.8" stroke-opacity="0.75">')
    for e in pack.edges.values():
        a = pack.zones.get(e.source)
        b = pack.zones.get(e.destination)
        if not a or not b:
            continue
        x1, y1 = px(a.position.x, a.position.y)
        x2, y2 = px(b.position.x, b.position.y)
        out.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}"/>')
    out.append("</g>")

    for kind in (ZoneKind.CONCOURSE, ZoneKind.PARKING, ZoneKind.GATE, ZoneKind.VIEWING):
        colour, r = _KIND_STYLE[kind]
        members = [z for z in pack.zones.values() if z.kind is kind]
        if not members:
            continue
        out.append(f'<g fill="{colour}" fill-opacity="0.85">')
        for z in members:
            cx, cy = px(z.position.x, z.position.y)
            out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}"/>')
        out.append("</g>")

    legend = [
        ("track", "#2E343B"),
        ("paths", "#5A626B"),
        ("gates", "#E6002B"),
        ("grandstands", "#BE8A0E"),
        ("parking", "#4C545C"),
    ]
    out.append(
        f'<g font-family="ui-monospace,monospace" font-size="11" fill="#949BA3">'
        f'<text x="{margin}" y="{margin - 14}">{pack.name} — '
        f"{len(pack.zones)} zones, {len(pack.edges)} edges</text></g>"
    )
    for i, (label, colour) in enumerate(legend):
        y = height_px - 14
        x = margin + i * 120
        out.append(f'<circle cx="{x}" cy="{y - 4}" r="4" fill="{colour}"/>')
        out.append(
            f'<text x="{x + 10}" y="{y}" font-family="ui-monospace,monospace" '
            f'font-size="10" fill="#949BA3">{label}</text>'
        )

    out.append("</svg>")
    return "\n".join(out)
