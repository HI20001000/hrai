const LEVEL_KEYS = ['high', 'medium', 'low']
const DEFAULT_LEVEL_SCORES = {
  high: 100,
  medium: 65,
  low: 30,
}

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

const DIMENSION_KEY_SET = new Set(SCORING_DIMENSIONS.map((dimension) => dimension.key))

const normalizeText = (value) => String(value ?? '').trim()
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const clampScore = (value, fallback = 0) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

const defaultWeightMap = () =>
  Object.fromEntries(SCORING_DIMENSIONS.map((dimension) => [dimension.key, dimension.defaultWeight]))

const normalizeRawWeightMap = (weights = {}) => {
  if (!isPlainObject(weights)) return {}
  const entries = Object.entries(weights)
  const sum = entries.reduce((total, [, value]) => total + Number(value || 0), 0)
  const divisor = Math.abs(sum - 100) <= 0.000001 ? 100 : 1
  return Object.fromEntries(entries.map(([key, value]) => [key, Number(value || 0) / divisor]))
}

const normalizeWeightSum = (weights = {}) => {
  const next = {}
  for (const dimension of SCORING_DIMENSIONS) {
    const value = Number(weights[dimension.key] || 0)
    next[dimension.key] = Number.isFinite(value) && value > 0 ? value : 0
  }

  const sum = Object.values(next).reduce((total, value) => total + value, 0)
  if (sum <= 0) return defaultWeightMap()
  return Object.fromEntries(Object.entries(next).map(([key, value]) => [key, value / sum]))
}

export const normalizeScoringWeights = (weights = {}) => {
  const raw = normalizeRawWeightMap(weights)
  const hasNewExperienceWeights =
    'companyExperience' in raw || 'internshipExperience' in raw || 'workExperience' in raw
  const defaults = defaultWeightMap()
  const migrated = {}

  for (const dimension of SCORING_DIMENSIONS) {
    migrated[dimension.key] = Number.isFinite(raw[dimension.key]) ? raw[dimension.key] : defaults[dimension.key]
  }

  if (!hasNewExperienceWeights && Number.isFinite(raw.projectExperience)) {
    migrated.companyExperience = raw.projectExperience * 0.6
    migrated.projectExperience = raw.projectExperience * 0.3
    migrated.internshipExperience = raw.projectExperience * 0.1
  } else {
    if (Number.isFinite(raw.workExperience)) migrated.companyExperience = raw.workExperience
    if (Number.isFinite(raw.internshipExperience)) migrated.internshipExperience = raw.internshipExperience
  }

  return normalizeWeightSum(migrated)
}

const getDefaultCriteria = (dimension, level) => {
  if (level === 'high') {
    return `CV 明確符合「${dimension.label}」的核心要求，且有具體工作、項目或成果證據。`
  }
  if (level === 'medium') {
    return `CV 有部分「${dimension.label}」相關證據，但深度、場景或近期性仍需確認。`
  }
  return `CV 缺少足夠「${dimension.label}」證據，或只呈現弱相關/可遷移能力。`
}

export const normalizeScoringRubrics = (rubrics = {}) => {
  const source = isPlainObject(rubrics) ? rubrics : {}
  const normalized = {}

  for (const dimension of SCORING_DIMENSIONS) {
    const rawDimension = isPlainObject(source[dimension.key]) ? source[dimension.key] : {}
    normalized[dimension.key] = {}
    for (const level of LEVEL_KEYS) {
      const rawLevel = isPlainObject(rawDimension[level]) ? rawDimension[level] : {}
      normalized[dimension.key][level] = {
        criteria:
          normalizeText(rawLevel.criteria) ||
          normalizeText(rawLevel.description) ||
          normalizeText(rawLevel.standard) ||
          getDefaultCriteria(dimension, level),
        score: clampScore(rawLevel.score, DEFAULT_LEVEL_SCORES[level]),
      }
    }
  }

  return normalized
}

export const normalizeScoringLevel = (value) => {
  const level = normalizeText(value).toLowerCase()
  return LEVEL_KEYS.includes(level) ? level : 'low'
}

export const normalizeDimensionKey = (value) => {
  const key = normalizeText(value)
  return DIMENSION_KEY_SET.has(key) ? key : ''
}

const normalizeDimensionEvaluationList = (evaluations = []) => {
  if (!Array.isArray(evaluations)) return []
  const seen = new Set()
  const normalized = []
  for (const evaluation of evaluations) {
    if (!isPlainObject(evaluation)) continue
    const dimensionKey = normalizeDimensionKey(evaluation.dimensionKey)
    if (!dimensionKey || seen.has(dimensionKey)) continue
    seen.add(dimensionKey)
    normalized.push({
      dimensionKey,
      level: normalizeScoringLevel(evaluation.level),
      evidence: normalizeText(evaluation.evidence),
      gap: normalizeText(evaluation.gap),
    })
  }
  return normalized
}

export const calculateWeightedMatch = ({ weights = {}, scoringRubrics = {}, dimensionEvaluations = [] } = {}) => {
  const normalizedWeights = normalizeScoringWeights(weights)
  const normalizedRubrics = normalizeScoringRubrics(scoringRubrics)
  const evaluationMap = new Map(
    normalizeDimensionEvaluationList(dimensionEvaluations).map((evaluation) => [evaluation.dimensionKey, evaluation])
  )
  const breakdown = SCORING_DIMENSIONS.map((dimension) => {
    const evaluation = evaluationMap.get(dimension.key) || {
      dimensionKey: dimension.key,
      level: 'low',
      evidence: '',
      gap: 'LLM 未返回此維度評估',
    }
    const level = normalizeScoringLevel(evaluation.level)
    const weight = Number(normalizedWeights[dimension.key] || 0)
    const roundedWeight = Math.round(weight * 1000000) / 1000000
    const levelScore = clampScore(normalizedRubrics[dimension.key]?.[level]?.score, DEFAULT_LEVEL_SCORES[level])
    const weightedScore = weight * levelScore
    return {
      dimensionKey: dimension.key,
      dimensionLabel: dimension.label,
      weight: roundedWeight,
      level,
      levelScore,
      weightedScore: Math.round(weightedScore * 100) / 100,
      criteria: normalizeText(normalizedRubrics[dimension.key]?.[level]?.criteria),
      evidence: normalizeText(evaluation.evidence),
      gap: normalizeText(evaluation.gap),
    }
  })
  const matchScore = clampScore(breakdown.reduce((total, item) => total + item.weightedScore, 0), 0)
  return {
    matchScore,
    matchLevel: getMatchLevelFromScore(matchScore),
    dimensionEvaluations: breakdown,
  }
}

export const getMatchLevelFromScore = (score) => {
  const numericScore = clampScore(score, 0)
  if (numericScore >= 80) return 'high'
  if (numericScore >= 60) return 'medium'
  return 'low'
}

export const getScoringDimensionKeys = () => SCORING_DIMENSIONS.map((dimension) => dimension.key)
