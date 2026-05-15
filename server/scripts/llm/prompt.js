import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const promptDir = path.resolve(__dirname, '../../prompts')

const readPromptFile = (fileName, envKey = '') => {
  if (envKey && process.env[envKey]) return process.env[envKey]
  const promptPath = path.resolve(promptDir, fileName)
  if (!fs.existsSync(promptPath)) {
    throw new Error(`[LLM] Prompt file not found: ${promptPath}`)
  }
  return fs.readFileSync(promptPath, 'utf8').trim()
}

export const getCvLlmPrompt = () => readPromptFile('cv-feature-extraction.prompt.txt', 'CV_LLM_PROMPT')
export const getJobShortlistPrompt = () => readPromptFile('job-shortlist.prompt.txt', 'JOB_SHORTLIST_PROMPT')
export const getJobRerankPrompt = () => readPromptFile('job-rerank.prompt.txt', 'JOB_RERANK_PROMPT')
export const getJobSingleMatchPrompt = () => readPromptFile('job-single-match.prompt.txt', 'JOB_SINGLE_MATCH_PROMPT')
export const getJobRubricSuggestionPrompt = () =>
  readPromptFile('job-rubric-suggestions.prompt.txt', 'JOB_RUBRIC_SUGGESTION_PROMPT')
export const getJobDictionarySuggestionPrompt = () =>
  readPromptFile('job-dictionary-suggestions.prompt.txt', 'JOB_DICTIONARY_SUGGESTION_PROMPT')
