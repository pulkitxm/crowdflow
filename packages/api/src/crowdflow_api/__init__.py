"""CrowdFlow API — the HTTP/WebSocket adapter over crowdflow_core.

An adapter, in the same sense the CLI is one (D2): it moves bytes, it does not
decide anything. Every number this package serves was computed by core or by the
contracts; nothing here classifies a zone, predicts a threshold crossing, scores
an intervention or approves a command. If you find yourself writing a comparison
against a density in this package, it belongs in core instead.

What lives here and nowhere else:

  * transport      — FastAPI routes, the WebSocket, connection lifecycles
  * pacing         — turning core's synchronous tick into a paced live feed
  * disk           — loading circuit packs (core is forbidden to call open())
  * presentation   — a bounded event log, so a console joining mid-session sees
                     what it missed rather than an empty screen

The wire models in `wire` are the one place a new type is introduced, and they
are generated into TypeScript so the dashboard cannot hand-write a payload shape
and drift from the server.
"""

from .session import ScenarioSession
from .wire import TickEnvelope

__all__ = ["ScenarioSession", "TickEnvelope"]
__version__ = "0.1.0"
