import { expect, it } from 'vitest';
import { BALANCE } from '@office/protocol';
import { CoffeeSteam } from '../src/game/coffeeSteam';

it('shows rising steam above the machine only while someone brews (T-1154)', () => {
  const steam = new CoffeeSteam([2.89, 1.13, -4.2]);
  expect(steam.visible).toBe(false);
  expect(steam.points.position.y).toBeCloseTo(1.13 + BALANCE.coffeeView.steam.aboveMachine);
  steam.update(0.1, true);
  expect(steam.visible).toBe(true);
  const ys = () => {
    const p = steam.points.geometry.getAttribute('position');
    return Array.from({ length: p.count }, (_, i) => p.getY(i));
  };
  const before = ys();
  expect(before).toHaveLength(BALANCE.coffeeView.steam.puffs);
  for (const y of before) {
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(BALANCE.coffeeView.steam.height);
  }
  steam.update(0.05, true);
  expect(ys()).not.toEqual(before);
  steam.update(0.05, false);
  expect(steam.visible).toBe(false);
  steam.dispose();
});
