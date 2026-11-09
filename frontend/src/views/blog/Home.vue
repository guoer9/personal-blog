<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, ref, watch, type Ref } from 'vue'
import { getWorks } from '@/api/works'
import { type Work, formatDuration } from '@/data/works'
import { stageAssets, stageIdentity, getStageArtwork, selectStageTrack } from '@/data/stage'
import { usePerformanceAudio } from '@/audio/performanceAudio'
import PerformancePlayer from '@/components/performance/PerformancePlayer.vue'
import ChenGuoSignature from '@/components/immersive/ChenGuoSignature.vue'
import { signatureEndpoint } from '@/components/immersive/chenGuoSignatureData'
import ScrollReveal from '@/components/immersive/ScrollReveal.vue'
import { usePageSceneState } from '@/graphics/runtime/usePageSceneState'
import { visualPageSceneBridgeKey, visualRuntimeKey, type VisualRuntimeBridge } from '@/graphics/runtime/visualRuntimeHandle'
import { pageScrollKey, type PageScrollFrame } from '@/graphics/runtime/pageScroll'
import type { HomePageState } from '@/graphics/scenes/pageStates'
import { homeScrollSequence, portraitScrollEase } from '@/graphics/scenes/home/portraitMath'
import { createHomeSphereInteractionBridge, defaultHomeSphereInteractionOptions, homeSphereInteractionOptionsKey } from './homeInteraction'

const home = ref<HTMLElement | null>(null)
const heroTrack = ref<HTMLElement | null>(null)
const signatureLayer = ref<HTMLElement | null>(null)
const signatureTrail = ref<SVGPathElement | null>(null)
const program = ref<HTMLElement | null>(null)
const programKicker = ref<HTMLElement | null>(null)
const works = ref<Work[]>([])
const selectedSlug = ref('')
const loading = ref(true)
const failed = ref(false)
const music = computed(() => works.value.filter(work => work.category === 'music'))
const films = computed(() => works.value.filter(work => work.category === 'film').slice(0, 2))
const selected = computed(() => music.value.find(work => work.slug === selectedSlug.value) || selectStageTrack(works.value) || music.value[0])
const audio = usePerformanceAudio()
const heroProgress = ref(0)
const signatureProgress = ref(0)
const connectorProgress = ref(0)
const storyProgress = ref(0)
const portraitPointerActive = ref(false)
const latestInteraction = ref<HomePageState['interaction']>(null)
const runtime = inject<Ref<VisualRuntimeBridge | null>>(visualRuntimeKey, ref(null))
const pageScroll = inject(pageScrollKey, null)
const sceneBridge = usePageSceneState<HomePageState>({ paused: false, interaction: null })
provide(visualPageSceneBridgeKey, sceneBridge)
const options = inject(homeSphereInteractionOptionsKey, defaultHomeSphereInteractionOptions)
let controller: AbortController | null = null
let observer: ResizeObserver | null = null
let unsubscribe: (() => void) | undefined
let scrollFrame = 0

