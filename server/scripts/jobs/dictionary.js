import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const JOB_DICTIONARY_PATH = path.resolve(__dirname, '../../../finance-job-positions.json')

const REQUIRED_JOB_FIELDS = [
  'title',
  'description',
  'industry',
  'roleKeywords',
  'coreResponsibilities',
  'requiredSkills',
  'preferredSkills',
  'certifications',
  'minWorkYears',
  'salaryRange',
  'weights',
]

let jobDictionaryCache = null

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const normalizeText = (value) => String(value ?? '').trim()

const ensureStringArray = (value, fieldName, jobKey) => {
  if (!Array.isArray(value)) throw new Error(`${jobKey}.${fieldName} must be an array`)
  for (const item of value) {
    if (!normalizeText(item)) throw new Error(`${jobKey}.${fieldName} must contain non-empty strings`)
  }
}

const ensureNumber = (value, fieldName, jobKey) => {
  if (!Number.isFinite(Number(value))) throw new Error(`${jobKey}.${fieldName} must be a number`)
}

export const validateJobDictionary = (dictionary) => {
  if (!isPlainObject(dictionary)) throw new Error('job dictionary root must be an object')

  for (const [jobKey, job] of Object.entries(dictionary)) {
    if (!normalizeText(jobKey)) throw new Error('job key cannot be empty')
    if (!isPlainObject(job)) throw new Error(`${jobKey} must be an object`)

    for (const field of REQUIRED_JOB_FIELDS) {
      if (!(field in job)) throw new Error(`${jobKey}.${field} is required`)
    }

    if (!normalizeText(job.title)) throw new Error(`${jobKey}.title is required`)
    if (!normalizeText(job.description)) throw new Error(`${jobKey}.description is required`)

    ensureStringArray(job.industry, 'industry', jobKey)
    ensureStringArray(job.roleKeywords, 'roleKeywords', jobKey)
    ensureStringArray(job.coreResponsibilities, 'coreResponsibilities', jobKey)
    ensureStringArray(job.requiredSkills, 'requiredSkills', jobKey)
    ensureStringArray(job.preferredSkills, 'preferredSkills', jobKey)
    ensureStringArray(job.certifications, 'certifications', jobKey)

    ensureNumber(job.minWorkYears, 'minWorkYears', jobKey)
    if (!isPlainObject(job.salaryRange)) throw new Error(`${jobKey}.salaryRange must be an object`)
    ensureNumber(job.salaryRange.min, 'salaryRange.min', jobKey)
    ensureNumber(job.salaryRange.max, 'salaryRange.max', jobKey)
    if (Number(job.salaryRange.min) > Number(job.salaryRange.max)) {
      throw new Error(`${jobKey}.salaryRange.min cannot be greater than max`)
    }

    if (!isPlainObject(job.weights)) throw new Error(`${jobKey}.weights must be an object`)
    let weightSum = 0
    for (const [weightKey, rawValue] of Object.entries(job.weights)) {
      const value = Number(rawValue)
      if (!Number.isFinite(value)) throw new Error(`${jobKey}.weights.${weightKey} must be a number`)
      weightSum += value
    }
    if (Math.abs(weightSum - 1) > 0.000001) {
      throw new Error(`${jobKey}.weights must sum to 1.0`)
    }
  }

  return dictionary
}

export const loadJobDictionary = () => {
  const content = fs.readFileSync(JOB_DICTIONARY_PATH, 'utf8')
  const parsed = JSON.parse(content)
  jobDictionaryCache = validateJobDictionary(parsed)
  return jobDictionaryCache
}

export const getJobDictionary = () => jobDictionaryCache || loadJobDictionary()

export const saveJobDictionary = (dictionary) => {
  const validated = validateJobDictionary(dictionary)
  fs.writeFileSync(JOB_DICTIONARY_PATH, `${JSON.stringify(validated, null, 2)}\n`, 'utf8')
  jobDictionaryCache = validated
  return validated
}
