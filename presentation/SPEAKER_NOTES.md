# CrowdFlow four-person speaker notes

Target finish: **4:38**. The moderator allows five minutes for the presentation and two minutes
for Q&A. Keep every camera on, join only when called, and make sure all four speakers are present
before entering the meeting.

Replace `Speaker 1` through `Speaker 4` with your names before rehearsal. Each person owns one
continuous block, so there are only three handoffs.

## Speaker 1: promise and problem

**Slides 1 and 2 · 0:00 to 0:43**

### Slide 1 · Promise · 18 seconds

“Crowds are usually managed in the present tense. Teams see pressure after it has formed, then
try to react. CrowdFlow operates in the future tense. It predicts where pressure will rise, tests
a safe intervention, and helps race control move people before a bottleneck becomes a crisis.”

Press right once.

### Slide 2 · Problem · 25 seconds

“At a Grand Prix, cameras, gates, Wi-Fi and staff reports each show only part of the venue. A
normal queue can compound before the whole team sees the pattern. By the time congestion is
obvious, the safest options are already disappearing. CrowdFlow closes that decision gap.”

Handoff: “Speaker 2 will show how the loop works and the result we can reproduce.”

## Speaker 2: product loop and proof

**Slides 3 and 4 · 0:43 to 1:48**

### Slide 3 · Closed loop · 30 seconds

“We combine anonymous movement signals into one live crowd state. The engine predicts pressure,
simulates several diversion levels, applies venue constraints, and sends the best candidate through
a mandatory safety review. Only then can guidance be issued. The next observations verify whether
the decision worked, so this is a measurable loop rather than a one-off alert.”

Press right once.

### Slide 4 · Proof podium · 35 seconds

“We tested that loop with the same 6,000 spectators, the same 700 ticks and the same random seed.
Only the intervention changed. The result was 34.7 percent less critical exposure, 22.2 percent
fewer simultaneous critical zones and a 13.2 percent lower peak queue, with zero seconds added to
mean walk time. The command at the bottom lets anyone reproduce the test.”

Handoff: “Speaker 3 will show how this scales across the race calendar and into race control.”

## Speaker 3: circuits and decision engine

**Slides 5 and 6 · 1:48 to 2:58**

### Slide 5 · Circuit programme · 30 seconds

“These are not decorative track icons. They are the actual vector outlines referenced by the 2026
circuit index in our main branch. Silverstone is our complete live venue pack today. The importer
gives us a repeatable path from circuit geometry to the next usable crowd model without rewriting
the engine for every venue.”

Press right once.

### Slide 6 · Decision engine · 40 seconds

“This graphic is generated from the same Silverstone graph as our current operator dashboard:
1,875 zones and 2,404 edges. The steps appear automatically. We forecast pressure, compare
diversion levels, enforce closures and route costs, require an explicit safety verdict, then measure
the outcome. The live dashboard adds confidence, coverage and race-control telemetry so operators
can see what the system knows and what it does not.”

Handoff: “Speaker 4 will close with the technical boundary, what is live, and our pilot ask.”

## Speaker 4: technical edge, completeness and ask

**Slides 7 through 9 · 2:58 to 4:38**

### Slide 7 · Technical edge · 45 seconds

“The safety-critical path is deterministic, not a chatbot on a map. Venue state flows through
prediction, counterfactual simulation and routing. A mandatory safety seam can veto every command.
AI may explain evidence or propose an option, but it cannot dispatch a route or bypass that verdict.
Privacy noise is applied at the edge, and the offline mesh policy is already exercised in simulation.
The repository currently passes 141 tests.”

Press right once.

### Slide 8 · Built and next · 35 seconds

“Today we have the seeded simulator, prediction and routing core, safety review, live API and
WebSocket operator console, spectator feed, and the Silverstone venue pack. We are equally clear
about the pilot work: connect one real signal, calibrate physical constraints, connect native mesh
radios, and run in shadow mode before any live intervention. That is how we compare forecast with
reality safely.”

Press right once.

### Slide 9 · Ask · 20 seconds

“Our ask is deliberately small: one circuit, one live signal and one shadow-mode session. We do
not need control of the venue. We need the chance to measure whether CrowdFlow can help race
operations see pressure earlier and choose safer options. One measured pilot, not a promise.”

Stop. Smile. Do not add a second closing line.

## Q&A ownership

- **Speaker 1:** problem, user need and originality.
- **Speaker 2:** simulator, proof command and the 34.7 percent result.
- **Speaker 3:** circuit geometry, dashboard and operator workflow.
- **Speaker 4:** architecture, safety, privacy, limitations and pilot plan.

The owner answers first in one sentence, then gives one supporting fact. At the moderator's
six-minute reminder, finish the current answer in one sentence and thank the judges.

## Final rehearsal checklist

- One right-arrow press per slide. Do not click to reveal bullets; all staged motion is automatic.
- Speaker 2 has the exact proof command ready in an unshared window.
- Speaker 3 has the live dashboard ready in a separate tab only if a judge asks.
- Each handoff names the next speaker once. The next speaker begins immediately.
- No one narrates every label on screen. Explain the claim and let the graphics carry the detail.
