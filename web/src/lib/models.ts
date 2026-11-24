import type { GenParams, ProviderType } from '../api/types'

/** Human-friendly names for well-known model ids. */
const LABELS: [RegExp, string][] = [
  [/^chatgpt-image-latest$/, 'ChatGPT Image'],
  [/^gpt-image-2\.6-sunburst/, 'GPT Image 2.6 Sunburst'],
  [/^gpt-image-2\.6-flare/, 'GPT Image 2.6 Flare'],
  [/^gpt-image-2\.5-sunburst/, 'GPT Image 2.5 Sunburst'],
  [/^gpt-image-2\.5-flare/, 'GPT Image 2.5 Flare'],
  [/^gpt-image-2/, 'GPT Image 2'],
  [/^gpt-image-1\.5/, 'GPT Image 1.5'],
  [/^gpt-image-1-mini/, 'GPT Image 1 Mini'],
  [/^gpt-image-1/, 'GPT Image 1'],
  [/^gemini-3-pro-image/, 'Nano Banana Pro'],
  [/^gemini-3\.1-flash-lite-image/, 'Nano Banana 2 Lite'],
  [/^gemini-3\.1-flash-image/, 'Nano Banana 2'],
  [/^gemini-2\.5-flash-image/, 'Nano Banana'],
]

export function modelLabel(id: string): string | null {
  for (const [re, label] of LABELS) if (re.test(id)) return /-preview$/.test(id) ? `${label} Preview` : label
  return null
}

/** Featured models get a highlight badge in the picker. */
export function isFeatured(id: string) {
  return /^(chatgpt-image|gpt-image-2)/.test(id) || /^gemini-3-pro-image/.test(id)
}

export interface Capabilities {
  type: ProviderType
  /** Aspect ratios offered in the picker ('auto' is always first). */
  ratios: string[]
  /** Resolution tiers; empty when the model has a fixed size per ratio. */
  tiers: string[]
  /** OpenAI gpt-image-2 accepts arbitrary WIDTHxHEIGHT. */
  customSize: boolean
  qualities: string[]
  transparent: boolean
  inputFidelity: boolean
  googleSearch: boolean
  maxN: number
  maxRefs: number
}

