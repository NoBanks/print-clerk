import {createServer, type IncomingMessage, type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {z} from 'zod'
import {ContextEmulator, EMULATED_KB_ID} from './emulator.js'

function text(t: string) {
  return {content: [{type: 'text' as const, text: t}]}
}

/** Build one MCP server instance for a request, in the mode the URL asks for. */
export function buildMcpServer(emu: ContextEmulator, mode: 'groq' | 'knowledge_base', kbIds: string[]): McpServer {
  const server = new McpServer({name: 'sanity-context-emulator', version: '0.1.0'})

  if (mode === 'groq') {
    server.registerTool(
      'initial_context',
      {description: 'Compressed schema overview plus instructions for querying your content', inputSchema: {}},
      async () => text(emu.groqInitialContext()),
    )
    server.registerTool(
      'schema_explorer',
      {
        description: 'Returns detailed schema information for a specific type, including fields and references',
        inputSchema: {type: z.string(), path: z.string().optional()},
      },
      async ({type, path}) => text(emu.schemaExplorer(type, path)),
    )
    server.registerTool(
      'groq_query',
      {
        description: 'Executes a GROQ query against the dataset, subject to any groqFilter in effect',
        inputSchema: {query: z.string()},
      },
      async ({query}) => {
        try {
          return text(JSON.stringify(await emu.groqQuery(query)))
        } catch (err) {
          return {...text(`GROQ error: ${(err as Error).message}`), isError: true}
        }
      },
    )
  } else {
    server.registerTool(
      'initial_context',
      {description: 'The outline of each Knowledge Base the endpoint serves', inputSchema: {}},
      async () => text(emu.kbInitialContext(kbIds)),
    )
    server.registerTool(
      'knowledge_base_read',
      {
        description: 'Reads the full content of one or more entries, by Knowledge Base id and entry paths',
        inputSchema: {knowledgeBase: z.string(), paths: z.array(z.string()).min(1).max(20)},
      },
      async ({knowledgeBase, paths}) => text(emu.kbRead(knowledgeBase, paths)),
    )
  }
  return server
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

export interface EmulatorHandle {
  url: string
  close: () => Promise<void>
}

/**
 * Serve the emulator over MCP Streamable HTTP, stateless, bearer-authenticated,
 * at /v1/context/organizations/:org/mcp/:name like the hosted endpoint.
 */
export async function startEmulator(opts: {emulator: ContextEmulator; token: string; port?: number}): Promise<EmulatorHandle> {
  const httpServer: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (!/^\/v1\/context\/organizations\/[^/]+\/mcp\/[^/]+$/.test(url.pathname)) {
        res.writeHead(404).end()
        return
      }
      if (req.headers.authorization !== `Bearer ${opts.token}`) {
        res.writeHead(403, {'content-type': 'application/json'}).end(JSON.stringify({code: 'contextGrantRequired'}))
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      const modeParam = url.searchParams.get('mode') ?? 'groq'
      const mode = modeParam === 'knowledge_base' ? 'knowledge_base' : 'groq'
      const kbIds = (url.searchParams.get('knowledgeBases') ?? EMULATED_KB_ID).split(',').filter(Boolean)
      const mcp = buildMcpServer(opts.emulator, mode, kbIds)
      const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true})
      res.on('close', () => {
        void transport.close()
        void mcp.close()
      })
      await mcp.connect(transport)
      await transport.handleRequest(req, res, await readJson(req))
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end(String(err))
    }
  })

  await new Promise<void>((resolve) => httpServer.listen(opts.port ?? 0, '127.0.0.1', resolve))
  const {port} = httpServer.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/v1/context/organizations/local-org/mcp/print-clerk`,
    close: () => new Promise((resolve) => httpServer.close(() => resolve())),
  }
}
