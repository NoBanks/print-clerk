import type {ArtworkFact} from './types.js'

/**
 * Everything the agent was shown during one task. Artworks are picked out of any
 * GROQ result by shape (anything with a formats[] array of priced sizes), and
 * prose from Knowledge Base reads is kept as grounding text for claims.
 */
export class Ledger {
  readonly artworks = new Map<string, ArtworkFact>()
  readonly collections = new Set<string>()
  readonly sourceIds = new Set<string>()
  private readonly texts: string[] = []

  ingestGroq(value: unknown): void {
    const visit = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(visit)
      if (!v || typeof v !== 'object') {
        return
      }
      const o = v as Record<string, any>
      if (typeof o._id === 'string') this.sourceIds.add(o._id)
      const fullFacts =
        Array.isArray(o.formats) &&
        o.formats.every((f: any) => f && [f.priceUsd, f.widthIn, f.heightIn].every((n) => typeof n === 'number')) &&
        typeof o.collection?.title === 'string'
      if (fullFacts) {
        const prev = this.artworks.get(o._id)
        this.artworks.set(o._id, {...prev, ...o} as ArtworkFact)
      }
      if (o.collection && typeof o.collection === 'object' && typeof o.collection.title === 'string') {
        this.collections.add(o.collection.title)
      } else if (typeof o.collection === 'string') {
        this.collections.add(o.collection)
      }
      for (const k of ['story', 'statement', 'body']) if (typeof o[k] === 'string') this.texts.push(o[k])
      Object.values(o).forEach(visit)
    }
    visit(value)
  }

  ingestText(text: string): void {
    this.texts.push(text)
    for (const m of text.matchAll(/Source:\s*([\w.-]+)/g)) this.sourceIds.add(m[1])
  }

  get groundingText(): string {
    return this.texts.join('\n')
  }

  artworkList(): ArtworkFact[] {
    return [...this.artworks.values()]
  }
}
