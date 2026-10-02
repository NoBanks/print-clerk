import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {ESCALATION_REPLY, PrintClerk, outlinePaths} from '../src/agent.js'
import type {ListingDraft} from '../src/types.js'
import {FaultInjectionWriter, LlmWriter, TemplateWriter, parseTitleBody} from '../src/writers.js'
import {harness, scriptedModel} from './helpers.js'

let h: Awaited<ReturnType<typeof harness>>
beforeEach(async () => {
  h = await harness()
})
afterEach(async () => h.close())

const clock = () => new Date('2026-10-01T12:00:00Z')

describe('drafting', () => {
  it('drafts every channel for every sample artwork without a verifier issue', async () => {
    const clerk = new PrintClerk(h.ctx, h.store, new TemplateWriter(), {now: clock})
    const slugs = ['cs-3fa9c2', 'cs-b04e7d', 'lj-7c21e0', 'lj-e5d017', 'an-0d93f4', 'an-61c8ab', '1440-0412am', '1440-1147pm']
    for (const slug of slugs) {
      for (const channel of ['marketplace', 'instagram', 'x', 'newsletter'] as const) {
        const d = await clerk.draft(slug, channel)
        expect(d.verification.issues, `${slug}/${channel}`).toEqual([])
        expect(d.status).toBe('needs_review')
      }
    }
    expect(await h.store.auditLog()).toHaveLength(slugs.length * 4)
  })

  it('records the source documents it read, including Knowledge Base entries', async () => {
    const clerk = new PrintClerk(h.ctx, h.store, new TemplateWriter())
    const d = await clerk.draft('lj-7c21e0', 'marketplace')
    expect(d.sourceDocIds).toContain('artwork-lj-sample-01')
    expect(d.sourceDocIds).toContain('kb-pricing-tiers')
    expect(d.sourceDocIds).toContain('kb-astronaut-collections')
  })

  it('blocks a draft with a wrong price and an invented claim, and logs why', async () => {
    const clerk = new PrintClerk(h.ctx, h.store, new FaultInjectionWriter())
    const d = await clerk.draft('cs-3fa9c2', 'instagram')
    expect(d.status).toBe('blocked')
    expect(d.verification.issues.join('\n')).toMatch(/price-size-mismatch/)
    expect(d.verification.issues.join('\n')).toMatch(/Limited edition/)
    const [event] = await h.store.auditLog(d._id)
    expect(event.action).toBe('draft.blocked')
  })

  it('errors on an unknown slug', async () => {
    const clerk = new PrintClerk(h.ctx, h.store, new TemplateWriter())
    await expect(clerk.draft('does-not-exist', 'marketplace')).rejects.toThrow(/No artwork/)
  })

  it('gives an LLM writer one revision with the verifier issues, then accepts a corrected draft', async () => {
    const model = scriptedModel([
      {text: 'TITLE: #7C21E0\nBODY:\nThe 5x7 framed print is $70 and it is a limited edition.'},
      {text: 'TITLE: #7C21E0\nBODY:\nThe 5x7 framed print is $50. The 12x12 framed print is $70.'},
    ])
    const clerk = new PrintClerk(h.ctx, h.store, new LlmWriter(model, 'scripted'))
    const d = await clerk.draft('lj-7c21e0', 'marketplace')
    expect(d.status).toBe('needs_review')
    expect(d.body).toContain('5x7 framed print is $50')
    const prompts = model.doGenerateCalls.map((c) => JSON.stringify(c.prompt))
    expect(prompts[1]).toMatch(/failed these checks/)
    expect(JSON.parse((await h.store.auditLog(d._id))[0].details).attempts).toBe(2)
  })
})

describe('human review', () => {
  async function drafted(): Promise<{clerk: PrintClerk; d: ListingDraft}> {
    const clerk = new PrintClerk(h.ctx, h.store, new TemplateWriter(), {now: clock})
    return {clerk, d: await clerk.draft('lj-7c21e0', 'marketplace')}
  }

  it('approves a verified draft and attributes it', async () => {
    const {clerk, d} = await drafted()
    const a = await clerk.approve(d._id, 'Ryan', 'looks right')
    expect(a.status).toBe('approved')
    expect(a.reviewer).toBe('Ryan')
    const actions = (await h.store.auditLog(d._id)).map((e) => `${e.actor}:${e.action}`)
    expect(actions).toEqual(['agent:draft.created', 'human:Ryan:draft.approved'])
  })

  it('refuses approval when the price changed in Sanity after drafting', async () => {
    const {clerk, d} = await drafted()
    const doc = h.emulator.visible.find((x) => x._id === 'artwork-lj-sample-01')!
    doc.formats[0].priceUsd = 80
    await expect(clerk.approve(d._id, 'Ryan')).rejects.toThrow(/catalog changed/)
    const after = await h.store.get<ListingDraft>(d._id)
    expect(after?.status).toBe('blocked')
    expect(after?.verification.issues.join()).toMatch(/\$70/)
  })

  it('refuses approval when a size went on hold after drafting', async () => {
    const {clerk, d} = await drafted()
    const doc = h.emulator.visible.find((x) => x._id === 'artwork-lj-sample-01')!
    doc.formats[1].status = 'on_hold'
    await expect(clerk.approve(d._id, 'Ryan')).rejects.toThrow(/5x7 is on_hold/)
  })

  it('lets a human fix a blocked draft and send it back for review', async () => {
    const clerk = new PrintClerk(h.ctx, h.store, new FaultInjectionWriter())
    const d = await clerk.draft('lj-7c21e0', 'x')
    expect(d.status).toBe('blocked')
    const fixed = await clerk.recheck(d._id, 'human:Ryan', {body: '#7C21E0, Lone Journey. 5x7 framed: $50.'})
    expect(fixed.status).toBe('needs_review')
    await expect(clerk.approve(d._id, 'Ryan')).resolves.toMatchObject({status: 'approved'})
  })

  it('never approves blocked or already-decided drafts', async () => {
    const {clerk, d} = await drafted()
    await clerk.reject(d._id, 'Ryan', 'not this week')
    await expect(clerk.approve(d._id, 'Ryan')).rejects.toThrow(/rejected/)
    await expect(clerk.reject(d._id, 'Ryan', 'again')).rejects.toThrow(/already rejected/)
  })
})

