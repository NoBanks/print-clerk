import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {evaluate, parse} from 'groq-js'

/**
 * A local stand-in for a Sanity Context MCP endpoint, for offline development
 * and tests. It serves the same tool names and input shapes documented at
 * https://www.sanity.io/docs/ai/sanity-context-mcp-tools and runs real GROQ
 * (groq-js) over the sample dataset. It is not Sanity's implementation; output
 * text formats are this project's best reading of the docs.
 */

type Doc = Record<string, any>

export const DEFAULT_GROQ_FILTER_TYPES = ['artwork', 'collection', 'knowledgeArticle']
export const EMULATED_KB_ID = 'kb-print-clerk-local'

const here = dirname(fileURLToPath(import.meta.url))
export const SAMPLE_CATALOG_PATH = join(here, '..', '..', 'sample-data', 'catalog.json')

export function loadSampleCatalog(path = SAMPLE_CATALOG_PATH): Doc[] {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export interface KbEntry {
  path: string
  title: string
  tag: 'core' | 'standard' | 'peripheral'
  body: string
  sourceId: string
}

export class ContextEmulator {
  readonly visible: Doc[]

  constructor(
    docs: Doc[],
    private readonly allowedTypes: string[] = DEFAULT_GROQ_FILTER_TYPES,
  ) {
    // Same effect as an endpoint groqFilter of `_type in [...]`: the agent cannot see
    // its own drafts, inquiries or the audit log.
    this.visible = docs.filter((d) => allowedTypes.includes(d._type))
  }

  groqInitialContext(): string {
    const counts = new Map<string, number>()
    for (const d of this.visible) counts.set(d._type, (counts.get(d._type) ?? 0) + 1)
    return [
      'Schema overview (emulated):',
      ...[...counts].map(([t, n]) => `- ${t} (${n} documents)`),
      'artwork: title, slug, catalogCode, collection -> collection, medium, formats[] {label, widthIn, heightIn, framed, priceUsd, status}, story, altText, tags, isSample',
      'collection: title, slug, statement, namingRule, isSample',
      'knowledgeArticle: title, slug, topic, body, isSample',
      'Instructions: prices and availability live on artwork.formats[]. A price belongs to exactly one format.',
    ].join('\n')
  }

  schemaExplorer(type: string, path?: string): string {
    const sample = this.visible.find((d) => d._type === type)
    if (!sample) return `No type named "${type}" is visible to this endpoint.`
    const target = path ? path.split('.').reduce<any>((o, k) => (o == null ? o : Array.isArray(o) ? o[0]?.[k] : o[k]), sample) : sample
    const fields = target && typeof target === 'object' ? Object.keys(Array.isArray(target) ? target[0] ?? {} : target) : []
    return JSON.stringify({type, path: path ?? null, fields}, null, 2)
  }

  async groqQuery(query: string): Promise<{meta: Record<string, unknown>; result: unknown}> {
    const tree = parse(query)
    const value = await evaluate(tree, {dataset: this.visible})
    const result = await value.get()
    const count = Array.isArray(result) ? result.length : result == null ? 0 : 1
    return {
      meta: {
        executedQuery: query,
        perspective: 'published',
        resultCount: count,
        returnedCount: count,
        warnings: [],
        hint: count === 0 ? 'No documents matched. Check the type name and field paths with schema_explorer.' : null,
      },
      result,
    }
  }

  kbEntries(): KbEntry[] {
    const entries: KbEntry[] = []
    for (const d of this.visible) {
      if (d._type === 'knowledgeArticle') {
        entries.push({
          path: `${d.topic ?? 'general'}/${d.slug?.current ?? d._id}`,
          title: d.title,
          tag: d.topic === 'policy' ? 'core' : 'standard',
          body: d.body,
          sourceId: d._id,
        })
      }
      if (d._type === 'collection') {
        entries.push({
          path: `collections/${d.slug?.current ?? d._id}`,
          title: `${d.title} collection`,
          tag: 'standard',
          body: d.statement ?? '',
          sourceId: d._id,
        })
      }
    }
    return entries
  }

  kbInitialContext(kbIds: string[]): string {
    if (!kbIds.includes(EMULATED_KB_ID)) return 'No readable Knowledge Bases.'
    const lines = this.kbEntries().map((e) => `- ${e.path}${e.tag === 'standard' ? '' : ` [${e.tag}]`}: ${e.title}`)
    return [`Knowledge Base ${EMULATED_KB_ID} (emulated)`, 'Purpose: answer buyer and listing questions about framed prints accurately.', ...lines].join('\n')
  }

  kbRead(kb: string, paths: string[]): string {
    if (kb !== EMULATED_KB_ID) return `Unknown Knowledge Base "${kb}".`
    const byPath = new Map(this.kbEntries().map((e) => [e.path, e]))
    return paths
      .map((p) => {
        const e = byPath.get(p)
        return e ? `## ${e.path}\n${e.body}\n\nSource: ${e.sourceId}` : `## ${p}\nNo entry at this path.`
      })
      .join('\n\n')
  }
}
