# Home Portrait Scene and Navigation Design

Status: approved for initial implementation by user on 2026-11-08
Date: 2026-11-08

> Superseded interaction requirements (2026-11-10): the user removed Front/Bass, Motion and boxed identity controls and explicitly requested full effects regardless of OS reduced-motion preference. Preserve the original centered sphere size/pose, without hero scaling or writing-sidebar docking. The user selected the signature-to-writing-heading connector and later supplied their own handwriting. Current scope and validation are in `../plans/2026-11-09-home-continuous-scroll.md`; contradictory requirements below are historical, not acceptance criteria.

## Intent

Make the personal-blog home page read as GUOER's personal calling card. Replace the abstract-only first impression with a full depth-displaced portrait treatment that can reveal a second photo of GUOER holding a bass and place small identity details around the subject. Follow the reference site's actual portrait-rendering structure rather than simplifying it to DOM image swaps. Make the shared navigation prioritize the routes people need to understand the person and their work, while keeping writing, documents, search, authentication, and existing route behavior available.

## Goals

- Render each portrait image with the source reference's high-subdivision, depth-displaced plane and a replaceable texture set: diffuse, alpha, depth, normal, roughness, and shadow.
- Use the shared Three.js runtime for portrait movement, pointer-driven reveal, fluid cursor field, noise/background, and final composition. The bass photo is the revealed portrait layer, replacing the reference helmet layer while keeping its interaction and render-target structure.
- Keep the interaction usable by touch, keyboard, screen readers, reduced-motion users, and browsers without WebGL; provide a manual photo selector in addition to pointer reveal.
- Use profile details already in `frontend/src/data/portfolio.ts` for floating labels; avoid inventing biographical facts.
- Make Works and About the primary header destinations, with Contact as the most prominent action. Keep Writing and Documents available as secondary destinations.
- Keep all existing public routes, search, login state, and admin-route separation intact.

## Non-goals and Anti-goals

- No rigged full-head mesh or invented likeness of GUOER. The source reference itself uses depth-displaced portrait planes, not a rigged 3D head.
- No removal of the existing shared Three.js runtime or its home scene.
- No new backend fields, routes, article/works APIs, or admin navigation.
- Do not use Lando Norris imagery, copy, or source assets as personal-blog content.
- Do not let floating details obscure the portrait, page title, controls, or navigation.

## Constraints

- `personal-blog` is the implementation repository. `land` is a reference-source repository; its README may describe its read-only reference purpose, but its application source remains untouched.
- `MainLayout.vue` owns the single shared WebGL renderer and canvas. `ImmersiveScene.vue` is the home visual's DOM layer; the existing runtime remains in place.
- Preserve the existing glass and liquid implementation in `frontend/src/graphics/glassShaders.ts`, `glassShaders.test.ts`, `liquidScene.ts`, and `liquidScene.test.ts`, and untracked `frontend/output/`. This design avoids those files. At implementation start, only this spec and `frontend/output/` were untracked.
- No real portrait or bass photos are currently present in the frontend assets. The first pass may use clearly identified, legally reusable public demonstration photos, with complete per-image texture sets in the same replaceable format. They must never be presented as GUOER's actual likeness. If suitable licensed source images cannot be found, retain a designed photo slot while still building and validating the renderer with a documented test fixture.
- All user-supplied replacements must be drop-in assets with a manifest documenting path, dimensions, color space, channel/alpha expectations, and map generation provenance.
- Contact can target the existing About page section at `/about#connect`.

## Approaches

### A. Full depth-displaced portrait pipeline in the shared runtime — selected

Create a home-owned portrait effect module that uses the existing single renderer and frame loop. Each photo is a high-subdivision plane (128 by 128 segments, adjustable displacement scale) with its own diffuse, alpha, depth, normal, roughness, and shadow maps. Render the front portrait and bass portrait into separate targets, then reveal the second through pointer/fluid and manual state using the final composition shader. Preserve damped portrait/camera response, procedural background noise, responsive sizing, reduced-motion handling, quality adaptation, and explicit GPU-resource disposal. Keep the current liquid scene as a subdued atmospheric background, then composite the new portrait treatment over it in the same shared WebGL context. Add floating identity labels in DOM so they remain crisp and accessible, positioned around registered scene bounds without blocking primary actions.

