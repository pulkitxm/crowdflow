"""CrowdFlow CLI — a thin adapter over crowdflow_core.

Not a scaffold to be replaced by the API. The CLI is how the system is seeded,
evaluated and demonstrated headlessly, and it stays for the life of the project
(D2). Four things need it and none are comfortable through a UI: repeatable
seeded runs, A/B evaluation, batch training-data generation, and having something
that still works when the dashboard is broken an hour before a demo.
"""

from __future__ import annotations

from pathlib import Path

import typer
import yaml

import crowdflow_contracts as contracts

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Predictive crowd management for Grand Prix circuits.",
)
circuit_app = typer.Typer(no_args_is_help=True, help="Circuit packs and venue data.")
app.add_typer(circuit_app, name="circuit")


def _repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "circuits" / "index.yaml").exists():
            return parent
    raise typer.BadParameter("could not locate repo root (circuits/index.yaml missing)")


def _load_index() -> dict:
    return yaml.safe_load((_repo_root() / "circuits" / "index.yaml").read_text())


# ---------------------------------------------------------------- standards --

@app.command()
def standards() -> None:
    """Show the constants registry and where each boundary comes from.

    Every threshold in the system is either cited here or measured at runtime.
    A literal that appears in code without appearing here is a defect.
    """
    typer.secho("Fruin Level of Service — walkways", bold=True)
    typer.echo("  pedestrians per metre of width per minute\n")
    rows = [
        ("A", 0.0, contracts.LOS_A_MAX, "free flow, bypassing possible"),
        ("B", contracts.LOS_A_MAX, contracts.LOS_B_MAX, "normal speed, one-way bypassing"),
        ("C", contracts.LOS_B_MAX, contracts.LOS_C_MAX, "some speeds restricted"),
        ("D", contracts.LOS_C_MAX, contracts.LOS_D_MAX, "majority restricted, conflicts"),
        ("E", contracts.LOS_D_MAX, contracts.LOS_E_MAX, "frequent stoppages"),
        ("F", contracts.LOS_E_MAX, float("inf"), "flow breaks down"),
    ]
    for grade, lo, hi in ((r[0], r[1], r[2]) for r in rows):
        band = contracts.band_for_flow((lo + min(hi, lo + 20)) / 2)
        hi_s = "  +  " if hi == float("inf") else f"{hi:5.0f}"
        note = next(r[3] for r in rows if r[0] == grade)
        typer.echo(f"  {grade}   {lo:5.0f} – {hi_s}   {band.label:<9} {note}")

    typer.echo()
    typer.secho("Operational bands", bold=True)
    typer.echo(f"  NOMINAL   <  {contracts.BAND_NOMINAL_MAX:.0f}      LOS A–C   nothing to do")
    typer.echo(f"  BUILDING  {contracts.BAND_NOMINAL_MAX:.0f} – {contracts.BAND_BUILDING_MAX:.0f}   "
               f"LOS D–E   the intervention window")
    typer.echo(f"  CRITICAL  >  {contracts.BAND_BUILDING_MAX:.0f}      LOS F     already too late")

    typer.echo()
    typer.secho("Movement priors", bold=True)
    typer.echo(f"  free-flow walking speed   {contracts.FREE_FLOW_SPEED_MS} m/s")
    typer.echo(f"  jam density               {contracts.JAM_DENSITY_PERSONS_M2} persons/m2")

    typer.echo()
    typer.secho("Measured, never assumed", bold=True, fg=typer.colors.YELLOW)
    for name in contracts.MEASURED_NOT_ASSUMED:
        typer.echo(f"  {name}")