describe('buyer questions', () => {
  const lookUp = {tool: 'groq_query', args: {query: '*[_type == "artwork" && slug.current == "1440-1147pm"][0]{_id, title, "collection": collection->{_id, title}, "formats": formats[]{label, widthIn, heightIn, priceUsd, status}}'}}

  it('answers when every fact in the answer came from a Context tool result', async () => {
    const model = scriptedModel([lookUp, {text: '11:47 PM comes in 5x7 framed for $50 and 5x5 framed for $40. Both are available.'}])
    const clerk = new PrintClerk(h.ctx, h.store, new TemplateWriter(), {model})
    const inq = await clerk.ask('How much is 11:47 PM?')
    expect(inq.issues).toEqual([])
    expect(inq.status).toBe('answered')
    expect(inq.answer).toContain('$50')
    expect(inq.sourceDocIds).toContain('artwork-1440-sample-1147')
  })

  it('escalates instead of sending a wrong price', async () => {
    const model = scriptedModel([lookUp, {text: 'The 5x5 is $50.'}])
    const clerk = new PrintClerk(h.ctx, h.store, new TemplateWriter(), {model})
    const inq = await clerk.ask('How much is the small one?')
    expect(inq.status).toBe('escalated')
    expect(inq.answer).toBe(ESCALATION_REPLY)
    expect(inq.modelAnswer).toBe('The 5x5 is $50.')
    expect((await h.store.auditLog(inq._id))[0].action).toBe('inquiry.escalated')
  })

  it('escalates a price the model never looked up', async () => {
    const model = scriptedModel([{text: 'That one is $90.'}])
    const clerk = new PrintClerk(h.ctx, h.store, new TemplateWriter(), {model})
    expect((await clerk.ask('price?')).status).toBe('escalated')
  })

  it('requires a model', async () => {
    const clerk = new PrintClerk(h.ctx, h.store, new TemplateWriter())
    await expect(clerk.ask('hi')).rejects.toThrow(/LLM_BASE_URL/)
  })
})

describe('helpers', () => {
  it('parses outline paths and core tags', () => {
    expect(outlinePaths('- policy/a [core]: A\n- care/b: B')).toEqual([
      {path: 'policy/a', core: true},
      {path: 'care/b', core: false},
    ])
  })
  it('parses TITLE/BODY output and strips think blocks', () => {
    expect(parseTitleBody('<think>x</think>TITLE: T\nBODY:\nline1\nline2', 'f')).toEqual({title: 'T', body: 'line1\nline2'})
    expect(parseTitleBody('just text', 'f')).toEqual({title: 'f', body: 'just text'})
  })
})

describe('ids', () => {
  it('keeps agent output under the private clerk. id path', async () => {
    const clerk = new PrintClerk(h.ctx, h.store, new TemplateWriter())
    const d = await clerk.draft('an-0d93f4', 'x')
    expect(d._id).toMatch(/^clerk\.draft\./)
    expect((await h.store.auditLog(d._id))[0]._id).toMatch(/^clerk\.audit\./)
  })
})

describe('outlinePaths on the hosted Context outline', () => {
  it('reads bare "path [core]" lines under the Knowledge bases heading and ignores tool bullets above it', () => {
    const hosted = [
      '## Tools',
      '- **knowledge_base_read**: Read full entries.',
      '',
      '# Knowledge bases',
      'Knowledge base id: `kbExample`',
      '## Print Clerk catalog',
      '5 entries.',
      'care_and_display',
      'catalog/listings [core]',
      'catalog/pricing [core]',
      'collections [core]',
      'shipping_and_fulfillment',
    ].join('\n\n')
    expect(outlinePaths(hosted)).toEqual([
      {path: 'care_and_display', core: false},
      {path: 'catalog/listings', core: true},
      {path: 'catalog/pricing', core: true},
      {path: 'collections', core: true},
      {path: 'shipping_and_fulfillment', core: false},
    ])
  })
})
