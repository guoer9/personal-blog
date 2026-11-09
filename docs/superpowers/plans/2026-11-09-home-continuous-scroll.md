# Homepage Continuous Scroll Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans; preserve the dirty workspace and implement only the assigned files. User selected A and explicitly authorized execution on 2026-11-09; no additional approval checkpoint.

**Goal:** Keep the original central sphere and join the signature's final stroke to the writing heading through continuous scrolling.

**Architecture:** Reuse the reference's Lenis `lerp: 0.1` and `scroll`, publish them through the existing `VisualState.scrollY` route. A public frame hook runs before scene updates, keeping scrolling alive independently of WebGL availability. Home derives all positional progress directly from that shared position. Its SVG continuation uses the actual signature endpoint and heading anchor.

**Tech Stack:** Existing Vue/Three/Vite; Lenis 1.3.27 (registry verified). No GSAP or Rive migration.

**Spec:** `docs/research/37-home-transition-audit-2026-11-09.md`; user chose A and execution. This supersedes the old dock, manual controls and system reduced-motion requirements.

## Constraints

- Preserve full effects and original sphere base position/size; no second renderer or independent perpetual animation loop.
- Use the selected heading connector, not an article divider or an entire-site decorative path.
- Keep native touch gestures, keyboard/anchors, menu locking, routing, and WebGL fallback usable.
- No commit, push, deployment, backend change or reference-repository edit.

## Review Focus

- WebGL failure/context loss must not freeze smooth scrolling.
- Reversal and large wheel jumps must keep signature, connector and heading consistent.
- Real mobile article/project/principle layouts must not be internally clipped.
- Route/menu lifecycle must cancel inertia without adding duplicate tickers.
- Shared frame changes must preserve existing renderer lifecycle tests.

## Task 1: Restore sphere invariants and skip invisible portrait work

Files: liquidScene/HomeScene/PortraitEffect and their tests. Worker Hume owns these six files.

- [x] Replace docking/hero-scale contracts with original centered-size behavior, observe the new regression tests fail, restore original formulas.
- [x] Skip fully transparent portrait passes; verify reverse scrolling restores rendering.
- [x] Run the three focused test files and inspect the diff.

## Task 2: One shared scroll position

Files: VisualRuntime(.test), MainLayout(.test), new runtime/pageScroll.ts, frontend package/lock.

- [x] Test `beforeFrame(timeMs)` ordering and continued scheduling without graphics, observe failure.
- [x] Add an optional public frame hook, preserving existing behavior when absent.
- [x] Initialize Lenis with manual raf and lerp 0.1; publish scrollY once, measure anchors before rendering, notify Vue consumers synchronously. Stop on menu, reset on route, dispose on unmount.
- [x] Run runtime/layout tests including fallback, context loss and cleanup.

## Task 3: A continuous homepage and responsive content

Files: Home(.test), portraitMath(.test), ScrollReveal, ChenGuoSignature, pageStates.

- [x] Test immediate shared-position progress and reversible signature/connector interval mapping; remove the hard 5.5-second independent clock.
- [x] Use about 220svh as the initial hero track, overlap signature writing with portrait handoff and heading entrance; calibrate in the browser.
- [x] Connect the rendered SVG endpoint/tangent to the writing kicker with one reversible path outside hero clipping.
- [x] Restore content single-column mobile rules; use shared scroll progress for homepage reveals and actual section anchors for stage selection.
- [x] Keep sphere readable behind text with local soft backgrounds and soften section edges without disabling effects.

## Task 4: Validate and update contracts

Files: scripts/quality/home-portrait.mjs, research/spec notes and this plan.

- [x] Replace outdated shrinking/docking and wall-clock-only browser assertions; include nonempty article fixtures.
- [x] Test desktop/mobile forward, reverse, fast wheel, signature geometry, content widths, navigation, pointer effects and fallback. Inspect screenshots.
- [x] Run full frontend tests, build, and git diff --check; get a final code review and resolve material findings.

## Execution record

- Initial investigation found existing `VisualState.scrollY` and reference `Lenis.scroll` / `lerp: 0.1`; reuse these instead of additional per-element lag parameters.
- No full-effect reduction or system preference change is authorized.


## Completion evidence — 2026-11-10

The user supplied their actual handwritten signature during implementation. It supersedes the synthesized monoline character paths: the photo is rotated 90° counterclockwise and the real ink outline is traced into SVG. Seven inferred pen guides reveal the original contours, including varying thickness and ink gaps. `signatureEndpoint` supplies the continuation point/tangent; handwriting remains reversible with shared scroll progress. The original photo is not published. The standalone asset is `frontend/public/signatures/chen-guo.svg`.

- Full frontend suite: **59 files / 450 tests passed**. Log: `frontend/output/continuous-scroll-full-tests.log`.
- Production build: passed; pre-existing large-chunk warnings remain. Log: `frontend/output/continuous-scroll-build.log`.
- Chrome / Playwright acceptance: **95/95 checks passed**, 46 screenshots, zero uncaught page errors and zero shader/WebGL errors in enabled profiles. Report: `frontend/output/playwright/continuous-scroll-acceptance/report.json`.
- Browser coverage: 1440×1000 desktop; 390×844, 320×740 and 320×568 touch emulation; forward/reverse geometry, 720px and 2400px wheel, populated article/project/principle/resource layouts, menu locking, Contact/navigation/login return, resize/DPR, reduced OS preference, WebGL-disabled and missing-texture fallback.
- A 720px wheel advanced from 68px over 53 increasing frames to 720px, with zero sampled difference between actual scroll and hero progress. A 2400px wheel completed signature and connector without an independent offscreen catch-up clock.
- Pointer fluid verified using identical animation clocks and seeded procedural randomness: untouched baseline pixel difference 0; reveal 1.614 mean RGB difference; after 6 seconds decay 0.057. This replaces the invalid comparison against an unrelated earlier animated frame.
- Complete handwriting mask misses approximately 0.000124% of traced ink alpha (raster edge rounding); the authentic full outline is preserved.
- Delayed-content regression: after an intentionally delayed article failure, scrollY stayed 2062 while a newly visible project heading updated from opacity 0 to 0.34865 without another scroll input. Evidence: `delayed-layout.json` next to the browser report.
- Independent review identified shared-layout invalidation and doubled anchor offsets; both fixed. WebGL initialization failure visibility recovery has a dedicated runtime regression. Existing sphere position/scale, click/press, fluid and resource tests remain passing.
- `git diff --check` passed. No commit, push, deployment, backend or reference-source edits.

Limits: mobile checks use Chrome touch/viewport emulation, not physical iPhone/Safari hardware. Signature pen order is inferred from a still photograph, not an original stroke recording. Browser scenarios use deterministic nonempty fixtures; additional visual previews used the running real local API.
