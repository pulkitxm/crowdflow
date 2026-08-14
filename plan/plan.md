# CrowdFlow Optimiser (FlowMesh)

> **Status.** This is the vision document. Decisions taken after it was first written are
> recorded in [`decisions.md`](./decisions.md); [`architecture.md`](./architecture.md) is
> authoritative for repository structure and runtime layout, and [`circuits.md`](./circuits.md)
> for the circuit pack format. Sections 11, 44 and 45 below have been revised to match.
> Section 51 summarises what changed. Start at [`README.md`](./README.md).

## Central idea

Every participating phone becomes an anonymous crowd node. The system uses the collective movement of these nodes to understand the crowd, predict congestion before it happens, simulate possible interventions, and automatically recommend or trigger rerouting to prevent the bottleneck.

The important part is that this is a **closed loop**:

```
OBSERVE
   ↓
UNDERSTAND
   ↓
PREDICT
   ↓
SIMULATE
   ↓
REDIRECT
   ↓
OBSERVE AGAIN
   ↓
PREDICT AGAIN
```

The Excalidraw maps very well to this architecture. The connected nodes represent the distributed crowd, the "hidden details" represent the underlying crowd state that cannot be directly observed, the prediction box represents the predictive engine, the management agent makes operational decisions, and the final crowd-management layer executes those decisions.

---

## 1. Complete system vision

Call the system something like:

**CrowdFlow Optimiser**

or, if you want something more distinctive:

**FlowMesh**

The system has three major surfaces:

```
                         CROWD FLOW OPTIMISER
                                  │
                ┌─────────────────┼─────────────────┐
                │                 │                 │
                ▼                 ▼                 ▼
          USER MOBILE        CROWD MESH       OPERATOR
              APP               NETWORK        DASHBOARD
                │                 │                 │
                └─────────────────┼─────────────────┘
                                  │
                                  ▼
                         CROWD INTELLIGENCE
                                  │
                ┌─────────────────┼─────────────────┐
                │                 │                 │
                ▼                 ▼                 ▼
             STATE             PREDICTION        INSIGHTS
             ENGINE              ENGINE            ENGINE
                │                 │                 │
                └─────────────────┼─────────────────┘
                                  ▼
                         ROUTING ENGINE
                                  │
                                  ▼
                         MANAGEMENT AGENT
                                  │
                                  ▼
                           INTERVENTION
                                  │
                                  └──────► CROWD
```

There are essentially two worlds:

```
REAL WORLD
    ↓
Phones + sensors + movement
    ↓
Crowd network
    ↓
Crowd intelligence
    ↓
Prediction
    ↓
Intervention
    ↓
REAL WORLD
```

That feedback loop is the actual product.

---

## 2. What problem are we solving?

Large venues have a basic problem.

They know:

- where entrances are
- where exits are
- where walkways are
- where food courts are
- where emergency exits are
- roughly how many people are expected

But they usually do not have a continuously updated model of:

- where people are moving
- where they are going
- how fast they are moving
- where density is increasing
- where opposing flows are forming
- which route is becoming overloaded
- where a bottleneck will appear in the next few minutes

And most importantly:

**Knowing that a bottleneck exists is too late.**

The system should work before that.

Traditional system:

```
Crowd forms
   ↓
Camera detects crowd
   ↓
Operator notices
   ↓
Operator reacts
```

Our system:

```
Crowd starts forming
   ↓
Movement pattern detected
   ↓
Congestion predicted
   ↓
Alternative routes simulated
   ↓
People redirected
   ↓
Congestion prevented
```

---

## 3. The core architecture

```
                         ┌─────────────────────┐
                         │   VENUE DEFINITION  │
                         │                     │
                         │ Gates               │
                         │ Corridors           │
                         │ Zones               │
                         │ Exits               │
                         │ Capacity            │
                         │ Restrictions        │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │    VENUE GRAPH      │
                         │                     │
                         │ Nodes + Edges       │
                         │ Capacities          │
                         │ Distances           │
                         │ Travel times        │
                         └──────────┬──────────┘
                                    │
                                    │
       ┌────────────────────────────┼──────────────────────────┐
       │                            │                          │
       ▼                            ▼                          ▼
┌──────────────┐             ┌──────────────┐          ┌──────────────┐
│ REAL PHONES  │             │ SIMULATOR    │          │ EVENT DATA   │
│              │             │              │          │              │
│ GPS          │             │ Virtual      │          │ Schedule     │
│ IMU          │             │ people       │          │ Gates        │
│ Wi-Fi        │             │ movement     │          │ Capacity     │
│ BLE          │             │ scenarios    │          │ Events       │
└──────┬───────┘             └──────┬───────┘          └──────┬───────┘
       │                            │                         │
       └────────────────────────────┼─────────────────────────┘
                                    ▼
                         ┌─────────────────────┐
                         │ CROWD STATE ENGINE  │
                         │                     │
                         │ Density             │
                         │ Velocity            │
                         │ Direction           │
                         │ Flow                │
                         │ Inflow/outflow      │
                         │ Occupancy           │
                         │ Confidence          │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ PREDICTION ENGINE   │
                         │                     │
                         │ Bottleneck          │
                         │ Congestion          │
                         │ Overflow            │
                         │ Opposing flow       │
                         │ Exit accessibility  │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ INTERVENTION ENGINE │
                         │                     │
                         │ Test reroutes       │
                         │ Simulate outcomes   │
                         │ Score alternatives  │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   ROUTING ENGINE    │
                         │                     │
                         │ Best route          │
                         │ Capacity            │
                         │ Risk                │
                         │ Travel time         │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ CROWD OPS AGENT     │
                         │                     │
                         │ Understand          │
                         │ Explain             │
                         │ Recommend           │
                         │ Coordinate          │
                         └──────────┬──────────┘
                                    │
                         ┌──────────┴──────────┐
                         ▼                     ▼
                  USER GUIDANCE          OPERATOR ACTION
                         │                     │
                         ▼                     ▼
                   Crowd movement       Dashboard
                         │                     │
                         └──────────┬──────────┘
                                    ▼
                              NEW CROWD STATE
```

