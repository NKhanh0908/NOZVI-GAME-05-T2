import raw from './office-layout.json';

export type Vec2 = { x: number; z: number };
export type Aabb = { x: number; z: number; w: number; d: number };
export type Vec3 = [number, number, number];
export type Collider = Aabb & { id: string; kind: string };
export type LayoutBox = {
  id: string;
  type: string;
  position: Vec3;
  size: Vec3;
  material?: string;
  rotY?: number;
  /** Sub-parts of an item (for example the TV's screen and speakers). */
  components?: LayoutBox[];
};
export type Workstation = {
  id: string;
  seat: { id: string; position: Vec3; rotY: number };
  interactionPoint: Vec3;
};
export type SeatSocket = { id: string; position: Vec3; rotY: number; interactionPoint: Vec3 };
export type Interactable = {
  id: string;
  type: string;
  itemId: string;
  position: Vec3;
  interactionPoint: Vec3;
  interactionRange: number;
  workstationId?: string;
};
export type OfficeLayout = {
  room: { width: number; depth: number; height: number };
  palette: Record<string, string>;
  zones: { id: string; bounds: { minX: number; maxX: number; minZ: number; maxZ: number } }[];
  walls: LayoutBox[];
  items: LayoutBox[];
  workstations: Workstation[];
  interactables: Interactable[];
  sofaSeats: SeatSocket[];
  colliders: Collider[];
  spawn: { zone: string; position: Vec3; rotY: number };
  /** Shell windows, drawn as frames and glass (T-1151); collision uses the walls only. */
  windows: LayoutWindow[];
  /** Floor tile edge length in metres (`shell.floor.tileSize`, default 0.6). */
  floorTileSize: number;
};

export type LayoutWindow = { id: string; wall: string; position: Vec3; size: Vec3 };

function fail(msg: string): never {
  throw new Error(`Invalid layout: ${msg}`);
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function parseLayout(input: unknown): OfficeLayout {
  if (!isRecord(input)) fail('not an object');
  const room = input.room;
  if (!isRecord(room) || !isRecord(room.dimensions)) fail('missing room.dimensions');
  const dims = room.dimensions as { width: number; depth: number; height: number };
  const required = [
    'palette',
    'zones',
    'walls',
    'items',
    'workstations',
    'colliders',
    'spawn',
    'interactables',
  ];
  for (const key of required) if (!(key in input)) fail(`missing ${key}`);
  const workstations = (input.workstations as Record<string, unknown>[]).map((ws) => {
    const seat = ws.seatSocket as { id: string; position: Vec3; rotY: number };
    return {
      id: ws.id as string,
      seat: { id: seat.id, position: seat.position, rotY: seat.rotY },
      interactionPoint: ws.interactionPoint as Vec3,
    };
  });
  const interactables = (input.interactables as Record<string, unknown>[]).map((i) => {
    const out: Interactable = {
      id: i.id as string,
      type: i.type as string,
      itemId: i.itemId as string,
      position: i.position as Vec3,
      interactionPoint: i.interactionPoint as Vec3,
      interactionRange: i.interactionRange as number,
    };
    if (typeof i.workstationId === 'string') out.workstationId = i.workstationId;
    return out;
  });
  // Chairs also carry seatSockets (the workstation seats); only the sofa's belong here.
  const sofaSeats = (input.items as Record<string, unknown>[])
    .filter((item) => item.type === 'sofa' && Array.isArray(item.seatSockets))
    .flatMap((item) => item.seatSockets as SeatSocket[])
    .map((s) => ({
      id: s.id,
      position: s.position,
      rotY: s.rotY,
      interactionPoint: s.interactionPoint,
    }));
  return {
    room: { width: dims.width, depth: dims.depth, height: dims.height },
    palette: input.palette as Record<string, string>,
    zones: input.zones as OfficeLayout['zones'],
    walls: input.walls as LayoutBox[],
    items: input.items as LayoutBox[],
    floorTileSize:
      isRecord(input.shell) &&
      isRecord(input.shell.floor) &&
      typeof input.shell.floor.tileSize === 'number' &&
      input.shell.floor.tileSize > 0
        ? input.shell.floor.tileSize
        : 0.6,
    windows: (isRecord(input.shell) && Array.isArray(input.shell.windows)
      ? (input.shell.windows as Record<string, unknown>[])
      : []
    ).map((w) => ({
      id: w.id as string,
      wall: w.wall as string,
      position: w.position as Vec3,
      size: w.size as Vec3,
    })),
    workstations,
    interactables,
    sofaSeats,
    colliders: input.colliders as Collider[],
    spawn: input.spawn as OfficeLayout['spawn'],
  };
}

export const officeLayout: OfficeLayout = parseLayout(raw);
