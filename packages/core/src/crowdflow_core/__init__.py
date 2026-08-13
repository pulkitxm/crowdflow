"""CrowdFlow engines.

A pure library. The CLI and the API are equal, permanent adapters over it (D2);
neither is privileged and neither may be the only way to run something.

The rule, enforced by test_purity.py: if a module in this package imports a web
framework, a socket, a database driver or an LLM client, it is in the wrong
package. Engines take state and return state. That is what makes them testable
headlessly, runnable in batch for training data, and forkable for what-if
simulation.

Modules
-------
venue         circuit pack loading, graph construction, coordinate frame
simulation    agent-based crowd simulation and the counterfactual fork
state         telemetry -> ZoneState, via Fruin flow rates
prediction    features, rule baseline, learned model
intervention  what-if sweep and scoring
routing       dynamic edge costs, constrained search, ETA gating
safety        hard constraints; the gate every action passes through
"""

__version__ = "0.1.0"