---

## 4. The phone node

Every participating phone is a **Crowd Node**.

It should not be treated as a person identity. It is simply:

```
CrowdNode
│
├── temporary_node_id
├── timestamp
├── position
├── velocity
├── direction
├── local_density
├── confidence
├── neighboring_nodes
└── current_zone
```

For example:

```json
{
  "node_id": "8f3a",
  "timestamp": 1723300102,
  "position": {
    "x": 43.2,
    "y": 81.7
  },
  "velocity": 1.24,
  "direction": 72,
  "zone": "corridor_c",
  "local_density": 0.74,
  "confidence": 0.91
}
```

Avoid sending personal information. The system does not need:

```
name
phone number
email
contacts
identity
```

It needs:

```
anonymous node
+
movement
+
location
+
time
```

---

## 5. The offline communication layer

This is one of the most interesting technical components.

Do not hard-code the entire application around one networking technology. Create a transport abstraction:

```
                 MESH TRANSPORT
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
     Wi-Fi Aware    Wi-Fi Direct      BLE
     preferred       fallback       discovery
```

Android supports Wi-Fi Aware for direct device discovery and peer-to-peer connections without another connectivity network. It can also support peer ranging on compatible hardware through Wi-Fi RTT.

Wi-Fi Direct also allows devices to discover and connect directly without an access point, and provides a higher-throughput link than Bluetooth in suitable cases.

BLE is useful for low-power discovery and small amounts of data.

So the application layer becomes:

```
MeshNetwork
│
├── discoverPeers()
├── connectPeer()
├── disconnectPeer()
├── sendMessage()
├── broadcast()
├── relayMessage()
└── getNearbyNodes()
```

The rest of the system does not care whether the packet was transported by Wi-Fi Aware, Wi-Fi Direct or BLE. That is important because device support and operating-system behavior will vary.

---

## 6. Important clarification about the mesh

Do not pitch this as:

> "Wi-Fi automatically creates a giant mesh."

That is not how the APIs work.

Wi-Fi Aware can create peer-to-peer links and system-managed clusters, but the application still needs to build the logical multi-hop overlay. Android's Wi-Fi Aware documentation explicitly describes discovery and peer connections, while the underlying clustering is managed by the system.

The application can create:

```
Node A
  │
  ▼
Node B
  │
  ▼
Node C
  │
  ▼
Node D
```

and decide that B should relay information from A toward C.

So the architecture is:

```
PHYSICAL NETWORK
Wi-Fi / BLE
      ↓
LINK
      ↓
APPLICATION MESH
      ↓
MESSAGE ROUTING
      ↓
CROWD INTELLIGENCE
```

This distinction will make the technical explanation much stronger.

---

## 7. Mesh message protocol

Do not constantly broadcast huge payloads. Use small messages.

Example:

```json
{
  "type": "STATE_UPDATE",
  "source": "8f3a",
  "sequence": 183,
  "ttl": 4,
  "timestamp": 1723300102,
  "payload": {
    "zone": "C17",
    "density": 0.74,
    "velocity": 1.2,
    "direction": 72
  }
}
```

Other message types:

```
HELLO
PEER_DISCOVERY
STATE_UPDATE
ZONE_UPDATE
ROUTE_UPDATE
ALERT
REROUTE
ACK
HEARTBEAT
SYNC
```

The `ttl` prevents packets from travelling forever. The `sequence` prevents duplicate processing.

---

## 8. Crowd data should be aggregated

Do not make the backend process every individual person forever.

Convert:

```
100 individual nodes
```

into:

```
Zone C17

population estimate: 412
density: high
average velocity: 0.81 m/s
dominant direction: east
inflow: 86/min
outflow: 31/min
pressure: high
confidence: 0.88
```

The system becomes:

```
Individual observations
        ↓
Local aggregation
        ↓
Zone state
        ↓
Venue state
```

This is both more efficient and more privacy-friendly.

---

## 9. Offline location architecture

The phone can use its location sensors without needing the application to have an internet connection. Android exposes GNSS capabilities and motion/location sensors through its platform APIs.

But do not depend purely on GPS. Use:

```
                 LOCATION ENGINE
                       │
        ┌──────────────┼──────────────┐
        │              │              │
       GNSS           IMU        Wi-Fi RTT
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                SENSOR FUSION
                       │
                       ▼
                  MAP MATCHING
                       │
                       ▼
                 VENUE POSITION
```

For outdoor events:

```
GNSS
```

may be sufficient for the prototype.

For indoor venues:

```
GNSS
+
IMU
+
Wi-Fi RTT where available
+
venue map constraints
```

is better.

---

## 10. Venue coordinate system

Do not build the whole system around latitude/longitude. Create a local coordinate system:

```
                    X →
        ┌──────────────────────────┐
        │                          │
        │ Gate A                   │
        │   ↓                      │
        │   ●───●───●              │
        │       │                   │
        │       ●───●              │
        │           │              │
        │     Food Court           │
        │           │              │
        │       ●───●───● Exit     │
        │                          │
        └──────────────────────────┘
                    ↓
                    Y
```

