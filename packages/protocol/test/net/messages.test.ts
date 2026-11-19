import { describe, expect, it } from 'vitest';
import {
  MAX_SEQ,
  SEAT_IDS,
  parseInput,
  parseIntent,
  parseJoinOptions,
  parseTvCommand,
  parseTvTimeReply,
  parseTvTimeRequest,
} from '../../src/net/messages';
import { EMOTES } from '../../src/activity';
import { officeLayout } from '../../src/layout/layout';
import { PROTOCOL_VERSION } from '../../src/version';

const input = { seq: 7, forward: 1, right: -0.5, run: false, yaw: 1.2 };
const deskSeat = officeLayout.workstations[0]!.seat.id;

describe('parseInput', () => {
  it('accepts a valid payload and returns a clean copy', () => {
    expect(parseInput({ ...input, extra: 'x' })).toEqual(input);
    expect(parseInput({ ...input, seq: 0, forward: -1, right: 1 })).not.toBeNull();
    expect(parseInput({ ...input, seq: MAX_SEQ })).not.toBeNull();
  });
  it.each([
    ['NaN forward', { forward: NaN }],
    ['Infinity right', { right: Infinity }],
    ['NaN yaw', { yaw: NaN }],
    ['-Infinity yaw', { yaw: -Infinity }],
    ['forward > 1', { forward: 1.01 }],
    ['right < -1', { right: -2 }],
    ['non-integer seq', { seq: 1.5 }],
    ['negative seq', { seq: -1 }],
    ['seq above uint32', { seq: MAX_SEQ + 1 }],
    ['string seq', { seq: '3' }],
    ['non-boolean run', { run: 1 }],
    ['missing yaw', { yaw: undefined }],
  ])('rejects %s', (_label, patch) => {
    expect(parseInput({ ...input, ...patch })).toBeNull();
  });
  it('rejects non-objects', () => {
    for (const raw of [null, undefined, 3, 'input', [input]]) expect(parseInput(raw)).toBeNull();
  });
});

describe('parseIntent', () => {
  it('accepts every intent type', () => {
    expect(parseIntent({ type: 'sit', seatId: deskSeat })).toEqual({
      type: 'sit',
      seatId: deskSeat,
    });
    for (const type of ['stand', 'toggleWork', 'drink', 'wave', 'brew']) {
      expect(parseIntent({ type })).toEqual({ type });
    }
  });
  it('accepts an emote intent for every listed emote id (REQ-AVATAR-004)', () => {
    for (const emote of EMOTES) {
      expect(parseIntent({ type: 'emote', emote })).toEqual({ type: 'emote', emote });
    }
  });
  it.each([
    ['an unknown emote id', { type: 'emote', emote: 'cry' }],
    ['a missing emote id', { type: 'emote' }],
    ['an empty emote id', { type: 'emote', emote: '' }],
    ['a wrongly cased emote id', { type: 'emote', emote: 'Wave' }],
    ['a non-string emote id', { type: 'emote', emote: 1 }],
    ['an array emote id', { type: 'emote', emote: ['wave'] }],
    ['an emote with a seat id', { type: 'emote', emote: 'wave', seatId: deskSeat }],
    ['free text in place of an id', { type: 'emote', emote: 'hello everyone' }],
    ['an emote id on another intent', { type: 'wave', emote: 'dance' }],
    ['an emote id on sit', { type: 'sit', seatId: deskSeat, emote: 'dance' }],
  ])('rejects %s', (_label, raw) => {
    expect(parseIntent(raw)).toBeNull();
  });
  it('knows desk and sofa seats from the layout', () => {
    expect(SEAT_IDS.size).toBe(officeLayout.workstations.length + officeLayout.sofaSeats.length);
    const sofa = officeLayout.sofaSeats[0]!.id;
    expect(parseIntent({ type: 'sit', seatId: sofa })).not.toBeNull();
  });
  it('rejects unknown types and unknown or missing seat ids', () => {
    expect(parseIntent({ type: 'fly' })).toBeNull();
    expect(parseIntent({ type: 'sit' })).toBeNull();
    expect(parseIntent({ type: 'sit', seatId: 'no_such_seat' })).toBeNull();
    expect(parseIntent({ type: 'sit', seatId: 3 })).toBeNull();
    expect(parseIntent({ type: 'stand', seatId: deskSeat })).toBeNull();
    expect(parseIntent(null)).toBeNull();
  });
});

