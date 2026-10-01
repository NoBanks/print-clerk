import {createHash} from 'node:crypto'
import type {ArtworkFact, Channel, FormatFact, Verification} from './types.js'

/**
 * The grounding verifier.
 *
 * The agent is allowed to write in its own words. It is not allowed to state a
 * number, a size, an availability, a collection or a selling claim that the
 * catalog does not support. Everything here is deterministic on purpose: the
 * model writes, plain code decides whether the writing is true.
 */

export interface VerifyInput {
  text: string
  /** Artworks the text is allowed to talk about (the focus piece, or everything the agent retrieved). */
  artworks: ArtworkFact[]
  /** All collection titles known to the catalog, used to catch cross-collection mixups. */
  knownCollections?: string[]
  /** Extra prose the agent retrieved (Knowledge Base entries, statements). Claims found here count as grounded. */
  groundingText?: string
  /** When set, the text is about exactly this artwork. */
  focusId?: string
  channel?: Channel | 'answer'
}

// Unicode code points built at runtime so this file stays plain ASCII.
const EM = String.fromCharCode(0x2014)
const EN = String.fromCharCode(0x2013)
const TIMES = String.fromCharCode(0x00d7)

const PRICE_RE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?|\b(\d+)\s?(?:usd|dollars|bucks)\b/gi
const SIZE_RE = new RegExp(
  `(?<![\\d.$#])(\\d{1,2}(?:\\.\\d+)?)\\s*(?:"|in\\.?|inch(?:es)?)?\\s*(?:x|${TIMES}|by)\\s*(\\d{1,2}(?:\\.\\d+)?)(?![\\d])`,
  'gi',
)
const AVAILABLE_RE = /\b(?<!not |un)(available|in stock|ready to ship|ready for pickup)\b/i
const UNAVAILABLE_RE = /\b(sold|sold out|on hold|unavailable|not available)\b/i

/** Selling claims that are easy for a model to invent and costly to get wrong. */
const RISKY_CLAIMS: Array<[RegExp, string]> = [
  [/\blimited edition\b/i, 'limited edition'],
  [/\bedition of \d+\b/i, 'edition size'],
  [/\bhand[- ]?signed\b|\bsigned by\b|\bsigned print\b/i, 'signed'],
  [/\bcertificate of authenticity\b|\bCOA\b/, 'certificate of authenticity'],
  [/\baward[- ]?winning\b|\bwon (?:an? )?award\b/i, 'award'],
  [/\bmuseum[- ](?:quality|grade)\b|\bexhibited\b/i, 'museum or exhibition claim'],
  [/\bone of a kind\b|\b1 of 1\b/i, 'one of a kind'],
  [/\bonly \d+ left\b|\blast one\b/i, 'scarcity claim'],
  [/\bfree shipping\b|\bships (?:in|within) \d+/i, 'shipping promise'],
  [/\bguarantee[ds]?\b|\brefund\b/i, 'guarantee or refund promise'],
]

const TRACKING_URL_RE = /google\.com\/url|utm_[a-z]+=|[?&]si=|[?&]ref=|%3A%2F%2F/i
const MARKDOWN_RE = /\*\*|^#{1,6}\s|\|[^|\n]{0,30}\||\[[^\]]+\]\([^)]+\)|`/m
const DASH_RE = new RegExp(`[${EM}${EN}]`)
const DASH_FIX_RE = new RegExp(`\\s*[${EM}${EN}]\\s*`, 'g')

function num(s: string): number {
  return Number(s.replace(/,/g, ''))
}

function segments(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function sizesIn(seg: string): Array<[number, number]> {
  return [...seg.matchAll(SIZE_RE)].map((m) => [Number(m[1]), Number(m[2])])
}

function pricesIn(seg: string): number[] {
  return [...seg.matchAll(PRICE_RE)].map((m) => {
    if (m[3]) return Number(m[3])
    return num(m[1]) + (m[2] ? Number(`0.${m[2]}`) : 0)
  })
}

function sameSize(f: FormatFact, [a, b]: [number, number]): boolean {
  return (f.widthIn === a && f.heightIn === b) || (f.widthIn === b && f.heightIn === a)
}

function fmtSize([a, b]: [number, number]): string {
  return `${a}x${b}`
}

export function factsHash(artworks: ArtworkFact[]): string {
  const stable = artworks
    .map((a) => ({id: a._id, c: a.collection?.title, f: a.formats.map((f) => [f.widthIn, f.heightIn, f.priceUsd, f.status])}))
    .sort((x, y) => x.id.localeCompare(y.id))
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16)
}