For example:

```
venue_x = 43.2
venue_y = 81.7
```

Then map it to:

```
zone = FOOD_COURT
corridor = C17
```

This makes simulation and routing dramatically easier.

---

## 11. Venue graph

The entire venue becomes a graph.

```
                 Gate A
                   │
                   ▼
                  N1
                 /  \
                /    \
               N2    N3
               │      │
               ▼      ▼
             Food    N4
               │      │
               └──┬───┘
                  ▼
                  N5
                /    \
               ▼      ▼
             Exit A  Exit B
```

Each node:

```
ZoneNode
│
├── id
├── type                 (gate | concourse | crossing | viewing | amenity | exit)
├── position
├── capacity
├── current_population
├── density
├── sensing_quality      (GNSS confidence for this zone)
└── risk
```

Each edge:

```
RouteEdge
│
├── source
├── destination
├── distance
├── max_capacity
├── average_speed
├── current_flow
├── direction
├── gradient             (elevation — affects walking speed)
├── availability         (time windows, see below)
├── blocked
└── risk
```

Now the routing problem becomes a graph optimization problem.

**Time-gated edges.** On a circuit, some edges do not always exist. Track crossings open
between sessions and close whenever cars are running, so `blocked: bool` is not expressive
enough — an edge needs availability windows tied to session state. This makes routing
time-dependent: a path is only valid if each edge is still open *when the walker would
actually reach it*. Routing someone toward a crossing that shuts before they arrive is worse
than not rerouting them at all. See [`circuits.md`](./circuits.md).

Crossings are also the dominant bottleneck mechanism at a real circuit, so this is the most
authentic thing the model can capture.

---

## 12. Crowd state engine

This is the first major intelligence layer.

It calculates:

```
density
velocity
direction
inflow
outflow
occupancy
pressure
flow variance
queue length
capacity utilization
```

For example:

```
Zone C

Population       430
Capacity         500
Utilization      86%
Inflow           91/min
Outflow          42/min
Velocity         0.7 m/s
Direction        East
Risk             HIGH
```

---

## 13. Density estimation

You need to account for the fact that not everyone will have the app. This is a major issue.

Suppose:

```
120 participating nodes
```

does not mean:

```
120 people
```

You need an estimated participation rate:

```
Observed nodes
      ↓
Participation model
      ↓
Estimated total crowd
```

If the estimated participation rate is 20%:

```
120 observed
÷
0.20
=
600 estimated people
```

For the hackathon, make this configurable:

```
estimated participation = 10%
20%
30%
50%
```

Then show the effect on prediction confidence.

---

## 14. The hidden state

This is directly connected to the Excalidraw.

What the system observes:

```
position
velocity
direction
nearby nodes
```

What it actually wants to understand:

```
true density
crowd pressure
movement intention
queue formation
flow instability
bottleneck probability
```

So:

```
OBSERVATIONS
     │
     ▼
STATE ESTIMATION
     │
     ▼
HIDDEN CROWD STATE
```

This is where the predictive model becomes interesting.

---

## 15. Prediction engine

The prediction engine should answer:

**Where will congestion happen?**

```
Zone C
```

**When?**

```
~180 seconds
```

**How severe?**

```
Critical
```

**Why?**

```
High inflow
+
low velocity
+
limited corridor capacity
```

**What happens without intervention?**

```
Capacity exceeded in 3 minutes
```

**What intervention prevents it?**

```
Redirect 30% of Gate A traffic
through Corridor B.
```

That final question is where the system becomes much stronger.

---

## 16. Prediction model

For the hackathon, do not immediately try to build a giant deep-learning model. Start with engineered features:

```
density
density_change
velocity
velocity_change
inflow
outflow
capacity_ratio
queue_growth
flow_direction
route_capacity
historical_pattern
```

Then predict:

```
congestion_probability
time_to_congestion
expected_peak_density
```

You can start with:

```
XGBoost
LightGBM
Random Forest
Gradient Boosting
```

or even a well-designed mathematical baseline.

Then, if there is time, compare it with a temporal model.

The important thing is demonstrating that:

```
prediction
>
intervention
>
measurable improvement
```

---

## 17. Intervention simulation

This is one of the most important components.

When the prediction engine says:

```
Bottleneck likely in Zone C.
```

do not immediately redirect people. First ask:

```
What if we redirect 10%?
What if we redirect 20%?
What if we redirect 30%?
What if we redirect 40%?
```

Run the simulation.

```
                   CURRENT STATE
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
           10% route   20% route   30% route
              │          │          │
              ▼          ▼          ▼
           Score 72    Score 84    Score 93
                                      │
                                      ▼
                                  SELECT 30%
```

The score could consider:

```
congestion reduction
+
travel time
+
route capacity
+
safety
+
distance
+
fairness
```

---

## 18. Routing engine

The routing engine should not simply calculate the shortest path. It should calculate the **safest and most efficient path under current crowd conditions**.

For example:

```
Route A

distance: 200m
time: 2.5 min
capacity: 90%
risk: HIGH
```

```
Route B

distance: 250m
time: 3.0 min
capacity: 42%
risk: LOW
```

Choose Route B.

Because the objective is not:

```
shortest route
```

It is:

```
optimal crowd flow
```

---

## 19. Dynamic edge weights

The graph should change continuously.

Suppose:

```
Edge C

normal cost = 1
```

When congestion rises:

```
density ↑
velocity ↓
risk ↑

dynamic cost = 8
```