This adapts the rendering pipeline documented for the reference site; it does not reproduce its literal scene topology. The reference renders its portrait plane and helmet wireframe together, then renders a separate helmet GLB target. This design instead renders two depth-displaced portrait planes and reveals the bass photo in place of the helmet target. It does not pretend a 2D portrait plane is a complete 3D head. The effect remains in the existing shared WebGL context and avoids the user's modified `liquidScene.ts` and glass-shader files.

### B. Independent head mesh / head reconstruction

Build or obtain a full 3D head model and project the portraits onto it. This can produce stronger head rotation, but it changes the source effect's geometry, needs a suitable licensed model and careful identity fitting, and is unnecessary for a pointer-led photo portrait. It is not selected unless the user later asks for a true rotating head.

### C. DOM-only portrait swap

Place both photos in the DOM and switch with a CSS mask. This is simpler, but omits depth displacement, fluid reveal, render targets, and shader composition present in the reference. It is explicitly rejected as a cut-down implementation.

## Navigation Direction

### Full-screen revision — 2026-11-09

The user's reference screenshots and follow-up correction supersede the initial split hero composition. Run `land/src` locally as a read-only visual reference. The portrait fills the first viewport, with the name and concise identity/actions at the lower-left edge, personal tokens around the subject, and navigation overlaid at the top. A desktop homepage menu exposes Works/About/Contact before Writing/Documents; inner pages retain their inline navigation. The full six-map/fluid pipeline remains required.

The hero stays viewport-sized throughout a two-viewport sticky track. Only the portrait render bounds contract toward a centered compact area. Once sticky positioning releases, the portrait must translate with its anchor and leave the viewport before covering the writing section. Check both contraction and the released/fully exited states; measuring the DOM's full-screen dimensions alone does not prove the GPU image leaves correctly. Touch controls remain below the header and clear of the name; selected static fallback remains available when motion or WebGL is unavailable.

- Keep the existing shared `SiteHeader.vue` and Vue Router contracts.
- Order the main route links as Works, About, Writing, Documents; style Works and About as primary while Documents is lower emphasis.
- Add a high-visibility Contact action linking to `/about#connect`.
- Give the mobile menu a more deliberate hierarchy and larger route rows; put Contact beside or directly after Works and About, ahead of secondary destinations.
- Preserve global search, login/user/logout behavior, focus handling, and the rule that admin destinations do not appear in public navigation.
- Keep secondary routes discoverable through existing footer and contextual links.

## Interaction and Accessibility

- Pointer movement updates the displacement/parallax and fluid reveal within the portrait bounds; it must not block links, page scrolling, or touch gestures.
- Provide a native two-option button group for front/bass selection. The selector provides a persistent reveal state; pointer reveal remains available on mouse/pen.
- Keep the canvas aria-hidden. Provide a DOM semantic description of both portraits and a named two-button selector; update its polite status only when the manual selection changes, not on each pointer movement. Store editable alt text beside the asset manifest so public placeholders and later personal-photo replacements are described accurately.
- Hide decorative orbit marks from assistive technology; floating labels remain semantic text when they add identity information not already stated in the page copy.
- Disable continuous image motion under `prefers-reduced-motion`; retain manual state switching.
- Keep the existing pause control and shared-renderer fallback behavior.

## Validation

- Unit tests cover image fallback, pointer reveal bounds/state, touch/manual switching, active navigation routes, Contact target, and preserved search/auth behavior.
- Run the focused Vue tests, the frontend unit suite, and `npm run build`.
- Verify desktop and mobile in a real browser, including no-photo fallback, a supplied-photo pass if assets arrive, reduced motion, keyboard focus, and WebGL fallback.

## Builder Decisions

- Add a home-scene portrait module that borrows renderer/input/lifecycle ownership from `VisualRuntime`; do not create a second renderer, canvas, or RAF.
- Store the two replaceable source photos and six-map bundles under a documented `frontend/public/` asset directory, with a manifest and a small asset-preparation script or clear reproducible instructions.
- Reuse source shader ideas and contracts, not the Lando site code or protected source assets.
- Preserve the current route set and authentication behavior; this is a hierarchy and presentation change, not a routing redesign.
- Compose the portrait pass after the current liquid background and restore renderer state after the pass; keep all new render targets, textures, materials, and geometry owned and released by the portrait module.
