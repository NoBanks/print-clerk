import {generateText, stepCountIs, type LanguageModel, type ToolSet} from 'ai'
import type {ArtworkFact, Channel, DraftCopy, FormatFact} from './types.js'

export interface WriteRequest {
  artwork: ArtworkFact
  channel: Channel
  /** Knowledge Base text retrieved for this piece (policies, collection rules). */
  guidance: string
  /** Set on a retry: what the verifier rejected last time. */
  previousIssues?: string[]
  previous?: DraftCopy
}

export interface Writer {
  readonly name: string
  readonly canRevise: boolean
  write(req: WriteRequest): Promise<DraftCopy>
}

const ARTIST = 'NoBanks Nearby'

function sizeLine(f: FormatFact): string {
  const state = f.status === 'available' ? 'available' : f.status.replace('_', ' ')
  return `${f.widthIn}x${f.heightIn}${f.framed ? ' framed' : ''}: $${f.priceUsd}, ${state}`
}

function cleanStory(a: ArtworkFact): string {
  return (a.story ?? '').replace(/^Sample entry\.\s*/i, '').trim()
}

function hashtag(s: string): string {
  return '#' + s.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

/** Deterministic copy straight from the facts. Works with no model at all. */
export class TemplateWriter implements Writer {
  readonly name: string = 'template'
  readonly canRevise: boolean = false

  async write({artwork: a, channel}: WriteRequest): Promise<DraftCopy> {
    const coll = a.collection.title
    const sizes = [...a.formats].sort((x, y) => x.priceUsd - y.priceUsd)
    const sampleNote = a.isSample ? 'Sample catalog entry.' : ''
    const story = cleanStory(a)
    let title: string
    let body: string
    switch (channel) {
      case 'marketplace':
        title = `${a.title} - ${coll} framed print by ${ARTIST}`
        body = [
          `${a.title} from the ${coll} collection by ${ARTIST}.`,
          story,
          a.medium ? `Medium: ${a.medium}.` : '',
          'Sizes:',
          ...sizes.map((f) => `• ${sizeLine(f)}`),
          'Message me with any questions.',
          sampleNote,
        ]
          .filter(Boolean)
          .join('\n')
        break
      case 'instagram':
        title = `${a.title} (${coll})`
        body = [
          `${a.title}. ${story}`.trim(),
          `${coll} collection.`,
          ...sizes.filter((f) => f.status === 'available').map((f) => `${f.widthIn}x${f.heightIn} framed, $${f.priceUsd}.`),
          sampleNote,
          [hashtag(ARTIST), hashtag(coll), '#framedart'].join(' '),
        ]
          .filter(Boolean)
          .join('\n')
        break
      case 'x':
        title = a.title
        body = [`${a.title}, ${coll}. ${story}`.trim(), sampleNote].filter(Boolean).join(' ')
        break
      case 'newsletter':
        title = `New in ${coll}: ${a.title}`
        body = [
          `${a.title} is part of ${coll}. ${story}`.trim(),
          `It comes in ${sizes.map((f) => `${f.widthIn}x${f.heightIn} ($${f.priceUsd})`).join(' and ')}.`,
          sampleNote,
        ]
          .filter(Boolean)
          .join('\n\n')
        break
    }
    return {title, body, model: this.name}
  }
}

/**
 * Wraps another writer and injects the two mistakes this project exists to catch:
 * the price of one size quoted for another size, and an invented selling claim.
 * Used by the demo and tests to show the verifier blocking a draft.
 */
export class FaultInjectionWriter implements Writer {
  readonly name = 'fault-injection'
  readonly canRevise = false
  constructor(private readonly inner: Writer = new TemplateWriter()) {}

  async write(req: WriteRequest): Promise<DraftCopy> {
    const copy = await this.inner.write(req)
    const sizes = [...req.artwork.formats].sort((x, y) => x.priceUsd - y.priceUsd)
    const small = sizes[0]
    const wrongPrice = Math.max(...sizes.map((f) => f.priceUsd)) === small.priceUsd ? small.priceUsd + 100 : Math.max(...sizes.map((f) => f.priceUsd))
    const body = `${copy.body}\nLimited edition. The ${small.widthIn}x${small.heightIn} is $${wrongPrice} and ready to ship.`
    return {...copy, body, model: this.name}
  }
}

const RULES = `Rules, all of them hard:
- Use only facts from CATALOG FACTS and GUIDANCE. If a fact is not there, leave it out.
- Every price you write must sit in the same sentence as the size it belongs to, for example "12x12 framed: $70".
- Never call a size available unless its status is "available".
- Never claim limited editions, signatures, certificates, awards, exhibitions, scarcity, shipping times, refunds or guarantees.
- Never mention a collection other than this piece's own collection.
- No em dashes or en dashes. Use hyphens, commas or periods.
- URLs, if any, are bare (example.com/page). No tracking parameters.
- Marketplace listings are plain text: no markdown, no asterisks, no headings, no tables. Use the bullet character • for lists.
- Calm, plain, first-person voice of the artist. No hype words.
Output exactly:
TITLE: <one line>
BODY:
<the body>`

export function parseTitleBody(text: string, fallbackTitle: string): {title: string; body: string} {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const t = cleaned.match(/^TITLE:\s*(.+)$/m)
  const b = cleaned.match(/^BODY:\s*\n?([\s\S]*)$/m)
  return {title: (t?.[1] ?? fallbackTitle).trim(), body: (b?.[1] ?? cleaned).trim()}
}

/** A language model writes; it may call the Context MCP tools to look things up. */
export class LlmWriter implements Writer {
  readonly canRevise = true
  readonly name: string
  constructor(
    private readonly model: LanguageModel,
    modelId: string,
    private readonly tools: ToolSet = {},
  ) {
    this.name = `llm:${modelId}`
  }

  async write(req: WriteRequest): Promise<DraftCopy> {
    const facts = JSON.stringify(req.artwork, null, 2)
    const retry = req.previousIssues?.length
      ? `\n\nYour previous draft failed these checks. Fix every one:\n${req.previousIssues.map((i) => `- ${i}`).join('\n')}\n\nPrevious draft:\nTITLE: ${req.previous?.title}\nBODY:\n${req.previous?.body}`
      : ''
    const {text} = await generateText({
      model: this.model,
      system: `You write ${req.channel} copy for framed art prints by ${ARTIST}.\n\n${RULES}`,
      prompt: `CATALOG FACTS (from Sanity):\n${facts}\n\nGUIDANCE (from the Knowledge Base):\n${req.guidance || '(none)'}\n\nWrite the ${req.channel} ${req.channel === 'marketplace' ? 'listing' : 'post'}.${retry}`,
      tools: this.tools,
      stopWhen: stepCountIs(4),
    })
    const {title, body} = parseTitleBody(text, req.artwork.title)
    return {title, body, model: this.name}
  }
}