Then the routing engine automatically starts avoiding it.

Conceptually:

```
edge_cost =
    travel_time
  + congestion_penalty
  + risk_penalty
  + capacity_penalty
```

This makes the graph dynamic.

---

## 20. Crowd Operations Agent

This is the AI component from the Excalidraw. Call it **Crowd Operations Agent**.

Its job is not raw numerical prediction. Its job is:

```
Understand
Reason
Simulate
Recommend
Explain
Coordinate
```

It can have tools like:

```
get_venue_state()
get_zone_state()
get_route_state()
get_predictions()
simulate_intervention()
find_alternative_route()
get_event_schedule()
create_reroute()
broadcast_alert()
generate_insight()
```

Example:

```
Agent:

Why is Zone C becoming congested?

Tool:
get_zone_state(C)

Tool:
get_inflow_sources(C)

Tool:
simulate_intervention(Gate_A → Corridor_B)

Result:
27% reduction in projected peak density.

Agent:
Redirect approximately 25-30% of Gate A
traffic through Corridor B.
```

---

## 21. Role-based agent system

The Excalidraw says: *role based modeling agent*. Expand this into multiple specialized agents, but keep them lightweight.

```
                    CROWD OPS AGENT
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
     ANALYST AGENT    ROUTING AGENT    EVENT AGENT
          │                │                │
          ▼                ▼                ▼
     FIND PATTERNS     TEST ROUTES       SCHEDULE
          │                │                │
          └────────────────┼────────────────┘
                           ▼
                    DECISION AGENT
                           │
                           ▼
                       ACTION
```

For the hackathon, these can actually be modules/tools inside one agent instead of separate LLM calls. That will be faster and cheaper.

---

## 22. Random insights

The idea of the system generating unexpected insights is good. Call this the **Crowd Intelligence Layer**.

It continuously searches for:

```
anomalies
inefficiencies
repeating patterns
unexpected flows
capacity problems
safety concerns
operational opportunities
```

Examples:

- Gate B is processing people 34% slower than Gate A.
- Food Court 2 creates a secondary bottleneck every 8 minutes.
- People entering through Gate C consistently avoid Corridor D.
- Exit E3 accessibility is decreasing even though total crowd density remains moderate.
- Opening Gate D 5 minutes earlier could distribute arrival traffic more evenly.

This is where the AI agent becomes useful to organizers.

---

## 23. User application

Keep the user app extremely simple.

The user sees:

```
┌───────────────────────────────┐
│          CROWD FLOW           │
│                               │
│              YOU             │
│               ●               │
│               ↓               │
│          GREEN ROUTE          │
│               ↓               │
│        ─────────────           │
│               ↓               │
│       RED / CROWDED            │
│                               │
│  Recommended route:           │
│  Corridor B                   │
│                               │
│  ~3 min                       │
└───────────────────────────────┘
```

If the system needs to redirect:

```
⚠ Crowd building ahead

Take Corridor B instead.

Estimated time: 3 min
Current route: high congestion
```

Do not overwhelm users with AI explanations.

---

## 24. Organizer dashboard

This is where the intelligence is demonstrated.

```
┌──────────────────────────────────────────────┐
│ CROWD OPS                                    │
├──────────────────────────────────────────────┤
│                                              │
│               LIVE VENUE MAP                 │
│                                              │
│       ● ● ● ●                                │
│      ● ● ● ● ●       ███████                 │
│       ● ● ●          ███████ HIGH            │
│          ↓               ↓                   │
│        ● ● ●           ● ● ●                 │
│           ↓             ● ●                  │
│        ● ● ●                 EXIT             │
│                                              │
├──────────────────────────────────────────────┤
│ PREDICTIONS                                  │
│                                              │
│ Zone C                                       │
│ Bottleneck predicted in 2m 47s               │
│ Confidence: 91%                              │
│                                              │
├──────────────────────────────────────────────┤
│ RECOMMENDED ACTION                           │
│                                              │
│ Redirect 30% Gate A traffic → Corridor B    │
│                                              │
│ Expected congestion reduction: 27%           │
│                                              │
└──────────────────────────────────────────────┘
```

---

## 25. Simulation engine

The simulation is critical because it gives a controllable demo.

Architecture:

```
                 VENUE GRAPH
                     │
                     ▼
              CROWD GENERATOR
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
       Person A   Person B   Person C
          │          │          │
          └──────────┼──────────┘
                     ▼
               MOVEMENT MODEL
                     │
                     ▼
              CROWD TELEMETRY
                     │
                     ▼
              SAME STATE ENGINE
                     │
                     ▼
              SAME PREDICTION
                     │
                     ▼
              SAME ROUTING
```

This is important: **simulation and real phones should produce the same data format.**

Then:

```
Simulator ──┐
            ├──► Crowd State Engine
Real phones ┘
```

This makes the architecture clean.

---

## 26. Crowd simulator

Create virtual people with:

```
origin
destination
speed
preferred_route
group_size
behavior
```

Example:

```
Person 1
origin: Gate A
destination: Food Court
speed: 1.3m/s

Person 2
origin: Gate A
destination: Exit B
speed: 1.1m/s
```

Generate hundreds or thousands. Then introduce scenarios:

```
Scenario 1
Normal crowd

Scenario 2
Large arrival wave

Scenario 3
Gate closes

Scenario 4
Food court event starts

Scenario 5
Emergency exit becomes unavailable

Scenario 6
One corridor becomes congested
```

---

## 27. The killer demo

This should be the primary demonstration.

Start with:

```
500 simulated people
```

