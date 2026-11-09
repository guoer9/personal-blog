"""Orthographic rasterization of the bundled CC0 Poly Haven scan.

Uses original mesh position/normal/UV data and source material maps. All six
portrait outputs therefore share one visible surface, not invented anatomy.
"""
from pathlib import Path
import json
import math
import numpy as np
from PIL import Image

SOURCE = Path(__file__).parent / 'source' / 'marble-bust'


def rasterize(studio):
    model = json.loads((SOURCE / 'marble_bust_01.gltf').read_text())
    buffer = (SOURCE / model['buffers'][0]['uri']).read_bytes()
    def accessor(index):
        a = model['accessors'][index]; v = model['bufferViews'][a['bufferView']]
        size = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
        dtype = {5126: '<f4', 5123: '<u2'}[a['componentType']]
        return np.frombuffer(buffer, dtype=dtype, count=a['count'] * size,
                             offset=v.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(-1, size).copy()
    pos, normals, uv = [accessor(i) for i in range(3)]
    indices = accessor(3).reshape(-1, 3)
    # Slight three-quarter presentation, kept identical in both portrait layers.
    yaw = -.10
    rot = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
    pos = np.einsum('ij,kj->ik', pos, rot)
    normals = np.einsum('ij,kj->ik', normals, rot)
    pos[:, 0] -= (pos[:, 0].min() + pos[:, 0].max()) / 2
    pos *= 10
    pos[:, 1] -= 2.55
    def load(name): return np.asarray(Image.open(SOURCE / 'textures' / name).convert('RGB'), dtype=np.float32) / 255
    diff = load('marble_bust_01_diff_2k.jpg')
    diff = np.where(diff <= .04045, diff / 12.92, ((diff + .055) / 1.055) ** 2.4)
    normal_map = load('marble_bust_01_nor_gl_2k.jpg') * 2 - 1
    rough = load('marble_bust_01_rough_2k.jpg')
    def sample(tex, coords):
        xx = np.clip(coords[:, 0] * (tex.shape[1] - 1), 0, tex.shape[1] - 1)
        yy = np.clip(coords[:, 1] * (tex.shape[0] - 1), 0, tex.shape[0] - 1)
        x0, y0 = xx.astype(int), yy.astype(int)
        x1, y1 = np.minimum(x0 + 1, tex.shape[1] - 1), np.minimum(y0 + 1, tex.shape[0] - 1)
        fx, fy = (xx - x0)[:, None], (yy - y0)[:, None]
        return (tex[y0, x0] * (1-fx) + tex[y0, x1] * fx) * (1-fy) + (tex[y1, x0] * (1-fx) + tex[y1, x1] * fx) * fy
    def unit(v): return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-8)
    for face in indices:
        triangle = pos[face]
        px = (triangle[:, 0] / studio.dx + studio.w / 2 - .5)
        py = (studio.h / 2 - triangle[:, 1] / studio.dy - .5)
        x0, x1 = max(0, int(np.floor(px.min()))), min(studio.w - 1, int(np.ceil(px.max())))
        y0, y1 = max(0, int(np.floor(py.min()))), min(studio.h - 1, int(np.ceil(py.max())))
        if x0 > x1 or y0 > y1: continue
        den = (py[1]-py[2])*(px[0]-px[2]) + (px[2]-px[1])*(py[0]-py[2])
        if abs(den) < 1e-6: continue
        xx, yy = np.meshgrid(np.arange(x0,x1+1), np.arange(y0,y1+1))
        a = ((py[1]-py[2])*(xx-px[2]) + (px[2]-px[1])*(yy-py[2])) / den
        b = ((py[2]-py[0])*(xx-px[2]) + (px[0]-px[2])*(yy-py[2])) / den
        c = 1-a-b
        zz = a*triangle[0,2] + b*triangle[1,2] + c*triangle[2,2]
        mask = (a >= -1e-5) & (b >= -1e-5) & (c >= -1e-5) & (zz > studio.z[y0:y1+1,x0:x1+1])
        if not mask.any(): continue
        rows, cols = yy[mask], xx[mask]
        weights = np.stack([a[mask],b[mask],c[mask]],axis=-1)
        coords = np.einsum('ij,jk->ik', weights, uv[face])
        n = unit(np.einsum('ij,jk->ik', weights, normals[face]))
        # Tangent basis derived from this triangle's position and UV gradients.
        e1, e2 = triangle[1]-triangle[0], triangle[2]-triangle[0]
        t1, t2 = uv[face[1]]-uv[face[0]], uv[face[2]]-uv[face[0]]
        determinant = t1[0]*t2[1]-t1[1]*t2[0]
        if abs(determinant) > 1e-10:
            tangent = (e1*t2[1]-e2*t1[1])/determinant
            bitangent = (e2*t1[0]-e1*t2[0])/determinant
            t = unit(tangent - n * np.sum(n * tangent,axis=-1,keepdims=True))
            bvec = unit(np.cross(n,t))
            bvec *= np.sign(np.sum(bvec*bitangent,axis=-1,keepdims=True))
            detail = unit(sample(normal_map,coords))
            n = unit(t*detail[:,:1]+bvec*detail[:,1:2]+n*detail[:,2:3])
        studio.z[rows,cols] = zz[mask]
        studio.n[rows,cols] = n
        studio.color[rows,cols] = sample(diff,coords) * .8
        studio.rough[rows,cols] = np.clip(sample(rough,coords)[:,0],.42,.98)
        studio.coverage[rows,cols] = True
