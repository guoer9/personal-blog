# Home Portrait and Navigation Implementation Plan

> Historical implementation plan. The user's subsequent corrections remove the Front/Bass and Motion controls, preserve full effects regardless of system preference, and restore the original centered sphere. The selected signature transition and handwritten asset are governed by `2026-11-09-home-continuous-scroll.md`; contradictory checks below are superseded.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the first complete portrait scene and a personal calling-card navigation in personal-blog.

**Architecture:** Two high-subdivision depth-displaced image planes render to independent targets in the existing shared Three.js renderer. A pressure-projected fluid pointer field controls their reveal; a transparent final shader composites the portraits over the existing liquid scene. Vue owns semantic descriptions, manual selection, identity details, and static fallback.

**Tech Stack:** Vue 3, TypeScript, Three.js, Vitest, Playwright; Python/Pillow for reproducible original demonstration textures.

**Spec:** `docs/superpowers/specs/2026-11-08-home-portrait-and-navigation-design.md`

## Global Constraints

- `personal-blog` is the implementation repository; `land` application source remains untouched.
- No new renderer, canvas, animation loop, backend contract, or public route.
- Preserve `liquidScene.ts`, `glassShaders.ts`, their tests, and existing untracked output.
- Each portrait has diffuse, alpha, depth, normal, roughness, and shadow maps; use 128 × 128 plane segments at high quality.
- Demonstration subjects must be clearly identified and never presented as GUOER's likeness.
- Canvas remains aria-hidden; manual changes alone update the polite live status.
- Works and About are primary destinations; Contact targets `/about#connect`; Writing, Documents, search, authentication, and admin separation remain available.

## Review Focus

- Asset load failure or completion after route disposal: DOM fallback remains visible, late textures are disposed, and no unhandled rejection occurs (Task 2 lifecycle tests).
- Pointer outside the portrait, non-finite input, or touch scrolling: reveal remains bounded and native scrolling works (Tasks 2 and 3).
- Reduced motion or paused scene: manual image changes still work without a continuous animation loop (Task 3 component tests and Task 5 browser checks).
- Narrow screens, long account names, and open navigation/search: actions remain reachable with logical keyboard focus (Task 4 tests and Task 5 browser checks).
- Repeated route entry and viewport/DPR changes: one canvas survives and render targets are resized/disposed without corrupting other scenes (Task 2 lifecycle tests and Task 5 browser checks).

## File Boundaries

- `frontend/scripts/portraits/generate_demo.py`: original procedural human/bass study, rendered through a z-buffer into real aligned map sets. Generated maps are a documented fixture, not estimated personal-photo data.
- `frontend/public/portraits/{front,bass}/`: six-map bundles and preview; `manifest.json` records provenance, sizes, channels, color spaces, subject descriptions, and replacement instructions.
- `frontend/src/graphics/scenes/home/portraitAssets.ts`: typed asset metadata consumed by renderer and DOM.
- `frontend/src/graphics/scenes/home/PortraitEffect.ts`, `portraitShaders.ts`, `PortraitFluid.ts`, `portraitMath.ts`: portrait pipeline and lifecycle, GPU fluid passes, and pure bounds/selection math.
- `frontend/src/graphics/scenes/home/HomeScene.ts`: integration after the existing liquid render, without changing liquid internals.
- `frontend/src/graphics/scenes/pageStates.ts`: optional `portraitMode: 'front' | 'bass'` state, defaulting to front for existing callers.
- `frontend/src/components/immersive/ImmersiveScene.vue`: registered `home-portrait` anchor, identity labels, semantic photo description, and static poster.
- `frontend/src/views/blog/Home.vue`: calling-card hero copy and native portrait controls; retains all fetched content and interactions.
- `frontend/src/components/navigation/SiteHeader.vue`, `frontend/src/data/portfolio.ts`: navigation hierarchy and expression.

### Task 1: Complete replaceable demonstration assets

**Files:** Create `frontend/scripts/portraits/generate_demo.py`, `frontend/public/portraits/manifest.json`, `frontend/public/portraits/README.md`, both six-map bundles, `frontend/src/graphics/scenes/home/portraitAssets.ts`, and `portraitAssets.test.ts`.