export const OPENAI_FIXED: Record<string, string> = { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536' }

export function capabilities(type: ProviderType, model: string): Capabilities {
  if (type === 'openai') {
    const flexible = model.startsWith('gpt-image-2')
    const premium = /^gpt-image-2\.[56]-(sunburst|flare)/.test(model)
    return {
      type,
      ratios: flexible
        ? ['auto', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9', '3:1', '1:3']
        : ['auto', '1:1', '3:2', '2:3'],
      tiers: flexible ? ['1K', '2K', '4K'] : [],
      customSize: flexible,
      qualities: premium ? ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] : ['auto', 'low', 'medium', 'high'],
      transparent: true,
      inputFidelity: model.startsWith('gpt-image-1.5'),
      googleSearch: false,
      maxN: 10,
      maxRefs: 16,
    }
  }
  const legacy = model.includes('2.5-flash-image')
  const flash31 = model.includes('3.1-flash')
  const ratios = ['auto', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '4:5', '5:4', '21:9']
  if (flash31) ratios.push('4:1', '1:4', '8:1', '1:8')
  return {
    type,
    ratios,
    tiers: legacy ? [] : ['1K', '2K', '4K'],
    customSize: false,
    qualities: [],
    transparent: false,
    inputFidelity: false,
    googleSearch: !legacy,
    maxN: 4,
    maxRefs: legacy ? 3 : 14,
  }
}

/** Composer state that is independent of the provider. */
export interface ComposerParams {
  ratio: string
  tier: string
  customW: number
  customH: number
  quality: string
  background: string
  outputFormat: string
  compression: number
  moderation: string
  inputFidelity: string
  n: number
  googleSearch: boolean
}

export const defaultParams: ComposerParams = {
  ratio: 'auto',
  tier: '1K',
  customW: 1536,
  customH: 1024,
  quality: 'auto',
  background: 'auto',
  outputFormat: 'png',
  compression: 90,
  moderation: 'auto',
  inputFidelity: 'low',
  n: 1,
  googleSearch: false,
}

const round16 = (v: number) => Math.max(16, Math.round(v / 16) * 16)

const MIN_PX = 655_360
const MAX_PX = 8_294_400
const MAX_EDGE = 3840

/**
 * Picks a gpt-image-2 size for ratio + tier: both edges multiples of 16,
 * within the pixel/edge limits, preferring an exact aspect ratio and then the
 * area closest to the tier's target (e.g. 16:9 @1K → 1280×720).
 */
export function openaiSize(ratio: string, tier: string): { w: number; h: number } {
  const [a, b] = ratio.split(':').map(Number)
  const r = a / b
  const long = tier === '4K' ? 3840 : tier === '2K' ? 2048 : 1024
  const ideal = a >= b ? long * (long / r) : long * (long * r)
  const target = Math.min(MAX_PX, Math.max(MIN_PX, ideal))
  let best = { w: 1024, h: 1024, score: Infinity }
  for (let w = 256; w <= MAX_EDGE; w += 16) {
    const h = round16(w / r)
    if (h > MAX_EDGE || w * h < MIN_PX || w * h > MAX_PX) continue
    if (Math.max(w, h) / Math.min(w, h) > 3) continue
    const score = (100 * Math.abs(w / h - r)) / r + Math.abs(w * h - target) / target
    if (score < best.score) best = { w, h, score }
  }
  return { w: best.w, h: best.h }
}

export type SizeError = 'sizeMultiple' | 'sizeRatio' | 'sizePixels' | 'sizeEdge' | null

export function validateCustomSize(w: number, h: number): SizeError {
  if (!w || !h || w % 16 || h % 16) return 'sizeMultiple'
  if (Math.max(w, h) > MAX_EDGE) return 'sizeEdge'
  if (Math.max(w, h) / Math.min(w, h) > 3) return 'sizeRatio'
  if (w * h < MIN_PX || w * h > MAX_PX) return 'sizePixels'
  return null
}

/** Resolves the effective output size (for display) or null when automatic. */
export function resolvedSize(caps: Capabilities, p: ComposerParams): { w: number; h: number } | null {
  if (caps.type !== 'openai') return null
  if (p.ratio === 'custom') return { w: p.customW, h: p.customH }
  if (p.ratio === 'auto') return null
  if (caps.customSize) return openaiSize(p.ratio, p.tier)
  const fixed = OPENAI_FIXED[p.ratio]
  if (!fixed) return null
  const [w, h] = fixed.split('x').map(Number)
  return { w, h }
}

/** Converts composer state to API params for the given model. */
export function toApiParams(caps: Capabilities, p: ComposerParams, hasRefs: boolean): GenParams {
  const n = Math.min(Math.max(1, p.n), caps.maxN)
  if (caps.type === 'gemini') {
    const out: GenParams = { n }
    if (p.ratio !== 'auto' && caps.ratios.includes(p.ratio)) out.aspect_ratio = p.ratio
    if (caps.tiers.length && caps.tiers.includes(p.tier)) out.image_size = p.tier
    if (caps.googleSearch && p.googleSearch) out.google_search = true
    return out
  }
  const out: GenParams = { n }
  const size = resolvedSize(caps, p)
  out.size = size ? `${size.w}x${size.h}` : 'auto'
  if (p.quality !== 'auto' && caps.qualities.includes(p.quality)) out.quality = p.quality
  let format = p.outputFormat
  if (p.background === 'transparent' && format === 'jpeg') format = 'png'
  if (p.background !== 'auto') out.background = p.background
  if (format !== 'png') {
    out.output_format = format
    out.output_compression = p.compression
  }
  if (p.moderation !== 'auto') out.moderation = p.moderation
  if (hasRefs && caps.inputFidelity && p.inputFidelity !== 'low') out.input_fidelity = p.inputFidelity
  return out
}

/** Restores composer state from a past generation's params. */
export function fromApiParams(type: ProviderType, g: GenParams): Partial<ComposerParams> {
  const out: Partial<ComposerParams> = { n: g.n ?? 1 }
  if (type === 'gemini') {
    out.ratio = g.aspect_ratio || 'auto'
    if (g.image_size) out.tier = g.image_size
    out.googleSearch = !!g.google_search
    return out
  }
  out.quality = g.quality || 'auto'
  out.background = g.background || 'auto'
  out.outputFormat = g.output_format || 'png'
  if (g.output_compression != null) out.compression = g.output_compression
  out.moderation = g.moderation || 'auto'
  out.inputFidelity = g.input_fidelity || 'low'
  if (!g.size || g.size === 'auto') out.ratio = 'auto'
  else {
    const [w, h] = g.size.split('x').map(Number)
    const fixed = Object.entries(OPENAI_FIXED).find(([, v]) => v === g.size)
    const tiered = capabilities('openai', 'gpt-image-2')
      .ratios.slice(1)
      .flatMap((r) => ['1K', '2K', '4K'].map((t) => ({ r, t, s: openaiSize(r, t) })))
      .find(({ s }) => s.w === w && s.h === h)
    if (tiered) {
      out.ratio = tiered.r
      out.tier = tiered.t
    } else if (fixed) out.ratio = fixed[0]
    else {
      out.ratio = 'custom'
      out.customW = w
      out.customH = h
    }
  }
  return out
}

/** Ratio string → numeric width/height for drawing the ratio glyph. */
export function ratioBox(ratio: string): { w: number; h: number } {
  if (ratio === 'auto' || ratio === 'custom') return { w: 1, h: 1 }
  const [a, b] = ratio.split(':').map(Number)
  return { w: a, h: b }
}
