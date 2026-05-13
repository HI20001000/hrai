<script setup>
import { computed, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'
import CvExtractedFilePreview from './CvExtractedFilePreview.vue'
import ProjectExperiencesField from './ProjectExperiencesField.vue'
import {
  EDITABLE_EXTRACTED_FIELDS,
  buildDraftFieldsFromRows,
  buildEditedExtractedFromDraft,
  buildExtractedPreviewData,
  computeMissingFields,
  getEditableRows,
} from '../scripts/cvExtractedEditor.js'

const props = defineProps({
  jobPostId: {
    type: Number,
    default: null,
  },
  jobPostTitle: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['uploaded', 'closed'])

const fileInputRef = ref(null)
const selectedFiles = ref([])

const selectedFile = ref(null)
const cachedCvId = ref('')
const cachedCvName = ref('')
const parsedCandidate = ref(null)
const parsedExtractedText = ref('')
const singleMatchResult = ref(null)

const isEditingExtracted = ref(false)
const hasEditedExtracted = ref(false)
const draftFields = ref({})

const batchItems = ref([])
const activeBatchItemId = ref('')
const batchView = ref('list')
const isEditingBatchExtracted = ref(false)
const batchDraftFields = ref({})
const currentBatchItemId = ref('')
const currentBatchStage = ref('')
const isBatchParsing = ref(false)
const isBatchMatching = ref(false)
const batchOperationTotal = ref(0)
const batchOperationCompleted = ref(0)

const message = ref('')
const isCaching = ref(false)
const isParsing = ref(false)
const isConfirmingUpload = ref(false)

const isBatchMode = computed(() => selectedFiles.value.length > 1)
const hasSelectedFiles = computed(() => selectedFiles.value.length > 0)
const isBatchBusy = computed(() => isBatchParsing.value || isBatchMatching.value)
const isBusy = computed(() => isCaching.value || isParsing.value || isConfirmingUpload.value || isBatchBusy.value)
const showLoadingOverlay = computed(
  () => !isBatchMode.value && (isCaching.value || isParsing.value || isConfirmingUpload.value)
)

const loadingTitle = computed(() => {
  if (isConfirmingUpload.value) return '正在提交到職位並進行履歷匹配'
  if (isParsing.value) return '正在調用 LLM 解析 CV'
  if (isCaching.value) return '正在快取 CV 檔案'
  return ''
})

const loadingDescription = computed(() => {
  if (isConfirmingUpload.value) return '請稍候，系統正在建立投遞記錄並生成此職位的匹配結果。'
  if (isParsing.value) return '請稍候，系統正在抽取履歷內容並生成結構化欄位。'
  if (isCaching.value) return '請稍候，系統正在暫存你選擇的檔案。'
  return ''
})

const selectedFilesLabel = computed(() => {
  if (!selectedFiles.value.length) return '尚未選擇檔案'
  if (selectedFiles.value.length === 1) return selectedFiles.value[0]?.name || '尚未選擇檔案'
  return `已選擇 ${selectedFiles.value.length} 份 CV`
})

const editFieldDefs = EDITABLE_EXTRACTED_FIELDS.filter(
  (field) => !['projectExperiences'].includes(field.fieldKey)
).map((field) => ({
  key: field.fieldKey,
  label: field.label,
  kind: field.inputType === 'textarea' ? 'textarea' : 'text',
  required: !!field.required,
}))

const activeBatchItem = computed(() => batchItems.value.find((item) => item.id === activeBatchItemId.value) || null)
const parsedReadyItems = computed(() =>
  batchItems.value.filter((item) => item.status === 'parsed' || item.status === 'match-error')
)
const matchedItems = computed(() => batchItems.value.filter((item) => item.status === 'matched'))
const selectedMatchableItems = computed(() =>
  batchItems.value.filter(
    (item) => item.selected && (item.status === 'parsed' || item.status === 'match-error')
  )
)
const allMatchableSelected = computed(
  () => !!parsedReadyItems.value.length && parsedReadyItems.value.every((item) => item.selected)
)
const batchHasSelection = computed(() => selectedMatchableItems.value.length > 0)
const batchParseCompletedCount = computed(() =>
  batchItems.value.filter(
    (item) =>
      item.status === 'parsed' ||
      item.status === 'matched' ||
      item.status === 'error' ||
      item.status === 'match-error'
  ).length
)
const batchProgressPercent = computed(() => {
  if (!batchOperationTotal.value) return 0
  return Math.round((batchOperationCompleted.value / batchOperationTotal.value) * 100)
})
const batchProgressLabel = computed(() => {
  if (isBatchParsing.value) return '批量解析進度'
  if (isBatchMatching.value) return '批量匹配進度'
  if (matchedItems.value.length) return '最新批量匹配結果'
  return '批量解析結果'
})

const batchSelectActionLabel = computed(() => (allMatchableSelected.value ? '取消勾選' : '勾選全部'))

const batchPrimaryActionLabel = computed(() => {
  if (batchHasSelection.value) return `開始匹配勾選項目（${selectedMatchableItems.value.length}）`
  return '開始匹配全部'
})

const hasSingleMatchResult = computed(() => !!singleMatchResult.value)
const isBatchDetailView = computed(() => isBatchMode.value && batchView.value === 'detail' && !!activeBatchItem.value)

const getScopedEndpoint = (suffix) => {
  const jobPostId = Number(props.jobPostId)
  if (!Number.isInteger(jobPostId) || jobPostId <= 0) return ''
  return `${apiBaseUrl}/api/job-posts/${jobPostId}${suffix}`
}

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('read-failed'))
    reader.readAsDataURL(file)
  })

const triggerFilePicker = () => {
  if (isBusy.value) return
  fileInputRef.value?.click()
}

const createBatchItem = (file, index) => ({
  id: `${file.name}-${file.lastModified}-${index}`,
  file,
  fileName: file.name,
  cacheId: '',
  status: 'pending',
  stage: 'waiting',
  message: '等待解析',
  selected: false,
  candidate: null,
  extractedText: '',
  edited: false,
  applicationId: null,
  matchedPosition: '',
})

