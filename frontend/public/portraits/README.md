# Portrait demonstration studies

These images depict the CC0 **Marble Bust 01** scan by **Rico Cilliers / Poly Haven**, combined with an original unbranded four-string bass. They are **not GUOER / 陈果’s likeness** or personal photographs. The two views share the same sculpture, eye line, camera, material and crop. The second view is an artistic bass composition, without invented hands.

Source and authorization: https://polyhaven.com/a/marble_bust_01 and https://polyhaven.com/license (CC0-1.0, checked 2026-11-09). The source glTF and 2K maps are bundled in `frontend/scripts/portraits/source/marble-bust`; details are in `source/NOTICE.md`. No reference-site imagery is included.

## Reproduce and validate

From the repository root, with Python 3, NumPy and Pillow available:

```sh
python3 frontend/scripts/portraits/generate_demo.py
python3 frontend/scripts/portraits/generate_demo.py --validate
cd frontend
npm test -- src/graphics/scenes/home/portraitAssets.test.ts
```

The generator is deterministic. It rasterizes the source mesh with barycentric UVs and tangent-space normal detail, plus original instrument surfaces, through an orthographic z-buffer. Every bundle is **768 × 960 pixels**. Geometry is rendered at 1.5× output resolution before downsampling for silhouette antialiasing. The actual visible surface supplies depth and normals; roughness comes from materials; a depth-horizon occlusion calculation supplies the shading map. The poster receives independent studio lighting from these same surfaces.

`manifest.json` records the exact projection, depth range, channels, color spaces, source disclosure and replacement procedure. All seven images in a bundle share a pixel-aligned projection and crop.

| File | Channels / color space | Meaning |
| --- | --- | --- |
| `diffuse.png` | RGBA / sRGB | Unlit material albedo; A is coverage. |
| `alpha.png` | grayscale R / linear | Geometric coverage, 0 background to 255 foreground. |
| `depth.png` | grayscale R / linear | 0 farther to 255 nearer, common world-z range −1.65 to 1.65. |
| `normal.png` | RGB / linear | Surface normal encoded `n * 0.5 + 0.5`; +X right, +Y up, +Z toward camera (OpenGL green). |
| `roughness.png` | grayscale R / linear | Black smooth, white rough; material and relief variation. |
| `shadow.png` | grayscale R / linear | Depth-based ambient occlusion and geometric light visibility; white unoccluded. |
| `preview.png` | RGBA / sRGB | Lit transparent static fallback; never a replacement for the diffuse/data maps. |

Only diffuse and preview use sRGB decoding. Data maps use no color transform. Alpha is authoritative outside the silhouette. Neutral exterior values are depth 0, normal `(128,128,255)`, roughness 255 and shadow 255; filter antialiasing may blend boundary pixels.

## Replace with personal portraits

1. Supply authorized front and bass portraits of the same person, aligned by eye line, head size and crop. Keep equal dimensions and the 4:5 aspect ratio, or update the typed metadata together with every map.
2. Replace **all six maps and `preview.png`** under both `front/` and `bass/`. Extract a clean cutout, generate shared-range depth and OpenGL normal maps, assign roughness, and generate occlusion/shadow. A constant gray image is not a valid depth or normal replacement.
3. Update the manifest with source authorization and actual processing provenance. Monocular depth from photographs is estimated; disclose that distinction. These scanned fixtures use known geometry and make no claim about photo reconstruction quality.
4. Update `src/graphics/scenes/home/portraitAssets.ts`: dimensions, URLs if changed, factual alt text and `isDemo`. Remove the public demonstration label only after the real supplied portraits are installed.
5. Run PNG validation, the focused asset test, the frontend build and desktop/mobile fallback checks. Inspect both preview images and test map-load failure before publication.

The generated PNGs are committed as small, reproducible demonstration assets. They are suitable for exercising displacement, parallax, fluid reveal and meaningful static fallback while personal photographs are unavailable.