**Interfaces:** Export `type PortraitMode = 'front' | 'bass'` and `portraitAssets: Record<PortraitMode, PortraitAsset>` with `id`, `label`, `alt`, `isDemo`, `width`, `height`, `maps: Record<'diffuse' | 'alpha' | 'depth' | 'normal' | 'roughness' | 'shadow', string>` and `preview: string`.

- [x] Write tests asserting both IDs, complete map groups, matching dimensions, nonconstant depth/normal/shadow data, and explicit demonstration metadata.
- [x] Run the focused test; expected failure because the asset contract and bundles do not exist.
- [x] Create original front-facing and bass-holding sculptural human placeholders. Generate real depth and normals from geometric surfaces, alpha from coverage, roughness from materials, and a nonconstant shading/occlusion map; save reproducible provenance and no external asset dependency.
- [x] Run the focused test and generator validation; expected pass, twelve usable nonempty maps, aligned previews, and documented drop-in replacement path.
- [x] Review the rendered previews visually before accepting the fixture.

### Task 2: Full shared-renderer portrait pipeline

**Files:** Create `PortraitEffect.ts`, `PortraitFluid.ts`, `portraitShaders.ts`, `portraitMath.ts`, `PortraitEffect.test.ts`, `portraitMath.test.ts`; modify `HomeScene.ts` and `HomeScene.test.ts`.

**Interfaces:** `createPortraitEffect(context: SceneContext): PortraitEffectController` exposes `update(visualState: Readonly<VisualState>, mode: PortraitMode): void`, `resize(width: number, height: number, dpr: number): void`, `render(): void`, `dispose(): void`. Reads anchor `home-portrait`; writes canvas `data-portrait-state` as `loading | ready | error` and `data-portrait-mode` for DOM fallback/diagnostics. Uses Task 1 assets. `HomeScene` invokes update/resize/dispose alongside liquid and render after liquid.

- [x] Add tests for bounded local pointer coordinates, missing/zero-sized anchor, NaN input, manual selection, GPU pass order, quality resizing, all-map load failure, late disposal, and renderer-state restoration.
- [x] Run focused tests; expected failure for missing module or absent portrait lifecycle calls.
- [x] Build subdivided plane materials that use depth displacement and all six maps, independent transparent targets, damped pose, noise/background treatment, and pointer reveal composition. Build fluid velocity advection, pointer force, divergence, Jacobi pressure, pressure subtraction, and density advection in ping-pong targets; use byte encoding to avoid requiring float render targets.
- [x] Render liquid to screen first, then transparent portrait composite with `autoClear=false`; restore target, clear, viewport, scissor, and autoClear state in `finally`. Dispose every texture/target/material/geometry, including textures completing after disposal. Keep errors local so existing scenes continue.
- [x] Integrate in HomeScene, retaining all sphere interactions and motion gating. Run focused tests; expected pass.

### Task 3: Calling-card hero, identity details, and manual selection

**Files:** Modify `ImmersiveScene.vue`, `Home.vue`, `Home.test.ts`, `pageStates.ts`; create `ImmersiveScene.test.ts`.

**Interfaces:** `ImmersiveScene` takes `mode?: PortraitMode` in addition to existing `progress` and `paused`; it registers `home-portrait`. Home owns `portraitMode` with front default and publishes it with the existing HomePageState. Task 2 owns rendering readiness; DOM watches its data attribute and shows the corresponding preview while loading, paused, reduced motion, or failed.

- [x] Write tests for named native front/bass buttons, `aria-pressed`, manual-only polite status, demonstration disclosure, selected fallback image, and mode publication while paused.
- [x] Run focused tests; expected failure because there is no portrait selector/state.
- [x] Build the hero around GUOER's name, existing profile introduction, personal disciplines, Works and Contact actions. Keep identity labels to existing profile facts and user's stated bass interest; place them around the portrait with safe margins. Keep all post/works fetches and content sections.
- [x] Implement accessible selector and DOM preview with editable alt metadata, ready-state detection/cleanup, and reduced-motion styles. Keep pointer events and native touch scrolling unobstructed.
- [x] Run Home and ImmersiveScene tests; expected pass, including preserved existing gesture tests.

