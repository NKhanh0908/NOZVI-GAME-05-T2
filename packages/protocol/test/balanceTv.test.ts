import { expect, it } from 'vitest';
import { BALANCE } from '../src/balance';

it('BALANCE.tv holds the Phase 4 tuning values (plan §3.1)', () => {
  expect(BALANCE.tv).toEqual({
    ignoreBelowSeconds: 0.5,
    hardSeekAboveSeconds: 1,
    nudgeRate: 0.05,
    nudgeMaxSeconds: 2,
    convergenceSeconds: 5,
    driftTargetSeconds: 1.0,
    rateLimitCommands: 5,
    rateLimitWindowSeconds: 10,
  });
});