moving through the venue. Show the live map.

Then:

```
T = 0

Normal flow
```

At:

```
T = 30 sec
```

the system notices:

```
inflow ↑
velocity ↓
density ↑
```

Prediction:

```
"Zone C will become congested
in approximately 90 seconds."
```

Then show:

```
INTERVENTION SIMULATION

No intervention:
Peak density = 118%

20% reroute:
Peak density = 103%

30% reroute:
Peak density = 87%

40% reroute:
Peak density = 84%
Travel time increases significantly
```

The system chooses:

```
30% reroute
```

Then:

```
REROUTE ACTIVE
```

Crowd changes route. And finally:

```
Predicted congestion: avoided

Peak density:
118% → 87%

Average travel time:
-8%

Bottleneck:
resolved
```

That is the moment the judges should remember.

---

## 28. Real phone demo

After the simulation, show that the same architecture works with actual phones.

Use:

```
Phone 1
Phone 2
Phone 3
Phone 4
Phone 5
```

Each phone becomes a node. Display:

```
5 active crowd nodes
```

Move the phones around the venue. The dashboard receives their state. Then create a small physical bottleneck.

The system detects:

```
density ↑
velocity ↓
```

and shows:

```
Potential congestion detected.
```

This proves the system is not just a fake dashboard.

---

## 29. Hybrid architecture

For the hackathon, use this:

```
                 ┌───────────────────────┐
                 │       DASHBOARD       │
                 │       Web App         │
                 └───────────┬───────────┘
                             │
                         WebSocket
                             │
                             ▼
                 ┌───────────────────────┐
                 │      CONTROL API      │
                 │                       │
                 │ Venue                 │
                 │ Crowd                 │
                 │ Prediction            │
                 │ Routing               │
                 └───────────┬───────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         State Engine   Prediction      AI Agent
              │           Engine             │
              │              │               │
              └──────────────┼───────────────┘
                             ▼
                       Routing Engine
                             │
                             ▼
                       Mesh Gateway
                             │
               ┌─────────────┼─────────────┐
               ▼             ▼             ▼
             Phone          Phone         Phone
               │             │             │
               └─────────────┼─────────────┘
                             │
                        Local Mesh
```

---

## 30. Recommended backend

The implemented runtime is deliberately one language and one package graph:

```
Backend
│
├── Bun 1.3 + strict TypeScript
├── native HTTP + WebSockets
├── pure local venue graph and simulation engines
├── authored TypeScript contracts + generated JSON Schema
└── Bun workspaces / one lockfile
```

A database and Redis remain optional until measured persistence/load requires them.

If real-time event processing is split later:

```
Phone
 ↓
WebSocket
 ↓
Bun API
 ↓
Redis Streams
 ↓
Crowd State Worker
 ↓
Prediction Worker
 ↓
Routing Worker
 ↓
WebSocket
 ↓
Dashboard
```

For a hackathon, however, do not build infrastructure just because it looks impressive. Initially do:

```
FastAPI
+
WebSocket
+
in-memory state
```

and add Redis only if needed.

---

## 31. Backend services

Separate the backend conceptually into:

```
services/

venue/
    venue_service

crowd/
    ingestion
    state_engine

prediction/
    prediction_engine

simulation/
    simulator

routing/
    routing_engine

agent/
    crowd_ops_agent

mesh/
    gateway

analytics/
    insights

api/
    websocket
    REST
```

---

## 32. Data flow

A real phone produces:

```
Location
Velocity
Direction

↓

Node State

↓

Mesh

↓

Local aggregation

↓

Gateway

↓

Crowd State

Zone C:
density = 0.82
velocity = 0.72
inflow = 91
outflow = 40

↓

Prediction

P(congestion within 180s) = 0.91

↓

Intervention Simulator

↓

30% reroute

↓

Routing Engine

↓

Reroute command

↓

Mesh

↓

Phones

"Use Corridor B"

↓

Crowd changes

↓

New state
```

---

## 33. Command propagation

A rerouting command can look like:

```json
{
  "type": "REROUTE",
  "route_id": "route_17",
  "source_zone": "gate_a",
  "destination_zone": "food_court",
  "avoid": ["corridor_c"],
  "preferred": ["corridor_b"],
  "expires_at": 1723300400
}
```

Phones receive it through the mesh. The phone calculates its own route:

```
Current position
      ↓
Destination
      ↓
Current venue graph
      ↓
Avoid congested edge
      ↓
Best route
```

This means you do not necessarily need to send a unique route to every person. You can send:

```
Avoid Corridor C
Prefer Corridor B
```

and let each device calculate its local route. That scales better conceptually.

---

## 34. Safety system

This should be part of the architecture. The system should have hard rules that the AI cannot override.

```
SAFETY POLICY

Emergency exits:
NEVER route away from them when emergency evacuation is active.

Maximum zone capacity:
NEVER intentionally exceed.

Blocked corridor:
NEVER route through.

Emergency mode:
Disable normal optimization.
Follow evacuation policy.
```

Architecture:

```
AI recommendation
       │
       ▼
SAFETY POLICY ENGINE
       │
       ├── allowed
       │
       └── rejected
              │
              ▼
          explanation
```

The AI should not have unrestricted control over crowd movement.

---

## 35. Privacy architecture

This should be built in from the beginning.

Use:

```
temporary node IDs
```

instead of permanent identities. For example:

```
node_7f31
```

can rotate periodically.

Store:

```
movement statistics
```

rather than:

```
person history
```

Avoid:

```
names
phone numbers
contacts
face recognition
personal profiles
```

