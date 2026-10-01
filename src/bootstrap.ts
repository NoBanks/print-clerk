import {join} from 'node:path'
import {createClient} from '@sanity/client'
import {PrintClerk} from './agent.js'
import {SanityContext} from './context/client.js'
import {modelFromEnv} from './llm.js'
import {ContextEmulator, EMULATED_KB_ID, loadSampleCatalog} from './mock/emulator.js'
import {startEmulator} from './mock/server.js'
import {FileStore} from './store/fileStore.js'
import {SanityStore} from './store/sanityStore.js'
import type {Store} from './store/store.js'
import {FaultInjectionWriter, LlmWriter, TemplateWriter, type Writer} from './writers.js'
import {Ledger} from './ledger.js'

export const SANITY_API_VERSION = '2025-02-19'

export interface Runtime {
  clerk: PrintClerk
  ctx: SanityContext
  store: Store
  describe: string[]
  close: () => Promise<void>
}

export async function bootstrap(opts: {writer?: 'template' | 'llm' | 'fault'; env?: NodeJS.ProcessEnv; storePath?: string} = {}): Promise<Runtime> {
  const env = opts.env ?? process.env
  const describe: string[] = []
  const closers: Array<() => Promise<void>> = []

  // Read path: hosted Context MCP if configured, otherwise the local emulator over real MCP.
  let ctx: SanityContext
  if (env.SANITY_CONTEXT_MCP_URL) {
    if (!env.SANITY_ORGANIZATION_TOKEN) throw new Error('SANITY_CONTEXT_MCP_URL is set but SANITY_ORGANIZATION_TOKEN is not')
    const kbIds = (env.SANITY_KNOWLEDGE_BASE_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    ctx = await SanityContext.connect({url: env.SANITY_CONTEXT_MCP_URL, token: env.SANITY_ORGANIZATION_TOKEN, knowledgeBaseIds: kbIds})
    describe.push(`context: Sanity Context MCP (${new URL(env.SANITY_CONTEXT_MCP_URL).pathname}), knowledge bases: ${kbIds.join(', ') || 'none'}`)
  } else {
    const token = 'local-emulator-token'
    const handle = await startEmulator({emulator: new ContextEmulator(loadSampleCatalog()), token})
    closers.push(handle.close)
    ctx = await SanityContext.connect({url: handle.url, token, knowledgeBaseIds: [EMULATED_KB_ID]})
    describe.push('context: local Context MCP emulator with sample data (set SANITY_CONTEXT_MCP_URL to use Sanity)')
  }
  closers.unshift(() => ctx.close())

  // Write path: Sanity dataset if a write token is present, otherwise a local JSON file.
  let store: Store
  if (env.SANITY_PROJECT_ID && env.SANITY_WRITE_TOKEN) {
    const client = createClient({
      projectId: env.SANITY_PROJECT_ID,
      dataset: env.SANITY_DATASET || 'production',
      token: env.SANITY_WRITE_TOKEN,
      apiVersion: SANITY_API_VERSION,
      useCdn: false,
    })
    store = new SanityStore(client)
    describe.push(`store: Sanity project ${env.SANITY_PROJECT_ID}, dataset ${env.SANITY_DATASET || 'production'}`)
  } else {
    const path = opts.storePath ?? join(process.cwd(), '.clerk', 'store.json')
    store = new FileStore(path)
    describe.push(`store: local file ${path} (set SANITY_PROJECT_ID + SANITY_WRITE_TOKEN to write to Sanity)`)
  }

  const llm = await modelFromEnv(env).catch((err) => {
    describe.push(`model: unavailable (${(err as Error).message})`)
    return null
  })
  if (llm) describe.push(`model: ${llm.id}`)

  let writer: Writer
  const choice = opts.writer ?? (llm ? 'llm' : 'template')
  if (choice === 'llm') {
    if (!llm) throw new Error('--writer llm needs LLM_BASE_URL')
    writer = new LlmWriter(llm.model, llm.id, ctx.agentTools(new Ledger()))
  } else if (choice === 'fault') {
    writer = new FaultInjectionWriter()
  } else {
    writer = new TemplateWriter()
  }
  describe.push(`writer: ${writer.name}`)

  const clerk = new PrintClerk(ctx, store, writer, {model: llm?.model, modelId: llm?.id})
  return {
    clerk,
    ctx,
    store,
    describe,
    close: async () => {
      for (const c of closers) await c()
    },
  }
}
