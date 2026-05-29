<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { apiBaseUrl } from '../../scripts/apiBaseUrl.js'
import { resolveJobDictionary } from '../../scripts/jobDictionary.js'
import {
  SCORING_DIMENSIONS,
  SCORING_LEVELS,
  normalizeScoringRubricsForUi,
  normalizeScoringWeightsForUi,
} from '../../scripts/jobScoring.js'

const props = defineProps({
  selectedTitle: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['updated', 'selected-title-change'])

const jobDictionaryLoading = ref(false)
const jobDictionarySaving = ref(false)
const jobDictionaryMessage = ref('')
const jobDictionaryError = ref('')
const jobDictionary = ref({})
const selectedJobTitle = ref('')
const newJobTitle = ref('')
const jobDraft = ref(null)
const isSuggestingJobDefinition = ref(false)
const isSuggestingRubrics = ref(false)
const jobUploadInput = ref(null)
const isUploadingJobDocument = ref(false)

const WEIGHT_FIELDS = SCORING_DIMENSIONS
const LEVEL_FIELDS = SCORING_LEVELS
const DEFAULT_EMPLOYMENT_GAP_LIMIT_MONTHS = 5

const parseJsonSafe = (value) => {
  try {
    return JSON.parse(String(value || '{}'))
  } catch {
    return null
  }
}

const normalizeText = (value) => String(value ?? '').trim()

const normalizeEmploymentGapLimitMonths = (value) => {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue < 0) return DEFAULT_EMPLOYMENT_GAP_LIMIT_MONTHS
  return Math.round(numericValue)
}

const normalizeListText = (value) =>
  String(value ?? '')
    .split(/[\n,，;；、|/]+/)
    .map((item) => item.trim())
    .filter(Boolean)

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const safeFileName = (value) =>
  normalizeText(value)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'job-dictionary'

const listToHtml = (items = []) => {
  const values = Array.isArray(items) ? items : normalizeListText(items)
  if (!values.length) return '<p class="empty">未填寫</p>'
  return `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
}

const fieldRowHtml = (label, value) => `
  <tr>
    <th>${escapeHtml(label)}</th>
    <td>${escapeHtml(value || '未填寫')}</td>
  </tr>
`

const buildJobDocumentHtml = (jobTitle, job) => {
  const exportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    jobTitle,
    job,
  }
  const encodedPayload = encodeBase64Utf8(JSON.stringify(exportPayload))
  const weights = WEIGHT_FIELDS.map((field) => ({
    label: field.label,
    value: Math.round(Number(job.weights?.[field.key] || 0) * 1000) / 10,
  }))
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(jobTitle)} 職位字典</title>
  <style>
    body { font-family: "Microsoft JhengHei", "PingFang TC", Arial, sans-serif; color: #1f2937; line-height: 1.55; }
    .cover { padding: 24px 0 18px; border-bottom: 4px solid #2563eb; margin-bottom: 18px; }
    h1 { margin: 0; color: #0f172a; font-size: 28px; }
    h2 { margin: 22px 0 8px; color: #1d4ed8; font-size: 18px; }
    .meta { color: #64748b; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
    th { width: 28%; background: #eff6ff; color: #1e40af; text-align: left; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; vertical-align: top; }
    ul { margin: 6px 0 6px 20px; padding: 0; }
    .section { page-break-inside: avoid; }
    .empty { color: #94a3b8; margin: 0; }
    .rubric th { width: auto; }
    .hidden-json { display: none; color: #fff; font-size: 1px; }
  </style>
</head>
<body>
  <div class="cover">
    <h1>${escapeHtml(jobTitle)} 職位字典</h1>
    <p class="meta">由 HRAI 匯出｜${escapeHtml(new Date().toLocaleString())}</p>
  </div>

  <div class="section">
    <h2>基本資料</h2>
    <table>
      ${fieldRowHtml('職位名稱', job.title)}
      ${fieldRowHtml('職位編號 / jobKey', job.jobKey)}
      ${fieldRowHtml('職位描述', job.description)}
      ${fieldRowHtml('最低工作年資', `${job.minWorkYears} 年`)}
      ${fieldRowHtml('空窗期上限', `${job.employmentGapLimitMonths} 個月`)}
      ${fieldRowHtml('薪資範圍', `${job.salaryRange?.min || 0} - ${job.salaryRange?.max || 0} MOP / 月`)}
    </table>
  </div>

  <div class="section"><h2>行業背景</h2>${listToHtml(job.industry)}</div>
  <div class="section"><h2>職位關鍵字</h2>${listToHtml(job.roleKeywords)}</div>
  <div class="section"><h2>核心職責</h2>${listToHtml(job.coreResponsibilities)}</div>
  <div class="section"><h2>必備技能</h2>${listToHtml(job.requiredSkills)}</div>
  <div class="section"><h2>專案經驗</h2>${listToHtml(job.projectExperience)}</div>
  <div class="section"><h2>加分技能</h2>${listToHtml(job.preferredSkills)}</div>
  <div class="section"><h2>證照</h2>${listToHtml(job.certifications)}</div>
  <div class="section"><h2>候選人偏好</h2>${listToHtml(job.candidatePreference)}</div>

  <div class="section">
    <h2>匹配權重</h2>
    <table>
      <tr>${weights.map((item) => `<th>${escapeHtml(item.label)}</th>`).join('')}</tr>
      <tr>${weights.map((item) => `<td>${escapeHtml(item.value)}%</td>`).join('')}</tr>
    </table>
  </div>

  <div class="section">
    <h2>量化評分標準</h2>
    <table class="rubric">
      <tr><th>維度</th><th>高</th><th>中</th><th>低</th></tr>
      ${WEIGHT_FIELDS.map((field) => {
        const rubric = job.scoringRubrics?.[field.key] || {}
        return `<tr>
          <th>${escapeHtml(field.label)}</th>
          ${LEVEL_FIELDS.map((level) => {
            const item = rubric[level.key] || {}
            return `<td><strong>${escapeHtml(Number(item.score || level.defaultScore))} 分</strong><br>${escapeHtml(item.criteria || '')}</td>`
          }).join('')}
        </tr>`
      }).join('')}
    </table>
  </div>

  <div class="hidden-json">HRAI_JOB_DICTIONARY_JSON_BASE64_START${encodedPayload}HRAI_JOB_DICTIONARY_JSON_BASE64_END</div>
</body>
</html>`
}

const decodeHtmlEntities = (value) => {
  const element = document.createElement('textarea')
  element.innerHTML = String(value || '')
  return element.value
}

const encodeBase64Utf8 = (value) => {
  const bytes = new TextEncoder().encode(String(value || ''))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return window.btoa(binary)
}

