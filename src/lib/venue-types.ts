// Shared venue model types (kept separate so circuits.ts and venue.ts can both
// use them without a circular import).

export type NodeKind = "gate" | "zone" | "facility";

export interface VenueNode {
  id: string;
  name: string;
  kind: NodeKind;
  x: number;
  y: number;
  /** Max comfortable people in this area */
  capacity: number;
  /** North / East / South / West / Central */
  sector: "NORTH" | "EAST" | "SOUTH" | "WEST" | "CENTRAL";
  facility?: "food" | "toilets" | "medical" | "screen" | "info" | "parking";
}

export interface VenueEdge {
  a: string;
  b: string;
  /** people per minute the walkway can carry */
  throughput: number;
}

export interface ScheduleItem {
  /** minutes from gates-open (t = 0 at 09:00) */
  t: number;
  label: string;
  /** relative pull of the crowd towards these zones */
  magnet: string[];
  /** arrival multiplier at the gates */
  arrival: number;
}
