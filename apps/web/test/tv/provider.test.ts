import { describe, expect, it } from 'vitest';
import { isYouTubeId } from '@office/protocol';
import {
  CATALOG,
  FakeVideoProvider,
  YouTubeProvider,
  parseYouTubeUrl,
  type VideoProvider,
} from '../../src/tv/provider';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeUrl (REQ-TV-003)', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=42s&list=PL123`],
    [`http://m.youtube.com/watch?feature=share&v=${ID}`],
    [`www.youtube.com/watch?v=${ID}`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=abc&t=10`],
    [`https://www.youtube.com/embed/${ID}?autoplay=1`],
    [`https://www.youtube-nocookie.com/embed/${ID}`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/live/${ID}`],
    [`  ${ID}  `],
  ])('extracts the id from %s', (text) => {
    expect(parseYouTubeUrl(text)).toBe(ID);
  });
  it.each([
    ['another host', `https://vimeo.com/watch?v=${ID}`],
    ['look-alike host', `https://youtube.com.evil.example/watch?v=${ID}`],
    ['short id', 'https://youtu.be/abc'],
    ['long id', `https://www.youtube.com/watch?v=${ID}X`],
    ['bad char', 'https://www.youtube.com/watch?v=dQw4w9WgX.Q'],
    ['missing v', 'https://www.youtube.com/watch?x=1'],
    ['channel page', 'https://www.youtube.com/@blender'],
    ['extra path', `https://youtu.be/${ID}/more`],
    ['javascript url', `javascript:alert('${ID}')`],
    ['empty', ''],
    ['garbage', 'not a url at all'],
  ])('rejects %s', (_label, text) => {
    expect(parseYouTubeUrl(text)).toBeNull();
  });
});

/** Consumer code written once against the interface (criterion 3). */
function pickFirstMatch(provider: VideoProvider, query: string) {
  const [first] = provider.search(query);
  if (!first) return null;
  return {
    item: provider.getVideo(first.id),
    embed: provider.getEmbedUrl(first.id),
    pasted: provider.parseInput(first.sourceUrl),
  };
}

describe('VideoProvider (REQ-TV-007)', () => {
  const yt = new YouTubeProvider(CATALOG, () => 'http://localhost:5173');

  it('ships 6 to 10 embeddable catalog videos with valid ids', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(6);
    expect(CATALOG.length).toBeLessThanOrEqual(10);
    for (const v of CATALOG) {
      expect(isYouTubeId(v.id)).toBe(true);
      expect(v.embeddable).toBe(true);
      expect(v.provider).toBe('youtube');
      expect(parseYouTubeUrl(v.sourceUrl)).toBe(v.id);
    }
    expect(new Set(CATALOG.map((v) => v.id)).size).toBe(CATALOG.length);
  });

  it('search filters the catalog by title, case-insensitively; empty returns all', () => {
    expect(yt.search('sintel').map((v) => v.title)).toEqual(['Sintel']);
    expect(yt.search('  BUNNY ')).toHaveLength(1);
    expect(yt.search('')).toHaveLength(CATALOG.length);
    expect(yt.search('no such video')).toEqual([]);
    expect(new FakeVideoProvider().search('cafe').map((v) => v.id)).toEqual(['CCCCCCCCCCC']);
  });

  it('getVideo returns a catalog item or null', () => {
    expect(yt.getVideo(CATALOG[0]!.id)).toEqual(CATALOG[0]);
    expect(yt.getVideo(ID)).toBeNull();
  });

  it('getEmbedUrl builds the youtube embed URL with enablejsapi=1', () => {
    const url = new URL(yt.getEmbedUrl(ID)!);
    expect(url.origin + url.pathname).toBe(`https://www.youtube.com/embed/${ID}`);
    expect(url.searchParams.get('enablejsapi')).toBe('1');
    expect(url.searchParams.get('origin')).toBe('http://localhost:5173');
    expect(yt.getEmbedUrl('bad')).toBeNull();
  });

  it('runs the same consumer code against YouTubeProvider and the test double', () => {
    for (const [provider, query] of [
      [yt, 'tears'],
      [new FakeVideoProvider(), 'bravo'],
    ] as const) {
      const r = pickFirstMatch(provider, query)!;
      expect(r.item).not.toBeNull();
      expect(r.embed).toContain(r.item!.id);
      expect(r.pasted).toBe(r.item!.id);
    }
  });
});