const decodeBase64Utf8 = (value) => {
  const binary = window.atob(String(value || '').replace(/\s+/g, ''))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const extractMarkerPayload = (text, startMarker, endMarker) => {
  const start = String(text || '').indexOf(startMarker)
  if (start < 0) return ''
  const contentStart = start + startMarker.length
  const end = String(text || '').indexOf(endMarker, contentStart)
  if (end < 0) return ''
  return String(text || '').slice(contentStart, end)
}

const decodeDocumentBuffer = (buffer) => {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)

  const sample = bytes.slice(0, Math.min(bytes.length, 400))
  let oddNulls = 0
  let evenNulls = 0
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] !== 0) continue
    if (index % 2 === 0) evenNulls += 1
    else oddNulls += 1
  }
  if (oddNulls > sample.length * 0.2) return new TextDecoder('utf-16le').decode(bytes)
  if (evenNulls > sample.length * 0.2) return new TextDecoder('utf-16be').decode(bytes)

  return new TextDecoder('utf-8').decode(bytes)
}

const htmlToPlainText = (value) =>
  decodeHtmlEntities(
    String(value || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim()

const normalizeTemplateText = (value) =>
  normalizeText(value)
    .replace(/\s+/g, '')
    .replace(/[：:]/g, '')

const isTemplateEmptyText = (value) => {
  const text = normalizeTemplateText(value)
  return !text || ['未填寫', '未填写', '-', '無', '无', 'N/A', 'NA'].includes(text.toUpperCase())
}

const extractHtmlTableRows = (html) => {
  const rows = []
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch = null
  while ((rowMatch = rowRegex.exec(String(html || '')))) {
    const cells = []
    const cellRegex = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi
    let cellMatch = null
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      cells.push(htmlToPlainText(cellMatch[1]))
    }
    if (cells.length) rows.push(cells)
  }
  return rows
}

const extractHtmlSections = (html) => {
  const sections = new Map()
  const headingRegex = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi
  const headings = []
  let match = null
  while ((match = headingRegex.exec(String(html || '')))) {
    headings.push({
      title: htmlToPlainText(match[1]),
      contentStart: headingRegex.lastIndex,
      headingStart: match.index,
    })
  }

  headings.forEach((heading, index) => {
    const contentEnd = headings[index + 1]?.headingStart ?? String(html || '').length
    const key = normalizeTemplateText(heading.title)
    if (key) sections.set(key, String(html || '').slice(heading.contentStart, contentEnd))
  })
  return sections
}

const findSectionHtml = (sections, labels) => {
  const normalizedLabels = labels.map((label) => normalizeTemplateText(label)).filter(Boolean)
  for (const [sectionTitle, sectionHtml] of sections.entries()) {
    if (normalizedLabels.some((label) => sectionTitle.includes(label) || label.includes(sectionTitle))) {
      return sectionHtml
    }
  }
  return ''
}

const extractListItemsFromHtml = (html) => {
  const items = []
  const itemRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi
  let match = null
  while ((match = itemRegex.exec(String(html || '')))) {
    const item = htmlToPlainText(match[1])
    if (!isTemplateEmptyText(item)) items.push(item)
  }
  if (items.length) return items

  return htmlToPlainText(html)
    .split(/[\n,，;；、|/]+/)
    .map((item) => normalizeText(item))
    .filter((item) => !isTemplateEmptyText(item))
}

const findTableValue = (rows, labels) => {
  const normalizedLabels = labels.map((label) => normalizeTemplateText(label)).filter(Boolean)
  for (const row of rows) {
    const label = normalizeTemplateText(row[0])
    if (!label) continue
    if (normalizedLabels.some((item) => label.includes(item) || item.includes(label))) {
      return normalizeText(row.slice(1).join(' '))
    }
  }
  return ''
}

const extractFirstNumber = (value) => {
  const match = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

const extractSalaryRange = (value) => {
  const numbers = Array.from(String(value || '').replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g))
    .map((match) => Number(match[0]))
    .filter((number) => Number.isFinite(number))
  return {
    min: numbers[0] ?? 0,
    max: numbers[1] ?? numbers[0] ?? 0,
  }
}

const normalizeDocumentJobTitle = (value) =>
  normalizeText(value)
    .replace(/\s*職位字典\s*$/i, '')
    .replace(/\s*职位字典\s*$/i, '')
    .trim()

const extractFirstHeadingText = (html, tagName) => {
  const match = String(html || '').match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'))
  return match ? htmlToPlainText(match[1]) : ''
}

const findWeightField = (label) => {
  const target = normalizeTemplateText(label)
  return WEIGHT_FIELDS.find((field) => {
    const fieldLabel = normalizeTemplateText(field.label)
    return target === fieldLabel || target.includes(fieldLabel) || fieldLabel.includes(target)
  })
}

const findLevelField = (label) => {
  const target = normalizeTemplateText(label)
  return LEVEL_FIELDS.find((level) => {
    const levelLabel = normalizeTemplateText(level.label)
    return target === levelLabel || target.includes(levelLabel) || levelLabel.includes(target)
  })
}

const parseRubricCell = (value, level) => {
  const text = normalizeText(value)
  const scoreMatch = text.match(/(\d+(?:\.\d+)?)\s*分?/)
  const score = scoreMatch ? Number(scoreMatch[1]) : level.defaultScore
  const criteria = normalizeText(
    text
      .replace(/^\s*\d+(?:\.\d+)?\s*分\s*/i, '')
      .replace(/^\s*\d+(?:\.\d+)?\s*/i, '')
  )
  return {
    score: Number.isFinite(score) ? score : level.defaultScore,
    criteria,
  }
}

const parseVisibleJobDocument = (content) => {
  const html = String(content || '')
  const sections = extractHtmlSections(html)
  const rows = extractHtmlTableRows(findSectionHtml(sections, ['基本資料', '基本资料'])) || []
  const allRows = extractHtmlTableRows(html)

  const titleFromTable = findTableValue(rows.length ? rows : allRows, ['職位名稱', '职位名称', '職位', '职位'])
  const titleFromHeading = normalizeDocumentJobTitle(extractFirstHeadingText(html, 'h1') || extractFirstHeadingText(html, 'title'))
  const jobTitle = normalizeText(titleFromTable) || titleFromHeading
  if (!jobTitle) return null

  const job = createEmptyJob(jobTitle)
  job.title = jobTitle
  job.jobKey = normalizeText(findTableValue(rows.length ? rows : allRows, ['職位編號 / jobKey', '職位編號', '职位编号', 'jobKey'])) || jobTitle
  job.description = normalizeText(findTableValue(rows.length ? rows : allRows, ['職位描述', '职位描述', '描述']))

  const workYears = extractFirstNumber(findTableValue(rows.length ? rows : allRows, ['最低工作年資', '最低工作年资', '工作年資', '工作年资']))
  if (workYears !== null) {
    job.minWorkYears = workYears
    job.workYears = workYears
  }

  const gapLimit = extractFirstNumber(findTableValue(rows.length ? rows : allRows, ['空窗期上限', '空窗期']))
  if (gapLimit !== null) job.employmentGapLimitMonths = normalizeEmploymentGapLimitMonths(gapLimit)

  const salaryText = findTableValue(rows.length ? rows : allRows, ['薪資範圍', '薪资范围', '薪資', '薪资'])
  if (salaryText) job.salaryRange = extractSalaryRange(salaryText)

  const listSections = [
    ['industry', ['行業背景', '行业背景']],
    ['roleKeywords', ['職位關鍵字', '职位关键字', '關鍵字', '关键字']],
    ['coreResponsibilities', ['核心職責', '核心职责']],
    ['requiredSkills', ['必備技能', '必备技能']],
    ['projectExperience', ['專案經驗', '專案經歷', '项目经验', '项目经历']],
    ['preferredSkills', ['加分技能']],
    ['certifications', ['證照', '证照']],
    ['candidatePreference', ['候選人偏好', '候选人偏好']],
  ]
  for (const [fieldKey, labels] of listSections) {
    const items = extractListItemsFromHtml(findSectionHtml(sections, labels))
    if (items.length) job[fieldKey] = items
  }

  const weightRows = extractHtmlTableRows(findSectionHtml(sections, ['匹配權重', '匹配权重']))
  const parsedWeights = {}
  if (weightRows.length >= 2) {
    const labels = weightRows[0]
    const values = weightRows[1]
    labels.forEach((label, index) => {
      const field = findWeightField(label)
      const percent = extractFirstNumber(values[index])
      if (field && percent !== null) parsedWeights[field.key] = percent / 100
    })
  }
  if (Object.keys(parsedWeights).length) {
    job.weights = normalizeScoringWeightsForUi(parsedWeights)
    job.weights = Object.fromEntries(
      WEIGHT_FIELDS.map((field) => [field.key, Number(job.weights[field.key] || 0) / 100])
    )
  }

  const rubricRows = extractHtmlTableRows(findSectionHtml(sections, ['量化評分標準', '量化评分标准', '評分標準', '评分标准']))
  const parsedRubrics = {}
  if (rubricRows.length >= 2) {
    const header = rubricRows[0]
    const levelByIndex = header.map((label) => findLevelField(label))
    for (const row of rubricRows.slice(1)) {
      const field = findWeightField(row[0])
      if (!field) continue
      parsedRubrics[field.key] = {}
      row.slice(1).forEach((cell, cellIndex) => {
        const level = levelByIndex[cellIndex + 1]
        if (!level) return
        parsedRubrics[field.key][level.key] = parseRubricCell(cell, level)
      })
    }
  }
  if (Object.keys(parsedRubrics).length) job.scoringRubrics = normalizeScoringRubricsForUi(parsedRubrics)

  return {
    jobTitle,
    job,
    hasWeights: Object.keys(parsedWeights).length > 0,
    hasRubrics: Object.keys(parsedRubrics).length > 0,
  }
}

const getNonEmptyList = (preferred, fallback) =>
  Array.isArray(preferred) && preferred.length ? preferred : Array.isArray(fallback) ? fallback : []

const mergeParsedJobDocument = (baseParsed, visibleParsed) => {
  if (!baseParsed) return visibleParsed
  if (!visibleParsed) return baseParsed

  const baseJob = baseParsed.job || {}
  const visibleJob = visibleParsed.job || {}
  const jobTitle = normalizeText(visibleParsed.jobTitle || visibleJob.title || baseParsed.jobTitle || baseJob.title)
  const mergedJob = {
    ...createEmptyJob(jobTitle),
    ...baseJob,
    ...visibleJob,
    jobKey: normalizeText(visibleJob.jobKey) || normalizeText(baseJob.jobKey) || jobTitle,
    title: normalizeText(visibleJob.title) || normalizeText(baseJob.title) || jobTitle,
    description: normalizeText(visibleJob.description) || normalizeText(baseJob.description),
    industry: getNonEmptyList(visibleJob.industry, baseJob.industry),
    roleKeywords: getNonEmptyList(visibleJob.roleKeywords, baseJob.roleKeywords),
    coreResponsibilities: getNonEmptyList(visibleJob.coreResponsibilities, baseJob.coreResponsibilities),
    requiredSkills: getNonEmptyList(visibleJob.requiredSkills, baseJob.requiredSkills),
    projectExperience: getNonEmptyList(visibleJob.projectExperience, baseJob.projectExperience),
    preferredSkills: getNonEmptyList(visibleJob.preferredSkills, baseJob.preferredSkills),
    certifications: getNonEmptyList(visibleJob.certifications, baseJob.certifications),
    candidatePreference: getNonEmptyList(visibleJob.candidatePreference, baseJob.candidatePreference),
    salaryRange: {
      min: Number(visibleJob.salaryRange?.min ?? baseJob.salaryRange?.min ?? 0),
      max: Number(visibleJob.salaryRange?.max ?? baseJob.salaryRange?.max ?? 0),
    },
    weights: visibleParsed.hasWeights ? visibleJob.weights : baseJob.weights,
    scoringRubrics: visibleParsed.hasRubrics ? visibleJob.scoringRubrics : baseJob.scoringRubrics,
  }
  mergedJob.minWorkYears = Number.isFinite(Number(visibleJob.minWorkYears))
    ? Number(visibleJob.minWorkYears)
    : Number(baseJob.minWorkYears || baseJob.workYears || 1)
  mergedJob.workYears = mergedJob.minWorkYears
  mergedJob.employmentGapLimitMonths = normalizeEmploymentGapLimitMonths(
    visibleJob.employmentGapLimitMonths ?? baseJob.employmentGapLimitMonths
  )

  return { jobTitle, job: mergedJob }
}

const parseHiddenJobDocumentPayload = (text) => {
  const base64Payload = extractMarkerPayload(
    text,
    'HRAI_JOB_DICTIONARY_JSON_BASE64_START',
    'HRAI_JOB_DICTIONARY_JSON_BASE64_END'
  )
  let payloadText = ''
  if (base64Payload) {
    payloadText = decodeBase64Utf8(base64Payload.replace(/<[^>]*>/g, '').replace(/\s+/g, ''))
  } else {
    const legacyPayload = extractMarkerPayload(
      text,
      'HRAI_JOB_DICTIONARY_JSON_START',
      'HRAI_JOB_DICTIONARY_JSON_END'
    )
    if (!legacyPayload) return null
    payloadText = decodeHtmlEntities(legacyPayload)
      .replace(/<[^>]*>/g, '')
      .replace(/[\u0000-\u001F]+/g, '')
  }

  const parsed = JSON.parse(payloadText)
  if (!parsed?.job || typeof parsed.job !== 'object') {
    throw new Error('Word 檔內的職位資料格式不正確')
  }
  return {
    jobTitle: normalizeText(parsed.jobTitle || parsed.job.title),
    job: parsed.job,
  }
}

const createEmptyJob = (title = '') => ({
  jobKey: normalizeText(title),
  title: normalizeText(title),
  description: '',
  industry: [],
  roleKeywords: [],
  coreResponsibilities: [],
  requiredSkills: [],
  projectExperience: [],
  preferredSkills: [],
  certifications: [],
  minWorkYears: 1,
  workYears: 1,
  employmentGapLimitMonths: DEFAULT_EMPLOYMENT_GAP_LIMIT_MONTHS,
  candidatePreference: [],
  salaryRange: { min: 0, max: 0 },
  weights: Object.fromEntries(WEIGHT_FIELDS.map((field) => [field.key, field.defaultWeight])),
  scoringRubrics: normalizeScoringRubricsForUi({}),
})

const buildRubricDraft = (rubrics = {}) => {
  const normalized = normalizeScoringRubricsForUi(rubrics)
  return Object.fromEntries(
    WEIGHT_FIELDS.map((field) => [
      field.key,
      Object.fromEntries(
        LEVEL_FIELDS.map((level) => [
          level.key,
          {
            criteria: normalizeText(normalized[field.key]?.[level.key]?.criteria),
            score: String(normalized[field.key]?.[level.key]?.score ?? level.defaultScore),
          },
        ])
      ),
    ])
  )
}

const buildJobDraft = (jobTitle, job) => {
  const source = job && typeof job === 'object' ? job : createEmptyJob(jobTitle)
  const workYears = source.workYears ?? source.minWorkYears ?? 1
  return {
    jobKey: normalizeText(source.jobKey) || normalizeText(jobTitle),
    title: normalizeText(source.title) || normalizeText(jobTitle),
    description: normalizeText(source.description),
    industryText: (source.industry || []).join(', '),
    roleKeywordsText: (source.roleKeywords || []).join(', '),
    coreResponsibilitiesText: (source.coreResponsibilities || []).join(', '),
    requiredSkillsText: (source.requiredSkills || []).join(', '),
    projectExperienceText: (source.projectExperience || []).join(', '),
    preferredSkillsText: (source.preferredSkills || []).join(', '),
    certificationsText: (source.certifications || []).join(', '),
    minWorkYears: String(workYears),
    employmentGapLimitMonths: String(normalizeEmploymentGapLimitMonths(source.employmentGapLimitMonths)),
    candidatePreferenceText: (source.candidatePreference || []).join(', '),
    salaryMin: String(source?.salaryRange?.min ?? 0),
    salaryMax: String(source?.salaryRange?.max ?? 0),
    weights: normalizeScoringWeightsForUi(source?.weights),
    scoringRubrics: buildRubricDraft(source?.scoringRubrics),
  }
}

const draftToJob = (draft) => {
  const workYears = Number(draft?.minWorkYears || 0)

  return {
    jobKey: normalizeText(draft?.jobKey),
    title: normalizeText(draft?.title),
    description: normalizeText(draft?.description),
    industry: normalizeListText(draft?.industryText),
    roleKeywords: normalizeListText(draft?.roleKeywordsText),
    coreResponsibilities: normalizeListText(draft?.coreResponsibilitiesText),
    requiredSkills: normalizeListText(draft?.requiredSkillsText),
    projectExperience: normalizeListText(draft?.projectExperienceText),
    preferredSkills: normalizeListText(draft?.preferredSkillsText),
    certifications: normalizeListText(draft?.certificationsText),
    minWorkYears: workYears,
    workYears,
    employmentGapLimitMonths: normalizeEmploymentGapLimitMonths(draft?.employmentGapLimitMonths),
    candidatePreference: normalizeListText(draft?.candidatePreferenceText),
    salaryRange: {
      min: Number(draft?.salaryMin || 0),
      max: Number(draft?.salaryMax || 0),
    },
    weights: Object.fromEntries(
      WEIGHT_FIELDS.map((field) => [field.key, Number(draft?.weights?.[field.key] || 0) / 100])
    ),
    scoringRubrics: Object.fromEntries(
      WEIGHT_FIELDS.map((field) => [
        field.key,
        Object.fromEntries(
          LEVEL_FIELDS.map((level) => [
            level.key,
            {
              criteria: normalizeText(draft?.scoringRubrics?.[field.key]?.[level.key]?.criteria),
              score: Number(draft?.scoringRubrics?.[field.key]?.[level.key]?.score || level.defaultScore),
            },
          ])
        ),
      ])
    ),
  }
}

const getAuthContext = () => {
  const auth = parseJsonSafe(window.localStorage.getItem('innerai_auth'))
  const token = String(auth?.token || '').trim()
  if (!token) return { ok: false, message: '尚未登入或登入資訊已過期' }
  return {
    ok: true,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  }
}

const sortedJobTitles = computed(() =>
  Object.keys(jobDictionary.value || {}).sort((a, b) => a.localeCompare(b))
)

const activeJobTitle = computed(() => selectedJobTitle.value || '未選擇職位')

const emitUpdated = () => {
  emit('updated', jobDictionary.value)
}

const emitSelectedTitleChange = (title) => {
  emit('selected-title-change', normalizeText(title))
}

const setSelectedJob = (jobTitle) => {
  const normalizedTitle = normalizeText(jobTitle)
  selectedJobTitle.value = normalizedTitle
  jobDraft.value = normalizedTitle && jobDictionary.value?.[normalizedTitle]
    ? buildJobDraft(normalizedTitle, jobDictionary.value[normalizedTitle])
    : null
  jobDictionaryMessage.value = ''
  jobDictionaryError.value = ''
  emitSelectedTitleChange(normalizedTitle)
}

const syncExternalSelection = (title) => {
  const normalizedTitle = normalizeText(title)
  if (!normalizedTitle) return
  if (jobDictionary.value[normalizedTitle]) {
    setSelectedJob(normalizedTitle)
    return
  }
  selectedJobTitle.value = ''
  jobDraft.value = null
}

const validateJobDraft = (jobTitle, nextJob, { validateRubrics = true } = {}) => {
  if (!normalizeText(jobTitle)) throw new Error('職位名稱不可為空')
  if (!normalizeText(nextJob.jobKey)) throw new Error('職位編號不可為空')
  if (!normalizeText(nextJob.description)) throw new Error('職位描述不可為空')
  if (!nextJob.industry.length) throw new Error('行業背景至少需填 1 項')
  if (!nextJob.roleKeywords.length) throw new Error('職位關鍵字至少需填 1 項')
  if (!nextJob.coreResponsibilities.length) throw new Error('核心職責至少需填 1 項')
  if (!nextJob.requiredSkills.length) throw new Error('必備技能至少需填 1 項')
  if (!Number.isFinite(nextJob.minWorkYears)) throw new Error('最低工作年資必須是數字')
  if (!Number.isFinite(nextJob.employmentGapLimitMonths)) throw new Error('空窗期上限必須是數字')
  if (!Number.isFinite(nextJob.salaryRange.min) || !Number.isFinite(nextJob.salaryRange.max)) {
    throw new Error('薪資範圍必須是數字')
  }
  if (nextJob.salaryRange.min > nextJob.salaryRange.max) {
    throw new Error('最低薪資不可大於最高薪資')
  }

  const sum = Object.values(nextJob.weights).reduce((acc, value) => acc + Number(value || 0), 0)
  if (Math.abs(sum - 1) > 0.0001) throw new Error('權重百分比總和必須等於 100%')
  if (validateRubrics) {
    for (const field of WEIGHT_FIELDS) {
      for (const level of LEVEL_FIELDS) {
        const rubric = nextJob.scoringRubrics[field.key]?.[level.key]
        if (!normalizeText(rubric?.criteria)) throw new Error(`${field.label} 的${level.label}標準不可為空`)
        if (!Number.isFinite(Number(rubric?.score))) throw new Error(`${field.label} 的${level.label}分值必須是數字`)
      }
    }
  }
}

const commitSelectedJobDraft = () => {
  if (!selectedJobTitle.value || !jobDraft.value) {
    jobDictionaryError.value = '請先選擇職位'
    return false
  }

  try {
    const nextTitle = normalizeText(jobDraft.value.title)
    const nextJob = draftToJob(jobDraft.value)
    validateJobDraft(nextTitle, nextJob)

    if (nextTitle !== selectedJobTitle.value && jobDictionary.value[nextTitle]) {
      throw new Error('職位名稱已存在')
    }

    const nextDictionary = {}
    for (const title of sortedJobTitles.value) {
      if (title === selectedJobTitle.value) {
        nextDictionary[nextTitle] = nextJob
      } else {
        nextDictionary[title] = jobDictionary.value[title]
      }
    }

    if (!nextDictionary[nextTitle]) {
      nextDictionary[nextTitle] = nextJob
    }

    jobDictionary.value = nextDictionary
    selectedJobTitle.value = nextTitle
    jobDraft.value = buildJobDraft(nextTitle, nextJob)
    jobDictionaryMessage.value = `已套用「${nextTitle}」的編輯內容`
    jobDictionaryError.value = ''
    emitUpdated()
    return true
  } catch (error) {
    jobDictionaryError.value = error?.message || '職位資料驗證失敗'
    jobDictionaryMessage.value = ''
    return false
  }
}

const loadJobDictionary = async () => {
  jobDictionaryError.value = ''
  jobDictionaryMessage.value = ''
  const auth = getAuthContext()
  if (!auth.ok) {
    jobDictionaryError.value = auth.message
    return
  }

  jobDictionaryLoading.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-dictionary`, {
      method: 'GET',
      headers: {
        Authorization: auth.headers.Authorization,
      },
    })
    const data = await response.json()
    if (!response.ok) {
      jobDictionaryError.value = data.message || '讀取職位字典失敗'
      return
    }

    jobDictionary.value = resolveJobDictionary(data)
    if (normalizeText(props.selectedTitle)) {
      syncExternalSelection(props.selectedTitle)
    } else {
      const firstTitle = sortedJobTitles.value[0] || ''
      if (firstTitle) setSelectedJob(firstTitle)
      else {
        selectedJobTitle.value = ''
        jobDraft.value = null
      }
    }
    emitUpdated()
  } catch {
    jobDictionaryError.value = '讀取職位字典失敗'
  } finally {
    jobDictionaryLoading.value = false
  }
}

const addJob = () => {
  const title = normalizeText(newJobTitle.value)
  if (!title) {
    jobDictionaryError.value = '請輸入新的職位名稱'
    return
  }
  if (jobDictionary.value[title]) {
    jobDictionaryError.value = '職位名稱已存在'
    return
  }

  jobDictionary.value = {
    ...jobDictionary.value,
    [title]: createEmptyJob(title),
  }
  newJobTitle.value = ''
  setSelectedJob(title)
  jobDictionaryMessage.value = `已新增職位「${title}」，請編輯後儲存字典`
  emitUpdated()
}

const deleteSelectedJob = async () => {
  if (!selectedJobTitle.value || !jobDictionary.value[selectedJobTitle.value]) {
    jobDictionaryError.value = '請先選擇要刪除的職位'
    return
  }

  const deletedTitle = selectedJobTitle.value
  const confirmed = window.confirm(`確定刪除職位字典「${deletedTitle}」？`)
  if (!confirmed) return

  const auth = getAuthContext()
  if (!auth.ok) {
    jobDictionaryError.value = auth.message
    return
  }

  const nextDictionary = { ...jobDictionary.value }
  delete nextDictionary[deletedTitle]
  jobDictionaryError.value = ''
  jobDictionaryMessage.value = ''
  jobDictionarySaving.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-dictionary`, {
      method: 'PUT',
      headers: auth.headers,
      body: JSON.stringify({ dictionary: nextDictionary }),
    })
    const data = await response.json()
    if (!response.ok) {
      jobDictionaryError.value = data.message || '刪除職位字典失敗'
      return
    }

    const resolvedDictionary = resolveJobDictionary(data)
    jobDictionary.value = resolvedDictionary
    const nextTitle = Object.keys(resolvedDictionary).sort((a, b) => a.localeCompare(b))[0] || ''
    if (nextTitle) {
      setSelectedJob(nextTitle)
    } else {
      selectedJobTitle.value = ''
      jobDraft.value = null
      emitSelectedTitleChange('')
    }
    jobDictionaryMessage.value = `已刪除職位字典「${deletedTitle}」`
    emitUpdated()
  } catch {
    jobDictionaryError.value = '刪除職位字典失敗'
  } finally {
    jobDictionarySaving.value = false
  }
}