const resolveBatchStatusLabel = (status) => {
  if (status === 'parsed') return '已解析'
  if (status === 'matching') return '匹配中'
  if (status === 'matched') return '已匹配'
  if (status === 'error') return '解析失敗'
  if (status === 'match-error') return '匹配失敗'
  if (status === 'parsing') return '解析中'
  return '等待中'
}

const resolveBatchStageLabel = (stage) => {
  if (stage === 'caching') return '快取'
  if (stage === 'parsing') return '解析'
  if (stage === 'parsed') return '可編輯'
  if (stage === 'matching') return '匹配'
  if (stage === 'matched') return '已入庫'
  if (stage === 'error') return '失敗'
  return '等待'
}

const canEditBatchItem = (item) => !!item && (item.status === 'parsed' || item.status === 'match-error')
const canMatchBatchItem = (item) => !!item && (item.status === 'parsed' || item.status === 'match-error')
const isSuccessText = (value) => String(value || '').includes('解析完成')

const isProcessingText = (value) => /(正在|處理中|解析中|匹配中)/.test(String(value || ''))
const isErrorText = (value) => /(失敗|異常|錯誤)/.test(String(value || ''))
const getMessageTone = (value) => {
  if (isErrorText(value)) return 'error-message'
  if (isProcessingText(value)) return 'processing-message'
  if (isSuccessText(value) || /(完成|成功|已儲存|已套用|已更新|已提交|已清空)/.test(String(value || ''))) {
    return 'success-message'
  }
  return ''
}

const getMessageSegments = (value) => {
  const text = String(value || '')
  if (!text) return []

  const batchParseMatch = text.match(/^(批量解析完成：成功 )(\d+ 份)(，失敗 )(\d+ 份)$/)
  if (batchParseMatch) {
    return [
      { text: batchParseMatch[1], tone: '' },
      { text: batchParseMatch[2], tone: 'success-message' },
      { text: batchParseMatch[3], tone: '' },
      { text: batchParseMatch[4], tone: 'error-message' },
    ]
  }

  const batchActionMatch = text.match(/^(.*完成：成功 )(\d+ 份)(，失敗 )(\d+ 份)$/)
  if (batchActionMatch) {
    return [
      { text: batchActionMatch[1], tone: '' },
      { text: batchActionMatch[2], tone: 'success-message' },
      { text: batchActionMatch[3], tone: '' },
      { text: batchActionMatch[4], tone: 'error-message' },
    ]
  }

  return [{ text, tone: '' }]
}

const buildBatchItem = (file, index) => ({
  id: `${file.name}-${file.lastModified}-${index}`,
  file,
  fileName: file.name,
  cacheId: '',
  status: 'pending',
  stage: 'waiting',
  message: '等待處理',
  selected: false,
  candidate: null,
  extractedText: '',
  edited: false,
  applicationId: null,
  matchedPosition: '',
})

const getBatchStatusLabel = (status) => {
  if (status === 'success') return '完成'
  if (status === 'error') return '失敗'
  if (status === 'processing') return '處理中'
  return '等待中'
}

const getBatchStageLabel = (stage) => {
  if (stage === 'caching') return '快取'
  if (stage === 'parsing') return '解析'
  if (stage === 'intake') return '提交'
  if (stage === 'success') return '完成'
  if (stage === 'error') return '失敗'
  return '等待'
}

const updateBatchItem = (itemId, patch) => {
  batchItems.value = batchItems.value.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
}

const resetParsedState = () => {
  parsedCandidate.value = null
  parsedExtractedText.value = ''
  singleMatchResult.value = null
  isEditingExtracted.value = false
  hasEditedExtracted.value = false
  draftFields.value = {}
}

const resetBatchEditingState = () => {
  isEditingBatchExtracted.value = false
  batchDraftFields.value = {}
}

const clearSingleState = () => {
  selectedFile.value = null
  cachedCvId.value = ''
  cachedCvName.value = ''
  resetParsedState()
}

const clearBatchState = () => {
  batchItems.value = []
  activeBatchItemId.value = ''
  batchView.value = 'list'
  currentBatchItemId.value = ''
  currentBatchStage.value = ''
  batchOperationTotal.value = 0
  batchOperationCompleted.value = 0
  isBatchParsing.value = false
  isBatchMatching.value = false
  resetBatchEditingState()
}

const clearAllState = () => {
  selectedFiles.value = []
  clearSingleState()
  clearBatchState()
  if (fileInputRef.value) fileInputRef.value.value = ''
}

const isExpiredCacheResponse = (response, data) =>
  Number(response?.status || 0) === 404 &&
  /cached cv not found|expired/i.test(String(data?.message || ''))

const parseJsonResponse = async (response) => {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

const requestCache = async (file) => {
  const endpoint = getScopedEndpoint('/cv/cache')
  if (!endpoint) throw new Error('請先選擇有效的職位')

  const contentBase64 = await fileToBase64(file)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      contentBase64,
    }),
  })

  const data = await parseJsonResponse(response)
  if (!response.ok) throw new Error(data.message || 'CV 快取失敗')
  return data
}

const requestParse = async (cacheId) => {
  const endpoint = getScopedEndpoint('/cv/parse')
  if (!endpoint) throw new Error('請先選擇有效的職位')

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cacheId }),
  })

  const data = await parseJsonResponse(response)
  return { response, data }
}

