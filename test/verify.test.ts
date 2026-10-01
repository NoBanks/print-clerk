import {describe, expect, it} from 'vitest'
import type {ArtworkFact} from '../src/types.js'
import {autofixStyle, factsHash, verify} from '../src/verify.js'

const EM = String.fromCharCode(0x2014)

const teal: ArtworkFact = {
  _id: 'artwork-cs-sample-01',
  title: '#3FA9C2',
  slug: 'cs-3fa9c2',
  story: 'A teal room lit from one side.',
  collection: {_id: 'collection-chromatic-spaces', title: 'Chromatic Spaces'},
  formats: [
    {label: '19x13 framed', widthIn: 19, heightIn: 13, framed: true, priceUsd: 140, status: 'available'},
    {label: '5x5 framed', widthIn: 5, heightIn: 5, framed: true, priceUsd: 40, status: 'available'},
  ],
}
const lone: ArtworkFact = {
  _id: 'artwork-lj-sample-02',
  title: '#E5D017',
  slug: 'lj-e5d017',
  collection: {_id: 'collection-lone-journey', title: 'Lone Journey'},
  formats: [{label: '12x12 framed', widthIn: 12, heightIn: 12, priceUsd: 70, status: 'on_hold'}],
}
const collections = ['Chromatic Spaces', 'Lone Journey', 'Anonstronauts', '1440']
const check = (text: string, a: ArtworkFact = teal, extra: Partial<Parameters<typeof verify>[0]> = {}) =>
  verify({text, artworks: [teal, lone], focusId: a._id, knownCollections: collections, ...extra})

describe('verify', () => {
  it('passes copy that only states catalog facts', () => {
    const v = check('#3FA9C2 from Chromatic Spaces.\n5x5 framed: $40, available\n19x13 framed: $140, available', teal, {channel: 'marketplace'})
    expect(v.issues).toEqual([])
    expect(v.ok).toBe(true)
  })

  it('catches the price of one size quoted for another size', () => {
    const v = check('The 5x5 framed print is $140.')
    expect(v.ok).toBe(false)
    expect(v.issues.join()).toMatch(/price-size-mismatch: \$140 is not the price of 5x5/)
  })

  it('accepts sizes written with inches and the multiplication sign, either orientation', () => {
    expect(check(`13 x 19 in framed for $140.`).ok).toBe(true)
    expect(check(`5${String.fromCharCode(0xd7)}5 for $40.`).ok).toBe(true)
  })

  it('flags sizes and prices the catalog does not list', () => {
    const v = check('Also available as a 24x36 for $300.')
    expect(v.issues.some((i) => i.startsWith('unknown-size'))).toBe(true)
    expect(v.issues.some((i) => i.startsWith('unknown-price'))).toBe(true)
  })

  it('flags a bare price when the piece has more than one price', () => {
    expect(check('Yours for $40.').issues.join()).toMatch(/price-without-size/)
  })

  it('allows a bare price when the piece only has one', () => {
    expect(check('Yours for $70, currently on hold.', lone).ok).toBe(true)
  })

  it('flags availability the catalog does not support', () => {
    expect(check('The 12x12 is available now.', lone).issues.join()).toMatch(/availability: 12x12 is on_hold/)
    expect(check('Available today.', lone).issues.join()).toMatch(/nothing in scope is available/)
    expect(check('The 5x5 is sold out.').issues.join()).toMatch(/5x5 is available, the text says otherwise/)
  })

  it('flags the wrong collection name but not the number 1,440 in prose', () => {
    expect(check('A Lone Journey piece, 5x5 for $40.').issues.join()).toMatch(/wrong-collection/)
    expect(check('One of 1,440 minutes. 5x5 for $40.').ok).toBe(true)
  })

  it('does not read hex fingerprint titles as sizes', () => {
    expect(check('#7C21E0 and #3FA9C2.').ok).toBe(true)
  })

  it('blocks invented selling claims unless the catalog says them', () => {
    const v = check('Hand-signed limited edition with a certificate of authenticity. Free shipping.')
    expect(v.issues.filter((i) => i.startsWith('ungrounded-claim'))).toHaveLength(4)
    const grounded = check('Hand-signed.', teal, {groundingText: 'Every print is hand-signed on the back.'})
    expect(grounded.ok).toBe(true)
  })

  it('enforces style: dashes, tracking URLs, markdown in marketplace', () => {
    expect(check(`Teal ${EM} calm.`).issues).toContain('style: em or en dash, use a hyphen')
    expect(check('See https://www.google.com/url?q=x').issues.join()).toMatch(/tracking URL/)
    expect(check('nobanksnearby.com/shop').ok).toBe(true)
    expect(check('**Teal** print', teal, {channel: 'marketplace'}).issues.join()).toMatch(/markdown/)
    expect(check('**Teal** print', teal, {channel: 'instagram'}).ok).toBe(true)
  })

  it('autofixes dashes and nothing else', () => {
    expect(autofixStyle(`Teal ${EM} calm`)).toBe('Teal - calm')
  })

  it('reports an unknown focus artwork', () => {
    expect(verify({text: 'x', artworks: [], focusId: 'nope'}).issues.join()).toMatch(/unknown-artwork/)
  })

  it('hashes facts so a price change is detectable', () => {
    const changed = {...teal, formats: [{...teal.formats[0], priceUsd: 150}, teal.formats[1]]}
    expect(factsHash([teal])).not.toBe(factsHash([changed]))
    expect(factsHash([teal])).toBe(factsHash([{...teal}]))
  })
})
