# Pointer Glass Effect Design

## Intent

Replace the current pointer wake rings and particle-only trail with the supplied multi-layer glass interaction. Motion writes a GPU velocity field, the scene receives a refractive screen-space trail with chromatic edges, a transparent pointer blob bends the rendered scene, broken-glass facets add local reflections, and the camera follows the pointer with light parallax.

The existing input path remains the source of truth: `MainLayout.vue` samples global pointer events, `VisualRuntime` smooths NDC coordinates and velocity, and `HomeScene` passes that state to `liquidScene`. The DOM continues to own content, focus, navigation, and touch gestures.

## Goals

- Add a GPU velocity field using two ping-pong render targets at reduced resolution.
- Render the active scene into a texture before presenting it to the canvas.
- Distort the scene along the sampled velocity direction with bounded multi-sampling and RGB shift.
- Add a transparent glass blob that follows the smoothed pointer and samples the rendered scene with Fresnel/refraction.
- Add a bounded broken-glass facet layer with screen-space reflection/refraction and colored edge response.
- Keep separate NDC and pixel pointer coordinates so the field brush uses physical viewport distance while scene interaction uses NDC.
- Use the supplied defaults as the starting point: push strength `25`, velocity dissipation `0.975`, weight dissipation `0.95 / 0.8`, curl noise enabled with scale `0.02` and strength `3`, distortion amount `3`, multiplier `5`, RGB shift `0.5`, and color multiplier `10`.
- Keep the existing scroll-driven sphere, scene stages, tap/press interactions, and shared renderer lifecycle.
- Remove the old expanding `pointerWake` ring pool so only the new pointer treatment is visible.
- Preserve quality-tier, reduced-motion, WebGL fallback, context-loss recovery, and resize behavior.

## Non-goals and anti-goals

- No DOM cursor replacement, CSS `backdrop-filter` dependency, or second global canvas.
- No general-purpose fluid simulation beyond the ScreenPaint-style velocity/weight field, and no new page-specific pointer effects outside the shared home scene.
- No API, content, route, backend, or accessibility behavior changes.
- The effect must not obscure page text or intercept pointer events.
- Low quality and reduced motion must remain usable and visibly calmer than the high-quality path.

## Approaches considered

1. **Full-screen velocity-field post-process plus glass blob (chosen).** Render the scene into a target, update a reduced-resolution velocity field from pointer movement, and draw a full-screen shader that samples the scene along the velocity vector with mild RGB dispersion. A small transparent blob is rendered in the same scene before the post-process. This best matches the supplied ScreenPaint / ScreenPaintDistortion breakdown while fitting the existing single-renderer architecture.
2. **Glass blob only.** Add a transparent refractive mesh over the existing scene without a velocity field. This is lower risk and cheaper, but cannot produce a persistent liquid trail or direction-aware screen distortion.
3. **CSS overlay.** Use a DOM element with `backdrop-filter`. This does not have access to the WebGL scene texture, produces no true screen-space refraction, and conflicts with the existing canvas layering.

The first approach is selected because the user explicitly asked to replace the current pointer effect with the multi-layer glass treatment. The implementation keeps the full visual chain at high quality and only reduces resolution/sample counts on lower tiers; it does not replace the requested features with a CSS or blob-only approximation.

## Runtime design

### Renderer and scene ownership

`MainLayout.vue` continues to create one `WebGLRenderer`. `RendererAdapter` gains the narrow methods needed by the scene controller (`setRenderTarget`, `getRenderTarget`, and a render-target type boundary) without exposing renderer internals to page modules. `createLiquidScene` owns its render targets, fullscreen quad, blob geometry, velocity-field materials, and scene materials; its `dispose()` releases those resources but never disposes the shared renderer.

### Frame order

For the home scene, each frame runs in this order:

1. Smooth pointer/scroll state using the existing runtime.
2. Update the velocity field from the current and previous pixel-space pointer positions. The field uses a low-resolution target and ping-pong updates, with dissipation and a bounded push radius.
3. Render the existing liquid scene plus the new glass blob into a scene render target.
4. Draw a fullscreen triangle/quad using the scene texture and velocity texture. Sample along the velocity direction up to nine times at high quality, fewer times at balanced/low quality, and apply a small channel offset for chromatic edges.
5. Restore the default framebuffer and present the processed result.

The render target is resized from the existing `resize(width, height, dpr)` path. The velocity target is capped to a quarter viewport dimension at high quality, with smaller caps for balanced and low tiers.

### Pointer and parallax behavior

`MainLayout.vue` and `VisualRuntime.setPointer()` keep the existing NDC input contract. `MainLayout.vue` additionally retains raw pixel coordinates for the pointer sample; `VisualRuntime` exposes both normalized and pixel-space values to the home scene. `liquidScene` retains current and previous pixel samples for the velocity brush and uses the supplied `u_scrollOffset.value.set(scrollX, scrollY)` write. Pointer velocity controls trail amount and RGB shift. Camera/object rotation follows the supplied damped equations with a goal-tunnel-style strength of roughly `0.02–0.1`.

### Glass blob

The blob is a transparent sphere or rounded icosahedron positioned near the pointer hit point when the pointer intersects the scene. Front and back faces use refraction against the scene target, with thickness-driven blur selection when the target supports mip levels, plus Fresnel, matcap-like highlights, and colored edges. If there is no valid sphere hit, its opacity eases toward zero so the fullscreen trail still works across the page.

### Broken-glass layer

A bounded set of irregular facet meshes is placed around the active scene subject. Each facet computes a screen-space normal from derivatives, reflects/refracts the scene texture with a normal-scaled offset, and adds an edge tint. The layer is generated procedurally in code so the repository does not need an external `broken_glass.buf` asset, but it uses the same screen-space contract described in the supplied shader analysis.

## Quality and fallback

- High: full-resolution scene target, quarter-resolution velocity field plus an eighth-resolution auxiliary field, up to nine distortion samples, blob, broken-glass facets, curl noise, and RGB shift enabled.
- Balanced: capped render target/DPR, quarter/eighth field targets retained at reduced dimensions, seven samples, reduced facet count and chromatic shift.
- Low: keep the velocity field and blob at reduced resolution with three samples; only disable auxiliary curl/facet detail if the quality controller crosses the low tier.
- `prefers-reduced-motion`: bypass the post-process and blob motion, preserve the static scene/fallback behavior.
- WebGL initialization failure or context loss: reuse the existing DOM-visible fallback and recovery path.

## Tests and verification

- Update `liquidScene.test.ts` to verify render-target lifecycle, velocity-field dissipation/decay, quality-tier sample selection, and shared renderer ownership.
- Replace wake-ring assertions with assertions that the controller updates the velocity field and renders the post-process pass.
- Add focused shader/source-contract checks for the velocity uniforms, corrected `u_scrollOffset` vector write, and bounded sample counts.
- Run the existing frontend unit suite and `npm run build`.
- Start Vite and use Playwright at desktop and narrow viewports to confirm the canvas remains nonblank, pointer movement produces a visible but bounded distortion, reduced-motion disables the effect, and no page text becomes occluded.

## Builder decisions

- The post-process is implemented inside the existing home scene controller rather than as a global `EffectQueue` effect, because it needs the scene's render target and must not affect non-home scenes.
- A fullscreen triangle/quad is acceptable; no new postprocessing dependency is needed.
- The effect remains visually restrained and transparent over the current black/acid/blue art direction instead of introducing a new palette.
