const DEG = Math.PI / 180;

export type Pose = { x: number; z: number; heading: number; yaw?: number; pitch?: number };

/**
 * The seven fixed camera views of `visual.spec.ts`, shared with `renderBaseline.spec.ts`.
 * Poses use the layout frame: heading 0 faces +Z (south, window side), -90 deg faces west.
 * `01-spawn` has no pose: it is the view right after joining.
 */
export const POSES: { name: string; pose?: Pose; note: string }[] = [
  { name: '01-spawn', note: 'spawn view as the player first sees it' },
  {
    name: '02-pods',
    pose: { x: -0.72, z: 2.46, heading: -90 * DEG, pitch: 22 * DEG },
    note: 'aisle between the pods looking west, window on the left (cf. except/main.jpg)',
  },
  {
    name: '03-tv-wall',
    pose: { x: -1.2, z: -0.6, heading: -90 * DEG, pitch: 18 * DEG },
    note: 'entertainment corner looking west toward the TV wall',
  },
  {
    name: '04-across-tv-wall',
    pose: { x: 3.6, z: 2.46, heading: 90 * DEG, pitch: 15 * DEG },
    note: 'east wall with utility door and air conditioner (cf. except/across-wall-tv.jpg)',
  },
  {
    name: '05-near-wall-fade',
    pose: { x: -1.44, z: -4.15, heading: 0, pitch: 25 * DEG },
    note: 'back to the north wall: camera pulled in, player mesh faded',
  },
  {
    name: '06-desk-side',
    pose: { x: -3.9, z: 2.46, heading: 180 * DEG, pitch: 35 * DEG },
    note: 'side view of ws_1 looking north: chair must face its desk (to the right, +X)',
  },
  {
    name: '07-sofa-side',
    pose: { x: -2.52, z: 0.72, heading: 180 * DEG, pitch: 35 * DEG },
    note: 'side view of the sofa looking north: seat must face the TV (to the left, -X)',
  },
];