describe('parseJoinOptions', () => {
  const ok = {
    name: '  An ',
    officeCode: 'test-01',
    avatarId: 'men_suit',
    protocolVersion: PROTOCOL_VERSION,
  };
  it('normalizes a valid join', () => {
    expect(parseJoinOptions(ok)).toEqual({
      ok: true,
      value: {
        name: 'An',
        officeCode: 'TEST-01',
        avatarId: 'men_suit',
        protocolVersion: PROTOCOL_VERSION,
      },
    });
  });
  it('rejects a wrong protocol version first', () => {
    expect(parseJoinOptions({ ...ok, protocolVersion: 1 })).toEqual({
      ok: false,
      error: 'version_mismatch',
    });
    expect(parseJoinOptions({ ...ok, name: '', protocolVersion: undefined })).toEqual({
      ok: false,
      error: 'version_mismatch',
    });
  });
  it.each([
    ['empty name', { name: '   ' }],
    ['markup name', { name: '<b>x</b>' }],
    ['short code', { officeCode: 'abc' }],
    ['bad code chars', { officeCode: 'AB CD' }],
    ['unknown avatar', { avatarId: 'robot' }],
    ['non-string name', { name: 42 }],
  ])('rejects %s as invalid_identity', (_label, patch) => {
    expect(parseJoinOptions({ ...ok, ...patch })).toEqual({ ok: false, error: 'invalid_identity' });
  });
});

describe('parseTvCommand (REQ-TV-005)', () => {
  it.each([
    [{ type: 'load', videoId: 'dQw4w9WgXcQ' }],
    [{ type: 'load', videoId: 'a-b_C1234_Z' }],
    [{ type: 'play' }],
    [{ type: 'pause' }],
    [{ type: 'seek', time: 0 }],
    [{ type: 'seek', time: 93.25 }],
    [{ type: 'stop' }],
  ])('accepts %j', (cmd) => {
    expect(parseTvCommand(cmd)).toEqual(cmd);
  });
  it('returns a clean copy without extra fields', () => {
    expect(parseTvCommand({ type: 'play', extra: 1 })).toEqual({ type: 'play' });
  });
  it.each([
    ['unknown type', { type: 'close' }],
    ['missing type', {}],
    ['numeric type', { type: 1 }],
    ['NaN seek', { type: 'seek', time: NaN }],
    ['Infinity seek', { type: 'seek', time: Infinity }],
    ['negative seek', { type: 'seek', time: -0.1 }],
    ['string seek', { type: 'seek', time: '5' }],
    ['missing seek time', { type: 'seek' }],
    ['short id', { type: 'load', videoId: 'abc' }],
    ['long id', { type: 'load', videoId: 'dQw4w9WgXcQx' }],
    ['id with bad char', { type: 'load', videoId: 'dQw4w9WgX.Q' }],
    ['url instead of id', { type: 'load', videoId: 'https://youtu.be/dQw4w9WgXcQ' }],
    ['missing id', { type: 'load' }],
    ['play with time', { type: 'play', time: 3 }],
    ['stop with id', { type: 'stop', videoId: 'dQw4w9WgXcQ' }],
  ])('rejects %s', (_label, raw) => {
    expect(parseTvCommand(raw)).toBeNull();
  });
  it('rejects non-objects', () => {
    for (const raw of [null, undefined, 'play', 3, [{ type: 'play' }]]) {
      expect(parseTvCommand(raw)).toBeNull();
    }
  });
});

describe('tv_time clock sample messages (OQ-023, T-1567)', () => {
  it('accepts a request with an integer id and returns a clean copy', () => {
    expect(parseTvTimeRequest({ id: 0 })).toEqual({ id: 0 });
    expect(parseTvTimeRequest({ id: MAX_SEQ, extra: 'x' })).toEqual({ id: MAX_SEQ });
  });
  it.each([
    ['missing id', {}],
    ['negative id', { id: -1 }],
    ['fractional id', { id: 1.5 }],
    ['id above MAX_SEQ', { id: MAX_SEQ + 1 }],
    ['string id', { id: '1' }],
    ['NaN id', { id: NaN }],
    ['null', null],
    ['undefined', undefined],
    ['array', [{ id: 1 }]],
    ['number', 1],
  ])('rejects a request with %s', (_label, raw) => {
    expect(parseTvTimeRequest(raw)).toBeNull();
  });
  it('accepts a reply with an id and a finite positive server time', () => {
    expect(parseTvTimeReply({ id: 3, serverNow: 1_794_000_000_000, x: 1 })).toEqual({
      id: 3,
      serverNow: 1_794_000_000_000,
    });
  });
  it.each([
    ['missing serverNow', { id: 1 }],
    ['zero serverNow', { id: 1, serverNow: 0 }],
    ['infinite serverNow', { id: 1, serverNow: Infinity }],
    ['string serverNow', { id: 1, serverNow: '5' }],
    ['bad id', { id: -1, serverNow: 5 }],
    ['non-object', 'tv_time'],
  ])('rejects a reply with %s', (_label, raw) => {
    expect(parseTvTimeReply(raw)).toBeNull();
  });
});