The system should be able to say:

> "412 people are estimated in Zone C."

without knowing who those people are.

---

## 36. Confidence system

Every prediction should have confidence.

For example:

```
Congestion probability: 91%
Confidence: 87%
```

Confidence can depend on:

```
number of active nodes
location accuracy
data freshness
sampling rate
prediction stability
```

If only three phones are reporting:

```
Prediction:
HIGH RISK

Confidence:
LOW
```

If 400 phones are reporting:

```
Prediction:
HIGH RISK

Confidence:
VERY HIGH
```

This prevents the system from pretending it knows something it does not.

---

## 37. Offline-first architecture

The system should degrade gracefully.

Full connectivity:

```
Phone
 ↓
Mesh
 ↓
Edge
 ↓
Cloud
 ↓
Dashboard
```

Internet unavailable:

```
Phone
 ↕
Phone
 ↕
Phone
 ↕
Phone
```

Local crowd intelligence continues.

Gateway unavailable:

```
Local mesh
 ↓
Local aggregation
 ↓
Local routing
```

When the gateway returns:

```
Local state
     ↓
Synchronization
     ↓
Central dashboard
```

This is a strong differentiator for stadiums, festivals, railway stations and other places where network conditions may become unreliable exactly when crowd density is high.

---

## 38. AI architecture

Use a tool-based agent rather than multiple expensive LLM agents.

```
                    LLM
                     │
              Crowd Ops Agent
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
     Analysis      Tools       Memory
        │            │            │
        │       ┌────┼────┐       │
        │       │    │    │       │
        ▼       ▼    ▼    ▼       ▼
     Context   State Route Sim   History
```

Tools:

```
get_live_state
get_zone
get_prediction
get_bottlenecks
simulate_route
simulate_intervention
get_event_schedule
get_venue_graph
generate_insight
broadcast_message
```

---

## 39. Agent memory

The agent can remember venue-level information:

```
Venue configuration
Historical bottlenecks
Typical arrival patterns
Past interventions
Event schedule
Known capacity constraints
```

Example:

```
Previous event:

Food Court 2 became congested
between 18:30 and 18:45.

Cause:
Large arrival wave from Gate B.

Next event:

Agent notices the same pattern.

Prediction:
Potential repeat bottleneck.

Recommendation:
Open alternate corridor at 18:25.
```

This is where the system can become smarter over time.

---

## 40. Event-aware prediction

The crowd does not move randomly. Events affect it.

The model should consume:

```
event start
event end
gate opening
gate closing
performances
food promotions
train arrival
match interval
emergency events
```

For example:

```
18:00
Main gate opens

18:15
Large crowd arrival

18:30
Match begins

20:15
Match ends

20:20
Mass exit
```

The prediction model can anticipate:

```
20:20 → massive exit wave
```

before it happens.

---

## 41. Insight engine

The insight engine can use statistical anomaly detection first.

```
Historical baseline
       ↓
Current behavior
       ↓
Difference
       ↓
Anomaly
       ↓
LLM explanation
```

This is better than asking an LLM to inspect thousands of raw points.

---

## 42. Metrics

You need measurable metrics for the judges.

Track:

```
Prediction accuracy
Time-to-warning
Peak density
Average density
Average travel time
Maximum congestion
Queue length
Number of bottlenecks
Bottlenecks prevented
Rerouting effectiveness
Route efficiency
```

Most important:

```
Without intervention
vs
With intervention
```

Example:

```
                         Before       After

Peak density              118%         87%
Avg travel time           8.2 min      7.5 min
Bottleneck duration       6.4 min      0.9 min
Emergency route access    61%          94%
```

This gives an actual result rather than a visual demo.

---

## 43. Architecture for the complete project

```
                           ┌──────────────────────────┐
                           │       ORGANIZER           │
                           │        DASHBOARD          │
                           └────────────┬─────────────┘
                                        │
                                  WebSocket/API
                                        │
                           ┌────────────▼─────────────┐
                           │       CONTROL PLANE      │
                           │                          │
                           │ Venue API                │
                           │ Crowd API                │
                           │ Event API                │
                           │ Alert API                │
                           └────────────┬─────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             │                          │                          │
             ▼                          ▼                          ▼
    ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
    │ CROWD STATE      │       │ PREDICTION      │       │ SIMULATION      │
    │ ENGINE           │──────►│ ENGINE          │◄──────│ ENGINE          │
    │                  │       │                 │       │                 │
    │ density          │       │ bottleneck      │       │ virtual people  │
    │ velocity         │       │ congestion      │       │ scenarios       │
    │ flow             │       │ risk            │       │ interventions   │
    │ occupancy        │       │ time-to-event   │       │ what-if         │
    └────────┬─────────┘       └────────┬────────┘       └─────────────────┘
             │                          │
             └──────────────┬───────────┘
                            ▼
                   ┌──────────────────┐
                   │ INTERVENTION     │
                   │ ENGINE           │
                   │                  │
                   │ What if A?       │
                   │ What if B?       │
                   │ What if C?       │
                   └────────┬─────────┘
                            │
                            ▼
                   ┌──────────────────┐
                   │ ROUTING ENGINE   │
                   │                  │
                   │ graph            │
                   │ capacity        │
                   │ risk             │
                   │ travel time      │
                   └────────┬─────────┘
                            │
                            ▼
                   ┌──────────────────┐
                   │ SAFETY ENGINE    │
                   │                  │
                   │ hard constraints │
                   │ emergency rules  │
                   │ blocked paths    │
                   └────────┬─────────┘
                            │
                            ▼
                   ┌──────────────────┐
                   │ CROWD OPS AGENT  │
                   │                  │
                   │ explain          │
                   │ recommend        │
                   │ coordinate       │
                   │ discover insights│
                   └────────┬─────────┘
                            │
                            ▼
                   ┌──────────────────┐
                   │ INTERVENTION     │
                   └────────┬─────────┘
                            │
                    ────────┼────────
                            │
                            ▼
                 ┌──────────────────────┐
                 │      CROWD MESH      │
                 │                      │
                 │ Wi-Fi Aware          │
                 │ Wi-Fi Direct         │
                 │ BLE                  │
                 └──────────┬───────────┘
                            │
             ┌──────────────┼──────────────┐
             │              │              │
             ▼              ▼              ▼
          PHONE A        PHONE B        PHONE C
             │              │              │
             └──────────────┼──────────────┘
                            │
                            ▼
                    REAL CROWD MOVEMENT
                            │
                            └───────────────►
                              NEW OBSERVATION
```