function publishSceneState() {
  const state: HomePageState = { paused: false, interaction: latestInteraction.value, sceneProgress: storyProgress.value, portraitMode: 'front', portraitExitProgress: heroProgress.value, portraitPointerActive: portraitPointerActive.value }
  sceneBridge.setState(state)
  runtime.value?.setPageState('home', state)
  runtime.value?.setCanvasVisible?.(true)
}
const sphereInteraction = createHomeSphereInteractionBridge({ options, emit(interaction) { latestInteraction.value = interaction; publishSceneState() } })
function onPortraitPointer(event: PointerEvent) { portraitPointerActive.value = event.pointerType !== 'touch'; publishSceneState() }
function leavePortrait() { portraitPointerActive.value = false; publishSceneState() }
async function loadWorks() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  failed.value = false
  try {
    const response = await getWorks({}, current.signal)
    if (current.signal.aborted) return
    works.value = response.data.items
    const active = audio.state.value.work
    selectedSlug.value = active && music.value.some(work => work.slug === active.slug) ? active.slug : selectStageTrack(works.value)?.slug || music.value[0]?.slug || ''
  } catch { if (!current.signal.aborted) failed.value = true }
  finally { if (!current.signal.aborted) { loading.value = false; void nextTick(scheduleUpdate) } }
}
function selectTrack(work: Work) { selectedSlug.value = work.slug; audio.select(work) }
function imageFallback(event: Event) {
  const image = event.target as HTMLImageElement
  if (!image.src.endsWith('/stage/cover-rain.svg')) image.src = '/stage/cover-rain.svg'
}
const heroStyle = computed(() => ({
  '--hero-progress': heroProgress.value,
  '--hero-eased': portraitScrollEase(heroProgress.value),
  '--intro-opacity': 1 - portraitScrollEase(heroProgress.value / .48),
  '--intro-rise': `${-45 * portraitScrollEase(heroProgress.value / .48)}px`,
  '--signature-opacity': portraitScrollEase((heroProgress.value - .28) / .35),
}))
function updateTrail() {
  const svg = signatureLayer.value?.querySelector('svg')
  const path = signatureTrail.value
  const matrix = svg?.getScreenCTM?.()
  if (!matrix || !path || !programKicker.value || !home.value) return
  const origin = home.value.getBoundingClientRect()
  const point = (x: number, y: number) => ({ x: matrix.a * x + matrix.c * y + matrix.e - origin.left, y: matrix.b * x + matrix.d * y + matrix.f - origin.top })
  const start = point(signatureEndpoint.x, signatureEndpoint.y)
  const prior = point(signatureEndpoint.controlX, signatureEndpoint.controlY)
  const target = programKicker.value.getBoundingClientRect()
  const end = { x: target.left - origin.left, y: target.top + target.height / 2 - origin.top }
  const room = Math.max(0, origin.width - 8 - start.x)
  const multiplier = Math.min(5, room * .6 / Math.max(1, start.x - prior.x))
  const drop = Math.max(80, end.y - start.y)
  const turn = { x: Math.min(origin.width - 8, start.x + room * .65), y: start.y + drop * .48 }
  const left = Math.max(4, end.x - 36)
  path.setAttribute('d', `M ${start.x} ${start.y} C ${start.x + (start.x - prior.x) * multiplier} ${start.y + (start.y - prior.y) * multiplier}, ${turn.x} ${turn.y - drop * .3}, ${turn.x} ${turn.y} C ${turn.x} ${turn.y + drop * .3}, ${left} ${end.y - 120}, ${left} ${end.y - 32} C ${left} ${end.y - 10}, ${end.x - 10} ${end.y}, ${end.x} ${end.y} l 28 0`)
  path.style.strokeDashoffset = String(1 - connectorProgress.value)
  path.style.opacity = connectorProgress.value > 0 ? '1' : '0'
  path.style.strokeWidth = String(signatureEndpoint.width * Math.hypot(matrix.a, matrix.b))
  path.dataset.progress = String(connectorProgress.value)
}
function updateNarrative(frame?: PageScrollFrame) {
  scrollFrame = 0
  const height = frame?.viewportHeight || window.innerHeight
  const scrollY = frame?.scrollY ?? window.scrollY
  const travel = -(heroTrack.value?.getBoundingClientRect().top ?? 0) / Math.max(1, height)
  const sequence = homeScrollSequence(travel)
  heroProgress.value = sequence.portrait
  signatureProgress.value = sequence.signature
  connectorProgress.value = sequence.connector
  // Use stable chapter travel: adding new songs does not retime the opening.
  storyProgress.value = Math.min(1, Math.max(0, scrollY / Math.max(1, height * 6)))
  if (heroTrack.value) for (const [key, value] of Object.entries(heroStyle.value)) heroTrack.value.style.setProperty(key, String(value))
  const programY = program.value?.getBoundingClientRect().top ?? height
  home.value?.style.setProperty('--program-progress', String(Math.max(-1, Math.min(1, programY / height))))
  updateTrail()
  publishSceneState()
}
function scheduleUpdate() {
  if (pageScroll) { pageScroll.invalidate(); return }
  if (!scrollFrame) scrollFrame = requestAnimationFrame(() => updateNarrative())
}
const pointerEvents = { pointerdown: sphereInteraction.onPointerDown, pointermove: sphereInteraction.onPointerMove, pointerup: sphereInteraction.onPointerUp, pointercancel: sphereInteraction.onPointerCancel, click: sphereInteraction.onClickCapture, mousedown: sphereInteraction.onMouseDown, contextmenu: sphereInteraction.onContextMenu }
onMounted(() => {
  void loadWorks()
  for (const [event, handler] of Object.entries(pointerEvents)) document.addEventListener(event, handler as EventListener, true)
  window.addEventListener('blur', sphereInteraction.cancel)
  window.addEventListener('resize', scheduleUpdate, { passive: true })
  if (pageScroll) unsubscribe = pageScroll.subscribe(updateNarrative)
  else window.addEventListener('scroll', scheduleUpdate, { passive: true })
  if (home.value) { observer = new ResizeObserver(scheduleUpdate); observer.observe(home.value) }
  updateNarrative()
})
watch(runtime, publishSceneState)
onBeforeUnmount(() => {
  controller?.abort(); observer?.disconnect(); unsubscribe?.(); sphereInteraction.dispose()
  for (const [event, handler] of Object.entries(pointerEvents)) document.removeEventListener(event, handler as EventListener, true)
  window.removeEventListener('blur', sphereInteraction.cancel)
  window.removeEventListener('resize', scheduleUpdate)
  window.removeEventListener('scroll', scheduleUpdate)
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
})
</script>

