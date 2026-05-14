export const SCORING_DIMENSIONS = [
  { key: 'requiredSkills', label: '必備技能', defaultWeight: 0.22 },
  { key: 'coreResponsibilities', label: '核心職責', defaultWeight: 0.12 },
  { key: 'companyExperience', label: '公司經歷', defaultWeight: 0.16 },
  { key: 'internshipExperience', label: '實習經歷', defaultWeight: 0.05 },
  { key: 'projectExperience', label: '專案經歷', defaultWeight: 0.12 },
  { key: 'industry', label: '行業背景', defaultWeight: 0.12 },
  { key: 'certifications', label: '證照', defaultWeight: 0.07 },
  { key: 'workYears', label: '年限/資歷', defaultWeight: 0.08 },
  { key: 'candidatePreference', label: '候選人偏好', defaultWeight: 0.06 },
]

export const SCORING_LEVELS = [
  { key: 'high', label: '高', defaultScore: 100 },
  { key: 'medium', label: '中', defaultScore: 65 },
  { key: 'low', label: '低', defaultScore: 30 },
]

const normalizeText = (value) => String(value ?? '').trim()
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const clampScore = (value, fallback = 0) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

export const getScoringDimensionLabel = (dimensionKey = '') =>
  SCORING_DIMENSIONS.find((dimension) => dimension.key === dimensionKey)?.label || dimensionKey

export const getScoringLevelLabel = (level = '') =>
  SCORING_LEVELS.find((item) => item.key === String(level).trim().toLowerCase())?.label || level

const defaultCriteria = (dimension, level) => {
  if (level === 'high') return `CV 明確符合「${dimension.label}」的核心要求，且有具體工作、項目或成果證據。`
  if (level === 'medium') return `CV 有部分「${dimension.label}」相關證據，但深度、場景或近期性仍需確認。`
  return `CV 缺少足夠「${dimension.label}」證據，或只呈現弱相關/可遷移能力。`
}

export const normalizeScoringRubricsForUi = (rubrics = {}) => {
  const source = isPlainObject(rubrics) ? rubrics : {}
  return Object.fromEntries(
    SCORING_DIMENSIONS.map((dimension) => [
      dimension.key,
      Object.fromEntries(
        SCORING_LEVELS.map((level) => {
          const raw = isPlainObject(source[dimension.key]?.[level.key]) ? source[dimension.key][level.key] : {}
          return [
            level.key,
            {
              criteria:
                normalizeText(raw.criteria) ||
                normalizeText(raw.description) ||
                normalizeText(raw.standard) ||
                defaultCriteria(dimension, level.key),
              score: clampScore(raw.score, level.defaultScore),
            },
          ]
        })
      ),
    ])
  )
}

export const normalizeScoringWeightsForUi = (weights = {}) => {
  const source = isPlainObject(weights) ? weights : {}
  return Object.fromEntries(
    SCORING_DIMENSIONS.map((dimension) => [
      dimension.key,
      String(Math.round(Number(source[dimension.key] ?? dimension.defaultWeight) * 10000) / 100),
    ])
  )
}

export const normalizeDimensionEvaluationsForDisplay = (evaluations = []) => {
  if (!Array.isArray(evaluations)) return []
  return evaluations
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      dimensionKey: normalizeText(item.dimensionKey),
      dimensionLabel: normalizeText(item.dimensionLabel) || getScoringDimensionLabel(item.dimensionKey),
      weight: Number(item.weight || 0),
      level: normalizeText(item.level),
      levelLabel: getScoringLevelLabel(item.level),
      levelScore: Number(item.levelScore || 0),
      weightedScore: Number(item.weightedScore || 0),
      criteria: normalizeText(item.criteria),
      evidence: normalizeText(item.evidence),
      gap: normalizeText(item.gap),
    }))
    .filter((item) => item.dimensionKey)
}

export const formatWeightPercent = (weight = 0) => `${Math.round(Number(weight || 0) * 10000) / 100}%`
