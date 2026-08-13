"""The wire models must not lose anything core computed.

These are drift tests. The failure they exist to catch is quiet: someone adds a
field to `TickResult` or a metric to `RunMetrics`, the API keeps serialising
happily, and the operator console silently stops showing it. Nobody notices,
because a missing number looks exactly like a number that is zero.
"""

from __future__ import annotations

import dataclasses

from crowdflow_api.app import standards_report
from crowdflow_api.wire import MetricsSnapshot, TickEnvelope
from crowdflow_contracts import (
    CAPACITY_DENSITY,
    DENSITY_BUILDING_MAX,
    DENSITY_NOMINAL_MAX,
    FREE_FLOW_SPEED_MS,
    JAM_DENSITY_PERSONS_M2,
    LOSBand,
    band_for_density,
)
from crowdflow_core.loop import TickResult
from crowdflow_core.metrics import RunMetrics


def test_envelope_covers_every_tick_result_field():
    core_fields = {f.name for f in dataclasses.fields(TickResult)}
    wire_fields = set(TickEnvelope.model_fields)
    missing = core_fields - wire_fields
    assert not missing, f"TickResult fields never reach the console: {sorted(missing)}"


def test_metrics_snapshot_covers_every_run_metric():
    public = {
        f.name for f in dataclasses.fields(RunMetrics) if not f.name.startswith("_")
    }
    missing = public - set(MetricsSnapshot.model_fields)
    assert not missing, f"metrics computed but never shown: {sorted(missing)}"


def test_standards_report_matches_the_contracts():
    """The console's legend must be the registry, not a copy of it."""
    report = standards_report()
    by_band = {b.band: b for b in report.bands}

    assert by_band[LOSBand.NOMINAL].density_max == DENSITY_NOMINAL_MAX
    assert by_band[LOSBand.BUILDING].density_min == DENSITY_NOMINAL_MAX
    assert by_band[LOSBand.BUILDING].density_max == DENSITY_BUILDING_MAX
    assert by_band[LOSBand.CRITICAL].density_min == DENSITY_BUILDING_MAX
    assert by_band[LOSBand.CRITICAL].density_max is None

    assert report.capacity_density == CAPACITY_DENSITY
    assert report.jam_density == JAM_DENSITY_PERSONS_M2
    assert report.free_flow_speed_ms == FREE_FLOW_SPEED_MS


def test_band_boundaries_agree_with_the_classifier():
    """Every boundary the console draws must classify the way core does.

    Catches the inversion that would otherwise be invisible on screen: a legend
    saying CRITICAL starts at 2.0 while `band_for_density` starts it elsewhere.
    """
    for boundary in standards_report().bands:
        just_inside = boundary.density_min + 1e-9
        assert band_for_density(just_inside) is boundary.band
        if boundary.density_max is not None:
            assert band_for_density(boundary.density_max - 1e-9) is boundary.band
            assert band_for_density(boundary.density_max) is not boundary.band


def test_max_achievable_flow_is_below_fruins_los_ef_boundary():
    """The discrepancy that forced density-based classification, asserted.

    If this ever passes the other way, someone has changed the fundamental
    diagram and the reason the system does not classify on flow has gone with it.
    """
    from crowdflow_contracts import LOS_E_MAX

    assert standards_report().max_achievable_flow < LOS_E_MAX


def test_node_mark_carries_no_device_identity():
    """Privacy is a schema property here, not a policy note."""
    from crowdflow_api.wire import NodeMark

    forbidden = {"node_id", "id", "epoch"}
    assert not forbidden & set(NodeMark.model_fields)