<template>
  <div ref="home" class="home performance-home" :data-motion-paused="false" :data-playing="audio.state.value.playing">
    <div class="stage-atmosphere" aria-hidden="true"><i /><i /><i /></div>
    <svg class="signature-continuation" aria-hidden="true" width="100%" height="100%" fill="none"><path ref="signatureTrail" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" stroke-linecap="round" /></svg>
    <div ref="heroTrack" class="hero-track" :style="heroStyle">
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero-visual" @pointerenter="onPortraitPointer" @pointermove="onPortraitPointer" @pointerleave="leavePortrait"><img v-if="stageAssets.artistPortrait" :src="stageAssets.artistPortrait" alt="陈果" class="artist-portrait" @error="imageFallback" /></div>
        <div class="hero-copy" data-overlay="identity" :inert="heroProgress > .48">
          <div class="hero-topline"><p>陈果 / GUOER<br /><span>MUSICIAN & CREATIVE EXPLORER</span></p><p class="hero-invitation">声音有形状。<br />在这里，触碰它。</p></div>
          <h1 id="hero-title">GUOER<span class="hero-name">陈果</span></h1>
          <div class="hero-actions"><button v-if="selected?.audio" type="button" class="hero-play" @click="audio.toggle(selected)"><span aria-hidden="true">{{ audio.state.value.playing ? 'Ⅱ' : '▶' }}</span> {{ audio.state.value.playing ? '暂停演出' : '让声音发生' }} <small>{{ selected.title }}</small></button><a v-else href="#setlist" class="hero-play">进入演出 <span aria-hidden="true">↓</span></a><router-link to="/about#connect" class="hero-contact">联系 ↗</router-link></div>
          <p v-if="audio.state.value.error" class="hero-audio-error" role="status">{{ audio.state.value.error }}</p>
        </div>
        <div ref="signatureLayer" class="hero-signature"><p>MADE OF SOUND. SIGNED BY</p><ChenGuoSignature :progress="signatureProgress" /><span>音乐，和我留下的痕迹。</span></div>
        <div class="hero-footnote"><span>AN INTERACTIVE PERFORMANCE</span><a href="#setlist" class="hero-scroll">往下看看 <span aria-hidden="true">↓</span></a></div>
      </section>
    </div>

    <section id="setlist" ref="program" class="program-section" aria-labelledby="program-title">
      <div class="program-top"><p ref="programKicker" class="section-kicker">01 / THE SETLIST</p><router-link to="/works?type=music" class="stage-link">全部音乐 ↗</router-link></div>
      <h2 id="program-title">把声音，<br /><em>留在此刻。</em></h2>
      <div v-if="selected" class="program-stage">
        <div class="program-art"><div class="album-sleeve"><img :key="selected.slug" :src="getStageArtwork(selected)" :alt="selected.title + '封面'" width="1200" height="1200" loading="lazy" @error="imageFallback" /><span aria-hidden="true">GUOER / ORIGINAL MUSIC</span></div><router-link :to="'/works/' + selected.slug" class="program-detail">进入《{{ selected.title }}》 <span>↗</span></router-link></div>
        <div class="program-space" aria-hidden="true"><span>TOUCH · MOVE · LISTEN</span></div>
        <div class="program-console"><span class="section-kicker">SELECT A TRACK</span><ol class="track-list"><li v-for="(work,index) in music" :key="work.slug"><button type="button" :aria-pressed="selected.slug === work.slug" @click="selectTrack(work)"><span class="track-number">{{ String(index + 1).padStart(2,'0') }}</span><strong>{{ work.title }}</strong><span>{{ work.duration ? formatDuration(work.duration) : '—' }}</span></button></li></ol><PerformancePlayer v-if="selected.audio" :work="selected" compact /><router-link v-else :to="'/works/' + selected.slug" class="stage-link">观看作品 ↗</router-link><p class="program-note">用耳朵听，也用指尖感受。</p></div>
      </div>
      <div v-else class="program-empty" role="status"><p>{{ loading ? '正在准备节目…' : failed ? '节目暂时没有加载成功。' : '下一段声音，正在酝酿。' }}</p><button v-if="failed" type="button" class="text-action" @click="loadWorks">重新读取 ↗</button><router-link v-else-if="!loading" to="/about" class="stage-link">认识陈果 ↗</router-link></div>
      <div class="program-bottom"><span>SOUND BECOMES MOTION</span><span>YOUR PRESENCE CHANGES THE SCENE</span></div>
    </section>

    <section v-if="films.length" id="films" class="films-section" aria-labelledby="films-title">
      <ScrollReveal :scroll="true"><div class="film-heading"><p class="section-kicker">02 / BETWEEN THE NOTES</p><h2 id="films-title">生活，<em>也在演奏。</em></h2><router-link to="/works?type=film" class="stage-link">更多影像 ↗</router-link></div></ScrollReveal>
      <div class="film-frames"><ScrollReveal v-for="(film,index) in films" :key="film.slug" :scroll="true" :class="'film-frame film-frame--' + index"><router-link :to="'/works/' + film.slug"><div class="film-image"><img :src="getStageArtwork(film)" :alt="film.title" width="960" height="540" loading="lazy" @error="imageFallback" /><span aria-hidden="true">PLAY ↗</span></div><div class="film-caption"><span>0{{ index + 1 }} / {{ film.duration ? formatDuration(film.duration) : 'FILM' }}</span><h3>{{ film.title }}</h3></div></router-link></ScrollReveal></div>
    </section>

    <section id="encore" class="encore-section page-shell" aria-labelledby="encore-title">
      <ScrollReveal :scroll="true"><p class="section-kicker">03 / AFTER THE LAST NOTE</p><h2 id="encore-title">音乐之外，<br /><em>还是我。</em></h2></ScrollReveal>
      <div class="encore-copy principle-intro"><p>我是{{ stageIdentity.name }}，也叫 {{ stageIdentity.alias }}。做音乐，拍下生活，也把想象写成可以触碰的界面。</p><div><router-link to="/about" class="stage-link">认识我 ↗</router-link><router-link to="/about#connect" class="stage-link">聊聊创作 ↗</router-link></div></div>
      <router-link to="/writing" class="archive-door"><span>留在演出之后的文字</span><strong>THE ARCHIVE</strong><span aria-hidden="true">↗</span></router-link>
    </section>
  </div>
