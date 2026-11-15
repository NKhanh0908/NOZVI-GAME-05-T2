import { expect, it } from 'vitest';
import { CommandRateLimiter } from '../src/commandRateLimiter';

it('allows 5 commands per 10 s per key and reports the wait for the next one', () => {
  let t = 0;
  const limiter = new CommandRateLimiter(5, 10_000, () => t);
  for (let i = 0; i < 5; i++) {
    expect(limiter.tryUse('a')).toBe(0);
    t += 1000;
  }
  expect(limiter.tryUse('a')).toBe(5000);
  expect(limiter.tryUse('b')).toBe(0);
  t = 10_000;
  expect(limiter.tryUse('a')).toBe(0);
  limiter.forget('a');
  for (let i = 0; i < 5; i++) expect(limiter.tryUse('a')).toBe(0);
});