---

## 44. Recommended tech stack

For the hackathon:

```
Mobile
──────
React Native + Expo      (dev client — not Expo Go)
TypeScript
Expo Location
SQLite / MMKV

  └── native module (Kotlin)
      Wi-Fi Aware        preferred
      Wi-Fi Direct       fallback
      BLE                discovery
      foreground service relay + TTL + dedupe + local aggregation


Backend
───────
Bun 1.3 + strict TypeScript
native HTTP + WebSockets
pure local graph/simulation engines
Bun CLI over the same core library
Bun workspaces + one lockfile


Prediction
──────────
XGBoost / LightGBM
Time-series features
Rule-based baseline


Simulation
──────────
TypeScript
project-owned seeded MT19937
pure custom agent simulation


AI
──
LLM
Tool calling
Crowd Operations Agent


Database
────────
PostgreSQL

Optional:
Redis
```

For the first prototype, avoid unnecessary Kubernetes, Kafka, microservices, vector databases, etc. Build the actual product first.

**Why the mesh stays native.** Expo is right for the app, but the mesh cannot live in
JavaScript: the JS runtime is suspended when the app backgrounds, and at a race almost every
phone is in a pocket with the screen off. A node that stops relaying when the screen locks is
not a node. Wi-Fi Aware also has no JS binding at all. So the `MeshNetwork` interface from
§5 doubles as the native bridge boundary — Kotlin below it, TypeScript above. See
[`decisions.md`](./decisions.md) D3.

---

## 45. Repository architecture

A single monorepo. Circuits and events are **data**, not code, and live at the root so they
can be swapped without touching a package. See [`architecture.md`](./architecture.md) for the
full rationale.

```
vmax/
│
├── packages/
│   ├── contracts/          schemas — single source of truth, generates TS types
│   ├── core/               venue · simulation · state · prediction ·
│   │                       intervention · routing · safety   (pure library)
│   ├── cli/                typer — thin adapter over core
│   ├── api/                fastapi websocket + rest — thin adapter over core
│   └── agent/              crowd ops agent + tool layer
│
├── apps/
│   ├── dashboard/          operator web app
│   └── mobile/             expo — spectator app
│       └── modules/mesh/   native Kotlin: transports, relay, aggregation
│
├── circuits/
│   ├── silverstone/
│   │   ├── pack/           graph · gates · viewing · crossings · sensing
│   │   └── SKILL.md        agent-facing operational playbook
│   └── monza/
│
├── events/                 per-weekend session timetables
├── scenarios/              seeded simulation scenarios
│
├── models/                 trained prediction models + calibration
├── plan/                   this folder
└── docs/                   protocol.md · demo.md
```

The two seams that matter:

```
   CLI ──┐                          TypeScript ── UI, routing display
         ├──► packages/core             ═══╪═══  MeshNetwork interface
   API ──┘   (pure functions)          Kotlin ── transports, relay, service
```

---

## 46. Development plan

Do not try to build everything simultaneously.

### Phase 1: Venue model

Build:

```
venue map
+
zones
+
corridors
+
gates
+
exits
+
capacities
```

Then convert it to a graph.

Goal:

```
You can visually see and query the venue graph.
```

### Phase 2: Simulator

Create:

```
100 → 1,000 virtual people
```

with different origins and destinations.

Goal:

```
People move through the venue.
```

### Phase 3: Crowd State Engine

Calculate:

```
density
velocity
flow
inflow
outflow
capacity
```

Goal:

```
Live crowd heatmap.
```

### Phase 4: Prediction

Add:

```
bottleneck prediction
time-to-congestion
risk score
```

Goal:

```
"Congestion predicted in 3 minutes."
```

### Phase 5: Routing

Add dynamic graph weights.

Goal:

```
Find alternative routes.
```

### Phase 6: Intervention simulation

Test:

```
10%
20%
30%
40%
```

rerouting.

Goal:

```
Find the minimum effective intervention.
```

### Phase 7: Mobile node

Build the Android app.

Goal:

```
Real phones produce crowd telemetry.
```

### Phase 8: Offline mesh

Implement:

```
discovery
peer connection
message exchange
relay
TTL
aggregation
```

Goal:

```
Phone → Phone → Phone communication.
```

### Phase 9: Dashboard

Show:

```
live crowd
prediction
risk
rerouting
```

### Phase 10: AI agent

Add:

```
insights
explanation
what-if simulation
operational recommendations
```

### Phase 11: Polish

Add:

```
animations
alerts
confidence
metrics
demo scenario
```

---

