import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BALANCE, officeLayout } from '@office/protocol';
import { deskProps } from '../src/game/assets/deskProps';
import { DeskScreens } from '../src/game/desk/DeskScreens';
import { deskBySeat, deskScreenStates, screenStateFor } from '../src/game/desk/screenState';
import { ScreenTextures, type CanvasFactory } from '../src/game/desk/screenTextures';
import type { OccupancyRoom } from '../src/net';

// REQ-INT-002 (T-1155): monitors and lamps follow the replicated seat and activity.

/** A 2D canvas whose context accepts every call and records how many times it was used. */
function fakeCanvases(): { factory: CanvasFactory; calls: () => number } {
  let calls = 0;
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) =>
      key in target
        ? target[key]
        : () => {
            calls++;
          },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  return {
    factory: (width, height) => ({
      width,
      height,
      getContext: () => ctx as unknown as CanvasRenderingContext2D,
    }),
    calls: () => calls,
  };
}

type Employee = { seatId: string; activity: string };
function room(employees: Record<string, Employee>): OccupancyRoom {
  return {
    state: {
      employees: {
        forEach: (cb: (e: Employee, id: string) => void) =>
          Object.entries(employees).forEach(([id, e]) => cb(e, id)),
      },
    },
  };
}

const seats = deskBySeat(officeLayout);
const sofaSeat = officeLayout.sofaSeats[0]!.id;

describe('screen state (T-1155)', () => {
  it('is off when empty, locked when seated and desktop when working', () => {
    expect(screenStateFor(null)).toBe('off');
    expect(screenStateFor('sitting')).toBe('locked');
    expect(screenStateFor('drinking')).toBe('locked');
    expect(screenStateFor('working')).toBe('desktop');
  });

  it('derives every desk from replicated state, local and remote employees alike', () => {
    expect(seats.get('ws_7_seat')).toBe('ws_7_desk');
    const scene = (local: Employee, remote: Employee) =>
      deskScreenStates(
        room({
          local,
          remote,
          walker: { seatId: '', activity: 'walking' },
          sofa: { seatId: sofaSeat, activity: 'resting' },
        }),
        seats,
      );
    // The same occupant gives the same state whether it is the local or a remote employee.
    for (const [activity, expected] of [
      ['sitting', 'locked'],
      ['working', 'desktop'],
    ] as const) {
      const asLocal = scene(
        { seatId: 'ws_7_seat', activity },
        { seatId: 'ws_1_seat', activity: 'sitting' },
      );
      const asRemote = scene(
        { seatId: 'ws_1_seat', activity: 'sitting' },
        { seatId: 'ws_7_seat', activity },
      );
      expect(asLocal.get('ws_7_desk')).toBe(expected);
      expect(asRemote.get('ws_7_desk')).toBe(expected);
      expect(asLocal.get('ws_1_desk')).toBe('locked');
    }
    const states = scene({ seatId: '', activity: 'idle' }, { seatId: '', activity: 'idle' });
    expect(states.size).toBe(officeLayout.workstations.length);
    expect([...states.values()].every((s) => s === 'off')).toBe(true);
  });
});