@app.command()
def band(flow: float = typer.Argument(..., help="flow rate, ped/m/min")) -> None:
    """Classify a flow rate. The only classifier in the system."""
    b = contracts.band_for_flow(flow)
    colour = {
        contracts.LOSBand.NOMINAL: typer.colors.GREEN,
        contracts.LOSBand.BUILDING: typer.colors.YELLOW,
        contracts.LOSBand.CRITICAL: typer.colors.RED,
    }[b]
    typer.echo(f"{flow:.1f} ped/m/min  ->  ", nl=False)
    typer.secho(b.label, fg=colour, bold=True, nl=False)
    typer.echo(f"   (Fruin {contracts.los_grade_for_flow(flow)}, band covers LOS {b.los_grades})")


# ----------------------------------------------------------------- circuits --

@circuit_app.command("list")
def circuit_list(
    status: str = typer.Option(None, help="filter: seed | not_started"),
) -> None:
    """List the indexed circuits for the season."""
    index = _load_index()
    rows = index["circuits"]
    if status:
        rows = [r for r in rows if r.get("status") == status]
    typer.secho(f"{index['season']} season — {len(rows)} circuits", bold=True)
    typer.echo()
    typer.echo(f"  {'rd':>2}  {'id':<16}{'geometry':<10}{'len':>6}  {'status':<12}location")
    for r in rows:
        mark = "*" if r.get("status") == "seed" else " "
        typer.echo(
            f"{mark} {r['round']:>2}  {r['id']:<16}{r['geometry_source']:<10}"
            f"{r['track_length_m']:>6}  {r.get('status', ''):<12}"
            f"{r['locality']}, {r['country']}"
        )


@circuit_app.command("show")
def circuit_show(circuit_id: str) -> None:
    """Show one circuit's frame, derived from its own source bbox."""
    index = _load_index()
    match = next((r for r in index["circuits"] if r["id"] == circuit_id), None)
    if match is None:
        known = ", ".join(r["id"] for r in index["circuits"][:5])
        raise typer.BadParameter(f"unknown circuit {circuit_id!r}. Try: {known}, ...")

    typer.secho(f"{match['name']}", bold=True)
    typer.echo(f"  round {match['round']}, {match['date']} — {match['locality']}, {match['country']}")
    typer.echo(f"  geometry     {match['geometry_source']}")
    typer.echo(f"  track        {match['track_length_m']} m, {match['altitude_m']} m altitude")
    o = match["origin"]
    typer.echo(f"  origin       {o['lat']}, {o['lon']}   (bbox SW corner)")
    b = match["track_bounds_m"]
    typer.echo(f"  track bounds {b['x'][1]} x {b['y'][1]} m")
    typer.secho(
        "  note         venue extent is larger — car parks, campsites and park-and-ride\n"
        "               sit outside the track bbox. Sizing to the track clips arrivals.",
        fg=typer.colors.YELLOW,
    )
    typer.echo(f"  status       {match.get('status', 'not_started')}")


