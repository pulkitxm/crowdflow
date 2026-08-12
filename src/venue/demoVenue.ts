import { VenueGraph, type VenueDefinition, type VenueZone } from './venueGraph';

const zone = (index: number, id: string, type: string, label: string, x: number, y: number, width: number, height: number, capacity: number): VenueZone => ({
  index, id, type, label, centroid: { x, y }, capacity,
  polygon: [
    { x: x - width / 2, y: y - height / 2 }, { x: x + width / 2, y: y - height / 2 },
    { x: x + width / 2, y: y + height / 2 }, { x: x - width / 2, y: y + height / 2 },
  ],
});

export const demoVenueDefinition: VenueDefinition = {
  venueId: 'demo_stadium', version: 3,
  bounds: { xMax: 320, yMax: 210 },
  coordinateTransform: { originLatitude: 51.135, originLongitude: -1.01, rotationDegrees: 0 },
  zones: [
    zone(0, 'gate_a', 'gate', 'Gate A', 12, 105, 24, 30, 200),
    zone(1, 'plaza_a', 'zone', 'Arrival Plaza', 48, 105, 44, 52, 600),
    zone(2, 'zone_c17', 'corridor', 'Corridor C17', 101, 105, 56, 18, 180),
    zone(3, 'junction_center', 'junction', 'Central Junction', 148, 105, 32, 34, 350),
    zone(4, 'food_court', 'food_court', 'Food Court', 202, 105, 68, 58, 900),
    zone(5, 'zone_c11', 'corridor', 'Corridor C11', 94, 55, 52, 20, 340),
    zone(6, 'junction_south', 'junction', 'South Junction', 151, 55, 50, 30, 420),
    zone(7, 'stand_north', 'stand', 'North Stand', 205, 168, 70, 48, 1200),
    zone(8, 'corridor_north', 'corridor', 'North Walk', 142, 165, 76, 21, 450),
    zone(9, 'exit_b', 'exit', 'Exit B', 300, 105, 40, 34, 700),
    zone(10, 'gate_b', 'gate', 'Gate B', 43, 170, 46, 36, 300),
    zone(11, 'medical', 'zone', 'Medical & Safety', 260, 55, 44, 32, 180),
  ],
  edges: [
    ['gate_a', 'plaza_a', 36, 8, .02], ['plaza_a', 'zone_c17', 53, 4, .10],
    ['zone_c17', 'junction_center', 47, 4, .12], ['junction_center', 'food_court', 54, 7, .03],
    ['plaza_a', 'zone_c11', 56, 8, .02], ['zone_c11', 'junction_south', 57, 8, .02],
    ['junction_south', 'food_court', 72, 7, .03], ['food_court', 'exit_b', 98, 10, .01],
    ['food_court', 'stand_north', 63, 8, .02], ['junction_center', 'corridor_north', 67, 6, .04],
    ['corridor_north', 'stand_north', 63, 6, .03], ['gate_b', 'corridor_north', 99, 7, .03],
    ['junction_south', 'medical', 109, 6, .02], ['medical', 'exit_b', 64, 8, .01],
  ].map(([from, to, length, width, risk], index) => ({
    id: `edge_${index}`, from: from as string, to: to as string, bidirectional: true,
    lengthMetres: length as number, widthMetres: width as number, freeFlowSpeed: 1.34, baseRisk: risk as number,
  })),
};

export const demoVenue = new VenueGraph(demoVenueDefinition);
