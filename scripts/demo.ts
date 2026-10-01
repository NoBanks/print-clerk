import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {bootstrap} from '../src/bootstrap.js'

// End-to-end walk-through on the local emulator: draft, block, approve, audit.
const storePath = join(mkdtempSync(join(tmpdir(), 'print-clerk-')), 'store.json')
const env = {...process.env, SANITY_CONTEXT_MCP_URL: '', SANITY_PROJECT_ID: '', LLM_BASE_URL: ''}

const good = await bootstrap({writer: 'template', env, storePath})
console.log(good.describe.map((l) => `# ${l}`).join('\n'))
const d1 = await good.clerk.draft('cs-3fa9c2', 'marketplace')
console.log(`\n1) Draft from catalog facts -> ${d1.status}\n${d1.title}\n${d1.body}`)
await good.close()

const sloppy = await bootstrap({writer: 'fault', env, storePath})
const d2 = await sloppy.clerk.draft('cs-3fa9c2', 'instagram')
console.log(`\n2) Draft with an injected wrong price and an invented claim -> ${d2.status}`)
console.log(d2.verification.issues.map((i) => `   - ${i}`).join('\n'))
await sloppy.close()

const review = await bootstrap({writer: 'template', env, storePath})
const approved = await review.clerk.approve(d1._id, 'Ryan', 'demo approval')
console.log(`\n3) Human approval re-checks live content first -> ${approved.status}`)
try {
  await review.clerk.approve(d2._id, 'Ryan')
} catch (err) {
  console.log(`4) Approving the blocked draft is refused: ${(err as Error).message}`)
}
console.log('\n5) Audit log')
for (const e of await review.store.auditLog()) console.log(`   ${e.at}  ${e.actor.padEnd(11)} ${e.action}`)
await review.close()
