import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const JOB_DICTIONARY_PATH = path.resolve(__dirname, '../../../finance-job-positions.json')

const REQUIRED_JOB_FIELDS = [
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

const ensureStringArray = (value, fieldName, jobTitle) => {
  const label = getFieldLabel(fieldName)
  if (!Array.isArray(value)) throw new Error(`職位「${jobTitle}」的${label}必須是陣列`)
  for (const item of value) {
    if (!normalizeText(item)) throw new Error(`職位「${jobTitle}」的${label}只能包含非空字串`)
  }
}

const ensureNumber = (value, fieldName, jobTitle) => {
  const label = getFieldLabel(fieldName)
  if (!Number.isFinite(Number(value))) throw new Error(`職位「${jobTitle}」的${label}必須是數字`)
}

const normalizeJobDefinition = (jobTitle, job = {}) => ({
  description: normalizeText(job.description),
  industry: Array.isArray(job.industry) ? job.industry.map((item) => normalizeText(item)).filter(Boolean) : job.industry,
  roleKeywords: Array.isArray(job.roleKeywords)
    ? job.roleKeywords.map((item) => normalizeText(item)).filter(Boolean)
    : job.roleKeywords,
  coreResponsibilities: Array.isArray(job.coreResponsibilities)
    ? job.coreResponsibilities.map((item) => normalizeText(item)).filter(Boolean)
    : job.coreResponsibilities,
  requiredSkills: Array.isArray(job.requiredSkills)
    ? job.requiredSkills.map((item) => normalizeText(item)).filter(Boolean)
    : job.requiredSkills,
  preferredSkills: Array.isArray(job.preferredSkills)
    ? job.preferredSkills.map((item) => normalizeText(item)).filter(Boolean)
    : job.preferredSkills,
  certifications: Array.isArray(job.certifications)
    ? job.certifications.map((item) => normalizeText(item)).filter(Boolean)
    : job.certifications,
  minWorkYears: Number(job.minWorkYears || 0),
  salaryRange: {
    min: Number(job?.salaryRange?.min || 0),
    max: Number(job?.salaryRange?.max || 0),
  },
  weights: isPlainObject(job.weights) ? { ...job.weights } : job.weights,
})

const normalizeDictionaryShape = (dictionary) => {
  if (!isPlainObject(dictionary)) throw new Error('職位字典根節點必須是物件')

  const normalizedDictionary = {}
  for (const [rawKey, rawJob] of Object.entries(dictionary)) {
    if (!isPlainObject(rawJob)) throw new Error(`職位「${rawKey}」的資料必須是物件`)

    const titleFromKey = normalizeText(rawKey)
    const legacyTitle = normalizeText(rawJob.title)
    const jobTitle = legacyTitle || titleFromKey

    if (!jobTitle) throw new Error('職位名稱不可為空')
    if (normalizedDictionary[jobTitle]) {
      throw new Error(`職位字典存在重複 title：「${jobTitle}」`)
    }

    normalizedDictionary[jobTitle] = normalizeJobDefinition(jobTitle, rawJob)
  }

  return normalizedDictionary
}

export const validateJobDictionary = (dictionary) => {
  const normalizedDictionary = normalizeDictionaryShape(dictionary)

  for (const [jobTitle, job] of Object.entries(normalizedDictionary)) {
    if (!normalizeText(jobTitle)) throw new Error('職位名稱不可為空')
    if (!isPlainObject(job)) throw new Error(`職位「${jobTitle}」的資料必須是物件`)

    for (const field of REQUIRED_JOB_FIELDS) {
      if (!(field in job)) throw new Error(`職位「${jobTitle}」缺少必要欄位：${getFieldLabel(field)}`)
    }

    if (!normalizeText(job.description)) throw new Error(`職位「${jobTitle}」的描述不可為空`)

    ensureStringArray(job.industry, 'industry', jobTitle)
    ensureStringArray(job.roleKeywords, 'roleKeywords', jobTitle)
    ensureStringArray(job.coreResponsibilities, 'coreResponsibilities', jobTitle)
    ensureStringArray(job.requiredSkills, 'requiredSkills', jobTitle)
    ensureStringArray(job.preferredSkills, 'preferredSkills', jobTitle)
    ensureStringArray(job.certifications, 'certifications', jobTitle)

    ensureNumber(job.minWorkYears, 'minWorkYears', jobTitle)
    if (!isPlainObject(job.salaryRange)) throw new Error(`職位「${jobTitle}」的薪資範圍必須是物件`)
    ensureNumber(job.salaryRange.min, 'salaryRange.min', jobTitle)
    ensureNumber(job.salaryRange.max, 'salaryRange.max', jobTitle)
    if (Number(job.salaryRange.min) > Number(job.salaryRange.max)) {
      throw new Error(`職位「${jobTitle}」的最低薪資不可大於最高薪資`)
    }

    if (!isPlainObject(job.weights)) throw new Error(`職位「${jobTitle}」的權重設定必須是物件`)
    let weightSum = 0
    for (const [weightKey, rawValue] of Object.entries(job.weights)) {
      const value = Number(rawValue)
      if (!Number.isFinite(value)) {
        throw new Error(`職位「${jobTitle}」的權重 ${getFieldLabel(weightKey)} 必須是數字`)
      }
      weightSum += value
    }
    if (Math.abs(weightSum - 1) > 0.000001) {
      throw new Error(`職位「${jobTitle}」的權重總和必須等於 1.0`)
    }
  }

  return normalizedDictionary
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
