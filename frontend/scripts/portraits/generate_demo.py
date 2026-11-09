#!/usr/bin/env python3
"""Bake aligned demonstration portraits from a CC0 scan and original bass geometry.

The bundled scan is Marble Bust 01, Rico Cilliers / Poly Haven (CC0).
This is an art study, not the site owner's likeness. See source/NOTICE.md.
Requires Python 3, NumPy, Pillow. Both views share the same camera and surface.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, __version__ as PILLOW_VERSION
from scan_surface import rasterize

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "public" / "portraits"
WIDTH, HEIGHT = 768, 960
RENDER_SCALE = 1.5
WORLD_WIDTH, WORLD_HEIGHT = 3.8, 4.75
DEPTH_MIN, DEPTH_MAX = -1.65, 1.65
MAPS = ("diffuse", "alpha", "depth", "normal", "roughness", "shadow")
COLORS = {
    "porcelain": (0.69, 0.78, 0.79),
    "ear": (0.53, 0.64, 0.65),
    "hair": (0.065, 0.105, 0.12),
    "suit": (0.055, 0.105, 0.105),
    "lapel": (0.085, 0.15, 0.145),
    "acid": (0.66, 0.89, 0.15),
    "dark": (0.018, 0.035, 0.038),
    "metal": (0.39, 0.51, 0.53),
    "bass": (0.035, 0.065, 0.060),
}


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-8)


def srgb(linear):
    linear = np.clip(linear, 0, 1)
    return np.where(linear <= 0.0031308, linear * 12.92,
                    1.055 * linear ** (1 / 2.4) - 0.055)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


class Studio:
    """Camera-facing geometric surfaces, composited by nearest z intersection."""

    def __init__(self):
        self.w, self.h = round(WIDTH * RENDER_SCALE), round(HEIGHT * RENDER_SCALE)
        self.dx = WORLD_WIDTH / self.w
        self.dy = WORLD_HEIGHT / self.h
        xs = (np.arange(self.w, dtype=np.float32) + 0.5) * self.dx - WORLD_WIDTH / 2
        ys = WORLD_HEIGHT / 2 - (np.arange(self.h, dtype=np.float32) + 0.5) * self.dy
        self.x, self.y = np.meshgrid(xs, ys)
        shape = (self.h, self.w)
        self.z = np.full(shape, DEPTH_MIN, np.float32)
        self.n = np.zeros((*shape, 3), np.float32)
        self.color = np.zeros((*shape, 3), np.float32)
        self.rough = np.zeros(shape, np.float32)
        self.coverage = np.zeros(shape, bool)

    def surface(self, mask, z, color, rough=0.52, normal=None):
        if normal is None:
            dzdy, dzdx = np.gradient(z, -self.dy, self.dx)
            normal = unit(np.stack((-dzdx, -dzdy, np.ones_like(z)), axis=-1))
        visible = mask & (z > self.z)
        if not np.any(visible):
            return
        self.z[visible] = z[visible]
        self.n[visible] = normal[visible]
        if isinstance(color, str):
            color = COLORS[color]
        if np.ndim(color) == 1:
            self.color[visible] = color
        else:
            self.color[visible] = color[visible]
        if np.ndim(rough) == 0:
            self.rough[visible] = rough
        else:
            self.rough[visible] = rough[visible]
        self.coverage[visible] = True

    def ellipsoid(self, center, radii, color="porcelain", rough=0.4, angle=0):
        # The z axis remains camera-facing; rotation in the image plane is exact.
        c, s = math.cos(angle), math.sin(angle)
        x = (self.x - center[0]) * c + (self.y - center[1]) * s
        y = -(self.x - center[0]) * s + (self.y - center[1]) * c
        q = (x / radii[0]) ** 2 + (y / radii[1]) ** 2
        local_z = radii[2] * np.sqrt(np.maximum(1 - q, 0))
        z = center[2] + local_z
        nx, ny = x / radii[0] ** 2, y / radii[1] ** 2
        n = unit(np.stack((nx * c - ny * s, nx * s + ny * c,
                           local_z / radii[2] ** 2), axis=-1))
        self.surface(q <= 1, z, color, rough, n)

    def capsule(self, a, b, radius, color="porcelain", rough=0.4, depth_radius=None):
        # A swept elliptical cylinder and rounded end caps form sculpted limbs.
        mid = (np.asarray(a) + np.asarray(b)) / 2
        delta = np.asarray(b) - np.asarray(a)
        length = float(np.linalg.norm(delta[:2]))
        angle = math.atan2(delta[1], delta[0])
        c, s = math.cos(angle), math.sin(angle)
        along = (self.x - mid[0]) * c + (self.y - mid[1]) * s
        cross = -(self.x - mid[0]) * s + (self.y - mid[1]) * c
        end = np.maximum(np.abs(along) - length / 2, 0)
        if isinstance(radius, tuple):
            radius = np.interp(along, [-length / 2, length / 2], radius)
        q = (cross * cross + end * end) / radius ** 2
        zr = radius if depth_radius is None else depth_radius
        z = mid[2] + np.clip(along / max(length, 0.001), -0.5, 0.5) * delta[2]
        z = z + zr * np.sqrt(np.maximum(1 - q, 0))
        self.surface(q <= 1, z, color, rough)

    def polygon(self, vertices, z, color="lapel", rough=0.5, bevel=0):
        image = Image.new("1", (self.w, self.h))
        points = [((x / WORLD_WIDTH + 0.5) * self.w,
                   (0.5 - y / WORLD_HEIGHT) * self.h) for x, y in vertices]
        ImageDraw.Draw(image).polygon(points, fill=1)
        mask = np.array(image, dtype=bool)
        zz = np.full_like(self.z, z) if np.ndim(z) == 0 else z
        if bevel:
            distance = np.full_like(self.z, 20)
            for a, b in zip(vertices, vertices[1:] + vertices[:1]):
                ax, ay = a
                bx, by = b
                vx, vy = bx - ax, by - ay
                t = np.clip(((self.x - ax) * vx + (self.y - ay) * vy) / (vx * vx + vy * vy), 0, 1)
                d = np.sqrt((self.x - ax - t * vx) ** 2 + (self.y - ay - t * vy) ** 2)
                distance = np.minimum(distance, d)
            zz = zz + bevel * smoothstep(0, 0.10, distance)
        self.surface(mask, zz, color, rough)

    def bass(self):
        # Instrument coordinates: v runs along the neck, u across the strings.
        center = np.array([-0.40, -1.24])
        axis = np.array([0.48, 0.8772685])
        across = np.array([axis[1], -axis[0]])
        u = (self.x - center[0]) * across[0] + (self.y - center[1]) * across[1]
        v = (self.x - center[0]) * axis[0] + (self.y - center[1]) * axis[1]

        def world(point):
            return tuple(center + across * point[0] + axis * point[1])

        def poly(points, z, color, rough=0.4, bevel=0):
            self.polygon([world(p) for p in points], z, color, rough, bevel)

        def line(a, b, radius, z, color="metal", rough=0.3):
            wa, wb = world(a), world(b)
            self.capsule((*wa, z), (*wb, z), radius, color, rough, radius * 0.35)

        def curved(points, steps=7):
            result = []
            for index in range(len(points)):
                p0 = np.array(points[(index - 1) % len(points)])
                p1 = np.array(points[index])
                p2 = np.array(points[(index + 1) % len(points)])
                p3 = np.array(points[(index + 2) % len(points)])
                for t in np.linspace(0, 1, steps, endpoint=False):
                    result.append(tuple(0.5 * ((2 * p1) + (-p0 + p2) * t + (2*p0 - 5*p1 + 4*p2 - p3)*t*t + (-p0 + 3*p1 - 3*p2 + p3)*t*t*t)))
            return result

        body = [(-0.09, 0.56), (-0.16, 0.90), (-0.27, 0.97), (-0.34, 0.82), (-0.26, 0.49), (-0.40, 0.31), (-0.57, 0.13), (-0.61, -0.19), (-0.47, -0.51), (-0.19, -0.65), (0.17, -0.63), (0.46, -0.44), (0.55, -0.17), (0.49, 0.10), (0.31, 0.33), (0.25, 0.50), (0.32, 0.72), (0.26, 0.79), (0.15, 0.64), (0.08, 0.47)]
        poly(curved(body), 1.01, "bass", 0.34, 0.075)
        # Thin perimeter inlay follows the actual body boundary.
        inset = [(pu * 0.957, pv * 0.957 - 0.004) for pu, pv in body]
        poly(curved(inset), 1.023, "acid", 0.38, 0.07)
        inner = [(pu * 0.940, pv * 0.940 - 0.006) for pu, pv in body]
        poly(curved(inner), 1.032, "bass", 0.34, 0.073)
        pickguard = [(-0.075, 0.52), (-0.18, 0.60), (-0.22, 0.40), (-0.40, 0.20), (-0.38, -0.13), (-0.24, -0.29), (0.16, -0.31), (0.25, -0.12), (0.12, 0.19), (0.065, 0.48)]
        poly(curved(pickguard, 5), 1.115, "dark", 0.40, 0.01)
        # Neck, 20 visible frets, tapered headstock, and four tuning machines.
        poly([(-0.105, 0.40), (-0.075, 2.20), (0.075, 2.20), (0.105, 0.40)], 1.125, "metal", 0.48, 0.012)
        poly([(-0.084, 0.43), (-0.060, 2.18), (0.060, 2.18), (0.084, 0.43)], 1.143, "hair", 0.52)
        headstock = [(-0.078, 2.15), (-0.10, 2.53), (-0.02, 2.73), (0.10, 2.71), (0.13, 2.55), (0.065, 2.31), (0.071, 2.15)]
        poly(curved(headstock, 4), 1.13, "bass", 0.38, 0.018)
        for index in range(20):
            fv = 2.13 - 1.68 * (1 - 2 ** (-(index + 1) / 12)) / (1 - 2 ** (-20 / 12))
            half = 0.061 + (2.18 - fv) * 0.0135
            line((-half, fv), (half, fv), 0.0045, 1.160)
            if index in (2, 4, 6, 8, 11, 14, 16, 18):
                px, py = world((0, fv + 0.025))
                self.ellipsoid((px, py, 1.159), (0.009, 0.009, 0.0025), "porcelain", 0.5)
        # Split-coil pickups, bridge plate, individual saddles, control knobs.
        for offset_u, offset_v in [(-0.043, 0.16), (0.043, 0.115), (0, -0.045)]:
            poly([(offset_u-.105, offset_v-.032), (offset_u+.105, offset_v-.032), (offset_u+.105, offset_v+.032), (offset_u-.105, offset_v+.032)], 1.175, "hair", 0.38, 0.009)
        poly([(-0.105, -0.36), (0.105, -0.36), (0.105, -0.24), (-0.105, -0.24)], 1.17, "metal", 0.24, 0.012)
        for index in range(4):
            su = (index - 1.5) * 0.039
            line((su, -0.33), (su, -0.25), 0.014, 1.189, "metal", 0.2)
            line((su, -0.30), (su * 0.64, 2.49 + index * 0.035), 0.0032 - index * 0.00035, 1.205, "porcelain", 0.18)
            tv = 2.28 + index * 0.105
            line((-0.055, tv), (-0.143, tv), 0.009, 1.164)
            px, py = world((-0.163, tv))
            self.ellipsoid((px, py, 1.165), (0.030, 0.022, 0.012), "metal", 0.22, -0.5)
        line((-0.064, 2.135), (0.064, 2.135), 0.011, 1.175, "porcelain", 0.36)
        for position in [(0.32, -0.15), (0.30, -0.30), (0.21, -0.43)]:
            px, py = world(position)
            self.ellipsoid((px, py, 1.123), (0.027, 0.027, 0.020), "metal", 0.25)
    def bake(self, mode):
        mask = self.coverage
        normals = self.n
        light = unit(np.array([-0.58, 0.68, 0.58], np.float32))
        ndotl = np.clip(np.sum(normals * light, axis=-1), 0, 1)
        # Screen-space horizon occlusion from the SAME visible depth surface.
        # Nearby depth jumps (nose/orbits, jaw/collar, fingers/strings) reduce AO.
        ao = np.zeros_like(self.z)
        count = 0
        for radius in (4, 10, 23):
            for angle in np.linspace(0, 2 * math.pi, 8, endpoint=False):
                ox, oy = round(math.cos(angle) * radius), round(math.sin(angle) * radius)
                other_z = np.roll(self.z, (oy, ox), axis=(0, 1))
                other_mask = np.roll(mask, (oy, ox), axis=(0, 1))
                distance = radius * self.dx
                horizon = np.clip((other_z - self.z - distance * 0.35) / (distance * 2.0), 0, 1)
                ao += horizon * other_mask
                count += 1
        ao = np.clip(1 - 1.8 * ao / count, 0.35, 1)
        shadow = np.clip((0.65 + 0.35 * ndotl) * ao, 0, 1)
        # Poster uses separate cool key, warm low fill and a slim reflective rim.
        view = np.array([0, 0, 1], np.float32)
        halfvec = unit(light + view)
        ndoth = np.clip(np.sum(normals * halfvec, axis=-1), 0, 1)
        spec_power = 12 + (1 - self.rough) * 115
        spec = ndoth ** spec_power * (1 - self.rough) * 0.56
        fill_light = unit(np.array([0.76, -0.16, 0.62], np.float32))
        fill = np.clip(np.sum(normals * fill_light, axis=-1), 0, 1)
        fresnel = (1 - np.clip(normals[..., 2], 0, 1)) ** 4
        lit = self.color * ((0.22 + 0.95 * ndotl) * ao)[..., None]
        lit += self.color * fill[..., None] * np.array([0.16, 0.18, 0.13])
        lit += spec[..., None] * np.array([0.60, 0.77, 0.83])
        lit += fresnel[..., None] * np.array([0.05, 0.10, 0.12]) * 0.42
        alpha = mask.astype(np.float32)
        folder = DEST / mode
        folder.mkdir(parents=True, exist_ok=True)

        def save(name, data, channels, gamma=False):
            if gamma:
                data = srgb(data)
            if channels == "RGBA":
                data = np.concatenate([data, alpha[..., None]], axis=-1)
            data = np.clip(np.round(data * 255), 0, 255).astype(np.uint8)
            image = Image.fromarray(data)
            image = image.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
            image.save(folder / f"{name}.png", optimize=True)

        albedo = self.color.copy()
        albedo[~mask] = 0
        save("diffuse", albedo, "RGBA", gamma=True)
        save("alpha", alpha, "L")
        depth = np.where(mask, (self.z - DEPTH_MIN) / (DEPTH_MAX - DEPTH_MIN), 0)
        save("depth", np.clip(depth, 0, 1), "L")
        normal_rgb = normals * 0.5 + 0.5
        normal_rgb[~mask] = (0.5, 0.5, 1.0)
        save("normal", normal_rgb, "RGB")
        save("roughness", np.where(mask, self.rough, 1), "L")
        save("shadow", np.where(mask, shadow, 1), "L")
        lit[~mask] = 0
        save("preview", lit, "RGBA", gamma=True)
        print(f"Rendered {mode}: {WIDTH}×{HEIGHT}; {mask.mean():.1%} projected coverage", flush=True)


def manifest():
    contract = {
        "diffuse": ("RGBA", "sRGB", "Unlit linear material albedo encoded as sRGB; A is geometric silhouette coverage."),
        "alpha": ("R (8-bit grayscale)", "linear / NoColorSpace", "Antialiased geometric z-buffer coverage; 0 background, 1 surface."),
        "depth": ("R (8-bit grayscale)", "linear / NoColorSpace", "Camera-space visible-surface z; 0 farther, 1 nearer. Global range [-1.65, 1.65] scene units."),
        "normal": ("RGB", "linear / NoColorSpace", "Camera/tangent-aligned surface normal encoded n*0.5+0.5. +X right, +Y up, +Z toward camera; green is OpenGL orientation."),
        "roughness": ("R (8-bit grayscale)", "linear / NoColorSpace", "Scan roughness texture plus original instrument material roughness; white rough, black smooth."),
        "shadow": ("R (8-bit grayscale)", "linear / NoColorSpace", "Visible-depth horizon AO multiplied by geometric diffuse light visibility; white unoccluded, dark shaded."),
    }
    portraits = {}
    for mode in ("front", "bass"):
        portraits[mode] = {
            "id": mode, "isDemo": True, "width": WIDTH, "height": HEIGHT,
            "subject": "CC0 scanned marble bust by Rico Cilliers / Poly Haven" + (", composed with an original four-string electric bass; no fabricated hands" if mode == "bass" else ""),
            "sameSubjectAs": "bass" if mode == "front" else "front",
            "preview": {"path": f"/portraits/{mode}/preview.png", "channels": "RGBA", "colorSpace": "sRGB", "purpose": "Separately studio-lit static fallback, with transparent background; same geometry and framing as maps."},
            "maps": {name: {"path": f"/portraits/{mode}/{name}.png", "width": WIDTH, "height": HEIGHT,
                            "channels": values[0], "colorSpace": values[1], "provenance": values[2],
                            "bytes": (DEST / mode / f"{name}.png").stat().st_size,
                            "sha256": hashlib.sha256((DEST / mode / f"{name}.png").read_bytes()).hexdigest()}
                     for name, values in contract.items()},
        }
    data = {
        "version": 1, "isDemo": True,
        "provenance": {
            "kind": "cc0-scan-and-original-instrument",
            "generator": "frontend/scripts/portraits/generate_demo.py",
            "generatorVersion": 2,
            "sourceFiles": {str(path.relative_to(Path(__file__).parent)): hashlib.sha256(path.read_bytes()).hexdigest()
                            for path in sorted((Path(__file__).parent / "source").rglob("*")) if path.is_file()},
            "rasterizerSHA256": hashlib.sha256((Path(__file__).parent / "scan_surface.py").read_bytes()).hexdigest(),
            "generatorSHA256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "externalAssets": [{"name": "Marble Bust 01", "author": "Rico Cilliers", "source": "https://polyhaven.com/a/marble_bust_01", "license": "CC0-1.0", "licenseSource": "https://polyhaven.com/license", "localSource": "frontend/scripts/portraits/source/marble-bust"}],
            "subjectDisclosure": "A scanned marble sculpture and original bass composition, not GUOER's likeness or a photograph of the owner.",
            "rights": "Marble bust mesh and source textures are CC0 by Rico Cilliers / Poly Haven. Instrument geometry and composition are original. No reference-site imagery.",
            "method": "Orthographic triangle rasterization of the scan with interpolated UV material textures and tangent-space normal detail, plus analytic instrument geometry, resolved through a nearest-surface z-buffer. All outputs share the same orthographic projection and alpha coverage.",
            "dependencies": ["Python 3", "NumPy", "Pillow"],
            "generatedWith": {"python": platform.python_version(), "numpy": np.__version__, "pillow": PILLOW_VERSION},
            "reproduce": "python3 frontend/scripts/portraits/generate_demo.py",
            "validate": "python3 frontend/scripts/portraits/generate_demo.py --validate",
            "deterministic": True,
        },
        "coordinateSystem": {"projection": "orthographic", "worldWidth": WORLD_WIDTH, "worldHeight": WORLD_HEIGHT,
                             "camera": "+Z looking toward -Z", "depthRange": [DEPTH_MIN, DEPTH_MAX],
                             "renderScale": RENDER_SCALE, "outputWidth": WIDTH, "outputHeight": HEIGHT,
                             "framing": "Identical scan, eye line, scale and crop in both modes. Bass is additional geometry; no invented human hands or body."},
        "portraits": portraits,
        "replacement": {
            "metadataFile": "frontend/src/graphics/scenes/home/portraitAssets.ts",
            "instructions": [
                "Supply an authorized front portrait and a bass-holding portrait of the same subject; keep head size, eye line, crop and image dimensions aligned.",
                "Replace all six PNG maps plus preview.png in both front/ and bass/. Use the channel and color-space conventions recorded above; do not substitute a photo for the linear data maps.",
                "Use cutout coverage in alpha and diffuse A. Encode depth with a shared near/far convention and OpenGL (+Y) normals. Set neutral outside pixels to depth 0, normal (128,128,255), roughness 255, shadow 255.",
                "Record the source authorization, processing tool/version and actual generation provenance for each map. Depth estimated from photographs must be disclosed as estimated, rather than geometric ground truth.",
                "Update width, height, alt, preview and map URLs in portraitAssets.ts; set isDemo false only for verified owner-supplied portraits and replace the demonstration disclosure in the DOM.",
                "Run the asset Vitest file, generator --validate (for the PNG contract), frontend build and desktop/mobile fallback checks before publishing.",
            ],
        },
    }
    (DEST / "manifest.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def validate():
    for mode in ("front", "bass"):
        alpha = np.asarray(Image.open(DEST / mode / "alpha.png"))
        assert alpha.shape == (HEIGHT, WIDTH)
        assert 0.2 < np.mean(alpha > 127) < 0.8
        for name in (*MAPS, "preview"):
            path = DEST / mode / f"{name}.png"
            image = Image.open(path)
            assert image.size == (WIDTH, HEIGHT), path
            assert image.mode == {"diffuse": "RGBA", "normal": "RGB", "preview": "RGBA"}.get(name, "L"), path
            if name in ("depth", "normal", "roughness", "shadow"):
                pixels = np.asarray(image)
                if pixels.ndim == 3:
                    pixels = pixels[..., 0]
                assert len(np.unique(pixels[alpha > 240])) > 12, path
        print(f"Validated {mode}: all six maps + RGBA fallback; aligned and nonconstant")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validate", action="store_true", help="Validate existing bundles without regenerating")
    args = parser.parse_args()
    if args.validate:
        validate()
        return
    for mode in ("front", "bass"):
        scene = Studio()
        rasterize(scene)
        if mode == "bass":
            scene.bass()
        scene.bake(mode)
        del scene
    manifest()
    validate()


if __name__ == "__main__":
    main()
