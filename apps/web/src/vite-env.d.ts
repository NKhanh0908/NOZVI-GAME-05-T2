/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Game server base URL (http/https); defaults to the local server. */
  readonly VITE_SERVER_URL?: string;
  /** `fake` selects the test TV player (Playwright sets it); anything else uses YouTube. */
  readonly VITE_TV_PLAYER?: string;
  /** `e2e` selects the low render quality (Playwright sets it); anything else is `high`. */
  readonly VITE_RENDER_QUALITY?: string;
}
