import {
  BALANCE,
  officeLayout,
  type Activity,
  type LayoutBox,
  type OfficeLayout,
  type PlayerState,
  type Vec3,
} from '@office/protocol';

/** The furniture a seat belongs to; it sets where the seated avatar's hips go (T-1614). */
export type SeatKind = 'desk' | 'sofa';

/** A desk or sofa seat socket from the office layout. */
export type SeatSocket = {
  id: string;
  kind: SeatKind;
  position: Vec3;
  /** Degrees, as in the layout. */
  rotY: number;
  interactionPoint: Vec3;
};

const SOCKETS: ReadonlyMap<string, SeatSocket> = new Map<string, SeatSocket>([
  ...officeLayout.workstations.map((w): [string, SeatSocket] => [
    w.seat.id,
    { ...w.seat, kind: 'desk', interactionPoint: w.interactionPoint },
  ]),
  ...officeLayout.sofaSeats.map((s): [string, SeatSocket] => [s.id, { ...s, kind: 'sofa' }]),
]);

/** The socket of a replicated `seatId`, or null for '' and unknown ids. */
export function seatSocket(seatId: string): SeatSocket | null {
  return SOCKETS.get(seatId) ?? null;
}

/** The pose an employee on `socket` has (heading in radians), as the server sets it. */
export function seatPose(socket: SeatSocket): PlayerState {
  return {
    x: socket.position[0],
    z: socket.position[2],
    heading: (socket.rotY * Math.PI) / 180,
  };
}

const ACTIVITIES: ReadonlySet<string> = new Set<Activity>([
  'idle',
  'walking',
  'sitting',
  'working',
  'resting',
  'drinking',
  'waving',
  'brewing',
]);

/** A replicated activity string as an `Activity`; unknown values read as idle. */
export function toActivity(value: string): Activity {
  return ACTIVITIES.has(value) ? (value as Activity) : 'idle';
}

/** The furniture a seated employee puts the cup on: the desk, or the sofa's coffee table. */
const REST_TYPE = { desk: 'desk', sofa: 'coffee_table' } as const;
const restSpots = new Map<string, Vec3 | null>();

/**
 * REQ-INT-003 (T-1154): where a seated employee's cup stands, in world coordinates: on top
 * of the nearest desk (desk seat) or coffee table (sofa seat), `BALANCE.coffeeView.rest.inset`
 * past the edge the seat faces and `side` to the seat's right, kept `margin` inside the top.
 * Layout boxes are axis-aligned (sizes are world extents). Null for '' and unknown seats.
 */
export function cupRestSpot(seatId: string, layout: OfficeLayout = officeLayout): Vec3 | null {
  const cached = layout === officeLayout ? restSpots.get(seatId) : undefined;
  if (cached !== undefined) return cached;
  const spot = computeRestSpot(seatId, layout);
  if (layout === officeLayout) restSpots.set(seatId, spot);
  return spot;
}

function computeRestSpot(seatId: string, layout: OfficeLayout): Vec3 | null {
  const socket = seatSocket(seatId);
  if (!socket) return null;
  const [sx, , sz] = socket.position;
  const type = REST_TYPE[socket.kind];
  let box: LayoutBox | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const item of layout.items) {
    if (item.type !== type) continue;
    const d = Math.hypot(item.position[0] - sx, item.position[2] - sz);
    if (d < best) [box, best] = [item, d];
  }
  if (!box) return null;
  const { inset, side, margin } = BALANCE.coffeeView.rest;
  const [cx, cy, cz] = box.position;
  const [w, h, d] = box.size;
  const [minX, maxX, minZ, maxZ] = [cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2];
  const heading = (socket.rotY * Math.PI) / 180;
  const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
  // The avatar's right when facing (fx, fz) (three.js: a model facing +z has its right at -x).
  const [rx, rz] = [-fz, fx];
  const t = entryDistance(sx, sz, fx, fz, minX, maxX, minZ, maxZ) ?? 0;
  const clamp = (v: number, lo: number, hi: number) =>
    lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
  return [
    clamp(sx + fx * (t + inset) + rx * side, minX + margin, maxX - margin),
    cy + h / 2,
    clamp(sz + fz * (t + inset) + rz * side, minZ + margin, maxZ - margin),
  ];
}

/** Distance along the ray (x, z) + t (fx, fz) where it enters the box; null when it misses. */
function entryDistance(
  x: number,
  z: number,
  fx: number,
  fz: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): number | null {
  let near = 0;
  let far = Number.POSITIVE_INFINITY;
  for (const [p, f, lo, hi] of [
    [x, fx, minX, maxX],
    [z, fz, minZ, maxZ],
  ] as const) {
    if (Math.abs(f) < 1e-9) {
      if (p < lo || p > hi) return null;
      continue;
    }
    const [a, b] = [(lo - p) / f, (hi - p) / f];
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  return near <= far ? near : null;
}
