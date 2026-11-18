/**
 * REQ-TV-009: per-video playback errors. The YouTube IFrame API reports `onError` codes
 * 2 (invalid id), 5 (HTML5 player error), 100 (not found or private), 101 and 150 (the
 * owner does not allow embedding; 150 is the same case as 101). Each failure belongs to
 * one video id and stays for the session: a failed video is not offered as playable again.
 */

/** Headline shown on the TV screen and in the panel for every error code. */
export const VIDEO_ERROR_TITLE = "This video can't be played here";

export type TvVideoErrorKind = 'invalid-id' | 'html5' | 'not-found' | 'embed-blocked' | 'unknown';

export type TvVideoError = {
  videoId: string;
  /** IFrame API error code as reported by the player. */
  code: number;
  kind: TvVideoErrorKind;
  /** One-line reason under {@link VIDEO_ERROR_TITLE}. */
  detail: string;
};

const DETAILS: Record<TvVideoErrorKind, string> = {
  // Pasted ids are already validated, so code 2 in practice means YouTube refused this video
  // in an embed (T-1405: MNXGfA_eT_Y errors 0.1 s after cue on localhost and plays on
  // youtube.com); "not valid" misled the owner.
  'invalid-id': 'YouTube refused to play this video outside youtube.com.',
  html5: 'The player could not play this video.',
  'not-found': 'The video was removed or is private.',
  'embed-blocked': 'The owner does not allow playing it outside YouTube.',
  unknown: 'The player reported an error.',
};

/** Maps an IFrame API error code to its kind; codes the API does not document are `unknown`. */
export function videoErrorKind(code: number): TvVideoErrorKind {
  switch (code) {
    case 2:
      return 'invalid-id';
    case 5:
      return 'html5';
    case 100:
      return 'not-found';
    case 101:
    case 150:
      return 'embed-blocked';
    default:
      return 'unknown';
  }
}

export function videoError(videoId: string, code: number): TvVideoError {
  const kind = videoErrorKind(code);
  return { videoId, code, kind, detail: DETAILS[kind] };
}

/** Failed videos of this session, keyed by video id (the first reported error wins). */
export class VideoErrorLog {
  private readonly failed = new Map<string, TvVideoError>();

  /** Records the failure; returns the stored error for the video. */
  report(videoId: string, code: number): TvVideoError {
    const known = this.failed.get(videoId);
    if (known) return known;
    const error = videoError(videoId, code);
    this.failed.set(videoId, error);
    return error;
  }

  get(videoId: string | null): TvVideoError | null {
    return videoId === null ? null : (this.failed.get(videoId) ?? null);
  }

  has(videoId: string): boolean {
    return this.failed.has(videoId);
  }
}
