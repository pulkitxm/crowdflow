# CrowdFlow online-round run of show

## Non-negotiables

- Join only when the moderator calls CrowdFlow.
- Have the entire team present before joining and keep every camera on throughout.
- Presentation limit: **5:00**. This deck targets **4:38**.
- Q&A limit: **2:00**. Give the direct answer first, then one supporting fact.
- The moderator may warn at 6:00 overall. At that point, finish the current answer in one
  sentence and thank the judges.
- Use the rehearsed four-person split in `SPEAKER_NOTES.md`. Each person owns one continuous block,
  keeping the deck to three short handoffs.

## Timed talk track

Open the speaker view with `S`; its timer reads each slide's `data-timing` value.

| Time | Slide | Purpose | Say this, then move |
|---:|---|---|---|
| 0:00–0:18 | 1 · Promise | Hook | “Crowds are managed in the present tense. CrowdFlow operates in the future tense.” |
| 0:18–0:43 | 2 · Problem | Establish urgency | Signals are fragmented, pressure compounds, and generic responses arrive late. |
| 0:43–1:13 | 3 · Closed loop | Originality | Observe, predict, simulate several interventions, safety-review one, redirect, verify. |
| 1:13–1:48 | 4 · Proof | Functionality | Same seed and crowd; one intervention cuts critical exposure 34.7% with no mean walk penalty. |
| 1:48–2:18 | 5 · Circuit programme | Design + scale | These are the actual vector outlines for all 23 rounds. Silverstone is the complete venue pack today; the importer is the path to the next circuit. |
| 2:18–2:58 | 6 · Decision engine | Technical depth | Forecast → compare → constrain → safety veto → measure. The five steps appear automatically over the real 1,875-zone venue graph. |
| 2:58–3:43 | 7 · Technical edge | Originality + depth | Deterministic core, explicit confidence, mandatory veto, edge privacy; AI cannot dispatch. |
| 3:43–4:18 | 8 · Built / next | Completeness | Name what runs today, then honestly name the three pilot gaps. Do not apologize for them. |
| 4:18–4:38 | 9 · Ask | Close | Ask for one circuit, one signal, and one shadow-mode session. End on “measured pilot.” |

If behind by more than 15 seconds, describe slide 6 in one sentence while its steps appear.
Never cut the proof slide or the final ask.

## Judging rubric map

| Criterion | Best evidence in the deck |
|---|---|
| Originality | Closed-loop counterfactual intervention; privacy-aware offline companion mesh |
| Technical depth | Deterministic venue graph, confidence contracts, bounded commands, mandatory safety veto |
| Presentation | One claim per slide, large proof metrics, rehearsed 4:38 path |
| Design | Operator-first visual system and explicit spectator output |
| Completeness + functionality | 141 passing tests, live API/WebSocket path, spectator feed, reproducible proof gate |

## Two-minute Q&A bank

**What is live and what is simulated?**  
The prediction, simulation, intervention, routing, safety, API, WebSocket dashboard and spectator
feed run now. Crowd telemetry is simulated; real sensor ingestion and native radio transport are
the next pilot integrations.

**Where is AI used?**  
The safety-critical path is deterministic. An LLM may explain evidence or propose an action, but
it cannot compute or dispatch routes and cannot bypass the safety veto.

**Why should we trust the 34.7% result?**  
It comes from a seeded A/B run with 6,000 spectators and 700 ticks. Both arms are identical except
for one intervention, and anyone can rerun the command from the slide.

**How do you protect privacy?**  
The contract uses anonymous crowd nodes and the built privacy engine applies planar-Laplace noise
on-device. The pilot must validate its accuracy/privacy tradeoff before live use.

**What happens when connectivity fails?**  
The store-carry-forward policy, dedupe and uplink election work in simulation. The native Android
interface exists, but production Bluetooth/Wi-Fi transport is not connected yet.

**What would a pilot prove?**  
In shadow mode, CrowdFlow makes no live intervention. We compare predicted pressure and proposed
reroutes with observed movement, then calibrate widths, crossings, constraints and confidence.

## Five-minute pre-call check

- Open `https://vmax.pulkit.page` in a clean Chromium window and press `F`.
- Open speaker view with `S`; place it on the presenter screen, not the shared screen.
- Share only the deck tab/window and confirm the first slide fills the shared frame.
- Close notifications, chat popups and unrelated tabs; connect power and stable audio.
- Keep the GitHub repo and exact proof command ready in a separate, unshared window for Q&A.
- Confirm every member is present, named correctly, camera-on, muted when not answering.
