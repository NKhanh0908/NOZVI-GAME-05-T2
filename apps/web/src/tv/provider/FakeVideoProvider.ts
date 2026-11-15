import { isYouTubeId } from '@office/protocol';
import { filterByTitle, type VideoItem, type VideoProvider } from './VideoProvider';
import { parseYouTubeUrl } from './parseYouTubeUrl';

/** Test double: a fixed in-memory catalog and a local embed URL. */
export class FakeVideoProvider implements VideoProvider {
  readonly id = 'youtube' as const;

  constructor(readonly items: readonly VideoItem[] = FAKE_VIDEOS) {}

  search(query: string): readonly VideoItem[] {
    return filterByTitle(this.items, query);
  }
  getVideo(id: string): VideoItem | null {
    return this.items.find((v) => v.id === id) ?? null;
  }
  getEmbedUrl(id: string): string | null {
    return isYouTubeId(id) ? `about:blank#fake-${id}` : null;
  }
  parseInput(text: string): string | null {
    return parseYouTubeUrl(text);
  }
}

const fake = (id: string, title: string): VideoItem => ({
  id,
  title,
  thumbnail: '',
  provider: 'youtube',
  duration: 120,
  sourceUrl: `https://www.youtube.com/watch?v=${id}`,
  embeddable: true,
});

export const FAKE_VIDEOS: readonly VideoItem[] = [
  fake('AAAAAAAAAAA', 'Alpha clip'),
  fake('BBBBBBBBBBB', 'Bravo clip'),
  fake('CCCCCCCCCCC', 'Café clip'),
];
