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

const FIELD_LABELS = {
  title: '職位名稱',
  description: '職位描述',
  industry: '行業背景',
  roleKeywords: '職位關鍵字',
  coreResponsibilities: '核心職責',
  requiredSkills: '必備技能',
  preferredSkills: '加分技能',
  certifications: '證照',
  minWorkYears: '最低工作年資',
  salaryRange: '薪資範圍',
  'salaryRange.min': '最低薪資',
  'salaryRange.max': '最高薪資',
  weights: '權重設定',
  projectExperience: '專案經驗',
  workYears: '工作年資',
  candidatePreference: '候選人偏好',
}

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const normalizeText = (value) => String(value ?? '').trim()
const getFieldLabel = (fieldName) => FIELD_LABELS[fieldName] || fieldName

const ensureStringArray = (value, fieldName, jobKey) => {
  const label = getFieldLabel(fieldName)
  if (!Array.isArray(value)) throw new Error(`職位「${jobKey}」的${label}必須是陣列`)
  for (const item of value) {
    if (!normalizeText(item)) throw new Error(`職位「${jobKey}」的${label}只能包含非空字串`)
  }
}

const ensureNumber = (value, fieldName, jobKey) => {
  const label = getFieldLabel(fieldName)
  if (!Number.isFinite(Number(value))) throw new Error(`職位「${jobKey}」的${label}必須是數字`)
}

export const validateJobDictionary = (dictionary) => {
  if (!isPlainObject(dictionary)) throw new Error('職位字典根節點必須是物件')

  for (const [jobKey, job] of Object.entries(dictionary)) {
    if (!normalizeText(jobKey)) throw new Error('職位代碼不可為空')
    if (!isPlainObject(job)) throw new Error(`職位「${jobKey}」的資料必須是物件`)

    for (const field of REQUIRED_JOB_FIELDS) {
      if (!(field in job)) throw new Error(`職位「${jobKey}」缺少必要欄位：${getFieldLabel(field)}`)
    }

    if (!normalizeText(job.title)) throw new Error(`職位「${jobKey}」的名稱不可為空`)
    if (!normalizeText(job.description)) throw new Error(`職位「${jobKey}」的描述不可為空`)

    ensureStringArray(job.industry, 'industry', jobKey)
    ensureStringArray(job.roleKeywords, 'roleKeywords', jobKey)
    ensureStringArray(job.coreResponsibilities, 'coreResponsibilities', jobKey)
    ensureStringArray(job.requiredSkills, 'requiredSkills', jobKey)
    ensureStringArray(job.preferredSkills, 'preferredSkills', jobKey)
    ensureStringArray(job.certifications, 'certifications', jobKey)

    ensureNumber(job.minWorkYears, 'minWorkYears', jobKey)
    if (!isPlainObject(job.salaryRange)) throw new Error(`職位「${jobKey}」的薪資範圍必須是物件`)
    ensureNumber(job.salaryRange.min, 'salaryRange.min', jobKey)
    ensureNumber(job.salaryRange.max, 'salaryRange.max', jobKey)
    if (Number(job.salaryRange.min) > Number(job.salaryRange.max)) {
      throw new Error(`職位「${jobKey}」的最低薪資不可大於最高薪資`)
    }

    if (!isPlainObject(job.weights)) throw new Error(`職位「${jobKey}」的權重設定必須是物件`)
    let weightSum = 0
    for (const [weightKey, rawValue] of Object.entries(job.weights)) {
      const value = Number(rawValue)
      if (!Number.isFinite(value)) throw new Error(`職位「${jobKey}」的權重 ${getFieldLabel(weightKey)} 必須是數字`)
      weightSum += value
    }
    if (Math.abs(weightSum - 1) > 0.000001) {
      throw new Error(`職位「${jobKey}」的權重總和必須等於 1.0`)
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
