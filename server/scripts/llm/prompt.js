import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const cvPromptPath = path.resolve(__dirname, '../../prompts/cv-feature-extraction.prompt.txt')
const fallbackPrompt = '你是資深 HR 履歷解析助理。請從履歷文字中提取 fullName、email、phone、keywords，並只輸出 JSON 物件。'

export const getCvLlmPrompt = () =>
  process.env.CV_LLM_PROMPT || (fs.existsSync(cvPromptPath) ? fs.readFileSync(cvPromptPath, 'utf8').trim() : fallbackPrompt)
