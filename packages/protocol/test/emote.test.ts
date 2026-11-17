import { describe, expect, it } from 'vitest';
import {
  EMOTES,
  canEmote,
  emoteContinues,
  emotePosture,
  isEmoteId,
  toEmote,
  type Activity,
} from '../src/activity';
import { BALANCE } from '../src/balance';

const ALL: readonly Activity[] = [
  'idle',
  'walking',
  'sitting',
  'working',
  'resting',
  'drinking',
  'waving',
  'brewing',
];

describe('emote list (REQ-AVATAR-004, DECISIONS 2026-11-17)', () => {
  it('holds the five owner-approved emotes, wave included', () => {
    expect(EMOTES).toEqual(['wave', 'dance', 'think', 'laugh', 'stretch']);
  });
  it('recognises listed ids only', () => {
    for (const id of EMOTES) expect(isEmoteId(id)).toBe(true);
    for (const v of ['', 'Wave', 'cry', 3, null, undefined, ['wave']]) {
      expect(isEmoteId(v)).toBe(false);
    }
    expect(toEmote('dance')).toBe('dance');
    expect(toEmote('')).toBe('');
    expect(toEmote('cry')).toBe('');
  });
});

describe('BALANCE.emote', () => {
  it('holds a positive duration for every emote and the minimum gap', () => {
    const { durationSeconds, minGapSeconds } = BALANCE.emote;
    expect(Object.keys(durationSeconds).sort()).toEqual([...EMOTES].sort());
    for (const id of EMOTES) expect(durationSeconds[id]).toBeGreaterThan(0);
    expect(minGapSeconds).toBeGreaterThan(0);
  });
  it('keeps the wave emote as long as the legacy wave', () => {
    expect(BALANCE.emote.durationSeconds.wave).toBe(BALANCE.activity.waveSeconds);
  });
});

describe('emote allowed states (T-1220)', () => {
  it('allows every emote while standing', () => {
    for (const a of ['idle', 'walking'] as const) {
      for (const id of EMOTES) expect(canEmote(a, id)).toBe(true);
    }
  });
  it('allows every emote but dance while seated', () => {
    for (const a of ['sitting', 'working', 'resting'] as const) {
      for (const id of EMOTES) expect(canEmote(a, id)).toBe(id !== 'dance');
    }
  });
  it('refuses emotes while drinking, waving or brewing', () => {
    for (const a of ['drinking', 'waving', 'brewing'] as const) {
      for (const id of EMOTES) expect(canEmote(a, id)).toBe(false);
    }
  });
  it('binds an emote to its posture', () => {
    expect(emotePosture('walking')).toBe('standing');
    expect(emotePosture('working')).toBe('working');
    expect(emotePosture('brewing')).toBeNull();
    expect(emoteContinues('idle', 'walking')).toBe(true);
    expect(emoteContinues('walking', 'idle')).toBe(true);
    expect(emoteContinues('sitting', 'sitting')).toBe(true);
    expect(emoteContinues('sitting', 'working')).toBe(false);
    expect(emoteContinues('working', 'idle')).toBe(false);
    expect(emoteContinues('idle', 'sitting')).toBe(false);
    for (const a of ['drinking', 'waving', 'brewing'] as const) {
      expect(emoteContinues('idle', a)).toBe(false);
    }
    for (const a of ALL) expect(emoteContinues('brewing', a)).toBe(false);
  });
});