describe('DeskScreens view (T-1155)', () => {
  const make = () => {
    const canvases = fakeCanvases();
    return { view: new DeskScreens(deskProps(officeLayout), canvases.factory), canvases };
  };

  it('shows each desk state with one shared texture per state and lights working lamps', () => {
    const { view } = make();
    expect(view.deskIds).toHaveLength(officeLayout.workstations.length);
    view.follow(room({}), 0);
    expect(view.info('ws_7_desk')).toMatchObject({ state: 'off', lampLit: false });
    view.follow(
      room({
        a: { seatId: 'ws_7_seat', activity: 'working' },
        b: { seatId: 'ws_1_seat', activity: 'working' },
        c: { seatId: 'ws_2_seat', activity: 'sitting' },
      }),
      0,
    );
    const a = view.info('ws_7_desk')!;
    const b = view.info('ws_1_desk')!;
    expect(a).toMatchObject({ state: 'desktop', lampLit: true, screenDrawn: true });
    expect(b.texture).toBe(a.texture);
    expect(a.texture).toBe(view.textures.desktop.uuid);
    expect(view.info('ws_2_desk')).toMatchObject({ state: 'locked', lampLit: false });
    expect(view.info('ws_2_desk')!.texture).toBe(view.textures.locked.uuid);
    // One InstancedMesh per state: the two desktop desks are two instances of one mesh.
    const meshes = view.group.children as THREE.InstancedMesh[];
    const desktopMeshes = meshes.filter(
      (m) => (m.material as THREE.MeshBasicMaterial).map === view.textures.desktop,
    );
    expect(desktopMeshes).toHaveLength(1);
    expect(desktopMeshes[0]!.count).toBe(2);
    const litLamps = meshes.filter(
      (m) => m.visible && (m.material as THREE.MeshStandardMaterial).emissiveIntensity > 0,
    );
    expect(litLamps.reduce((n, m) => n + m.count, 0)).toBe(2);
    view.follow(room({ a: { seatId: 'ws_7_seat', activity: 'sitting' } }), 0);
    expect(view.info('ws_7_desk')).toMatchObject({ state: 'locked', lampLit: false });
    expect(view.info('ws_1_desk')).toMatchObject({ state: 'off' });
    view.dispose();
  });

  it('puts the screen quad on the monitor panel, facing the seat', () => {
    const { view } = make();
    view.follow(room({ a: { seatId: 'ws_7_seat', activity: 'working' } }), 0);
    const mesh = (view.group.children as THREE.InstancedMesh[]).find(
      (m) => (m.material as THREE.MeshBasicMaterial).map === view.textures.desktop,
    )!;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const centre = new THREE.Vector3().setFromMatrixPosition(m);
    const box = officeLayout.items
      .find((i) => i.id === 'ws_7_desk')!
      .components!.find((c) => c.type === 'computer')!;
    // Inside the monitor's layout box (ws_7 computer at 1.26, 1.02, 3.72; 0.12 x 0.5 x 0.55).
    for (const k of [0, 1, 2] as const) {
      expect(Math.abs(centre.getComponent(k) - box.position[k])).toBeLessThan(box.size[k] / 2);
    }
    // The quad's normal points at the seat (ws_7 seat is at x 0.66, west of the desk).
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(m);
    expect(normal.x).toBeLessThan(-0.9);
    view.dispose();
  });

  it('redraws the shared desktop texture at most once per second, only while shown', () => {
    const { view, canvases } = make();
    const textures = view.textures;
    view.follow(room({}), 0);
    expect(textures.redraws).toBe(0);
    const working = room({ a: { seatId: 'ws_7_seat', activity: 'working' } });
    for (let t = 0; t < 1000; t += 16) view.follow(working, 5000 + t);
    expect(textures.redraws).toBe(1);
    view.follow(working, 6000);
    expect(textures.redraws).toBe(2);
    for (let t = 6000; t <= 9000; t += 16) view.follow(working, t);
    // 7008 and 8016: never two paints less than a second apart.
    expect(textures.redraws).toBe(4);
    expect(canvases.calls()).toBeGreaterThan(0);
    view.dispose();
  });

  it('bumps the texture version on each redraw and never faster than redrawSeconds', () => {
    const textures = new ScreenTextures(fakeCanvases().factory);
    const period = BALANCE.deskScreen.redrawSeconds * 1000;
    const v0 = textures.desktop.version;
    expect(textures.update(0, true)).toBe(true);
    expect(textures.update(period - 1, true)).toBe(false);
    expect(textures.update(period, false)).toBe(false);
    expect(textures.update(period, true)).toBe(true);
    expect(textures.desktop.version).toBe(v0 + 2);
    textures.dispose();
  });
});
