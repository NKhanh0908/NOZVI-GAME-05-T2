import { isYouTubeId } from '@office/protocol';

const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const NOCOOKIE_HOSTS = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com']);

/**
 * REQ-TV-003: returns the 11-character id from a pasted YouTube link (`watch?v=`,
 * `youtu.be/`, `/embed/`, `/shorts/`, `/live/`) or a bare id, otherwise null. Other hosts
 * and malformed ids are rejected.
 */
export function parseYouTubeUrl(text: string): string | null {
  const input = text.trim();
  if (isYouTubeId(input)) return input;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined = null;
  if (host === 'youtu.be') {
    id = parts.length === 1 ? parts[0] : null;
  } else if (HOSTS.has(host) || NOCOOKIE_HOSTS.has(host)) {
    if (parts.length === 1 && parts[0] === 'watch') id = url.searchParams.get('v');
    else if (parts.length === 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0]!)) {
      id = parts[1];
    }
  }
  return isYouTubeId(id) ? id : null;
}
