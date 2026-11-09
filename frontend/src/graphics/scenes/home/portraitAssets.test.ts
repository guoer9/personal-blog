// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { portraitAssets } from './portraitAssets'

const publicRoot = fileURLToPath(new URL('../../../../public', import.meta.url))
const mapNames = ['diffuse', 'alpha', 'depth', 'normal', 'roughness', 'shadow'] as const

/** Decode the lossless PNG fixtures so blank maps cannot satisfy the asset contract. */
function png(url: string) {
  const source = readFileSync(`${publicRoot}${url}`)
  expect(source.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const width = source.readUInt32BE(16)
  const height = source.readUInt32BE(20)
  expect(source[24]).toBe(8)
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[source[25]!]
  if (!channels) throw new Error(`Unsupported PNG format: ${url}`)
  const chunks: Buffer[] = []
  for (let offset = 8; offset < source.length;) {
    const length = source.readUInt32BE(offset)
    if (source.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      chunks.push(source.subarray(offset + 8, offset + 8 + length))
    }
    offset += length + 12
  }
  const bytes = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const pixels = new Uint8Array(width * height * channels)
  const paeth = (a: number, b: number, c: number) => {
    const value = a + b - c
    const distances = [Math.abs(value - a), Math.abs(value - b), Math.abs(value - c)]
    return distances[0]! <= distances[1]! && distances[0]! <= distances[2]! ? a : distances[1]! <= distances[2]! ? b : c
  }
  for (let y = 0; y < height; y++) {
    const filter = bytes[y * (stride + 1)]!
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels]! : 0
      const above = y ? pixels[(y - 1) * stride + x]! : 0
      const corner = y && x >= channels ? pixels[(y - 1) * stride + x - channels]! : 0
      const prediction = [0, left, above, Math.floor((left + above) / 2), paeth(left, above, corner)][filter]
      if (prediction === undefined) throw new Error(`Unsupported PNG filter: ${filter}`)
      pixels[y * stride + x] = (bytes[y * (stride + 1) + x + 1]! + prediction) & 255
    }
  }
  return { width, height, channels, pixels }
}

describe('replaceable home portrait bundles', () => {
  it('supplies two complete aligned portraits with honest demonstration descriptions', () => {
    expect(Object.keys(portraitAssets).sort()).toEqual(['bass', 'front'])
    for (const [mode, asset] of Object.entries(portraitAssets)) {
      expect(asset.id).toBe(mode)
      expect(asset.isDemo).toBe(true)
      expect(asset.alt).toMatch(/demonstration|演示/i)
      expect(asset.alt).toMatch(/sculptur|雕塑/i)
      expect(asset.width).toBeGreaterThanOrEqual(640)
      expect(asset.width / asset.height).toBeCloseTo(0.8)
      expect(Object.keys(asset.maps).sort()).toEqual([...mapNames].sort())
      for (const name of mapNames) {
        expect(asset.maps[name]).toBe(`/portraits/${mode}/${name}.png`)
        const map = png(asset.maps[name])
        expect([map.width, map.height]).toEqual([asset.width, asset.height])
      }
      const preview = png(asset.preview)
      expect([preview.width, preview.height, preview.channels]).toEqual([asset.width, asset.height, 4])
    }
    expect(portraitAssets.bass.alt).toMatch(/bass|贝斯/i)
  })

  it('contains real surface information and transparent background coverage', () => {
    for (const asset of Object.values(portraitAssets)) {
      const alpha = png(asset.maps.alpha)
      expect(alpha.channels).toBe(1)
      expect(alpha.pixels[0]).toBe(0)
      const coverage = [...alpha.pixels].filter(value => value > 127).length / alpha.pixels.length
      expect(coverage).toBeGreaterThan(0.2)
      expect(coverage).toBeLessThan(0.8)
      for (const name of ['depth', 'normal', 'roughness', 'shadow'] as const) {
        const map = png(asset.maps[name])
        const values = new Set<number>()
        for (let index = 0; index < alpha.pixels.length; index += 19) {
          if (alpha.pixels[index]! > 240) values.add(map.pixels[index * map.channels]!)
        }
        expect(values.size, `${asset.id}/${name} cannot be a constant placeholder`).toBeGreaterThan(12)
      }
      expect(png(asset.maps.diffuse).channels).toBe(4)
      expect(png(asset.maps.normal).channels).toBe(3)
    }
  })

  it('documents source, geometric generation, channels, and replacement instructions', () => {
    const manifest = JSON.parse(readFileSync(`${publicRoot}/portraits/manifest.json`, 'utf8'))
    expect(manifest.isDemo).toBe(true)
    expect(manifest.provenance.kind).toBe('cc0-scan-and-original-instrument')
    expect(manifest.provenance.externalAssets).toEqual([expect.objectContaining({ author: 'Rico Cilliers', license: 'CC0-1.0', source: 'https://polyhaven.com/a/marble_bust_01' })])
    expect(manifest.provenance.subjectDisclosure).toMatch(/not.*GUOER/i)
    expect(manifest.provenance.generator).toBe('frontend/scripts/portraits/generate_demo.py')
    for (const mode of ['front', 'bass']) {
      expect(manifest.portraits[mode].width).toBe(portraitAssets[mode as 'front' | 'bass'].width)
      for (const name of mapNames) {
        expect(manifest.portraits[mode].maps[name].path).toBe(portraitAssets[mode as 'front' | 'bass'].maps[name])
        expect(manifest.portraits[mode].maps[name].channels).toBeTruthy()
        expect(manifest.portraits[mode].maps[name].colorSpace).toBeTruthy()
        expect(manifest.portraits[mode].maps[name].provenance).toBeTruthy()
      }
    }
    expect(manifest.replacement.instructions.length).toBeGreaterThan(2)
  })
})