@circuit_app.command("import")
def circuit_import(
    circuit_id: str,
    refresh: bool = typer.Option(False, help="re-fetch from Overpass instead of using cache"),
    buffer_m: float = typer.Option(900.0, help="venue envelope radius around the track"),
) -> None:
    """Import a venue from OpenStreetMap into a circuit pack.

    The structure is imported before the event; traces refine it afterwards (D6).
    Every step's counts are printed — a silent import that quietly drops half the
    venue is worse than one that fails.
    """
    from crowdflow_core.venue import build_pack, parse, summarise

    from . import ingest

    root = _repo_root()
    index = _load_index()
    entry = next((r for r in index["circuits"] if r["id"] == circuit_id), None)
    if entry is None:
        raise typer.BadParameter(f"unknown circuit {circuit_id!r}")

    typer.secho(f"importing {entry['name']}", bold=True)

    track, props = ingest.load_track_geometry(root, entry["geometry_source"])
    bbox = ingest.bbox_for_track(track)
    typer.echo(f"  track      {len(track)} points, {props['length']} m")
    typer.echo(f"  bbox       {bbox}")

    payload, cached = ingest.fetch_osm(root, circuit_id, bbox, refresh=refresh)
    typer.echo(f"  osm        {len(payload['elements'])} elements "
               f"({'cache' if cached else 'fetched'})")

    ways, nodes = parse(payload["elements"])
    counts = summarise(ways, nodes)
    typer.echo(f"  classified {counts}")

    pack, stats = build_pack(
        circuit_id=circuit_id, name=entry["name"],
        geometry_source=entry["geometry_source"],
        track_length_m=float(entry["track_length_m"]),
        altitude_m=float(entry["altitude_m"]),
        track_latlon=track, ways=ways, nodes=nodes,
        venue_buffer_m=buffer_m,
    )
    typer.echo()
    for label, n in stats.as_rows():
        typer.echo(f"  {n:>7}  {label}")

    if stats.assumed_widths:
        typer.echo()
        typer.secho(
            f"  {stats.assumed_widths} edges carry an ASSUMED width. Flow rate is per metre\n"
            f"  of width, so these bands are provisional until observed.",
            fg=typer.colors.YELLOW,
        )

    from crowdflow_core.venue.frame import Frame
    frame = Frame(pack.frame.origin_lat, pack.frame.origin_lon)
    track_xy = frame.project_all(track)
    out = ingest.write_pack(root, pack, track_xy)
    typer.echo()
    typer.secho(f"  wrote {out.relative_to(root)}", fg=typer.colors.GREEN)


@circuit_app.command("validate")
def circuit_validate(circuit_id: str) -> None:
    """Validate a circuit pack's structural integrity.

    Catches orphaned zones, edges to unknown zones and unreachable emergency
    exits at load — rather than as a NaN inside the routing engine.
    """
    from . import ingest

    root = _repo_root()
    pack_dir = root / "circuits" / circuit_id / "pack"
    if not pack_dir.exists() or not (pack_dir / "circuit.json").exists():
        typer.secho(f"no pack at circuits/{circuit_id}/pack/", fg=typer.colors.YELLOW)
        typer.echo(f"Build it:  crowdflow circuit import {circuit_id}")
        raise typer.Exit(code=1)

    pack = ingest.read_pack(root, circuit_id)
    problems = pack.validate_integrity()

    typer.secho(pack.name, bold=True)
    typer.echo(f"  {len(pack.zones)} zones, {len(pack.edges)} edges")

    kinds: dict[str, int] = {}
    for z in pack.zones.values():
        kinds[z.kind.value] = kinds.get(z.kind.value, 0) + 1
    for kind, n in sorted(kinds.items(), key=lambda kv: -kv[1]):
        typer.echo(f"    {n:>5}  {kind}")

    assumed = sum(1 for e in pack.edges.values() if not e.width_m.is_trustworthy)
    typer.echo(f"  {assumed} of {len(pack.edges)} edges have untrustworthy width")

    if problems:
        typer.echo()
        typer.secho(f"  {len(problems)} integrity problems", fg=typer.colors.RED, bold=True)
        for p in problems[:20]:
            typer.echo(f"    {p}")
        raise typer.Exit(code=1)

    typer.echo()
    typer.secho("  integrity OK", fg=typer.colors.GREEN, bold=True)


@circuit_app.command("render")
def circuit_render(
    circuit_id: str,
    out: Path = typer.Option(None, help="output path; defaults beside the pack"),
) -> None:
    """Render the pack as an SVG, to see whether it looks like the venue."""
    from crowdflow_core.venue.render import render_svg

    from . import ingest

    root = _repo_root()
    pack = ingest.read_pack(root, circuit_id)
    track = ingest.read_track(root, circuit_id)
    svg = render_svg(pack, track_xy=track)
    target = out or (root / "circuits" / circuit_id / f"{circuit_id}.svg")
    target.write_text(svg)
    typer.secho(f"wrote {target.relative_to(root)} ({len(svg) // 1024} KB)",
                fg=typer.colors.GREEN)


