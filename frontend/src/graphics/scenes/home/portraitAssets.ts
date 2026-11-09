/** CC0 scan and original musical composition, pending owner-supplied portraits. */
export type PortraitMode = 'front' | 'bass'
export type PortraitMap = 'diffuse' | 'alpha' | 'depth' | 'normal' | 'roughness' | 'shadow'

export interface PortraitAsset {
  id: PortraitMode
  label: string
  alt: string
  isDemo: boolean
  width: number
  height: number
  maps: Record<PortraitMap, string>
  preview: string
}

const mapsFor = (mode: PortraitMode): Record<PortraitMap, string> => ({
  diffuse: `/portraits/${mode}/diffuse.png`,
  alpha: `/portraits/${mode}/alpha.png`,
  depth: `/portraits/${mode}/depth.png`,
  normal: `/portraits/${mode}/normal.png`,
  roughness: `/portraits/${mode}/roughness.png`,
  shadow: `/portraits/${mode}/shadow.png`,
})

export const portraitAssets: Record<PortraitMode, PortraitAsset> = {
  front: {
    id: 'front',
    label: '正面',
    alt: '大理石雕塑演示肖像（非 GUOER 本人）；扫描素材来自 Rico Cilliers / Poly Haven，CC0 授权。',
    isDemo: true,
    width: 768,
    height: 960,
    maps: mapsFor('front'),
    preview: '/portraits/front/preview.png',
  },
  bass: {
    id: 'bass',
    label: '贝斯',
    alt: '同一大理石雕塑与原创四弦电贝斯的演示构图（非 GUOER 本人），琴身带有酸绿色细节。',
    isDemo: true,
    width: 768,
    height: 960,
    maps: mapsFor('bass'),
    preview: '/portraits/bass/preview.png',
  },
}