const requestIntake = async (cacheId, editedExtracted = null) => {
  const endpoint = getScopedEndpoint('/cv/intake')
  if (!endpoint) throw new Error('請先選擇有效的職位')

  const payload = { cacheId }
  if (editedExtracted && typeof editedExtracted === 'object') {
    payload.editedExtracted = editedExtracted
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await parseJsonResponse(response)
  return { response, data }
}

const cacheCvFile = async (file) => {
  if (!file) {
    cachedCvId.value = ''
    cachedCvName.value = ''
    return false
  }

  isCaching.value = true
  try {
    const data = await requestCache(file)
    cachedCvId.value = data.cacheId || ''
    cachedCvName.value = data.fileName || file.name
    return !!cachedCvId.value
  } catch (error) {
    cachedCvId.value = ''
    cachedCvName.value = ''
    message.value = error?.message || 'CV 快取失敗'
    return false
  } finally {
    isCaching.value = false
  }
}

const ensureCachedCv = async () => {
  if (cachedCvId.value) return true
  return cacheCvFile(selectedFile.value)
}

const recacheSelectedFile = async () => {
  if (!selectedFile.value) {
    message.value = '快取已失效，請重新選擇 CV 檔案後再試'
    return false
  }

  message.value = '快取已失效，正在自動重新快取檔案...'
  cachedCvId.value = ''
  cachedCvName.value = ''
  return cacheCvFile(selectedFile.value)
}

const handleFileChange = (event) => {
  const files = Array.from(event.target.files || [])
  selectedFiles.value = files
  message.value = ''

  if (files.length <= 1) {
    clearBatchState()
    selectedFile.value = files[0] || null
    cachedCvId.value = ''
    cachedCvName.value = ''
    resetParsedState()
    return
  }

  clearSingleState()
  batchItems.value = files.map((file, index) => createBatchItem(file, index))
  activeBatchItemId.value = batchItems.value[0]?.id || ''
}

const parseCv = async () => {
  message.value = ''
  if (!selectedFile.value) {
    message.value = '請先選擇 CV 檔案'
    return
  }

  const hasCached = await ensureCachedCv()
  if (!hasCached) {
    if (!message.value) message.value = 'CV 快取失敗，請重新選擇檔案'
    return
  }

  isParsing.value = true
  try {
    let { response, data } = await requestParse(cachedCvId.value)

    if (!response.ok && isExpiredCacheResponse(response, data)) {
      const recached = await recacheSelectedFile()
      if (!recached) return
      ;({ response, data } = await requestParse(cachedCvId.value))
    }

    if (!response.ok) {
      message.value = data.message || 'CV 解析失敗'
      return
    }

    parsedCandidate.value = data.candidate || null
    parsedExtractedText.value = String(data.extractedText || '')
    isEditingExtracted.value = false
    hasEditedExtracted.value = false
    draftFields.value = {}
    message.value = 'CV 解析完成，請確認提取結果'
  } catch {
    message.value = 'CV 解析失敗'
  } finally {
    isParsing.value = false
  }
}

const startEditingExtracted = () => {
  if (!parsedCandidate.value) return
  const previewData = buildExtractedPreviewData({
    content: parsedExtractedText.value,
    extracted: parsedCandidate.value.extracted || {},
    parser: parsedCandidate.value.parser || '',
    missingFields: parsedCandidate.value.missingFields || [],
  })
  draftFields.value = buildDraftFieldsFromRows(getEditableRows(previewData))
  isEditingExtracted.value = true
  message.value = ''
}

const cancelEditingExtracted = () => {
  isEditingExtracted.value = false
  draftFields.value = {}
}

const saveEditedExtracted = () => {
  if (!parsedCandidate.value) return
  const editedExtracted = buildEditedExtractedFromDraft(draftFields.value)
  if (!editedExtracted.fullName) {
    message.value = '姓名不可為空'
    return
  }

  const missingFields = computeMissingFields(editedExtracted)
  parsedCandidate.value = {
    ...parsedCandidate.value,
    fullName: editedExtracted.fullName,
    email: editedExtracted.email,
    phone: editedExtracted.phone,
    extracted: editedExtracted,
    missingFields,
    parser: 'manual',
  }
  parsedExtractedText.value = JSON.stringify(
    {
      extracted: editedExtracted,
      missingFields,
      parser: 'manual',
    },
    null,
    2
  )
  hasEditedExtracted.value = true
  isEditingExtracted.value = false
  draftFields.value = {}
  message.value = '已套用編輯內容，確認後即可提交'
}

const cancelParsedUpload = () => {
  clearAllState()
  message.value = '已取消本次 CV 上傳'
}

const confirmUpload = async () => {
  message.value = ''
  if (!cachedCvId.value || !parsedCandidate.value) {
    message.value = '請先完成解析並確認提取結果'
    return
  }
  if (isEditingExtracted.value) {
    message.value = '請先儲存或取消編輯後再提交'
    return
  }

  isConfirmingUpload.value = true
  try {
    let { response, data } = await requestIntake(
      cachedCvId.value,
      hasEditedExtracted.value ? parsedCandidate.value?.extracted : null
    )

    if (!response.ok && isExpiredCacheResponse(response, data)) {
      const recached = await recacheSelectedFile()
      if (!recached) return
      ;({ response, data } = await requestIntake(
        cachedCvId.value,
        hasEditedExtracted.value ? parsedCandidate.value?.extracted : null
      ))
    }

    if (!response.ok) {
      message.value = data.message || 'CV 提交失敗'
      return
    }

    emit('uploaded', {
      mode: 'single',
      candidateId: data?.candidate?.id ? Number(data.candidate.id) : null,
      applicationId: data?.application?.id ? Number(data.application.id) : null,
      jobPostId: Number(props.jobPostId || 0) || null,
    })
    message.value = 'CV 匹配完成，請查看匹配結果'
    parsedCandidate.value = data?.candidate || parsedCandidate.value
    singleMatchResult.value = {
      jobPost: data?.jobPost || null,
      application: data?.application || null,
      match: data?.match || null,
    }
  } catch {
    message.value = 'CV 提交失敗'
  } finally {
    isConfirmingUpload.value = false
  }
}

const openBatchItem = (itemId) => {
  activeBatchItemId.value = itemId
  batchView.value = 'detail'
  resetBatchEditingState()
}

const returnToBatchList = () => {
  batchView.value = 'list'
  resetBatchEditingState()
}

const toggleBatchSelection = (itemId, checked) => {
  updateBatchItem(itemId, { selected: !!checked })
}

const toggleSelectAllParsed = () => {
  const next = !allMatchableSelected.value
  batchItems.value = batchItems.value.map((item) =>
    canMatchBatchItem(item) ? { ...item, selected: next } : { ...item, selected: false }
  )
}

const clearBatchSelections = () => {
  batchItems.value = batchItems.value.map((item) => ({ ...item, selected: false }))
}

const startEditingBatchExtracted = () => {
  const item = activeBatchItem.value
  if (!canEditBatchItem(item) || !item?.candidate) return
  const previewData = buildExtractedPreviewData({
    content: item.extractedText || '',
    extracted: item.candidate.extracted || {},
    parser: item.candidate.parser || '',
    missingFields: item.candidate.missingFields || [],
  })
  batchDraftFields.value = buildDraftFieldsFromRows(getEditableRows(previewData))
  isEditingBatchExtracted.value = true
  message.value = ''
}

const cancelEditingBatchExtracted = () => {
  resetBatchEditingState()
}

const saveBatchEditedExtracted = () => {
  const item = activeBatchItem.value
  if (!canEditBatchItem(item) || !item?.candidate) return

  const editedExtracted = buildEditedExtractedFromDraft(batchDraftFields.value)
  if (!editedExtracted.fullName) {
    message.value = '姓名不可為空'
    return
  }

  const missingFields = computeMissingFields(editedExtracted)
  const nextCandidate = {
    ...item.candidate,
    fullName: editedExtracted.fullName,
    email: editedExtracted.email,
    phone: editedExtracted.phone,
    extracted: editedExtracted,
    missingFields,
    parser: 'manual',
  }

  updateBatchItem(item.id, {
    candidate: nextCandidate,
    extractedText: JSON.stringify(
      {
        extracted: editedExtracted,
        missingFields,
        parser: 'manual',
      },
      null,
      2
    ),
    edited: true,
    message: '已儲存編輯，可直接匹配',
  })

  resetBatchEditingState()
  message.value = `已更新 ${item.fileName} 的提取結果`
}

const startBatchProcessing = async () => {
  message.value = ''
  if (!isBatchMode.value || !batchItems.value.length) {
    message.value = '請先選擇多份 CV'
    return
  }
  if (!getScopedEndpoint('/cv/cache')) {
    message.value = '請先選擇有效的職位'
    return
  }

  clearBatchSelections()
  resetBatchEditingState()
  isBatchParsing.value = true
  currentBatchItemId.value = ''
  currentBatchStage.value = ''
  batchOperationTotal.value = batchItems.value.length
  batchOperationCompleted.value = 0

  batchItems.value = batchItems.value.map((item) => ({
    ...item,
    cacheId: '',
    status: 'pending',
    stage: 'waiting',
    message: '等待解析',
    candidate: null,
    extractedText: '',
    edited: false,
    applicationId: null,
    matchedPosition: '',
    selected: false,
  }))

  for (let index = 0; index < batchItems.value.length; index += 1) {
    const item = batchItems.value[index]
    currentBatchItemId.value = item.id

    try {
      updateBatchItem(item.id, {
        status: 'parsing',
        stage: 'caching',
        message: `正在快取第 ${index + 1} / ${batchItems.value.length} 份 CV`,
      })
      currentBatchStage.value = '正在快取檔案'

      let cacheData = await requestCache(item.file)
      let workingCacheId = cacheData.cacheId || ''

      updateBatchItem(item.id, {
        cacheId: workingCacheId,
        status: 'parsing',
        stage: 'parsing',
        message: '正在解析履歷',
      })
      currentBatchStage.value = '正在解析履歷'

      let parseResult = await requestParse(workingCacheId)
      if (!parseResult.response.ok && isExpiredCacheResponse(parseResult.response, parseResult.data)) {
        cacheData = await requestCache(item.file)
        workingCacheId = cacheData.cacheId || ''
        updateBatchItem(item.id, {
          cacheId: workingCacheId,
          message: '快取已更新，重新解析中',
        })
        parseResult = await requestParse(workingCacheId)
      }
      if (!parseResult.response.ok) throw new Error(parseResult.data.message || 'CV 解析失敗')

      updateBatchItem(item.id, {
        cacheId: workingCacheId,
        status: 'parsed',
        stage: 'parsed',
        message: '解析完成，可編輯並匹配',
        candidate: parseResult.data?.candidate || null,
        extractedText: String(parseResult.data?.extractedText || ''),
      })

      if (!activeBatchItemId.value) activeBatchItemId.value = item.id
    } catch (error) {
      updateBatchItem(item.id, {
        status: 'error',
        stage: 'error',
        message: error?.message || '批量解析失敗',
      })
    } finally {
      batchOperationCompleted.value = index + 1
    }
  }

  isBatchParsing.value = false
  currentBatchItemId.value = ''
  currentBatchStage.value = ''
  message.value = `批量解析完成：成功 ${parsedReadyItems.value.length} 份，失敗 ${batchItems.value.filter((item) => item.status === 'error').length} 份`

  const firstReadyItem = batchItems.value.find((item) => item.status === 'parsed' || item.status === 'match-error')
  if (firstReadyItem) activeBatchItemId.value = firstReadyItem.id
}

const matchBatchItemsByIds = async (itemIds, actionLabel = '批量匹配') => {
  if (!itemIds.length) {
    message.value = '請先選擇要匹配的 CV'
    return
  }
  if (isEditingBatchExtracted.value) {
    message.value = '請先儲存或取消目前的編輯後再匹配'
    return
  }

  const ids = itemIds.filter((id) => canMatchBatchItem(batchItems.value.find((item) => item.id === id)))
  if (!ids.length) {
    message.value = '目前沒有可匹配的 CV'
    return
  }

  isBatchMatching.value = true
  currentBatchItemId.value = ''
  currentBatchStage.value = ''
  batchOperationTotal.value = ids.length
  batchOperationCompleted.value = 0

  let successCount = 0
  let errorCount = 0

  for (let index = 0; index < ids.length; index += 1) {
    const itemId = ids[index]
    const item = batchItems.value.find((entry) => entry.id === itemId)
    if (!canMatchBatchItem(item)) {
      batchOperationCompleted.value = index + 1
      continue
    }

    currentBatchItemId.value = item.id
    updateBatchItem(item.id, {
      status: 'matching',
      stage: 'matching',
      message: `正在匹配第 ${index + 1} / ${ids.length} 份 CV`,
      selected: false,
    })
    currentBatchStage.value = '正在提交並匹配職位'

    try {
      let workingCacheId = item.cacheId
      let intakeResult = await requestIntake(workingCacheId, item.candidate?.extracted || null)

      if (!intakeResult.response.ok && isExpiredCacheResponse(intakeResult.response, intakeResult.data)) {
        const cacheData = await requestCache(item.file)
        workingCacheId = cacheData.cacheId || ''
        updateBatchItem(item.id, {
          cacheId: workingCacheId,
          message: '快取已更新，重新匹配中',
        })
        intakeResult = await requestIntake(workingCacheId, item.candidate?.extracted || null)
      }

      if (!intakeResult.response.ok) {
        throw new Error(intakeResult.data.message || 'CV 匹配失敗')
      }

      updateBatchItem(item.id, {
        cacheId: workingCacheId,
        status: 'matched',
        stage: 'matched',
        message: intakeResult.data?.message || '已完成匹配並同步到候選人管理',
        applicationId: intakeResult.data?.application?.id ? Number(intakeResult.data.application.id) : null,
        matchedPosition:
          intakeResult.data?.application?.matchedPosition ||
          intakeResult.data?.jobPost?.matchedPosition ||
          '',
        candidate:
          intakeResult.data?.candidate && typeof intakeResult.data.candidate === 'object'
            ? intakeResult.data.candidate
            : item.candidate,
      })
      successCount += 1
    } catch (error) {
      updateBatchItem(item.id, {
        status: 'match-error',
        stage: 'error',
        message: error?.message || 'CV 匹配失敗，請檢查後重試',
      })
      errorCount += 1
    } finally {
      batchOperationCompleted.value = index + 1
    }
  }

  isBatchMatching.value = false
  currentBatchItemId.value = ''
  currentBatchStage.value = ''
  message.value = `${actionLabel}完成：成功 ${successCount} 份，失敗 ${errorCount} 份`

  emit('uploaded', {
    mode: 'batch',
    total: ids.length,
    successCount,
    errorCount,
    jobPostId: Number(props.jobPostId || 0) || null,
  })
}

const matchAllParsedBatchItems = async () => {
  await matchBatchItemsByIds(
    parsedReadyItems.value.map((item) => item.id),
    '全部匹配'
  )
}

const matchSelectedBatchItems = async () => {
  await matchBatchItemsByIds(
    selectedMatchableItems.value.map((item) => item.id),
    '所選匹配'
  )
}

const matchSingleBatchItem = async (itemId) => {
  await matchBatchItemsByIds([itemId], '單個匹配')
}

const runBatchPrimaryAction = async () => {
  if (batchHasSelection.value) {
    await matchSelectedBatchItems()
    return
  }
  await matchAllParsedBatchItems()
}

const clearBatchQueue = () => {
  clearAllState()
  message.value = '已清空批量佇列'
}

const startBatchProcessingLegacy = async () => {
  message.value = ''
  if (!isBatchMode.value || !batchItems.value.length) {
    message.value = '請先選擇多份 CV'
    return
  }
  if (!getScopedEndpoint('/cv/cache')) {
    message.value = '請先選擇有效的職位'
    return
  }

  batchItems.value = batchItems.value.map((item) => ({
    ...item,
    cacheId: '',
    status: 'pending',
    stage: 'waiting',
    message: '等待處理',
    candidateName: '',
    applicationId: null,
    matchedPosition: '',
  }))

  isBatchRunning.value = true
  currentBatchItemId.value = ''
  currentBatchStage.value = ''

  for (let index = 0; index < batchItems.value.length; index += 1) {
    const item = batchItems.value[index]
    currentBatchItemId.value = item.id

    try {
      updateBatchItem(item.id, {
        status: 'processing',
        stage: 'caching',
        message: `正在快取第 ${index + 1} / ${batchItems.value.length} 份 CV`,
      })
      currentBatchStage.value = '正在快取檔案'
      let cacheData = await requestCache(item.file)
      let workingCacheId = cacheData.cacheId || ''

      updateBatchItem(item.id, {
        cacheId: workingCacheId,
        stage: 'parsing',
        message: '正在抽取履歷資料',
      })
      currentBatchStage.value = '正在解析履歷'

      let parseResult = await requestParse(workingCacheId)
      if (!parseResult.response.ok && isExpiredCacheResponse(parseResult.response, parseResult.data)) {
        cacheData = await requestCache(item.file)
        workingCacheId = cacheData.cacheId || ''
        updateBatchItem(item.id, { cacheId: workingCacheId, message: '快取已更新，重新解析中' })
        parseResult = await requestParse(workingCacheId)
      }
      if (!parseResult.response.ok) throw new Error(parseResult.data.message || 'CV 解析失敗')

      const candidate = parseResult.data?.candidate || {}
      updateBatchItem(item.id, {
        stage: 'intake',
        message: '正在提交並匹配職位',
        candidateName: candidate.fullName || '',
      })
      currentBatchStage.value = '正在提交到職位'

      let intakeResult = await requestIntake(workingCacheId)
      if (!intakeResult.response.ok && isExpiredCacheResponse(intakeResult.response, intakeResult.data)) {
        cacheData = await requestCache(item.file)
        workingCacheId = cacheData.cacheId || ''
        updateBatchItem(item.id, { cacheId: workingCacheId, message: '快取已更新，重新提交中' })
        intakeResult = await requestIntake(workingCacheId)
      }
      if (!intakeResult.response.ok) throw new Error(intakeResult.data.message || 'CV 提交失敗')

      updateBatchItem(item.id, {
        cacheId: workingCacheId,
        status: 'success',
        stage: 'success',
        message: intakeResult.data?.message || '已完成批量處理',
        candidateName: intakeResult.data?.candidate?.fullName || candidate.fullName || '',
        applicationId: intakeResult.data?.application?.id ? Number(intakeResult.data.application.id) : null,
        matchedPosition:
          intakeResult.data?.application?.matchedPosition ||
          intakeResult.data?.jobPost?.matchedPosition ||
          '',
      })
    } catch (error) {
      updateBatchItem(item.id, {
        status: 'error',
        stage: 'error',
        message: error?.message || '批量處理失敗',
      })
    }
  }

  isBatchRunning.value = false
  currentBatchItemId.value = ''
  currentBatchStage.value = ''

  const summary = {
    mode: 'batch',
    total: batchItems.value.length,
    successCount: batchSuccessCount.value,
    errorCount: batchErrorCount.value,
    jobPostId: Number(props.jobPostId || 0) || null,
  }
  message.value = `批量處理完成：成功 ${summary.successCount} 份，失敗 ${summary.errorCount} 份`
  emit('uploaded', summary)
}

const clearBatchQueueLegacy = () => {
  clearAllState()
  message.value = '已清空批量佇列'
}
</script>

<template>
  <section class="upload-flow">
    <div v-if="showLoadingOverlay" class="loading-overlay" aria-live="polite" aria-busy="true">
      <div class="loading-card">
        <div class="spinner" aria-hidden="true" />
        <h4>{{ loadingTitle }}</h4>
        <p>{{ loadingDescription }}</p>
      </div>
    </div>

    <header class="panel-header">
      <div class="panel-title-wrap">
        <h3>上傳與解析 CV</h3>
        <p v-if="props.jobPostTitle" class="job-post-hint">當前職位：{{ props.jobPostTitle }}</p>
      </div>
      <button type="button" class="ghost-btn" :disabled="isBusy" @click="emit('closed')">關閉</button>
    </header>

    <div class="card">
      <h4>{{ isBatchMode ? '第一步：批量解析 CV' : '第一步：解析 CV（不會立即提交）' }}</h4>
      <input
        ref="fileInputRef"
        class="file-input"
        type="file"
        accept=".pdf,.doc,.docx,.txt"
        :multiple="true"
        @change="handleFileChange"
      />

      <div class="file-picker-row">
        <button type="button" class="file-picker-btn" :disabled="isBusy" @click="triggerFilePicker">
          {{ isBatchMode ? '選擇多份檔案' : '選擇檔案' }}
        </button>
        <p class="file-name" :class="{ placeholder: !hasSelectedFiles }">{{ selectedFilesLabel }}</p>

        <button
          v-if="!isBatchMode"
          type="button"
          class="primary-action-btn"
          :disabled="isBusy || !selectedFile"
          @click="parseCv"
        >
          {{ isParsing ? '解析中...' : '解析 CV' }}
        </button>

        <div v-else class="batch-action-row">
          <button
            type="button"
            class="primary-action-btn"
            :disabled="isBusy || !batchItems.length"
            @click="startBatchProcessing"
          >
            {{ isBatchParsing ? '批量解析中...' : '開始批量解析' }}
          </button>
          <button type="button" class="ghost-btn" :disabled="isBusy" @click="clearBatchQueue">清空</button>
        </div>
      </div>

      <p v-if="!isBatchMode && cachedCvId" class="info-line">
        已快取檔案：{{ cachedCvName }}（ID: {{ cachedCvId.slice(0, 8) }}...）
      </p>
      <p v-if="message" class="message">
        <template v-for="(segment, index) in getMessageSegments(message)" :key="`${segment.text}-${index}`">
          <span :class="segment.tone">{{ segment.text }}</span>
        </template>
      </p>
    </div>

    <div v-if="isBatchMode && batchItems.length && !isBatchDetailView" class="card batch-card">
      <div class="batch-summary">
        <div>
          <h4>{{ batchProgressLabel }}</h4>
          <p class="batch-summary-text">
            已解析 {{ batchParseCompletedCount }} / {{ batchItems.length }}，可匹配 {{ parsedReadyItems.length }}，已匹配
            {{ matchedItems.length }}
          </p>
          <p v-if="currentBatchItemId" class="batch-current">
            當前 CV：{{ batchItems.find((item) => item.id === currentBatchItemId)?.fileName || '--' }}｜
            {{ currentBatchStage || '--' }}
          </p>
        </div>
        <strong class="batch-percent">{{ batchProgressPercent }}%</strong>
      </div>

      <div class="progress-track" aria-hidden="true">
        <div class="progress-bar" :style="{ width: `${batchProgressPercent}%` }" />
      </div>

      <div class="batch-toolbar">
        <p class="batch-toolbar-hint">
          點選左側 CV 查看與編輯；可先勾選想處理的 CV，不勾選時會直接匹配全部可處理 CV。
        </p>
        <button
          type="button"
          class="secondary-btn"
          :disabled="isBusy || !parsedReadyItems.length"
          @click="toggleSelectAllParsed"
        >
          {{ batchSelectActionLabel }}
        </button>
        <button
          type="button"
          class="primary-action-btn"
          :disabled="isBusy || !parsedReadyItems.length"
          @click="runBatchPrimaryAction"
        >
          {{ batchPrimaryActionLabel }}
        </button>
      </div>

      <div class="batch-list">
        <article
          v-for="item in batchItems"
          :key="item.id"
          class="batch-item"
          :class="[`status-${item.status}`, { active: item.id === activeBatchItemId }]"
        >
          <div class="batch-item-header">
            <label class="batch-select">
              <input
                type="checkbox"
                :checked="item.selected"
                :disabled="isBusy || !canMatchBatchItem(item)"
                @change="toggleBatchSelection(item.id, $event.target.checked)"
              />
              <span />
            </label>

            <button type="button" class="batch-item-main" @click="openBatchItem(item.id)">
              <strong>{{ item.fileName }}</strong>
              <span class="batch-meta">
                {{ resolveBatchStatusLabel(item.status) }}｜{{ resolveBatchStageLabel(item.stage) }}
                <template v-if="item.candidate?.fullName">｜{{ item.candidate.fullName }}</template>
                <template v-if="item.matchedPosition">｜{{ item.matchedPosition }}</template>
              </span>
              <span class="batch-message" :class="getMessageTone(item.message)">{{ item.message }}</span>
            </button>
          </div>
        </article>
      </div>
    </div>

    <div v-if="isBatchDetailView && activeBatchItem" class="card batch-detail-page">
      <div class="detail-page-topbar">
        <button type="button" class="ghost-btn" :disabled="isBusy" @click="returnToBatchList">返回上一頁</button>
        <p class="detail-status">
          狀態：{{ resolveBatchStatusLabel(activeBatchItem.status) }}
          <span v-if="activeBatchItem.applicationId">｜投遞編號：{{ activeBatchItem.applicationId }}</span>
        </p>
      </div>

      <div class="step-header">
        <div class="detail-title-wrap">
          <h4>{{ activeBatchItem.fileName }}</h4>
          <p class="batch-meta">
            <span v-if="activeBatchItem.candidate?.fullName">{{ activeBatchItem.candidate.fullName }}</span>
            <span v-if="activeBatchItem.matchedPosition">｜{{ activeBatchItem.matchedPosition }}</span>
          </p>
        </div>

        <div class="detail-actions">
          <button
            v-if="!isEditingBatchExtracted"
            type="button"
            class="edit-btn"
            :disabled="isBusy || !canEditBatchItem(activeBatchItem)"
            @click="startEditingBatchExtracted"
          >
            編輯資料
          </button>
          <button
            type="button"
            class="primary-action-btn"
            :disabled="isBusy || !canMatchBatchItem(activeBatchItem)"
            @click="matchSingleBatchItem(activeBatchItem.id)"
          >
            匹配此 CV
          </button>
        </div>
      </div>

      <div v-if="isEditingBatchExtracted" class="editor-wrap">
        <p class="edit-hint">請編輯欄位後點擊「儲存編輯」。清單欄位可用逗號或換行分隔。</p>
        <div class="edit-grid">
          <label
            v-for="field in editFieldDefs"
            :key="field.key"
            class="edit-field"
            :class="{ 'full-width': field.kind === 'textarea' }"
          >
            <span>{{ field.label }}</span>
            <textarea
              v-if="field.kind === 'textarea'"
              v-model="batchDraftFields[field.key]"
              rows="3"
              class="edit-input"
              :placeholder="field.required ? '必填' : '選填'"
            />
            <input
              v-else
              v-model="batchDraftFields[field.key]"
              type="text"
              class="edit-input"
              :placeholder="field.required ? '必填' : '選填'"
            />
          </label>
        </div>
        <div class="project-editor-section">
          <h5>專案經歷</h5>
          <ProjectExperiencesField
            v-model="batchDraftFields.projectExperiences"
            :legacy-text="activeBatchItem?.candidate?.extracted?.profile?.projectExperience || ''"
          />
        </div>
        <div class="edit-actions">
          <button type="button" class="save-edit-btn" :disabled="isBusy" @click="saveBatchEditedExtracted">
            儲存編輯
          </button>
          <button type="button" class="cancel-edit-btn" :disabled="isBusy" @click="cancelEditingBatchExtracted">
            取消編輯
          </button>
        </div>
      </div>

      <CvExtractedFilePreview
        v-else-if="activeBatchItem.candidate"
        :content="activeBatchItem.extractedText"
        :extracted="activeBatchItem.candidate.extracted || {}"
        :parser="activeBatchItem.candidate.parser || ''"
        :missing-fields="activeBatchItem.candidate.missingFields || []"
      />

      <p v-else class="hint">此 CV 尚未完成解析，完成後可在這裡查看與編輯。</p>
    </div>

    <div v-if="!isBatchMode && parsedCandidate" class="card">
      <div class="step-header">
        <h4>第二步：確認 AI分析結果</h4>
        <button
          v-if="!isEditingExtracted"
          type="button"
          class="edit-btn"
          :disabled="isConfirmingUpload"
          @click="startEditingExtracted"
        >
          編輯
        </button>
      </div>

      <div v-if="isEditingExtracted" class="editor-wrap">
        <p class="edit-hint">請編輯欄位後點擊「儲存編輯」。清單欄位可用逗號或換行分隔。</p>
        <div class="edit-grid">
          <label
            v-for="field in editFieldDefs"
            :key="field.key"
            class="edit-field"
            :class="{ 'full-width': field.kind === 'textarea' }"
          >
            <span>{{ field.label }}</span>
            <textarea
              v-if="field.kind === 'textarea'"
              v-model="draftFields[field.key]"
              rows="3"
              class="edit-input"
              :placeholder="field.required ? '必填' : '選填'"
            />
            <input
              v-else
              v-model="draftFields[field.key]"
              type="text"
              class="edit-input"
              :placeholder="field.required ? '必填' : '選填'"
            />
          </label>
        </div>
        <div class="project-editor-section">
          <h5>專案經歷</h5>
          <ProjectExperiencesField
            v-model="draftFields.projectExperiences"
            :legacy-text="parsedCandidate?.extracted?.profile?.projectExperience || ''"
          />
        </div>
        <div class="edit-actions">
          <button type="button" class="save-edit-btn" :disabled="isConfirmingUpload" @click="saveEditedExtracted">
            儲存編輯
          </button>
          <button type="button" class="cancel-edit-btn" :disabled="isConfirmingUpload" @click="cancelEditingExtracted">
            取消編輯
          </button>
        </div>
      </div>

      <CvExtractedFilePreview
        v-else
        :content="parsedExtractedText"
        :extracted="parsedCandidate.extracted || {}"
        :parser="parsedCandidate.parser || ''"
        :missing-fields="parsedCandidate.missingFields || []"
      />

      <div v-if="hasSingleMatchResult" class="match-result-card">
        <h4>匹配結果</h4>
        <p><strong>匹配職位：</strong>{{ singleMatchResult?.application?.matchedPosition || singleMatchResult?.jobPost?.matchedPosition || '--' }}</p>
        <p><strong>匹配分數：</strong>{{ singleMatchResult?.application?.matchedScore ?? singleMatchResult?.match?.matchScore ?? '--' }}</p>
        <p><strong>匹配等級：</strong>{{ singleMatchResult?.application?.matchedLevel || singleMatchResult?.match?.matchLevel || '--' }}</p>
        <p><strong>投遞編號：</strong>{{ singleMatchResult?.application?.id || '--' }}</p>
      </div>

      <div class="confirm-actions">
        <button type="button" class="cancel-btn" :disabled="isConfirmingUpload" @click="cancelParsedUpload">
          取消
        </button>
        <button
          type="button"
          class="confirm-btn"
          :disabled="isConfirmingUpload || isEditingExtracted || hasSingleMatchResult"
          @click="confirmUpload"
        >
          {{ hasSingleMatchResult ? '已完成匹配' : isConfirmingUpload ? '匹配中...' : '確認並匹配 CV' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.upload-flow {
  display: grid;
  gap: 1rem;
  color: var(--text-base);
  position: relative;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  background: rgba(243, 247, 251, 0.72);
  border-radius: 28px;
  backdrop-filter: blur(10px);
}

.loading-card {
  min-width: min(360px, 88%);
  max-width: 520px;
  display: grid;
  gap: 0.8rem;
  place-items: center;
  text-align: center;
  padding: 1.2rem 1.25rem;
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: var(--shadow-md);
}

.loading-card h4,
.loading-card p,
.panel-header h3,
.batch-summary h4,
.detail-title-wrap h4 {
  margin: 0;
}

.loading-card h4 {
  color: var(--text-strong);
  font-size: 1rem;
}

.loading-card p,
.job-post-hint,
.batch-summary-text,
.batch-current,
.batch-meta,
.detail-status {
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.5;
  margin: 0;
}

.spinner {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 4px solid rgba(16, 24, 40, 0.1);
  border-top-color: var(--accent);
  animation: spin 900ms linear infinite;
}

.panel-header,
.step-header,
.file-picker-row,
.confirm-actions,
.edit-actions,
.batch-summary,
.batch-toolbar,
.batch-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.panel-title-wrap,
.detail-title-wrap {
  display: grid;
  gap: 0.2rem;
}

.card,
.batch-list,
.editor-wrap,
.edit-grid {
  display: grid;
  gap: 0.9rem;
}

.file-input {
  display: none;
}

.file-picker-row {
  align-items: stretch;
}

.batch-action-row,
.detail-actions {
  display: flex;
  gap: 0.6rem;
}

.file-name {
  flex: 1;
  margin: 0;
  padding: 0.82rem 0.95rem;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid var(--border-default);
  border-radius: 18px;
  min-width: 0;
  word-break: break-all;
}

.file-name.placeholder {
  color: var(--text-muted);
}

.info-line,
.message,
.edit-hint,
.batch-message {
  margin: 0;
}

.success-message {
  color: #15803d;
  font-weight: 600;
}

.processing-message {
  color: #ca8a04;
  font-weight: 600;
}

.error-message {
  color: #dc2626;
  font-weight: 600;
}

.batch-card {
  gap: 1rem;
}

.batch-toolbar {
  flex-wrap: wrap;
}

.batch-toolbar-hint {
  flex: 1 1 260px;
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.5;
}

.batch-percent {
  font-size: 1.5rem;
  color: var(--text-strong);
}

.progress-track {
  width: 100%;
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
}

.progress-bar {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(35, 124, 211, 0.88), rgba(16, 185, 129, 0.9));
  transition: width 180ms ease;
}

.batch-item {
  display: grid;
  gap: 0.45rem;
  padding: 0.95rem 1rem;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(255, 255, 255, 0.82);
}

.batch-item.active {
  border-color: rgba(35, 124, 211, 0.4);
  box-shadow: 0 12px 28px rgba(35, 124, 211, 0.12);
}

.batch-item.status-parsed,
.batch-item.status-match-error {
  border-color: rgba(59, 130, 246, 0.2);
}

.batch-item.status-matched {
  border-color: rgba(16, 185, 129, 0.28);
  background: rgba(240, 253, 250, 0.86);
}

.batch-item.status-error {
  border-color: rgba(239, 68, 68, 0.28);
  background: rgba(254, 242, 242, 0.9);
}

.batch-item-main {
  flex: 1;
  display: grid;
  gap: 0.22rem;
  text-align: left;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.batch-item-main strong {
  color: var(--text-strong);
}

.batch-select {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding-top: 0.1rem;
}

.batch-select input {
  width: 16px;
  height: 16px;
}

.batch-detail {
  padding: 0.95rem 1rem;
}

.batch-detail-page {
  gap: 1rem;
}

.match-result-card {
  display: grid;
  gap: 0.45rem;
  padding: 0.95rem 1rem;
  border-radius: 18px;
  border: 1px solid rgba(34, 197, 94, 0.22);
  background: rgba(240, 253, 244, 0.92);
}

.match-result-card h4,
.match-result-card p {
  margin: 0;
}

.detail-page-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.edit-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.project-editor-section {
  display: grid;
  gap: 0.7rem;
}

.project-editor-section h5 {
  margin: 0;
  color: var(--text-strong);
}

.edit-field {
  display: grid;
  gap: 0.45rem;
}

.edit-field.full-width {
  grid-column: 1 / -1;
}

.edit-input {
  width: 100%;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .edit-grid {
    grid-template-columns: 1fr;
  }

  .file-picker-row,
  .confirm-actions,
  .edit-actions,
  .step-header,
  .panel-header,
  .batch-summary,
  .batch-toolbar,
  .batch-item-header,
  .detail-page-topbar {
    flex-direction: column;
    align-items: stretch;
  }

  .batch-action-row,
  .detail-actions {
    width: 100%;
    justify-content: stretch;
  }

  .batch-action-row > *,
  .detail-actions > * {
    flex: 1;
  }
}
</style>
