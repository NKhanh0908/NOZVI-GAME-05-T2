/** REQ-TV-007: one video the TV can play. */
export type VideoItem = {
  id: string;
  title: string;
  thumbnail: string;
  provider: 'youtube';
  /** Seconds, when known. */
  duration?: number;
  sourceUrl: string;
  embeddable: boolean;
};

/**
 * REQ-TV-007: the TV talks to videos only through this interface, so another provider
 * or a test double can replace YouTube. `search` filters the curated catalog; there is
 * no live search and no Data API key (REQ-TV-003, REQ-TV-008).
 */
export interface VideoProvider {
  readonly id: 'youtube';
  search(query: string): readonly VideoItem[];
  /** A catalog item, or null when the id is not in the catalog. */
  getVideo(id: string): VideoItem | null;
  /** Embed URL for the IFrame player, or null when the id is malformed. */
  getEmbedUrl(id: string): string | null;
  /** Video id from a pasted URL or bare id, or null. */
  parseInput(text: string): string | null;
}

/** Case- and accent-insensitive title match; an empty query returns everything. */
export function filterByTitle(items: readonly VideoItem[], query: string): readonly VideoItem[] {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const q = fold(query);
  return q === '' ? items : items.filter((v) => fold(v.title).includes(q));
}
