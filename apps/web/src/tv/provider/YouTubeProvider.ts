import { isYouTubeId } from '@office/protocol';
import catalogJson from '../catalog.json';
import { filterByTitle, type VideoItem, type VideoProvider } from './VideoProvider';
import { parseYouTubeUrl } from './parseYouTubeUrl';

type CatalogEntry = Omit<VideoItem, 'provider'>;

/** REQ-TV-003: the curated catalog shipped with the client (OQ-021). */
export const CATALOG: readonly VideoItem[] = (catalogJson.videos as CatalogEntry[]).map((v) => ({
  ...v,
  provider: 'youtube' as const,
}));

/** Origin passed to the IFrame API so it accepts postMessage from this page. */
function pageOrigin(): string | null {
  return typeof window === 'undefined' ? null : window.location.origin;
}

/** REQ-TV-007: YouTube over the curated catalog; no network call and no API key. */
export class YouTubeProvider implements VideoProvider {
  readonly id = 'youtube' as const;

  constructor(
    private readonly catalog: readonly VideoItem[] = CATALOG,
    private readonly origin: () => string | null = pageOrigin,
  ) {}

  search(query: string): readonly VideoItem[] {
    return filterByTitle(this.catalog, query);
  }

  getVideo(id: string): VideoItem | null {
    return this.catalog.find((v) => v.id === id) ?? null;
  }

  getEmbedUrl(id: string): string | null {
    if (!isYouTubeId(id)) return null;
    const params = new URLSearchParams({ enablejsapi: '1', playsinline: '1', rel: '0' });
    const origin = this.origin();
    if (origin) params.set('origin', origin);
    return `https://www.youtube.com/embed/${id}?${params.toString()}`;
  }

  parseInput(text: string): string | null {
    return parseYouTubeUrl(text);
  }
}
