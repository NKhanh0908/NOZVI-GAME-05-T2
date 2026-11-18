import { describe, expect, it } from 'vitest';
import { renderQuality } from '../src/game/renderQuality';

describe('renderQuality', () => {
  it('defaults to high when the variable is unset or empty', () => {
    expect(renderQuality({})).toBe('high');
    expect(renderQuality({ VITE_RENDER_QUALITY: undefined })).toBe('high');
    expect(renderQuality({ VITE_RENDER_QUALITY: '' })).toBe('high');
  });

  it('selects e2e, ignoring case and surrounding whitespace', () => {
    expect(renderQuality({ VITE_RENDER_QUALITY: 'e2e' })).toBe('e2e');
    expect(renderQuality({ VITE_RENDER_QUALITY: ' E2E ' })).toBe('e2e');
  });

  it('keeps high for high and for unknown values', () => {
    expect(renderQuality({ VITE_RENDER_QUALITY: 'high' })).toBe('high');
    expect(renderQuality({ VITE_RENDER_QUALITY: 'low' })).toBe('high');
    expect(renderQuality({ VITE_RENDER_QUALITY: 'e2e-x' })).toBe('high');
  });
});
