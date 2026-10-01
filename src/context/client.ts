import {randomUUID} from 'node:crypto'
import {createMCPClient, type MCPClient} from '@ai-sdk/mcp'
import type {ToolSet} from 'ai'
import {Ledger} from '../ledger.js'

/**
 * Connection to a Sanity Context MCP endpoint
 * (https://api.sanity.io/v1/context/organizations/:organizationId/mcp/:mcpEndpointName).
 *
 * Two MCP clients are opened against the same endpoint: one with mode=groq for
 * structured facts (prices, sizes, availability), one with mode=knowledge_base
 * for prose (policies, collection rules). Both are read-only by design; the
 * agent writes nothing through Context.
 */

export interface ContextConfig {
  /** SANITY_CONTEXT_MCP_URL */
  url: string
  /** SANITY_ORGANIZATION_TOKEN (Context Viewer). Sent as a bearer token, never logged. */
  token: string
  /** SANITY_KNOWLEDGE_BASE_IDS, comma separated. Optional. */
  knowledgeBaseIds?: string[]
}

type ToolResult = {content?: Array<{type: string; text?: string}>; structuredContent?: unknown; isError?: boolean}

export function endpointUrl(base: string, mode: 'groq' | 'knowledge_base', kbIds: string[] = []): string {
  const u = new URL(base)
  u.searchParams.set('mode', mode)
  if (mode === 'knowledge_base' && kbIds.length) u.searchParams.set('knowledgeBases', kbIds.join(','))
  return u.toString()
}

export function resultText(r: unknown): string {
  const res = r as ToolResult
  if (res && Array.isArray(res.content)) {
    return res.content.map((c) => (c.type === 'text' ? c.text ?? '' : '')).join('\n')
  }
  return typeof r === 'string' ? r : JSON.stringify(r)
}

/** groq_query returns {meta, result}. Accept structured content, JSON text, or a bare result. */
export function parseGroqResult<T>(r: unknown): T {
  const res = r as ToolResult
  if (res?.isError) throw new Error(`groq_query failed: ${resultText(r)}`)
  let payload: any = res?.structuredContent
  if (payload === undefined) {
    const raw = resultText(r)
    try {
      payload = JSON.parse(raw)
    } catch {
      throw new Error(`groq_query returned non-JSON text: ${raw.slice(0, 200)}`)
    }
  }
  return (payload && typeof payload === 'object' && 'result' in payload ? payload.result : payload) as T
}

export class SanityContext {
  private constructor(
    private readonly groqClient: MCPClient,
    private readonly groqTools: ToolSet,
    private readonly kbClient: MCPClient | undefined,
    private readonly kbTools: ToolSet | undefined,
    readonly knowledgeBaseIds: string[],
  ) {}

  static async connect(cfg: ContextConfig): Promise<SanityContext> {
    const headers = {Authorization: `Bearer ${cfg.token}`}
    const kbIds = cfg.knowledgeBaseIds ?? []
    const groqClient = await createMCPClient({transport: {type: 'http', url: endpointUrl(cfg.url, 'groq'), headers}})
    const groqTools = (await groqClient.tools()) as ToolSet
    let kbClient: MCPClient | undefined
    let kbTools: ToolSet | undefined
    if (kbIds.length) {
      kbClient = await createMCPClient({transport: {type: 'http', url: endpointUrl(cfg.url, 'knowledge_base', kbIds), headers}})
      kbTools = (await kbClient.tools()) as ToolSet
    }
    return new SanityContext(groqClient, groqTools, kbClient, kbTools, kbIds)
  }

  get hasKnowledgeBase(): boolean {
    return Boolean(this.kbTools)
  }

  toolNames(): {groq: string[]; knowledgeBase: string[]} {
    return {groq: Object.keys(this.groqTools), knowledgeBase: Object.keys(this.kbTools ?? {})}
  }

  private async call(tools: ToolSet | undefined, name: string, args: Record<string, unknown>): Promise<unknown> {
    const t = tools?.[name]
    if (!t?.execute) throw new Error(`Context MCP tool "${name}" is not available on this endpoint`)
    return t.execute(args, {toolCallId: randomUUID(), messages: []})
  }

  async groqQuery<T>(query: string, ledger?: Ledger): Promise<T> {
    const raw = await this.call(this.groqTools, 'groq_query', {query})
    const result = parseGroqResult<T>(raw)
    ledger?.ingestGroq(result)
    return result
  }

  async schemaOverview(): Promise<string> {
    return resultText(await this.call(this.groqTools, 'initial_context', {}))
  }

  async knowledgeBaseOutline(): Promise<string> {
    if (!this.kbTools) return ''
    return resultText(await this.call(this.kbTools, 'initial_context', {}))
  }

  async knowledgeBaseRead(paths: string[], ledger?: Ledger): Promise<string> {
    const kb = this.knowledgeBaseIds[0]
    const text = resultText(await this.call(this.kbTools, 'knowledge_base_read', {knowledgeBase: kb, paths}))
    ledger?.ingestText(text)
    return text
  }

  /**
   * The Context tools handed to the model, wrapped so every result the model sees
   * is also recorded in the ledger. The verifier later checks the model's words
   * against exactly what it was shown, nothing more.
   */
  agentTools(ledger: Ledger): ToolSet {
    const out: ToolSet = {}
    const wrap = (tools: ToolSet | undefined, rename?: (n: string) => string) => {
      for (const [name, t] of Object.entries(tools ?? {})) {
        const exec = t.execute
        if (!exec) continue
        out[rename ? rename(name) : name] = {
          ...t,
          execute: async (args: any, opts: any) => {
            const r = await exec(args, opts)
            if (name === 'groq_query') {
              try {
                ledger.ingestGroq(parseGroqResult(r))
              } catch {
                /* the model sees the error text; nothing to record */
              }
            } else {
              ledger.ingestText(resultText(r))
            }
            return r
          },
        } as any
      }
    }
    wrap(this.groqTools)
    // Both modes expose initial_context, so the KB copy gets a distinct name.
    wrap(this.kbTools, (n) => (n === 'initial_context' ? 'knowledge_base_outline' : n))
    return out
  }

  async close(): Promise<void> {
    await this.groqClient.close()
    await this.kbClient?.close()
  }
}
