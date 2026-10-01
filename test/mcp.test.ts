import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {SanityContext, endpointUrl, parseGroqResult} from '../src/context/client.js'
import {Ledger} from '../src/ledger.js'
import {artworkBySlug} from '../src/queries.js'
import {harness, TOKEN} from './helpers.js'

describe('Context MCP over streamable HTTP', () => {
  let h: Awaited<ReturnType<typeof harness>>
  beforeAll(async () => {
    h = await harness()
  })
  afterAll(async () => h.close())

  it('exposes the documented tool names for each mode', () => {
    expect(h.ctx.toolNames()).toEqual({
      groq: ['initial_context', 'schema_explorer', 'groq_query'],
      knowledgeBase: ['initial_context', 'knowledge_base_read'],
    })
  })

  it('rejects a bad bearer token', async () => {
    await expect(SanityContext.connect({url: h.server.url, token: 'wrong'})).rejects.toThrow()
  })

  it('queries content and records it in the ledger', async () => {
    const ledger = new Ledger()
    const a = await h.ctx.groqQuery<any>(artworkBySlug('an-0d93f4'), ledger)
    expect(a.title).toBe('#0D93F4')
    expect(ledger.artworkList().map((x) => x._id)).toEqual(['artwork-an-sample-01'])
    expect(ledger.collections.has('Anonstronauts')).toBe(true)
  })

  it('reads the knowledge base', async () => {
    const outline = await h.ctx.knowledgeBaseOutline()
    expect(outline).toMatch(/collections\/lone-journey/)
    const ledger = new Ledger()
    const text = await h.ctx.knowledgeBaseRead(['policy/shipping'], ledger)
    expect(text).toMatch(/must not promise shipping/)
    expect(ledger.sourceIds.has('kb-shipping')).toBe(true)
  })

  it('names the KB initial_context distinctly when handing tools to a model', () => {
    expect(Object.keys(h.ctx.agentTools(new Ledger())).sort()).toEqual(
      ['groq_query', 'initial_context', 'knowledge_base_outline', 'knowledge_base_read', 'schema_explorer'].sort(),
    )
  })
})

describe('endpoint helpers', () => {
  it('builds mode and knowledge base query parameters', () => {
    const base = 'https://api.sanity.io/v1/context/organizations/oABC/mcp/print-clerk'
    expect(endpointUrl(base, 'groq')).toBe(`${base}?mode=groq`)
    expect(endpointUrl(base, 'knowledge_base', ['kb1', 'kb2'])).toBe(`${base}?mode=knowledge_base&knowledgeBases=kb1%2Ckb2`)
  })

  it('parses groq_query results in the shapes a server may return', () => {
    expect(parseGroqResult({content: [{type: 'text', text: '{"meta":{},"result":[1]}'}]})).toEqual([1])
    expect(parseGroqResult({structuredContent: {result: {a: 1}}, content: []})).toEqual({a: 1})
    expect(parseGroqResult({content: [{type: 'text', text: '[2]'}]})).toEqual([2])
    expect(() => parseGroqResult({isError: true, content: [{type: 'text', text: 'boom'}]})).toThrow(/boom/)
  })
  it('keeps the token out of the URL', () => {
    expect(endpointUrl('https://api.sanity.io/v1/context/organizations/o/mcp/x', 'groq')).not.toContain(TOKEN)
  })
})