if __name__ == "__main__":
    app()


# ------------------------------------------------------------------- simulate --

sim_app = typer.Typer(no_args_is_help=True, help="Simulation, evaluation and the gate.")
app.add_typer(sim_app, name="sim")


def _load_world(circuit_id: str):
    from crowdflow_core.routing import VenueGraph
    from . import ingest

    root = _repo_root()
    pack = ingest.read_pack(root, circuit_id)
    return pack, VenueGraph(pack)


def _egress_scenario(pack, graph, exit_zone: str | None, count: int, seed: int):
    from crowdflow_core.simulation import egress

    if exit_zone is None:
        parks = [z.id for z in pack.zones.values() if z.kind.value == "parking"]
        exit_zone = max(parks, key=lambda p: len(graph.reachable(p)))
    comp = graph.reachable(exit_zone)
    stands = [
        z.id for z in pack.zones.values()
        if z.kind.value == "viewing" and z.id in comp
    ]
    if not stands:
        raise typer.BadParameter(f"no grandstands connected to {exit_zone}")
    return egress(graph, stands, exit_zone, count=count, seed=seed), exit_zone, stands


@sim_app.command("run")
def sim_run(
    circuit_id: str = typer.Argument("silverstone"),
    count: int = typer.Option(6000, help="spectators"),
    ticks: int = typer.Option(400),
    participation: float = typer.Option(0.18, help="measured share running the app"),
    seed: int = typer.Option(42),
    intervene: bool = typer.Option(False, help="allow the loop to reroute"),
) -> None:
    """Run a post-race egress and report what emerged."""
    from crowdflow_contracts import LOSBand
    from crowdflow_core.metrics import run_scenario

    pack, graph = _load_world(circuit_id)
    scenario, exit_zone, stands = _egress_scenario(pack, graph, None, count, seed)

    typer.secho(f"{pack.name} — {scenario.name}", bold=True)
    typer.echo(f"  {count} spectators from {len(stands)} stands -> {exit_zone}")
    typer.echo(f"  participation {participation:.0%}, seed {seed}, "
               f"intervention {'ON' if intervene else 'OFF'}\n")

    metrics, results = run_scenario(
        scenario, graph, intervene=intervene, participation=participation, ticks=ticks
    )

    first_warn = next(
        (r for r in results if r.headline and r.headline.is_actionable), None
    )
    first_crit = next(
        (r for r in results if r.state.in_band(LOSBand.CRITICAL)), None
    )
    if first_warn and first_crit:
        lead = first_crit.time_s - first_warn.time_s
        h = first_warn.headline
        typer.echo(f"  first warning   t={first_warn.time_s:.0f}s  {h.zone_id} -> "
                   f"{h.target_band.label} in {h.time_to_threshold_s:.0f}s")
        typer.echo(f"  first critical  t={first_crit.time_s:.0f}s")
        typer.secho(f"  lead time       {lead:.0f}s\n", bold=True,
                    fg=typer.colors.GREEN if lead > 0 else typer.colors.RED)

    for label, value in metrics.as_rows():
        typer.echo(f"  {value:>10}  {label}")