export function verify(input: VerifyInput): Verification {
  const issues: string[] = []
  const scope = input.focusId ? input.artworks.filter((a) => a._id === input.focusId) : input.artworks
  const formats = scope.flatMap((a) => a.formats)
  const grounding = [
    input.groundingText ?? '',
    ...scope.map((a) => [a.story, a.medium, a.collection?.statement].filter(Boolean).join(' ')),
  ]
    .join('\n')
    .toLowerCase()
  const distinctPrices = new Set(formats.map((f) => f.priceUsd))

  if (input.focusId && scope.length === 0) {
    issues.push(`unknown-artwork: ${input.focusId} is not in the retrieved catalog facts`)
  }

  for (const seg of segments(input.text)) {
    const sizes = sizesIn(seg)
    const prices = pricesIn(seg)

    for (const size of sizes) {
      if (!formats.some((f) => sameSize(f, size))) {
        issues.push(`unknown-size: "${fmtSize(size)}" is not a size the catalog lists (in: "${seg}")`)
      }
    }

    for (const price of prices) {
      if (!formats.some((f) => f.priceUsd === price)) {
        issues.push(`unknown-price: $${price} is not a price in the catalog (in: "${seg}")`)
        continue
      }
      if (sizes.length > 0) {
        const matchesASize = sizes.some((s) => formats.some((f) => sameSize(f, s) && f.priceUsd === price))
        if (!matchesASize) {
          issues.push(`price-size-mismatch: $${price} is not the price of ${sizes.map(fmtSize).join('/')} (in: "${seg}")`)
        }
      } else if (distinctPrices.size > 1) {
        issues.push(`price-without-size: $${price} is quoted without saying which size it is for (in: "${seg}")`)
      }
    }

    const saysAvailable = AVAILABLE_RE.test(seg) && !/\bnot available\b/i.test(seg)
    const saysUnavailable = UNAVAILABLE_RE.test(seg)
    if (sizes.length > 0) {
      for (const size of sizes) {
        const f = formats.filter((x) => sameSize(x, size))
        if (f.length === 0) continue
        const anyAvailable = f.some((x) => x.status === 'available')
        if (saysAvailable && !saysUnavailable && !anyAvailable) {
          issues.push(`availability: ${fmtSize(size)} is ${f.map((x) => x.status).join('/')}, not available (in: "${seg}")`)
        }
        if (saysUnavailable && !saysAvailable && anyAvailable) {
          issues.push(`availability: ${fmtSize(size)} is available, the text says otherwise (in: "${seg}")`)
        }
      }
    } else if (saysAvailable && !saysUnavailable && formats.length > 0 && !formats.some((f) => f.status === 'available')) {
      issues.push(`availability: nothing in scope is available (in: "${seg}")`)
    }

    for (const [re, label] of RISKY_CLAIMS) {
      const m = seg.match(re)
      if (m && !grounding.includes(m[0].toLowerCase())) {
        issues.push(`ungrounded-claim: "${m[0]}" (${label}) does not appear in the catalog (in: "${seg}")`)
      }
    }
  }

  if (input.focusId && scope[0] && input.knownCollections) {
    const own = scope[0].collection.title.toLowerCase()
    for (const c of input.knownCollections) {
      if (c.toLowerCase() === own) continue
      const re = new RegExp(`(?<![\\w,])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w,])`, 'i')
      if (re.test(input.text)) {
        issues.push(`wrong-collection: text mentions "${c}" but this piece is in "${scope[0].collection.title}"`)
      }
    }
  }

  if (DASH_RE.test(input.text)) issues.push('style: em or en dash, use a hyphen')
  if (TRACKING_URL_RE.test(input.text)) issues.push('style: wrapped or tracking URL, use a bare URL')
  if (input.channel === 'marketplace' && MARKDOWN_RE.test(input.text)) {
    issues.push('style: markdown in a plain-text marketplace listing')
  }

  return {ok: issues.length === 0, issues: [...new Set(issues)], factsHash: factsHash(scope)}
}

/** The only fix the code applies on its own. Anything about facts goes back to the writer or a human. */
export function autofixStyle(text: string): string {
  return text.replace(DASH_FIX_RE, ' - ')
}
