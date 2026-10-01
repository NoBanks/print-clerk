import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {loadSampleCatalog} from '../src/mock/emulator.js'

// Writes sample-data/catalog.ndjson for `npx sanity dataset import`.
const out = join(import.meta.dirname, '..', 'sample-data', 'catalog.ndjson')
writeFileSync(out, loadSampleCatalog().map((d) => JSON.stringify(d)).join('\n') + '\n')
console.log(`wrote ${out}`)