@sim_app.command("ab")
def sim_ab(
    circuit_id: str = typer.Argument("silverstone"),
    count: int = typer.Option(6000),
    ticks: int = typer.Option(400),
    participation: float = typer.Option(0.18),
    seed: int = typer.Option(42),
) -> None:
    """THE GATE. Same seed, intervention off vs on.

    If a reroute does not measurably reduce both peak density and the time spent
    beyond capacity, there is no product — and we find that out here, with no
    interface built on top of it.
    """
    from crowdflow_core.metrics import ab_test

    pack, graph = _load_world(circuit_id)
    scenario, exit_zone, stands = _egress_scenario(pack, graph, None, count, seed)

    typer.secho(f"A/B — {pack.name}, {scenario.name}", bold=True)
    typer.echo(f"  {count} spectators, seed {seed}, participation {participation:.0%}")
    typer.echo("  identical seed both arms; only the intervention differs\n")

    result = ab_test(scenario, graph, participation=participation, ticks=ticks)

    typer.echo(f"  {'metric':<34}{'without':>12}{'with':>12}{'change':>10}")
    typer.echo(f"  {'-' * 68}")
    for label, before, after, pct in result.summary():
        arrow = "" if abs(pct) < 0.05 else (f"{pct:+.1f}%")
        typer.echo(f"  {label:<34}{before:>12.1f}{after:>12.1f}{arrow:>10}")

    typer.echo()
    if result.passes_gate:
        typer.secho("  GATE PASSED — intervention reduced both peak density and "
                    "time beyond capacity", fg=typer.colors.GREEN, bold=True)
    else:
        typer.secho("  GATE FAILED — intervention did not measurably help. "
                    "Stop and revisit before building on this.",
                    fg=typer.colors.RED, bold=True)
        raise typer.Exit(code=1)


# ----------------------------------------------------------------------- mesh --

mesh_app = typer.Typer(no_args_is_help=True, help="Mesh transport, measured without devices.")
app.add_typer(mesh_app, name="mesh")


@mesh_app.command("compare")
def mesh_compare(
    ticks: int = typer.Option(200, help="simulated ticks"),
    nodes: int = typer.Option(150, help="participating devices"),
    span: float = typer.Option(400.0, help="side of the area they move in, metres"),
    connectivity: float = typer.Option(0.05, help="fraction of handsets with a data plan"),
    seed: int = typer.Option(7),
) -> None:
    """Compare the three routing policies on one topology.

    The justification for not flooding, as a number rather than an argument:
    copies-per-message is what a phone pays in battery, and it is the column that
    separates the policies. Delivery ratio barely does.
    """
    from crowdflow_core.mesh import MeshSimConfig, MeshSimulator

    config = MeshSimConfig.crowd(
        seed=seed, node_count=nodes, span_m=span, data_plan_fraction=connectivity
    )
    metrics = MeshSimulator(config).run(ticks)

    typer.secho("Mesh routing by traffic class", bold=True)
    typer.echo(
        f"  {nodes} devices, {span:.0f} m square, {connectivity:.0%} with a data plan, "
        f"seed {seed}, {ticks} ticks\n"
    )
    header = f"  {'class':<8}{'policy':<24}{'delivery':>9}{'hops':>7}{'copies/msg':>12}{'lag s':>8}"
    typer.echo(header)
    typer.echo(f"  {'-' * (len(header) - 2)}")
    for name, policy, delivery, hops, copies, lag in metrics.rows():
        typer.echo(f"  {name:<8}{policy:<24}{delivery:>9.3f}{hops:>7.2f}{copies:>12.1f}{lag:>8.1f}")

    typer.echo()
    typer.echo(f"  flooding costs {metrics.epidemic_cost_ratio:.0f}x the radio traffic of "
               "a bounded copy count")
    typer.echo(f"  uplinks elected per tick   {metrics.mean_uplinks:.1f} "
               f"(of {metrics.mean_online_nodes:.1f} handsets online)")
    typer.echo(f"  nodes within reach of one  {metrics.mean_coverage:.0%}")
    typer.echo(f"  observation age on arrival {metrics.mean_observation_age_s:.0f}s mean, "
               f"{metrics.p95_observation_age_s:.0f}s p95")
    typer.echo(f"  reports per observation    {metrics.uplink_redundancy:.2f} "
               "(deduplicated by source and sequence)")

    if metrics.mean_coverage < 1.0:
        typer.echo()
        typer.secho(
            f"  {1 - metrics.mean_coverage:.0%} of nodes were out of reach of any uplink on "
            "average.\n  Those regions are unheard, not quiet — they must render as unknown.",
            fg=typer.colors.YELLOW,
        )
