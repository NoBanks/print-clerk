import {ContextEmulator, loadSampleCatalog} from './emulator.js'
import {startEmulator} from './server.js'

// Runs the local Context MCP emulator so you can point any MCP client at it.
const token = process.env.MOCK_CONTEXT_TOKEN || 'local-emulator-token'
const port = Number(process.env.MOCK_CONTEXT_PORT || 4777)
const handle = await startEmulator({emulator: new ContextEmulator(loadSampleCatalog()), token, port})
console.log(`Context MCP emulator on ${handle.url}`)
console.log('Auth: Authorization: Bearer $MOCK_CONTEXT_TOKEN (defaults to local-emulator-token)')
