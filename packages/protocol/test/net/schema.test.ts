import { describe, expect, it } from 'vitest';
import { Decoder, Encoder } from '@colyseus/schema';
import { EmployeeState, OfficeState, readTv } from '../../src/net/schema';

describe('net schema', () => {
  it('has the documented defaults', () => {
    const e = new EmployeeState();
    expect(e.activity).toBe('idle');
    expect(e.seatId).toBe('');
    expect(e.connected).toBe(true);
    expect(e.lastSeq).toBe(0);
    expect(e.item).toBe('');
    expect(e.sips).toBe(0);
  });
  it('replicates item and sips, including the cup being emptied (REQ-INT-003)', () => {
    const state = new OfficeState();
    const e = new EmployeeState();
    Object.assign(e, { name: 'An', avatarId: 'men_suit', activity: 'brewing' });
    state.employees.set('s1', e);
    const encoder = new Encoder(state);
    const decoded = new OfficeState();
    const decoder = new Decoder(decoded);
    decoder.decode(encoder.encodeAll());
    encoder.discardChanges();
    expect(decoded.employees.get('s1')!.activity).toBe('brewing');

    Object.assign(e, { activity: 'idle', item: 'coffee', sips: 3 });
    decoder.decode(encoder.encode());
    encoder.discardChanges();
    expect(decoded.employees.get('s1')).toMatchObject({ item: 'coffee', sips: 3 });

    Object.assign(e, { item: '', sips: 0 });
    decoder.decode(encoder.encode());
    expect(decoded.employees.get('s1')).toMatchObject({ item: '', sips: 0 });
  });
  it('round-trips an employee through the encoder with exact float64 positions', () => {
    const state = new OfficeState();
    const e = new EmployeeState();
    Object.assign(e, {
      name: 'An',
      avatarId: 'men_suit',
      x: 0.1 + 0.2,
      z: -3.3333333333333335,
      heading: Math.PI / 3,
      lastSeq: 42,
    });
    state.employees.set('s1', e);
    const encoder = new Encoder(state);
    const decoded = new OfficeState();
    new Decoder(decoded).decode(encoder.encodeAll());
    const d = decoded.employees.get('s1')!;
    expect(d.name).toBe('An');
    expect(Object.is(d.x, 0.1 + 0.2)).toBe(true);
    expect(Object.is(d.z, -3.3333333333333335)).toBe(true);
    expect(d.heading).toBe(Math.PI / 3);
    expect(d.lastSeq).toBe(42);
    expect(d.connected).toBe(true);
  });
});

describe('SharedTVState (REQ-TV-004)', () => {
  it('defaults to idle with null video and controller', () => {
    const state = new OfficeState();
    expect(readTv(state.tv)).toEqual({
      videoId: null,
      provider: 'youtube',
      status: 'idle',
      currentTime: 0,
      updatedAt: 0,
      controllerSessionId: null,
    });
  });
  it('replicates all six fields through an encode/decode round trip, including a clear', () => {
    const state = new OfficeState();
    Object.assign(state.tv, {
      videoId: 'dQw4w9WgXcQ',
      status: 'paused',
      currentTime: 12.345678901234,
      updatedAt: 1_794_000_000_123.5,
      controllerSessionId: 'sess-A',
    });
    const encoder = new Encoder(state);
    const decoded = new OfficeState();
    const decoder = new Decoder(decoded);
    decoder.decode(encoder.encodeAll());
    encoder.discardChanges();
    expect(readTv(decoded.tv)).toEqual({
      videoId: 'dQw4w9WgXcQ',
      provider: 'youtube',
      status: 'paused',
      currentTime: 12.345678901234,
      updatedAt: 1_794_000_000_123.5,
      controllerSessionId: 'sess-A',
    });

    Object.assign(state.tv, {
      videoId: null,
      status: 'idle',
      currentTime: 0,
      controllerSessionId: null,
    });
    decoder.decode(encoder.encode());
    expect(readTv(decoded.tv)).toMatchObject({
      videoId: null,
      status: 'idle',
      currentTime: 0,
      controllerSessionId: null,
    });
  });
  it('readTv maps an unknown status to idle', () => {
    expect(readTv({ provider: 'youtube', status: 'x', currentTime: 1, updatedAt: 2 }).status).toBe(
      'idle',
    );
  });
});
