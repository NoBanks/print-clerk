import {describe, expect, it} from 'vitest'
import {ContextEmulator, EMULATED_KB_ID, loadSampleCatalog} from '../src/mock/emulator.js'
import {artworkBySlug, groqString} from '../src/queries.js'

describe('sample catalog', () => {
  const docs = loadSampleCatalog()
  it('marks every document as a sample', () => {
    expect(docs.every((d) => d.isSample === true)).toBe(true)
  })
  it('uses public-safe ids (no dots, which Sanity treats as private paths)', () => {
    expect(docs.every((d) => !d._id.includes('.'))).toBe(true)
  })
  it('titles 1440 pieces by their minute', () => {
    const titles = docs.filter((d) => d.collection?._ref === 'collection-1440').map((d) => d.title)
    expect(titles.length).toBeGreaterThan(0)
    expect(titles.every((t) => /^\d{1,2}:\d{2} (AM|PM)$/.test(t))).toBe(true)
  })
  it('gives every artwork alt text and at least one priced size', () => {
    for (const a of docs.filter((d) => d._type === 'artwork')) {
      expect(a.altText.length).toBeGreaterThan(10)
      expect(a.formats.length).toBeGreaterThan(0)
    }
  })
})

describe('ContextEmulator', () => {
  const emu = new ContextEmulator([...loadSampleCatalog(), {_id: 'd1', _type: 'listingDraft', title: 'secret'}])

  it('hides agent output types, like a groqFilter on the endpoint', async () => {
    const {result} = await emu.groqQuery('*[_type == "listingDraft"]')
    expect(result).toEqual([])
  })

  it('runs real GROQ with dereferences and returns meta', async () => {
    const {meta, result} = await emu.groqQuery(artworkBySlug('lj-7c21e0'))
    expect(meta.resultCount).toBe(1)
    expect((result as any).collection.title).toBe('Lone Journey')
    expect((result as any).formats.map((f: any) => f.priceUsd)).toEqual([70, 50])
  })

  it('escapes inlined values', async () => {
    const {result} = await emu.groqQuery(`*[_type == "artwork" && slug.current == ${groqString('x" || true || "')}]`)
    expect(result).toEqual([])
  })

  it('serves a knowledge base outline and entries', () => {
    const outline = emu.kbInitialContext([EMULATED_KB_ID])
    expect(outline).toMatch(/policy\/pricing-tiers \[core\]/)
    expect(emu.kbRead(EMULATED_KB_ID, ['policy/pricing-tiers'])).toMatch(/Never quote the price of one size for another size/)
    expect(emu.kbInitialContext(['kb-other'])).toMatch(/No readable/)
  })
})