### Task 4: Expressive navigation with retained behavior

**Files:** Modify `portfolio.ts`, `SiteHeader.vue`, `SiteHeader.test.ts`.

**Interfaces:** Existing `navigation` data gains `priority: 'primary' | 'secondary'`, ordered Works, About, Writing, Documents. Contact is an explicit shared `/about#connect` CTA.

- [x] Add assertions for priority/order, desktop/mobile Contact target and position, existing active nested routes, preserved search/login/logout, Escape focus restoration, and route-change menu closure.
- [x] Run header tests; expected failure for missing hierarchy/contact behavior.
- [x] Design a compact brand, primary links, restrained secondary links, and acid Contact button. Expand mobile navigation into generous numbered rows with personal identity footer and Contact before secondary links. Keep search and accounts reachable, make menu/search mutually exclusive, and restore toggle focus on Escape.
- [x] Run header tests; expected pass. Check 390px and 1280px layouts with authenticated long-name state in Task 5.

### Task 5: Integrated acceptance and documentation

**Files:** Add `frontend/scripts/quality/home-portrait.mjs` and update this plan with actual evidence; save browser screenshots under existing ignored output.

**Interfaces:** Uses existing frontend Vite server, installed Playwright, all preceding components, and existing runtime diagnostics.

- [x] Run `npm test` and `npm run build` in frontend; expected all unit tests and TypeScript/Vite build pass.
- [x] Browser checks at desktop and mobile: one shared canvas; portrait maps and shaders load without WebGL errors; pointer reveal changes the picture; manual bass persists; touch scroll remains native; Works/About/Contact/Writing/Documents/search targets work.
- [x] Browser checks with reduced motion, paused animation, WebGL disabled, texture request failure, and route return: selected static preview remains meaningful; no continuous motion; no extra canvas or late-load errors.
- [x] Review screenshots for portrait framing, navigation hierarchy, overlap, focus visibility, text readability, and horizontal overflow. Obtain an independent code/spec review, resolve material findings, and rerun affected checks.
- [x] Document what is demonstration content, the exact replacement files, verified commands, and any remaining limitation. Keep all changes reviewable locally; no deployment or push is part of this request.

## Self-review and Execution

Spec coverage: assets Task 1; full rendering architecture and shared context Task 2; semantics, manual mode and identity content Task 3; all navigation contracts Task 4; runtime/browser evidence Task 5. Interfaces above are the source of truth for parallel workers. Existing user output is preserved.

Execution choice: use independent workers for assets and navigation while the main implementation coordinates the tightly coupled scene/DOM integration. The user's instruction to start and existing authorization cover local reversible implementation; no additional permission gate is introduced for routine implementation choices. Hand-authored geometric demonstration fixtures are allowed by the user's explicit placeholder instruction and make every map reproducible without inventing a likeness.


## Verification Record — 2026-11-08

- Assets: `python3 frontend/scripts/portraits/generate_demo.py --validate` passed for all twelve aligned maps and both static previews. Both original sculptures were visually inspected.
- Unit suite: `cd frontend && npm test` passed **55 files / 403 tests** after the final backdrop-exit regression. New asset, renderer, scene, DOM and navigation assertions were observed failing before their behavior was implemented.
- Production: `cd frontend && npm run build` passed TypeScript and Vite. The existing large-chunk advisory remains.
- Source integrity: `git diff --check` passed; no modifications to `liquidScene.ts`, `glassShaders.ts`, or their tests. Existing untracked output was retained. `land` application source was not changed during implementation.
- Review: an independent source reviewer verified the six-map/RT/fluid/lifecycle design. The backdrop exit jump was fixed with tested smooth opacity; the potential Contact transition issue was ruled out by actual Home and Documents → Contact measurements (target top 92px) and About's existing post-mount hash handling.
- Material decisions: use an original geometric sculpture fixture with real geometry-derived data maps until personal photographs exist; preserve local changes on `codex/home-portrait-navigation`, with no commit, push, or deployment performed. DOM previews support pause/reduced motion and WebGL/asset failure while the full renderer runs normally when available.
- Browser acceptance is reproducible through `BASE_URL=http://127.0.0.1:4179 node scripts/quality/home-portrait.mjs` from frontend. Its local report and screenshots live under `frontend/output/playwright/home-portrait/`. API reads use empty fixtures because the backend is not part of this visual change; this does not validate backend availability. Intentional missing-texture and disabled-WebGL cases are recorded separately from unexpected errors.

