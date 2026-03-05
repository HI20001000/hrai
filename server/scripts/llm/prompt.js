import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const cvPromptPath = path.resolve(__dirname, '../../prompts/cv-feature-extraction.prompt.txt')

export const getCvLlmPrompt = () => {
  if (process.env.CV_LLM_PROMPT) return process.env.CV_LLM_PROMPT
  if (!fs.existsSync(cvPromptPath)) {
    throw new Error(`[CV] Prompt file not found: ${cvPromptPath}`)
  }
  return fs.readFileSync(cvPromptPath, 'utf8').trim()
}