const saveJobDictionaryConfig = async () => {
  jobDictionaryError.value = ''
  jobDictionaryMessage.value = ''
  const auth = getAuthContext()
  if (!auth.ok) {
    jobDictionaryError.value = auth.message
    return
  }

  if (!commitSelectedJobDraft()) return

  jobDictionarySaving.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-dictionary`, {
      method: 'PUT',
      headers: auth.headers,
      body: JSON.stringify({ dictionary: jobDictionary.value }),
    })
    const data = await response.json()
    if (!response.ok) {
      jobDictionaryError.value = data.message || '儲存職位字典失敗'
      return
    }

    const resolvedDictionary = resolveJobDictionary(data)
    jobDictionary.value = Object.keys(resolvedDictionary).length ? resolvedDictionary : jobDictionary.value
    if (selectedJobTitle.value && jobDictionary.value[selectedJobTitle.value]) {
      jobDraft.value = buildJobDraft(selectedJobTitle.value, jobDictionary.value[selectedJobTitle.value])
    }
    jobDictionaryMessage.value = '職位字典已更新，僅影響之後新上傳或新觸發匹配的 CV'
    emitUpdated()
  } catch {
    jobDictionaryError.value = '儲存職位字典失敗'
  } finally {
    jobDictionarySaving.value = false
  }
}

const downloadSelectedJobDocument = () => {
  jobDictionaryError.value = ''
  jobDictionaryMessage.value = ''
  if (!selectedJobTitle.value || !jobDraft.value) {
    jobDictionaryError.value = '請先選擇職位'
    return
  }

  let nextJob = null
  const nextTitle = normalizeText(jobDraft.value.title || selectedJobTitle.value)
  try {
    nextJob = draftToJob(jobDraft.value)
    validateJobDraft(nextTitle, nextJob)
  } catch (error) {
    jobDictionaryError.value = error?.message || '職位資料驗證失敗，暫不能導出'
    return
  }

  const html = buildJobDocumentHtml(nextTitle, nextJob)
  const link = document.createElement('a')
  link.href = `data:application/msword;charset=utf-8,${encodeURIComponent(`\ufeff${html}`)}`
  link.download = `${safeFileName(nextTitle)}_職位字典.doc`
  document.body.appendChild(link)
  link.click()
  link.remove()
  jobDictionaryMessage.value = `已導出「${nextTitle}」職位字典 Word 檔`
}

const parseUploadedJobDocument = (content) => {
  const text = String(content || '')
  const base64Payload = extractMarkerPayload(
    text,
    'HRAI_JOB_DICTIONARY_JSON_BASE64_START',
    'HRAI_JOB_DICTIONARY_JSON_BASE64_END'
  )

  let baseParsed = null
  let hiddenPayloadError = null
  try {
    baseParsed = parseHiddenJobDocumentPayload(text)
  } catch (error) {
    hiddenPayloadError = error
  }
  const visibleParsed = parseVisibleJobDocument(text)
  const mergedParsed = mergeParsedJobDocument(baseParsed, visibleParsed)
  if (mergedParsed?.job) {
    const jobTitle = normalizeText(mergedParsed.jobTitle || mergedParsed.job.title)
    const job = mergedParsed.job
    validateJobDraft(jobTitle, job)
    return { jobTitle, job }
  }
  if (hiddenPayloadError) throw hiddenPayloadError

  let payloadText = ''
  if (base64Payload) {
    payloadText = decodeBase64Utf8(base64Payload.replace(/<[^>]*>/g, '').replace(/\s+/g, ''))
  } else {
    const legacyPayload = extractMarkerPayload(
      text,
      'HRAI_JOB_DICTIONARY_JSON_START',
      'HRAI_JOB_DICTIONARY_JSON_END'
    )
    if (!legacyPayload) {
      throw new Error('找不到 HRAI 職位字典標記，請上傳由「職位導出」產生的 Word 檔')
    }
    payloadText = decodeHtmlEntities(legacyPayload)
      .replace(/<[^>]*>/g, '')
      .replace(/[\u0000-\u001F]+/g, '')
  }

  const parsed = JSON.parse(payloadText)
  if (!parsed?.job || typeof parsed.job !== 'object') {
    throw new Error('Word 檔內的職位資料格式不正確')
  }
  const jobTitle = normalizeText(parsed.jobTitle || parsed.job.title)
  const job = parsed.job
  validateJobDraft(jobTitle, job)
  return { jobTitle, job }
}

const findExistingJobDictionaryKey = (jobTitle) => {
  const targetTitle = normalizeText(jobTitle)
  if (!targetTitle) return ''
  if (Object.prototype.hasOwnProperty.call(jobDictionary.value, targetTitle)) return targetTitle
  const normalizedTarget = targetTitle.toLocaleLowerCase()
  return Object.keys(jobDictionary.value || {}).find(
    (key) => normalizeText(key).toLocaleLowerCase() === normalizedTarget
  ) || ''
}

const uploadSelectedJobDocument = () => {
  jobUploadInput.value?.click?.()
}

const handleJobDocumentUpload = async (event) => {
  const file = event?.target?.files?.[0]
  if (event?.target) event.target.value = ''
  if (!file || isUploadingJobDocument.value) return

  const auth = getAuthContext()
  if (!auth.ok) {
    jobDictionaryError.value = auth.message
    return
  }

  isUploadingJobDocument.value = true
  jobDictionaryError.value = ''
  jobDictionaryMessage.value = ''
  try {
    const content = decodeDocumentBuffer(await file.arrayBuffer())
    const { jobTitle, job } = parseUploadedJobDocument(content)
    const existingJobKey = findExistingJobDictionaryKey(jobTitle)
    const targetJobKey = existingJobKey || jobTitle
    if (existingJobKey) {
      const shouldOverwrite = window.confirm(
        `職位「${existingJobKey}」已存在，是否要覆蓋現有的職位字典？`
      )
      if (!shouldOverwrite) {
        jobDictionaryMessage.value = '已取消職位字典上傳'
        return
      }
    }
    const nextDictionary = {
      ...jobDictionary.value,
      [targetJobKey]: {
        ...job,
        jobKey: normalizeText(job.jobKey) || targetJobKey,
        title: normalizeText(job.title) || targetJobKey,
      },
    }
    const response = await fetch(`${apiBaseUrl}/api/job-dictionary`, {
      method: 'PUT',
      headers: auth.headers,
      body: JSON.stringify({ dictionary: nextDictionary }),
    })
    const data = await response.json()
    if (!response.ok) {
      jobDictionaryError.value = data.message || '上傳職位字典失敗'
      return
    }

    jobDictionary.value = resolveJobDictionary(data)
    setSelectedJob(targetJobKey)
    jobDictionaryMessage.value = existingJobKey
      ? `已從 Word 檔覆蓋「${targetJobKey}」職位字典`
      : `已從 Word 檔新增「${targetJobKey}」職位字典`
    emitUpdated()
  } catch (error) {
    jobDictionaryError.value = error?.message || '上傳職位字典失敗'
  } finally {
    isUploadingJobDocument.value = false
  }
}

const applyRubricSuggestions = async () => {
  if (!jobDraft.value || isSuggestingRubrics.value) return
  const auth = getAuthContext()
  if (!auth.ok) {
    jobDictionaryError.value = auth.message
    return
  }

  let nextJob = null
  try {
    nextJob = draftToJob(jobDraft.value)
    validateJobDraft(normalizeText(jobDraft.value.title), nextJob, { validateRubrics: false })
  } catch (error) {
    jobDictionaryError.value = error?.message || '請先補齊職位資料'
    jobDictionaryMessage.value = ''
    return
  }

  isSuggestingRubrics.value = true
  jobDictionaryError.value = ''
  jobDictionaryMessage.value = ''
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-dictionary/rubric-suggestions`, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify({ job: nextJob }),
    })
    const data = await response.json()
    if (!response.ok) {
      jobDictionaryError.value = data.message || '生成量化標準失敗'
      return
    }
    jobDraft.value.scoringRubrics = buildRubricDraft(data.scoringRubrics)
    jobDictionaryMessage.value = '已生成量化標準，請檢查後套用或儲存'
  } catch {
    jobDictionaryError.value = '生成量化標準失敗'
  } finally {
    isSuggestingRubrics.value = false
  }
}

