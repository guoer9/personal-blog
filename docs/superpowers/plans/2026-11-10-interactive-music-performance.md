# Interactive Music Performance Implementation Plan

> Use writing-plans and scoped parallel implementation for independent audio and navigation work. User explicitly authorized whole development with replaceable assets; no additional approval checkpoint. Preserve dirty workspace, no commits/push/deploy.

**Goal:** Deliver a coherent interactive music performance site with genuine audio-driven graphics and replaceable personal media.

**Architecture:** Existing Vue/Three.js shared runtime and Lenis remain. MainLayout owns one audio controller sampled by its existing beforeFrame. Homepage owns stage choreography, navigation/gallery share configurable media presentation.

**Tech Stack:** Vue 3, TypeScript, Three.js, Web Audio, Lenis, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-interactive-music-performance-design.md`

## Global constraints

- Original sphere base size/center and interactions remain, full motion retained.
- No new perpetual RAF, no autoplay sound, no media preload before user play.
- Existing APIs own content; temporary assets are artwork only.
- No reference edits, no backend migrations or database writes, no commit/push/deploy.
- No fictitious personal history or published music.

## Review focus

- Play/resume rejects or resolves after pause/track switch: no stale playback.
- Hidden tab, navigation, video playback: no orphaned/overlapping audio.
- Empty/failed API and broken art: complete visual fallback and actionable state.
- Narrow screen, keyboard, menu close: no lost controls/focus or scroll lock.
- WebGL/audio-analysis unavailable: content/playback stays usable; no second clock.

### Task 1: Audio controller and player

- [x] Build/test `src/audio/performanceAudio.ts` using spec interface, meaningful race/lifecycle and frequency tests.
- [x] Build `src/components/performance/PerformancePlayer.vue`, refactor only audio behavior of `WorkPlayer.vue`.
- [x] Verify targeted tests and record output.

### Task 2: Stage assets and homepage

- [x] Write `docs/content/music-performance-assets.md`, stage config, original SVG art and consistent artwork fallback.
- [x] Replace homepage layout with hero/signature/program/film/encore. Reuse interaction bridge and pageScroll.
- [x] Feed audio features into existing liquid scene; keep default behavior exact when features absent.
- [x] Provide a visually coherent WebGL failure state.
- [x] Verify homepage scene behavior, dimensions and media-only content selection.

### Task 3: Navigation and inner page design

- [x] Unified full-screen menu with visual preview, existing auth/search/focus behavior.
- [x] Music-led gallery and music detail stage, keep code/film access and routing.
- [x] About/portfolio copy and archive entry consistency, no invented facts.
- [x] Update meaningful behavioral tests for intentional navigation/copy/layout changes.

### Task 4: Integration and acceptance

- [x] MainLayout provides/ticks/disposes audio, routes share pause policy; stage transitions retain runtime handoff.
- [x] Full unit suite and build; resolve failures without discarding existing interaction coverage.
- [x] Real-browser visual and actual audio checks, mobile 390/320, keyboard/menu/empty/error/fallback.
- [x] Fresh code review, fix material findings, capture screenshots and final evidence.

## Execution ledger

- 2026-11-10: User selected interactive performance and explicitly requested complete development with temporary personal assets. Continue directly. Existing feature branch and dirty state preserved.
- Implementation allocation: main agent owns stage assets/Home/graphics/layout integration; audio worker owns controller/player; visual-pages worker owns navigation/gallery/detail/About/portfolio. Disjoint writes, shared interfaces defined above.

- Audio and visual-pages worker scopes were reviewed and integrated. Both workers released stable files; no unrelated changes discarded.
- Homepage intentionally removes frontloaded article/project walls; music player and artwork flank the unchanged centered sphere. Signature geometry still follows the shared pageScroll bus and existing scroll sequence.
- Fixed intrinsic image dimensions stretching the setlist; artwork now remains square. Fixed menu close on already-current Home/Contact links. MainLayout performance mode now checks the detail slug, so retained music selection cannot misclassify another detail page.
- Actual browser evidence: `frontend/output/playwright/music-performance/evidence.json` (17 checks) and `resilience.json` (15 checks); screenshots in the same directory. Real published music was decoded and analysed; no generated/fake music was added to content.
- Full unit suite: 505/505, 62 files. Build and public-entry bundle budget passed. Build retains Vite's large-chunk advisory; this is not a bundle-budget failure. MainLayout gzip ~166.6 kB; entry gzip ~61.9 kB.
- A resilience probe initially tried native scrollTo before Lenis inertia had stopped. Waiting for the existing smooth scroll to settle corrected the probe; no product scroll change was needed. Failure-state screenshots and both final browser reports show no uncaught page errors.
- Added route ownership assertions after the first all-green run; rerun targeted layout checks and final build after review before final delivery.

- Final review closed both P2 findings: interrupted AudioContext recovery and video-only/no-media music fallback. New tests were observed red before fixing. Independent original repro probes now pass 3/3; reviewer reports no outstanding focused findings.
- Final verification after all product edits: **510/510 tests, 63 files**, production build and entry bundle budget passed. Real-audio browser suite repeated 17/17; resilience 15/15, extra navigation/artwork 6/6, video-only WebGL fallback 1/1. No uncaught browser errors. No further product edits followed these checks.
- Acceptance record: `docs/research/39-music-performance-acceptance-2026-11-10.md`. Material replacement guide: `docs/content/music-performance-assets.md`. All four implementation tasks complete locally; no commit/push/deploy.
