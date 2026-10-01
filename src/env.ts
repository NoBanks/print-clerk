import {existsSync} from 'node:fs'

// Load ./.env when present (Node 20.12+ built-in, no dotenv dependency).
if (existsSync('.env')) process.loadEnvFile('.env')
