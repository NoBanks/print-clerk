import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {MockLanguageModelV3} from 'ai/test'
import {SanityContext} from '../src/context/client.js'
import {ContextEmulator, EMULATED_KB_ID, loadSampleCatalog} from '../src/mock/emulator.js'
import {startEmulator} from '../src/mock/server.js'
import {FileStore} from '../src/store/fileStore.js'

export const TOKEN = 'test-token'

export async function harness(opts: {kb?: boolean} = {}) {
  const docs = loadSampleCatalog()
  const emulator = new ContextEmulator(docs)
  const server = await startEmulator({emulator, token: TOKEN})
  const ctx = await SanityContext.connect({url: server.url, token: TOKEN, knowledgeBaseIds: opts.kb === false ? [] : [EMULATED_KB_ID]})
  const store = new FileStore(join(mkdtempSync(join(tmpdir(), 'clerk-test-')), 'store.json'))
  return {
    emulator,
    server,
    ctx,
    store,
    close: async () => {
      await ctx.close()
      await server.close()
    },
  }
}

const usage = {
  inputTokens: {total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0},
  outputTokens: {total: 10, text: 10, reasoning: 0},
}

export type Step = {tool: string; args: Record<string, unknown>} | {text: string}

/** A language model that plays back a fixed script of tool calls and text. */
export function scriptedModel(steps: Step[]) {
  let i = 0
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const step = steps[Math.min(i, steps.length - 1)]
      i++
      if ('tool' in step) {
        return {
          content: [{type: 'tool-call', toolCallId: `call-${i}`, toolName: step.tool, input: JSON.stringify(step.args)}],
          finishReason: {unified: 'tool-calls', raw: 'tool_calls'},
          usage,
          warnings: [],
        } as any
      }
      return {content: [{type: 'text', text: step.text}], finishReason: {unified: 'stop', raw: 'stop'}, usage, warnings: []} as any
    },
  })
}
