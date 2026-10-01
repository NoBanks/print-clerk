import '../src/env.js'
import {createClient} from '@sanity/client'
import {loadSampleCatalog} from '../src/mock/emulator.js'
import {SANITY_API_VERSION} from '../src/bootstrap.js'

// Loads sample-data/catalog.json into your dataset with createOrReplace (safe to re-run).
const {SANITY_PROJECT_ID, SANITY_DATASET, SANITY_WRITE_TOKEN} = process.env
if (!SANITY_PROJECT_ID || !SANITY_WRITE_TOKEN) {
  console.error('Set SANITY_PROJECT_ID and SANITY_WRITE_TOKEN (an Editor token) to seed.')
  process.exit(1)
}
const client = createClient({
  projectId: SANITY_PROJECT_ID,
  dataset: SANITY_DATASET || 'production',
  token: SANITY_WRITE_TOKEN,
  apiVersion: SANITY_API_VERSION,
  useCdn: false,
})
const docs = loadSampleCatalog()
const tx = client.transaction()
for (const d of docs) tx.createOrReplace(d as any)
const res = await tx.commit()
console.log(`Seeded ${docs.length} sample documents (transaction ${res.transactionId}).`)
