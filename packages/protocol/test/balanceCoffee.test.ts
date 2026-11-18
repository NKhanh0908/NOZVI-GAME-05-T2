import { expect, it } from 'vitest';
import { BALANCE } from '../src/balance';

it('BALANCE.coffee holds the Phase 4.1 defaults (plan §3.4, §6.2)', () => {
  expect(BALANCE.coffee).toEqual({ brewSeconds: 4, sips: 3 });
  // A sip reuses the drink timer.
  expect(BALANCE.activity.drinkSeconds).toBe(2.5);
});
