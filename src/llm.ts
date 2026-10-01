import {createOpenAICompatible} from '@ai-sdk/openai-compatible'
import type {LanguageModel} from 'ai'

/**
 * Any OpenAI-compatible chat endpoint (a hosted provider, or a local server).
 * The app knows where the model lives, not which model it is: if LLM_MODEL is
 * unset, the first id from GET {LLM_BASE_URL}/models is used.
 */
export async function modelFromEnv(env = process.env): Promise<{model: LanguageModel; id: string} | null> {
  const baseURL = env.LLM_BASE_URL
  if (!baseURL) return null
  const apiKey = env.LLM_API_KEY
  let id = env.LLM_MODEL
  if (!id) {
    const res = await fetch(`${baseURL.replace(/\/$/, '')}/models`, {
      headers: apiKey ? {Authorization: `Bearer ${apiKey}`} : {},
    })
    if (!res.ok) throw new Error(`LLM_MODEL is unset and ${baseURL}/models answered ${res.status}`)
    const data = (await res.json()) as {data?: Array<{id: string}>}
    id = data.data?.[0]?.id
    if (!id) throw new Error(`LLM_MODEL is unset and ${baseURL}/models listed no models`)
  }
  const provider = createOpenAICompatible({name: 'llm', baseURL, apiKey})
  return {model: provider.chatModel(id), id}
}
