import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {schemaTypes} from './schemaTypes'

const projectId = process.env.SANITY_STUDIO_PROJECT_ID
const dataset = process.env.SANITY_STUDIO_DATASET || 'production'

if (!projectId) {
  throw new Error('Set SANITY_STUDIO_PROJECT_ID (see ../.env.example)')
}

export default defineConfig({
  name: 'print-clerk',
  title: 'Print Clerk',
  projectId,
  dataset,
  plugins: [structureTool()],
  schema: {types: schemaTypes},
})
