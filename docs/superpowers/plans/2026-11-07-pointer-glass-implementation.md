# Pointer Glass Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the pointer-driven glass interaction as a multi-layer Three.js pipeline with a ScreenPaint-style velocity field, full-screen distortion/RGB dispersion, a refractive glass blob, broken-glass facets, and camera parallax while preserving the blog's existing runtime and fallbacks.

**Architecture:** Keep one shared `WebGLRenderer`, canvas, RAF, and pointer input path. Extend the renderer adapter with render-target operations, then make `createLiquidScene` own a scene target, velocity-field ping-pong targets, an auxiliary low-resolution field, a glass blob, facet meshes, and a fullscreen post-process pass. Home renders through this chain; other page scenes retain the current direct scene path.

**Tech Stack:** Vue 3, TypeScript, Three.js 0.187, GLSL shaders, Vitest, Vite, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-07-pointer-glass-design.md`

## Global Constraints

- Keep at most one active WebGL renderer/context, one canvas, and one RAF in `MainLayout`.
- `createLiquidScene.dispose()` releases scene-owned GPU resources and never disposes the shared renderer.
- Keep DOM content, focus, navigation, touch gestures, API behavior, and route behavior unchanged.
- Preserve WebGL fallback, context-loss restoration, reduced-motion handling, quality tiers, and resize lifecycle.
- Use separate NDC and pixel pointer coordinates; write scroll offsets with `set(scrollX, scrollY)`.
- Use the supplied full-chain defaults: push `25`, velocity dissipation `0.975`, weight dissipation `0.95 / 0.8`, curl scale `0.02`, curl strength `3`, distortion amount `3`, multiplier `5`, RGB shift `0.5`, color multiplier `10`.

## Review Focus

- Render-target ownership: scene disposal must release every target/material/geometry without calling `renderer.dispose()`.
- Ping-pong stability: velocity and weight values must remain finite and dissipate when the pointer stops.
- Frame ordering: velocity update, scene render, blob/facet render, and fullscreen composite must happen in that order.
- Context recovery: the rebuilt home scene must recreate all targets and shaders while retaining the single renderer.
- Pointer coordinate correctness: fast movement must use pixel distance for brush radius while scene hit tests continue using NDC.

### Task 1: Extend the renderer contract and pointer state

**Files:**
- Modify: `frontend/src/graphics/runtime/types.ts`
- Modify: `frontend/src/layouts/MainLayout.vue`
- Modify: `frontend/src/graphics/runtime/VisualRuntime.ts`
- Modify: `frontend/src/graphics/scenes/home/HomeScene.ts`
- Test: `frontend/src/layouts/MainLayout.test.ts`
- Test: `frontend/src/graphics/runtime/VisualRuntime.test.ts`

**Interfaces:**
- `RendererAdapter` gains optional render-target methods: `setRenderTarget(target: unknown | null): void`, `getRenderTarget?(): unknown | null`, and `clear?(): void`.
- `VisualState` gains `pointerPixelX` and `pointerPixelY` normalized to viewport pixels; `setPointer(pointerX, pointerY, pixelX?, pixelY?)` keeps old callers valid and derives pixels when omitted.
- `HomeScene` forwards the new pixel coordinates to `LiquidSceneController.setInput`.

- [ ] **Step 1: Write failing tests** for pixel pointer forwarding and for a renderer adapter that can save/restore a target.
- [ ] **Step 2: Run focused tests** with `cd frontend && npx vitest run src/layouts/MainLayout.test.ts src/graphics/runtime/VisualRuntime.test.ts`; expect failures for the new state/contract.
- [ ] **Step 3: Implement the contract** and update `MainLayout.vue` to pass `event.clientX` / `event.clientY` alongside NDC without changing touch filtering.
- [ ] **Step 4: Run focused tests** and confirm the existing pointer tests still pass.

### Task 2: Add velocity-field and post-process shader contracts

**Files:**
- Modify: `frontend/src/graphics/shaders.ts`
- Modify: `frontend/src/graphics/shaders.test.ts`
- Create: `frontend/src/graphics/glassShaders.ts`
- Test: `frontend/src/graphics/glassShaders.test.ts`

**Interfaces:**
- Export shader strings for `velocityAdvectVertexShader`, `velocityAdvectFragmentShader`, `velocitySplatFragmentShader`, `glassCompositeVertexShader`, `glassCompositeFragmentShader`, `glassBlobVertexShader`, `glassBlobFragmentShader`, `glassFacetVertexShader`, and `glassFacetFragmentShader`.
- Shader uniforms include `uPrevPaint`, `uLowPaint`, `uPointer`, `uPrevPointer`, `uTexelSize`, `uPushStrength`, `uVelocityDissipation`, `uWeight1Dissipation`, `uWeight2Dissipation`, `uUseNoise`, `uCurlScale`, `uCurlStrength`, `uTexture`, `uVelocityTexture`, `uAmount`, `uMultiplier`, `uRgbShift`, `uColorMultiplier`, `uSceneResolution`, and `uScrollOffset`.

- [ ] **Step 1: Write failing source-contract tests** that assert the corrected `u_scrollOffset` vector form, nine-sample composite loop, channel offsets, velocity backtrace, dissipation, curl toggle, Fresnel/refraction, and derivative-based facet normal.
- [ ] **Step 2: Run `cd frontend && npx vitest run src/graphics/shaders.test.ts src/graphics/glassShaders.test.ts`; expect new shader exports to fail.**
- [ ] **Step 3: Implement the GLSL strings** with bounded loops and finite-value clamps. Keep the shaders self-contained and avoid adding a postprocessing dependency.
- [ ] **Step 4: Run the shader tests** and confirm all contracts pass.

### Task 3: Build the full liquid scene pipeline

**Files:**
- Modify: `frontend/src/graphics/liquidScene.ts`
- Modify: `frontend/src/graphics/scenes/home/HomeScene.ts`
- Test: `frontend/src/graphics/liquidScene.test.ts`

**Interfaces:**
- `SceneInput` gains `pointerPixelX` and `pointerPixelY`.
- `LiquidSceneController.setInput()` consumes NDC, pixel coordinates, velocity, and scroll.
- The controller keeps `resize`, `setQualityTier`, interaction methods, `render`, and `dispose` signatures stable.

- [ ] **Step 1: Replace wake-ring expectations with failing tests** for target creation, target resize, velocity-field decay, post-process render order, quality sample count, blob visibility, facet count, and shared renderer ownership.
- [ ] **Step 2: Run `cd frontend && npx vitest run src/graphics/liquidScene.test.ts`; expect failures for the new targets and pass structure.**
- [ ] **Step 3: Implement scene-owned targets**: full-resolution scene target, velocity `prev/curr` targets at viewport/4, auxiliary field at viewport/8, and temporary blur targets for glass thickness. Use `NearestFilter` for velocity data and `LinearFilter` for scene color.
- [ ] **Step 4: Implement the velocity update** using pointer pixel segments, a splat pass, semi-Lagrangian backtrace, dissipation, optional curl perturbation, and ping-pong swaps. Radius derives from pointer distance and is clamped to the supplied range.
- [ ] **Step 5: Implement the glass blob** with front/back refraction, Fresnel, edge tint, and scene/blur texture uniforms. Position and visibility follow the sphere hit point with damping.
- [ ] **Step 6: Implement procedural broken-glass facets** around the scene subject. Use screen-space derivative normals, reflection/refraction offsets, and a bounded facet count by quality tier.
- [ ] **Step 7: Implement the fullscreen composite** with 9/7/3 samples by quality tier, velocity-weighted direction, RGB channel offsets, color multiplier, and a mild scene vignette. Save/restore the renderer's current target around every pass.
- [ ] **Step 8: Remove the old `pointerWake` point pool** and its resources. Keep the existing sphere, wire, particle field, scroll stages, ripple, and press behavior unless a shader uniform is replaced by the new glass path.
- [ ] **Step 9: Run the focused liquid tests** and fix all lifecycle, quality, and render-order failures.

### Task 4: Integrate runtime fallback and browser verification

**Files:**
- Modify: `frontend/src/layouts/MainLayout.vue`
- Modify: `frontend/src/graphics/runtime/VisualRuntime.ts`
- Modify: `frontend/src/graphics/runtime/VisualRuntime.test.ts`
- Create: `frontend/scripts/quality/pointer-glass.mjs`

**Interfaces:**
- `MainLayout.createRenderer()` exposes the Three.js target methods through the adapter.
- Runtime diagnostics continue to report one renderer, RAF state, quality tier, context loss, and fallback state.
- The browser script accepts `BASE_URL` and records screenshots/diagnostics in a temporary output folder.

- [ ] **Step 1: Add failing tests** for context loss/recovery with render targets, reduced-motion bypass, hidden-document cleanup, and fallback when a target/shader allocation throws.
- [ ] **Step 2: Run `cd frontend && npx vitest run src/graphics/runtime/VisualRuntime.test.ts src/layouts/MainLayout.test.ts`; expect failures only for new target lifecycle assertions.**
- [ ] **Step 3: Implement adapter methods and ensure the runtime does not create a second renderer during context restoration.**
- [ ] **Step 4: Implement the Playwright verification script** to move the pointer along several paths, assert the canvas is nonblank, record `__visualRuntimeDiagnostics`, compare reduced-motion behavior, and check desktop/mobile screenshots for text occlusion.
- [ ] **Step 5: Run `cd frontend && npm test` and `cd frontend && npm run build`.**
- [ ] **Step 6: Start Vite and run `node frontend/scripts/quality/pointer-glass.mjs`; inspect the screenshots and diagnostics before claiming completion.**

### Task 5: Final visual tuning and documentation

**Files:**
- Modify: `frontend/src/graphics/glassShaders.ts`
- Modify: `frontend/src/graphics/liquidScene.ts`
- Modify: `docs/implementation/2026-10-31-lusion-motion.md`

- [ ] **Step 1: Compare the browser result against the supplied effect breakdown**: field trail, RGB color separation, blob refraction, facet reflection, and camera parallax must all be observable during pointer movement.
- [ ] **Step 2: Tune only the pinned defaults and quality caps**; keep the full path enabled on high quality and preserve the low/reduced-motion fallback.
- [ ] **Step 3: Record the implemented chain and known limitations** in the implementation notes without claiming production shader parity beyond what the browser evidence demonstrates.
- [ ] **Step 4: Re-run the focused visual tests, full unit suite, build, and browser script.**
