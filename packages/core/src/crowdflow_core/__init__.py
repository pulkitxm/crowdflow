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
mesh          delay-tolerant transport, uplink election, on-device privacy

`mesh` is here rather than in the mobile app for the same reason as everything
else in this package: routing policy is algorithmic, so it can be simulated with
a hundred and fifty imaginary phones and falsified before a single radio is
written. The native layer owns the radio and nothing else.
"""

__version__ = "0.1.0"
