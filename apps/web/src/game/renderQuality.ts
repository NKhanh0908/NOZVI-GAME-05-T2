/**
 * Render-quality switch (Phase 4.1 task 1, T-1146). `high` is the default for real
 * hardware; `e2e` is the low setting Playwright builds use (headless SwiftShader WebGL),
 * so later Phase 4.1 tasks can turn off costly effects such as post-processing and
 * environment reflections there. Today no visual depends on it.
 */
export type RenderQuality = 'high' | 'e2e';

/** Reads `VITE_RENDER_QUALITY`; anything other than `e2e` (any case, trimmed) is `high`. */
export function renderQuality(env: { VITE_RENDER_QUALITY?: string | undefined }): RenderQuality {
  return env.VITE_RENDER_QUALITY?.trim().toLowerCase() === 'e2e' ? 'e2e' : 'high';
}
