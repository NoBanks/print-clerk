import './env.js'
import {readFileSync} from 'node:fs'
import {bootstrap} from './bootstrap.js'
import {CATALOG_INDEX} from './queries.js'
import {CHANNELS, type Channel, type ListingDraft} from './types.js'

const HELP = `print-clerk: an art catalog agent that only says what Sanity says

  clerk index                         list artworks (via Context MCP groq_query)
  clerk tools                         list the Context MCP tools the agent can use
  clerk draft <slug> [--channel marketplace|instagram|x|newsletter] [--writer template|llm|fault]
  clerk ask "<buyer question>"        answer from the catalog or escalate (needs LLM_BASE_URL)
  clerk review [--status needs_review|blocked|approved|rejected]
  clerk show <draftId>
  clerk approve <draftId> --by <name> [--note "..."]
  clerk reject <draftId> --by <name> --reason "..."
  clerk recheck <draftId> --by <name> [--body-file path]
  clerk audit [subjectId]
`

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

function printDraft(d: ListingDraft) {
  console.log(`\n[${d.status}] ${d._id}  (${d.channel}, ${d.model})`)
  console.log(`TITLE: ${d.title}`)
  console.log(d.body)
  if (d.verification.issues.length) console.log(`\nverifier issues:\n- ${d.verification.issues.join('\n- ')}`)
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(HELP)
    return
  }
  const writer = flag(args, 'writer') as 'template' | 'llm' | 'fault' | undefined
  const rt = await bootstrap({writer})
  console.error(rt.describe.map((l) => `# ${l}`).join('\n'))
  try {
    switch (cmd) {
      case 'index': {
        const rows = await rt.ctx.groqQuery<any[]>(CATALOG_INDEX)
        for (const r of rows) {
          const sizes = (r.formats ?? []).map((f: any) => `${f.label} $${f.priceUsd} ${f.status}`).join(' | ')
          console.log(`${r.slug.padEnd(14)} ${String(r.title).padEnd(10)} ${String(r.collection).padEnd(18)} ${sizes}`)
        }
        break
      }
      case 'tools':
        console.log(JSON.stringify(rt.ctx.toolNames(), null, 2))
        break
      case 'draft': {
        const slug = args[0]
        const channel = (flag(args, 'channel') ?? 'marketplace') as Channel
        if (!slug || !CHANNELS.includes(channel)) throw new Error('usage: clerk draft <slug> --channel marketplace|instagram|x|newsletter')
        printDraft(await rt.clerk.draft(slug, channel))
        break
      }
      case 'ask': {
        const q = args.filter((a) => !a.startsWith('--')).join(' ')
        const inq = await rt.clerk.ask(q)
        console.log(`\n[${inq.status}] ${inq._id}\n${inq.answer}`)
        if (inq.status === 'escalated') console.log(`\nheld back:\n${inq.modelAnswer}\n\nissues:\n- ${inq.issues.join('\n- ')}`)
        break
      }
      case 'review': {
        const drafts = await rt.store.listDrafts(flag(args, 'status') ?? 'needs_review')
        if (!drafts.length) console.log('nothing waiting')
        drafts.forEach(printDraft)
        break
      }
      case 'show': {
        const d = await rt.store.get<ListingDraft>(args[0])
        if (!d) throw new Error(`no document ${args[0]}`)
        console.log(JSON.stringify(d, null, 2))
        break
      }
      case 'approve': {
        const by = flag(args, 'by')
        if (!by) throw new Error('approve needs --by <name>: approvals are attributed in the audit log')
        printDraft(await rt.clerk.approve(args[0], by, flag(args, 'note')))
        break
      }
      case 'reject': {
        const by = flag(args, 'by')
        const reason = flag(args, 'reason')
        if (!by || !reason) throw new Error('reject needs --by <name> and --reason "..."')
        printDraft(await rt.clerk.reject(args[0], by, reason))
        break
      }
      case 'recheck': {
        const by = flag(args, 'by')
        if (!by) throw new Error('recheck needs --by <name>')
        const bodyFile = flag(args, 'body-file')
        const edits = bodyFile ? {body: readFileSync(bodyFile, 'utf8').trim()} : undefined
        printDraft(await rt.clerk.recheck(args[0], `human:${by}`, edits))
        break
      }
      case 'audit': {
        for (const e of await rt.store.auditLog(args[0])) console.log(`${e.at}  ${e.actor.padEnd(14)} ${e.action.padEnd(18)} ${e.subjectId}  ${e.details}`)
        break
      }
      default:
        console.log(HELP)
        process.exitCode = 1
    }
  } finally {
    await rt.close()
  }
}

main().catch((err) => {
  console.error(`error: ${(err as Error).message}`)
  process.exit(1)
})