- Final browser run: Chrome 156, **32/32 checks passed**, zero unexpected WebGL errors and zero uncaught page errors. Desktop 1440px and mobile 390px/320px, DPR changes, actual pointer pixel differences, manual persistence, native touch scrolling, navigation/Contact positioning, pause/reduced motion, disabled WebGL and missing texture were verified. Screenshots were inspected after native smooth scrolling settled. Existing Sentry setup and early router hash warnings are retained; About’s own hash handling correctly positions Contact at 92px.

## Full-screen continuation — 2026-11-09

The user's later screenshots and request to run `land` locally override the initial side-by-side hero. The reference and blog were restarted at `http://127.0.0.1:5180` and `http://127.0.0.1:5181`; `land` application source remains unchanged. Existing implementation was retained on `codex/home-portrait-navigation`.

- [x] Keep the portrait full-screen at rest, overlay the home navigation, move the name and compact actions to the lower-left edge, and preserve the full six-map/fluid pipeline. Adjust framing so the demonstration subject's head stays in view. Keep touch controls below the header and clear of the caption/title, including 320×568.
- [x] Fix contraction exit: render bounds now retain the anchor's translation after sticky positioning releases. Previously the small portrait remained centered over the writing section. Two regression tests first failed with `top: 317` instead of `17`, then passed after the coordinate fix; the renderer stops issuing portrait passes once those bounds leave the viewport.
- [x] Complete an independent read-only review. Its one material finding was keyboard focus escaping behind the full-screen navigation. Add initial menu focus, forward/reverse Tab wrapping, Escape restoration, and reactive `inert` on the main content, footer and skip link. The integration test and real-browser check failed before the fix and passed afterwards; switching to search or navigating restores background interaction.
- [x] Inspect desktop, mobile and static-fallback screenshots. Desktop fallback uses contain framing; compact phone screens reposition the music token so it does not cover the name. Keep original demo attribution and replacement instructions.
- [x] Run the final frontend unit suite: **55 files / 415 tests passed**. `npm run build` passed TypeScript and Vite; the existing >500 kB chunk advisory remains. Asset validation and `git diff --check` passed. No changes to `liquidScene.ts`, `glassShaders.ts`, or their tests.
- [x] Run Chrome browser acceptance: **57/57 checks passed**, zero unexpected WebGL errors, zero uncaught page errors. Covers 1440×1000, 390×844, 320×740 and 320×568, DPR/resize, pointer reveal/decay, persistent manual selection, contraction/release, native touch scroll, route/search/login behavior, menu focus/inert restoration, Contact positioning, pause/reduced motion, disabled WebGL and missing texture. A separate 1280×720 layout check confirmed no overflow and caption/control clearance.

Reproduce acceptance with `BASE_URL=http://127.0.0.1:5181 PORTRAIT_REPORT_DIR=output/playwright/portrait-resume-final node scripts/quality/home-portrait.mjs` from `frontend`. Report and screenshots: `frontend/output/playwright/portrait-resume-final/`; unit/build logs: `frontend/output/playwright/portrait-resume-{unit,build}.log`. API reads still use empty fixtures, so this verifies the frontend experience, not backend availability. The reviewer did not assess pixel-identical reproduction or personal-photo quality; these are intentionally not claimed. Current subjects remain explicitly marked original demonstrations, not the owner's likeness.

All work remains local and uncommitted. No push or production deployment was performed; existing output was preserved.
