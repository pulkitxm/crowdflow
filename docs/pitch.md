# CrowdFlow — Winning Pitch (7 minutes)

> Punchy, results-first. No story, no warm-up. Lead with the problem, land the numbers, own the room.

---

## The problem (0:00–0:40)

A hundred and forty thousand people stand up at once and every system watching them has the same defect: **it reacts.** Cameras, stewards, gates — they all see a crowd *after* it forms. By then, it's too late to prevent anything. You're not managing the crowd. You're managing the aftermath.

Nobody in this space does what we do: **predict a bottleneck before it exists, and move people before they reach it.**

---

## What we built (0:40–1:20)

CrowdFlow is a closed-loop crowd-intelligence system. Five stages, running constantly:

**OBSERVE → UNDERSTAND → PREDICT → SIMULATE → REDIRECT.**

- Observe the crowd through the phones already in everyone's pocket.
- Understand it as a live map of density.
- Predict *where, when, and how bad* congestion will be — minutes early.
- Simulate interventions before touching a single person.
- Redirect only a fraction of the crowd, just enough to relieve pressure.

One sentence to remember: **we don't detect crowds. We predict where they'll get stuck — and move them before they do.**

---

## The input: every phone is a sensor (1:20–2:00)

Zero infrastructure. Zero cameras. Every spectator with the app becomes an anonymous **Crowd Node**.

- Sends only movement, never identity. No name, no number, rotating IDs — unlinkable by design.
- Works with **no internet**. Phones talk to each other directly.
- Privacy isn't a promise, it's the architecture: data is noised *on-device* before it leaves.

This is the moat: we get crowd telemetry where every other solution dies — with the network down and the venue packed.

---

## The network: the mesh (2:00–3:00)

A stadium is where networks fail. A hundred thousand devices hitting one tower. So we removed the tower.

- **Wi-Fi Aware → Wi-Fi Direct → Bluetooth**, auto-selected per device.
- A foreground service keeps relaying with the screen off — because every phone is in a pocket.
- **No fixed gateway. Any phone with signal becomes an uplink.** Network dies? The mesh keeps measuring and routing locally, then reconciles. It degrades gracefully; it never fails.

That's not a feature. That's the differentiator nobody else has.

---

## The brain: prediction + Hugging Face (3:00–4:00)

Dots aren't answers. We turned Silverstone into a graph — **1,875 zones, 2,404 walkable edges** — including time-gated track crossings, so routing is time-aware.

The state engine fuses every node into zone-level **density, velocity, flow, and confidence**. Unknown zones are shown as *unknown*, never empty. We don't fake certainty.

Then the headline: the predictor doesn't say "Zone C is busy." It says: **"Zone C crosses capacity in ~180 seconds, at 91% confidence, because inflow is 86/min against 31 leaving."** Time-to-congestion is what an operator acts on.

Two predictors run in parallel — a deterministic baseline that always works, and a machine-learned model scoring risk from **thirteen engineered features**. That's where **Hugging Face** powers us three ways: we train and publish the tabular model on the Hub, version labelled training data as a Hugging Face dataset, and serve the open LLM for our agent from the Hub. ML that's versioned, reproducible, and always has a fallback.

---

## The decision: agent + safety (4:00–4:40)

Prediction is half. Deciding — safely — is the rest.

When a forecast fires, we fork the whole simulation into parallel mirror worlds and test **10% / 20% / 30% / 40%** diversions. Each is scored — congestion saved vs. walking cost vs. fairness. We pick the **minimum intervention that actually works.** No oversteering, no wasted dispatch.

The **Crowd Ops Agent** — an LLM via Hugging Face — reads the same numbers and explains them in plain language. It *recommends*. It *never acts*. Between the AI and the crowd sits a **safety engine**: hard rules no model can override. Never route through a blocked path. Never exceed capacity. Never steer away from an emergency exit during an evacuation. The AI proposes; safety disposes.

---

## The output: two surfaces (4:40–5:20)

**The operator** gets a dense console: live map, every prediction with confidence, the full 10/20/30/40% comparison table, and narrated insights. Everything, with units and uncertainty.

**The spectator** gets one decision: *which way do I walk?* A green route, a red route, and — when needed — *"crowd building ahead, take Corridor B, ~3 minutes."* That's the whole app. One decision, made effortless.

---

## The proof (5:20–6:10)

Here's the number that wins the room.

Same race-day scenario, **same seed**, run twice — system off, then on. The only variable is our loop.

| | Without | With | |
|---|---|---|---|
| Critical zone-seconds | 2,746 | **1,792** | **−34.7%** |
| Zones at critical density | 9 | **7** | −22% |
| Peak queued (people) | 1,808 | **1,569** | −13% |
| Interventions | 0 | **1** | one decision |

One dispatch, three minutes early, and the bottleneck never happened. And the demo needs **zero phones** — add five real ones and the mesh lights up live.

---

## The close (6:10–7:00)

We do something nobody else does: we don't react to crowds — we **predict where they'll get stuck and move them before they do.**

It works offline. It protects privacy by architecture. It generalizes to any circuit — swap the data, not the code. And we've already proven the core loop, measurably, in simulation.

This is Formula 1 today. It's every festival, stadium, and station tomorrow — anywhere a crowd becomes a risk.

Thank you.
