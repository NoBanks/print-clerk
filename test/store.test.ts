import {describe, expect, it} from 'vitest'
import {SanityStore} from '../src/store/sanityStore.js'

/** A stand-in for @sanity/client that records the mutations it was asked to commit. */
function fakeClient() {
  const committed: any[] = []
  const tx = () => {
    const ops: any[] = []
    const t: any = {
      create: (d: any) => (ops.push({create: d}), t),
      patch: (id: string, fn: (p: any) => any) => {
        const p: any = {set: (s: any) => (ops.push({patch: {id, set: s}}), p)}
        fn(p)
        return t
      },
      commit: async () => (committed.push(ops), {transactionId: 'tx1'}),
    }
    return t
  }
  return {client: {transaction: tx, fetch: async (q: string, p: any) => ({q, p})} as any, committed}
}

describe('SanityStore', () => {
  it('commits each write together with its audit event', async () => {
    const {client, committed} = fakeClient()
    const s = new SanityStore(client)
    await s.createWithAudit({_id: 'd1', _type: 'listingDraft'} as any, {_id: 'a1', _type: 'auditEvent'} as any)
    await s.patchWithAudit('d1', {status: 'approved'}, {_id: 'a2', _type: 'auditEvent'} as any)
    expect(committed).toEqual([
      [{create: {_id: 'd1', _type: 'listingDraft'}}, {create: {_id: 'a1', _type: 'auditEvent'}}],
      [{patch: {id: 'd1', set: {status: 'approved'}}}, {create: {_id: 'a2', _type: 'auditEvent'}}],
    ])
  })

  it('uses GROQ params, never string-built filters, for reads', async () => {
    const {client} = fakeClient()
    const r: any = await new SanityStore(client).listDrafts('blocked')
    expect(r.p).toEqual({status: 'blocked'})
    expect(r.q).toMatch(/status == \$status/)
  })
})