const applyJobDefinitionSuggestion = async () => {
  if (!jobDraft.value || isSuggestingJobDefinition.value) return
  const auth = getAuthContext()
  if (!auth.ok) {
    jobDictionaryError.value = auth.message
    return
  }

  const jobTitle = normalizeText(jobDraft.value.title || selectedJobTitle.value || newJobTitle.value)
  const jobKey = normalizeText(jobDraft.value.jobKey || jobTitle)
  if (!jobTitle && !jobKey) {
    jobDictionaryError.value = '請先選擇或輸入職位名稱'
    jobDictionaryMessage.value = ''
    return
  }

  isSuggestingJobDefinition.value = true
  jobDictionaryError.value = ''
  jobDictionaryMessage.value = ''
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-dictionary/job-suggestions`, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify({
        jobTitle,
        jobKey,
        draft: draftToJob(jobDraft.value),
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      jobDictionaryError.value = data.message || '生成職位資料失敗'
      return
    }
    if (!data?.job || typeof data.job !== 'object') {
      jobDictionaryError.value = '生成結果格式錯誤'
      return
    }
    jobDraft.value = buildJobDraft(data.job.title || jobTitle, data.job)
    jobDictionaryMessage.value = '已生成職位資料草稿，請檢查後套用或儲存'
  } catch {
    jobDictionaryError.value = '生成職位資料失敗'
  } finally {
    isSuggestingJobDefinition.value = false
  }
}

watch(
  () => props.selectedTitle,
  (value) => {
    if (!jobDictionaryLoading.value && Object.keys(jobDictionary.value).length) {
      syncExternalSelection(value)
    }
  }
)

onMounted(() => {
  loadJobDictionary()
})
</script>

<template>
  <section class="card dictionary-card">
    <header class="card-header">
      <div>
        <h3>職位字典配置</h3>
        <p>維護 `finance-job-positions.json`。更新後僅影響之後新上傳或新觸發匹配的 CV。</p>
      </div>
      <button
        type="button"
        class="secondary-btn"
        :disabled="jobDictionaryLoading || jobDictionarySaving"
        @click="loadJobDictionary"
      >
        刷新
      </button>
    </header>

    <p v-if="jobDictionaryMessage" class="success-msg">{{ jobDictionaryMessage }}</p>
    <p v-if="jobDictionaryError" class="error-msg">{{ jobDictionaryError }}</p>

    <div class="dictionary-layout">
      <aside class="dictionary-sidebar">
        <div class="sidebar-header">
          <p class="sidebar-title">職位列表</p>
          <div class="dictionary-create-row">
            <input
              v-model.trim="newJobTitle"
              type="text"
              placeholder="輸入新的職位名稱"
              :disabled="jobDictionaryLoading || jobDictionarySaving"
            />
            <button
              type="button"
              class="secondary-btn"
              :disabled="jobDictionaryLoading || jobDictionarySaving"
              @click="addJob"
            >
              新增職位
            </button>
          </div>
        </div>

        <div class="job-list">
          <button
            v-for="jobTitle in sortedJobTitles"
            :key="jobTitle"
            type="button"
            class="job-list-item"
            :class="{ active: selectedJobTitle === jobTitle }"
            @click="setSelectedJob(jobTitle)"
          >
            <strong>{{ jobTitle }}</strong>
          </button>
        </div>
      </aside>

      <section class="dictionary-editor">
        <template v-if="selectedJobTitle && jobDraft">
          <div class="editor-header">
            <div>
              <h4>{{ activeJobTitle }}</h4>
            </div>
            <div class="editor-actions">
              <button
                type="button"
                class="secondary-btn"
                :disabled="jobDictionaryLoading || jobDictionarySaving || isUploadingJobDocument"
                @click="downloadSelectedJobDocument"
              >
                職位導出
              </button>
              <button
                type="button"
                class="secondary-btn"
                :disabled="jobDictionaryLoading || jobDictionarySaving || isUploadingJobDocument"
                @click="uploadSelectedJobDocument"
              >
                {{ isUploadingJobDocument ? '上傳中...' : '職位上傳' }}
              </button>
              <input
                ref="jobUploadInput"
                class="sr-only"
                type="file"
                accept=".doc,.html,.htm,application/msword,text/html"
                @change="handleJobDocumentUpload"
              />
              <button
                type="button"
                class="secondary-btn"
                :disabled="jobDictionaryLoading || jobDictionarySaving || isSuggestingJobDefinition"
                @click="applyJobDefinitionSuggestion"
              >
                {{ isSuggestingJobDefinition ? '生成中...' : 'AI 一鍵生成職位資料' }}
              </button>
              <button
                type="button"
                class="danger-btn"
                :disabled="jobDictionaryLoading || jobDictionarySaving"
                @click="deleteSelectedJob"
              >
                刪除當前職位
              </button>
            </div>
          </div>

          <div class="editor-grid">
            <label class="field">
              <span>職位名稱</span>
              <input v-model="jobDraft.title" type="text" />
            </label>

            <label class="field">
              <span>職位編號 / jobKey</span>
              <input v-model="jobDraft.jobKey" type="text" />
            </label>

            <label class="field full-width">
              <span>職位描述</span>
              <textarea v-model="jobDraft.description" rows="3" />
            </label>

            <label class="field">
              <span>行業背景</span>
              <textarea v-model="jobDraft.industryText" rows="3" />
            </label>

            <label class="field">
              <span>職位關鍵字</span>
              <textarea v-model="jobDraft.roleKeywordsText" rows="3" />
            </label>

            <label class="field">
              <span>核心職責</span>
              <textarea v-model="jobDraft.coreResponsibilitiesText" rows="3" />
            </label>

            <label class="field">
              <span>必備技能</span>
              <textarea v-model="jobDraft.requiredSkillsText" rows="3" />
            </label>

            <label class="field">
              <span>專案經驗</span>
              <textarea v-model="jobDraft.projectExperienceText" rows="3" />
            </label>

            <label class="field">
              <span>加分技能</span>
              <textarea v-model="jobDraft.preferredSkillsText" rows="3" />
            </label>

            <label class="field">
              <span>證照</span>
              <textarea v-model="jobDraft.certificationsText" rows="3" />
            </label>

            <label class="field">
              <span>最低工作年資</span>
              <input v-model="jobDraft.minWorkYears" type="number" min="0" step="1" />
            </label>

            <label class="field">
              <span>空窗期上限（月）</span>
              <input v-model="jobDraft.employmentGapLimitMonths" type="number" min="0" step="1" />
            </label>

            <label class="field">
              <span>候選人偏好</span>
              <textarea v-model="jobDraft.candidatePreferenceText" rows="3" />
            </label>

            <label class="field">
              <span>最低薪資（MOP / 月）</span>
              <input v-model="jobDraft.salaryMin" type="number" min="0" step="1" />
            </label>

            <label class="field">
              <span>最高薪資（MOP / 月）</span>
              <input v-model="jobDraft.salaryMax" type="number" min="0" step="1" />
            </label>
          </div>

          <section class="weight-section">
            <div class="rubric-header">
              <div>
                <p class="weight-title">權重與評分標準</p>
                <p class="rubric-hint">權重以百分比填寫，總和需為 100%。高/中/低分值會用於後端計算匹配總分。</p>
              </div>
              <button
                type="button"
                class="secondary-btn"
                :disabled="jobDictionaryLoading || jobDictionarySaving || isSuggestingRubrics"
                @click="applyRubricSuggestions"
              >
                {{ isSuggestingRubrics ? '生成中...' : 'AI 生成量化標準' }}
              </button>
            </div>
            <div class="rubric-table-wrap">
              <table class="rubric-table">
                <thead>
                  <tr>
                    <th>維度</th>
                    <th>權重 %</th>
                    <th v-for="level in LEVEL_FIELDS" :key="level.key">
                      <span class="rubric-level-heading">{{ level.label }}標準</span>
                      <small>分值</small>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="field in WEIGHT_FIELDS" :key="field.key">
                    <th>
                      <span class="rubric-dimension">{{ field.label }}</span>
                    </th>
                    <td>
                      <input
                        v-model="jobDraft.weights[field.key]"
                        class="weight-input"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                      />
                    </td>
                    <td
                      v-for="level in LEVEL_FIELDS"
                      :key="`${field.key}-${level.key}`"
                      class="rubric-level-cell"
                    >
                      <textarea
                        v-model="jobDraft.scoringRubrics[field.key][level.key].criteria"
                        class="rubric-criteria-input"
                        rows="3"
                      />
                      <div class="rubric-score-row">
                        <span>分值</span>
                        <input
                          v-model="jobDraft.scoringRubrics[field.key][level.key].score"
                          class="score-input"
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                        />
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <div class="actions">
            <button type="button" class="secondary-btn" :disabled="jobDictionarySaving" @click="commitSelectedJobDraft">
              套用當前編輯
            </button>
            <button
              type="button"
              class="primary-btn"
              :disabled="jobDictionaryLoading || jobDictionarySaving"
              @click="saveJobDictionaryConfig"
            >
              {{ jobDictionarySaving ? '儲存中...' : '儲存整份字典' }}
            </button>
          </div>
        </template>

        <p v-else class="empty-dictionary-state">尚未選擇職位。</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.dictionary-card {
  color: var(--text-base);
}

.sidebar-title,
.weight-title {
  margin: 0;
}

.rubric-hint {
  margin: 0.25rem 0 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.job-list-item strong,
.editor-header h4 {
  margin: 0;
  color: var(--text-strong);
}

.empty-dictionary-state {
  color: var(--text-muted);
}

.dictionary-card {
  grid-template-rows: auto auto auto minmax(0, 1fr);
  overflow: hidden;
}

.sidebar-header,
.dictionary-create-row,
.actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.sidebar-header {
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  max-height: 178px;
  margin-bottom: 0.9rem;
  overflow: auto;
}

.dictionary-create-row input {
  flex: 1;
  min-width: 220px;
}

.dictionary-layout {
  display: grid;
  grid-template-columns: minmax(320px, 380px) minmax(0, 1fr);
  gap: 1rem;
  min-height: 0;
  overflow: hidden;
}

.dictionary-sidebar,
.dictionary-editor {
  padding: 0.9rem;
  min-height: 0;
  overflow: hidden;
}

.dictionary-sidebar {
  min-width: 0;
}

.job-list {
  display: grid;
  align-content: start;
  gap: 0.55rem;
  min-height: 0;
  overflow: auto;
}

.job-list-item {
  border: 1px solid var(--border-default);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  padding: 0.85rem;
  text-align: left;
  cursor: pointer;
  display: grid;
  gap: 0.2rem;
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease,
    background-color 180ms ease;
}

.job-list-item:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

.job-list-item.active {
  border-color: rgba(47, 111, 237, 0.18);
  background: linear-gradient(180deg, rgba(47, 111, 237, 0.1), rgba(255, 255, 255, 0.82));
}

.dictionary-editor {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-height: 100%;
  overflow: auto;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.editor-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.editor-grid {
  display: grid;
  align-content: start;
  gap: 0.85rem;
  min-height: 0;
  overflow: visible;
}

.weight-section,
.dictionary-editor > .actions {
  flex: 0 0 auto;
}

.editor-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.full-width {
  grid-column: 1 / -1;
}

.rubric-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.rubric-table-wrap {
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
}

.rubric-table {
  width: 100%;
  min-width: 1120px;
  border-collapse: separate;
  border-spacing: 0;
  background: #ffffff;
}

.rubric-table th,
.rubric-table td {
  padding: 0.85rem;
  border-right: 1px solid rgba(148, 163, 184, 0.16);
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  vertical-align: top;
  text-align: left;
}

.rubric-table th:last-child,
.rubric-table td:last-child {
  border-right: 0;
}

.rubric-table thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  background: #f8fafc;
  color: var(--text-strong);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.rubric-table thead th:first-child,
.rubric-table tbody th {
  position: sticky;
  left: 0;
}

.rubric-table thead th:first-child {
  z-index: 4;
}

.rubric-table tbody th {
  z-index: 2;
  background: #ffffff;
}

.rubric-table tbody th {
  width: 132px;
  color: var(--text-strong);
}

.rubric-table tbody tr:hover th,
.rubric-table tbody tr:hover td {
  background: #f9fbff;
}

.rubric-table tbody tr:last-child th,
.rubric-table tbody tr:last-child td {
  border-bottom: 0;
}

.rubric-table td:nth-child(2),
.rubric-table th:nth-child(2) {
  width: 112px;
  text-align: center;
}

.rubric-level-heading,
.rubric-dimension {
  display: block;
  line-height: 1.35;
}

.rubric-table thead small {
  display: block;
  margin-top: 0.18rem;
  color: var(--text-muted);
  font-size: 0.72rem;
  font-weight: 700;
}

.rubric-table textarea,
.rubric-table input {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 8px;
  background: #ffffff;
  color: var(--text-strong);
  font: inherit;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    background-color 160ms ease;
}

.rubric-table textarea:focus,
.rubric-table input:focus {
  outline: none;
  border-color: rgba(47, 111, 237, 0.62);
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.12);
}

.weight-input {
  height: 38px;
  padding: 0 0.45rem;
  text-align: center;
  font-weight: 800;
}

.rubric-level-cell {
  min-width: 250px;
  background: rgba(248, 250, 252, 0.42);
}

.rubric-criteria-input {
  display: block;
  min-height: 92px;
  padding: 0.68rem 0.72rem;
  line-height: 1.45;
  resize: vertical;
}

.rubric-score-row {
  display: grid;
  grid-template-columns: auto 76px;
  align-items: center;
  gap: 0.55rem;
  margin-top: 0.55rem;
  color: var(--text-muted);
  font-size: 0.76rem;
  font-weight: 800;
}

.score-input {
  height: 34px;
  padding: 0 0.42rem;
  text-align: center;
  font-size: 0.84rem;
  font-weight: 850;
}

@media (max-width: 960px) {
  .dictionary-layout,
  .editor-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .editor-header,
  .rubric-header {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