</template>

<style scoped>
.home { position: relative; overflow-x: clip; }
.stage-atmosphere { position: fixed; inset: 0; z-index: 0; pointer-events:none; background:radial-gradient(ellipse at 50% 45%,rgba(25,46,86,.12),transparent 60%); }
.stage-atmosphere i { position:absolute; width:78vmin; height:78vmin; border:1px solid rgba(199,255,46,.07); border-radius:50%; top:50%; left:50%; transform:translate(-50%,-50%) rotateX(65deg) rotate(-30deg); }
.stage-atmosphere i:nth-child(2) { width:110vmin;height:110vmin;transform:translate(-50%,-50%) rotateY(65deg) rotate(30deg); }
.stage-atmosphere i:nth-child(3) { width:135vmin;height:135vmin;border-color:rgba(143,174,255,.05); }
.signature-continuation { position:absolute;z-index:4;inset:0;pointer-events:none;overflow:visible; }
.signature-continuation path {stroke:var(--acid);opacity:0;}
.hero-track { position:relative; z-index:2; height:220svh; }
.hero { position:sticky;top:0;height:100svh;min-height:580px;isolation:isolate; }
.hero-visual {position:absolute;inset:0;z-index:0;}
.artist-portrait {width:100%;height:100%;object-fit:contain;opacity:.25;}
.hero-copy {position:absolute;inset:0;padding:0 5.5vw;opacity:var(--intro-opacity);transform:translateY(var(--intro-rise));pointer-events:none;}
.hero-copy a,.hero-copy button {pointer-events:auto;}
.hero-topline {display:flex;justify-content:space-between;position:absolute;top:16%;left:5.5vw;right:5.5vw;}
.hero-topline p {font:500 .86rem/1.8 var(--body-font);}
.hero-topline p span {font: .55rem/2 var(--mono-font);color:var(--muted);letter-spacing:.12em;}
.hero-invitation {text-align:right;}
.hero h1 {position:absolute;bottom:15%;left:4.7vw;right:5vw;margin:0;font:500 clamp(100px,16.5vw,260px)/.78 var(--body-font);letter-spacing:-.085em;}
.hero-name {display:inline-block;margin-left:2.6vw;font:400 clamp(18px,2.5vw,38px)/1 var(--display-font);letter-spacing:.1em;color:var(--acid);vertical-align:top;}
.hero-actions {position:absolute;bottom:6.9%;left:5.5vw;right:5.5vw;display:flex;align-items:center;justify-content:space-between;}
.hero-play {display:inline-flex;align-items:center;gap:16px;padding:0;border:0;background:transparent;color:var(--ink);cursor:pointer;font-size:.9rem;text-decoration:none;min-height:48px;}
.hero-play > span {display:grid;place-items:center;width:44px;height:44px;border:1px solid rgba(199,255,46,.6);border-radius:50%;color:var(--acid);font-size:.75rem;transition:background .3s,color .3s;}
.hero-play:hover > span {background:var(--acid);color:#080808;}
.hero-play small {font-size:.68rem;color:var(--muted);padding-left:16px;border-left:1px solid var(--line);}
.hero-contact,.hero-scroll {text-decoration:none;font-size:.7rem;}
.hero-audio-error {position:absolute;bottom:3.9%;left:5.5vw;font-size:.7rem;color:var(--acid);}
.hero-footnote {position:absolute;bottom:20px;left:5.5vw;right:5.5vw;display:flex;justify-content:space-between;align-items:center;font:.52rem var(--mono-font);letter-spacing:.1em;}
.hero-scroll {display:flex;gap:28px;align-items:center;}
.hero-scroll span {color:var(--acid);}
.hero-signature {position:absolute;width:min(800px,86vw);left:50%;top:50%;transform:translate(-50%,-45%);opacity:var(--signature-opacity);pointer-events:none;text-align:center;}
.hero-signature p {font:.55rem var(--mono-font);letter-spacing:.24em;color:var(--muted);margin:0 0 4vh;}
.hero-signature > span {display:block;margin-top:5vh;font:.75rem var(--body-font);color:var(--muted);letter-spacing:.2em;}
.program-section {position:relative;z-index:2;padding:60px 5.5vw 0;min-height:125svh;}
.program-top {display:flex;justify-content:space-between;align-items:center;}
.stage-link {font-size:.8rem;text-decoration:none;display:inline-flex;gap:20px;align-items:center;padding:12px 0;}
.stage-link:hover {color:var(--acid);}
.program-section h2 {font:400 clamp(3rem,5.7vw,6rem)/1.2 var(--display-font);letter-spacing:-.06em; margin:55px 0 65px;}
.program-section h2 em {color:var(--acid);font-style:normal;}
.program-stage {display:grid;grid-template-columns:minmax(0,1fr) minmax(200px,1.8fr) minmax(0,1.1fr);align-items:center;gap:30px;min-height:400px;}
.program-art {align-self:start;transform:translateY(calc(var(--program-progress,0) * 25px));}
.album-sleeve {position:relative;transform:rotate(-6deg);box-shadow:0 28px 60px #0008;border:1px solid #ffffff16;transition:transform .5s;}
.album-sleeve:hover {transform:rotate(-2deg) translateY(-6px);}
.album-sleeve img {display:block;width:100%;height:auto;aspect-ratio:1;object-fit:cover;animation:art-enter .6s both;}
.album-sleeve > span {position:absolute;left:12px;bottom:12px;font:.45rem var(--mono-font);letter-spacing:.12em;color:var(--muted);}
.program-detail {display:flex;justify-content:space-between;gap:15px;margin-top:36px;text-decoration:none;font-size:.8rem;}
.program-detail span {color:var(--acid);}
.program-space {align-self:end;text-align:center;font:.5rem var(--mono-font);letter-spacing:.18em;color:#a4a49f80;padding-bottom:40px;}
.program-console {align-self:center;}
.track-list {margin:20px 0 28px;padding:0;list-style:none;}
.track-list button {display:grid;grid-template-columns:20px 1fr auto;align-items:center;gap:12px;width:100%;text-align:left;min-height:80px;padding:16px 0;background:transparent;color:var(--muted);border:0;border-bottom:1px solid var(--line);cursor:pointer;}
.track-list button[aria-pressed='true'] {color:var(--acid);}
.track-list button strong {font-weight:400;font-size:clamp(.85rem,1.2vw,1.1rem);}
.track-list button > span {font:.58rem var(--mono-font);}
.program-note {margin-top:28px;font-size:.68rem;color:var(--muted);}
.program-bottom {margin-top:100px;padding:26px 0;display:flex;justify-content:space-between;border-top:1px solid var(--line);font:.5rem var(--mono-font);letter-spacing:.16em;color:var(--muted);}
.program-empty {min-height:350px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;font-size:.9rem;}
.films-section {position:relative;z-index:2;padding:160px 5.5vw 100px;}
.film-heading {max-width:650px;}
.film-heading h2 {font:400 clamp(2.8rem,5.2vw,5.5rem)/1.2 var(--display-font);letter-spacing:-.06em;}
.film-heading em {display:block;font-style:normal;color:var(--acid);}
.film-frames {display:flex;align-items:flex-start;gap:12%;margin-top:55px;}
.film-frame {width:44%;min-width:0;}
.film-frame--1 {margin-top:240px;}
.film-frame a {text-decoration:none;}
.film-image {position:relative;overflow:hidden;}
.film-image img {display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;transition:transform .7s,filter .7s;filter:saturate(.65);}
.film-frame:hover img {transform:scale(1.045);filter:saturate(1);}
.film-image span {position:absolute;right:15px;bottom:15px;background:var(--acid);color:#101208;padding:9px 14px;font:.6rem var(--mono-font);}
.film-caption {padding-top:24px;}
.film-caption > span {font:.55rem var(--mono-font);color:var(--muted);letter-spacing:.1em;}
.film-caption h3 {margin-top:12px;font:400 clamp(1.2rem,2.2vw,2rem) var(--display-font);}
.encore-section {position:relative;z-index:2;padding-top:140px;padding-bottom:70px;}
.encore-section h2 {font:400 clamp(3.3rem,7.2vw,8rem)/1.14 var(--display-font);letter-spacing:-.06em;}
.encore-section h2 em {font-style:normal;color:var(--acid);}
.encore-copy {width:32%;margin-left:auto;margin-top:60px;}
.encore-copy > p {font-size:.9rem;line-height:2;color:var(--muted);}
.encore-copy > div {display:flex;justify-content:space-between;gap:15px;}
.archive-door {display:grid;grid-template-columns:1fr auto 40px;align-items:center;gap:25px;margin-top:140px;padding:40px 0;border-top:1px solid var(--line);text-decoration:none;}
.archive-door > span:first-child {font-size:.8rem;color:var(--muted);}
.archive-door strong {font:400 clamp(1.5rem,3vw,3rem)/1 var(--body-font);letter-spacing:-.04em;}
.archive-door > span:last-child {color:var(--acid);font-size:2rem;}
@keyframes art-enter {from {opacity:0;filter:blur(6px);}to {opacity:1;filter:blur(0);}}
@media(min-width:1600px) {.program-stage {grid-template-columns:340px 1fr 370px;}.program-section {min-height:115svh;}}
@media(max-width:900px) {.program-stage {grid-template-columns:minmax(0,1fr) minmax(120px,1fr) minmax(0,1.1fr);gap:20px;}.hero-topline {top:18%;}.program-section {min-height:110svh;}}
@media(max-width:700px) {
 .hero {min-height:540px;}.hero-copy {padding:0 22px;}.hero-topline {top:16%;left:22px;right:22px;}.hero-topline p {font-size:.74rem;}.hero-topline p span {font-size:.42rem;}.hero-invitation {max-width:120px;}
 .hero h1 {font-size:24vw;left:18px;right:auto;bottom:18%;}.hero-name {font-size:15px;display:block;margin:22px 0 0 5px;}.hero-actions {bottom:7.5%;left:22px;right:22px;}.hero-play {font-size:.8rem;gap:12px;}.hero-play small {display:none;}.hero-footnote {left:22px;right:22px;font-size:.4rem;bottom:17px;}.hero-contact {font-size:.65rem;}
 .hero-signature {width:92vw;}.hero-signature p {font-size:.45rem;}.hero-signature > span {font-size:.65rem;}
 .program-section {padding:70px 22px 0;min-height:auto;}.program-top .section-kicker {font-size:.55rem;}.program-section h2 {font-size:2.9rem;margin:35px 0 48px;}.program-stage {grid-template-columns:1fr;gap:45px;}.program-art {width:55%;transform:none;}.album-sleeve {transform:rotate(-5deg);}.program-detail {font-size:.72rem;}.program-space {display:none;}.program-console {width:100%;padding:24px;background:linear-gradient(135deg,#0c0d11eb,#0c0d11c9);border:1px solid #ffffff12;backdrop-filter:blur(16px);}.track-list button {min-height:66px;}.track-list button strong {font-size:1rem;}.program-note {font-size:.65rem;}.program-bottom {margin-top:70px;gap:24px;font-size:.4rem;line-height:1.7;}.program-bottom span:last-child {text-align:right;}
 .films-section {padding:100px 22px 50px;}.film-heading h2 {font-size:2.9rem;}.film-frames {flex-direction:column;gap:70px;margin-top:35px;}.film-frame {width:92%;}.film-frame--1 {align-self:flex-end;margin-top:0;}.film-image img {aspect-ratio:4/3;}.film-caption h3 {font-size:1.5rem;}
 .encore-section {padding-top:100px;}.encore-section h2 {font-size:3.2rem;}.encore-copy {width:100%;margin-top:50px;padding:20px;background:#080808ad;}.archive-door {grid-template-columns:1fr 30px;gap:18px;margin-top:65px;padding:30px 0;}.archive-door > span:first-child {grid-column:1/-1;}.archive-door strong {font-size:1.8rem;}
}
@media(max-width:360px) {.hero-invitation {display:none;}.hero-topline {top:14%;}.hero-play {font-size:.74rem;}.program-console {padding:18px;}.program-section h2,.film-heading h2 {font-size:2.5rem;}.encore-section h2 {font-size:2.8rem;}}
</style>