## 47. What should be MVP vs advanced

Do not try to implement the entire vision for the hackathon.

**Must have**

```
✓ Venue graph
✓ Crowd simulation
✓ Live crowd visualization
✓ Density calculation
✓ Bottleneck prediction
✓ Alternative route calculation
✓ Intervention simulation
✓ Automatic rerouting
✓ Organizer dashboard
✓ AI operational insights
```

**Strong differentiator**

```
✓ Real Android phones
✓ Offline peer communication
✓ Anonymous node IDs
✓ Real-time telemetry
✓ Hybrid simulated + real crowd
```

**Nice to have**

```
✓ Wi-Fi RTT ranging
✓ Historical learning
✓ Advanced temporal model
✓ Multi-agent architecture
✓ Fully decentralized prediction
✓ iOS support
```

Do not let the nice-to-have features consume the time needed for the core demo.

---

## 48. What NOT to build

Specifically avoid these for the hackathon:

```
Face recognition
```

Not needed.

```
Individual identity tracking
```

Not needed.

```
Huge LLM pipeline
```

Not needed.

```
Fully decentralized AI
```

Too much complexity.

```
iOS + Android simultaneously
```

Unless the networking is already solved.

```
Perfect indoor positioning
```

Not realistic in hackathon time.

```
Cloud-only architecture
```

Weakens the offline story.

```
LLM deciding routes directly
```

Bad architecture.

---

## 49. The most important technical loop

Everything should ultimately revolve around this:

```
                  ┌──────────────┐
                  │     CROWD    │
                  └──────┬───────┘
                         │
                         ▼
                  OBSERVATION
                         │
                         ▼
                  STATE ESTIMATION
                         │
                         ▼
                    PREDICTION
                         │
                         ▼
                "BOTTLENECK IN 3M"
                         │
                         ▼
              INTERVENTION SIMULATION
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
          10%          20%          30%
            │            │            │
            └────────────┼────────────┘
                         ▼
                   BEST ACTION
                         │
                         ▼
                      ROUTING
                         │
                         ▼
                    REDIRECTION
                         │
                         ▼
                     CROWD
                         │
                         └──────────────►
                           NEW OBSERVATION
```

This is the actual innovation.

---

## 50. How to describe the product

**Short version:**

CrowdFlow is an offline-first crowd intelligence system that turns participating smartphones into an anonymous, distributed sensing network. It continuously estimates crowd movement, predicts bottlenecks before they form, simulates possible interventions, and dynamically redirects people through safer and less congested routes.

**More technical version:**

CrowdFlow combines a distributed phone-to-phone sensing layer, venue graph, real-time crowd state estimation, predictive congestion modeling, intervention simulation, dynamic routing, and an AI Crowd Operations Agent into a closed-loop crowd management system.

**Strongest one-liner:**

> We don't just detect crowds. We predict where they will get stuck and move them before they do.

That should be the central idea of the entire project.

One technical choice to lock in early is **Android-first**, with Wi-Fi Aware as the preferred peer transport, Wi-Fi Direct as a fallback, and BLE primarily for discovery/small messages. Android's current documentation supports the basic peer-to-peer pieces needed for this direction, but the multi-hop mesh and crowd-routing logic would be the application-level layer.

For the hackathon, the final demo should tell one complete story: 500 simulated people + a few real phones → congestion starts forming → model predicts it → system tests interventions → chooses the best reroute → phones receive the new route → crowd changes direction → predicted bottleneck disappears → dashboard shows the measurable improvement.

---

## 51. Addendum — decisions taken after this document

Five decisions were taken after the vision above was written. Each is recorded with full
context in [`decisions.md`](./decisions.md); this is the summary.

**D1 — Bun/TypeScript monorepo with generated JSON Schema.** One repository, and the payoff
is specifically that the §1 contracts are authored once in TypeScript and imported directly by
all JavaScript runtimes. Deterministic codegen emits committed JSON Schema for non-TypeScript
boundaries. Without this authority a monorepo is just folders; with it, app and backend cannot
silently drift on the telemetry format.

**D2 — CLI-first over a core library.** `packages/core` is a pure library. The CLI and the
API are both thin adapters over it, and the CLI is not a phase to graduate from — it stays as
the evaluation harness. This is what makes the demo seeded and repeatable (§27), the A/B
metrics table possible (§42), and headless training-data generation practical (§16).

**D3 — React Native + Expo, mesh as a native Kotlin module.** The app UI in §23 is trivial and
RN builds it fast while sharing types with the dashboard. But the mesh stays native, because
the JS runtime suspends in the background and Wi-Fi Aware has no JS binding. The
`MeshNetwork` interface from §5 becomes the bridge boundary — which is also the retreat path:
if Aware fails on the demo hardware it falls back to BLE-only, then to a gateway-only mode,
and nothing above the interface changes.

**D4 — Circuits as data packs plus agent skills.** Every Grand Prix circuit differs in gates,
capacity, viewing areas and crossings, so each becomes a swappable **Circuit Pack** — data,
loaded by the engines, schema-validated. The circuit's *operational knowledge* (§39) is a
separate `SKILL.md` for the Crowd Ops Agent. The split matters: the venue graph must never sit
behind a language model. Build one circuit deep and one shallow — the second exists only to
prove the format generalises.

**D5 — Time-gated edges.** A consequence of D4, recorded separately because it changes the
graph model: track crossings open and close with session state, so routing becomes
time-dependent. See §11 and [`circuits.md`](./circuits.md).

Nothing above changes the central idea, the closed loop in §49, or the demo in §27.
