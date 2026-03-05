<script setup>
import { onMounted, ref, watch } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'

const selectedFile = ref(null)
const message = ref('')
const isUploading = ref(false)
const candidates = ref([])
const selectedCandidateId = ref('')
const uploadedFiles = ref([])

const extractedCandidate = ref(null)
const missingFields = ref([])
const manualFullName = ref('')
const manualEmail = ref('')
const manualPhone = ref('')
const isSubmittingManual = ref(false)

const formatSize = (bytes) => {
  if (!Number.isFinite(bytes)) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const loadCandidates = async () => {
  const response = await fetch(`${apiBaseUrl}/api/candidates`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || '讀取候選人失敗')
  candidates.value = data.candidates || []
}

const loadCandidateFiles = async () => {
  if (!selectedCandidateId.value) {
    uploadedFiles.value = []
    return
  }
  const response = await fetch(`${apiBaseUrl}/api/candidates/${selectedCandidateId.value}/cvs`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || '讀取 CV 列表失敗')
  uploadedFiles.value = data.files || []
}

const handleFileChange = (event) => {
  selectedFile.value = event.target.files?.[0] || null
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

const syncManualForm = (candidate) => {
  manualFullName.value = candidate?.fullName || ''
  manualEmail.value = candidate?.email || ''
  manualPhone.value = candidate?.phone || ''
}

const intakeCv = async () => {
  message.value = ''
  if (!selectedFile.value) {
    message.value = '請先選擇 CV 檔案'
    return
  }

  isUploading.value = true
  try {
    const contentBase64 = await fileToBase64(selectedFile.value)
    const response = await fetch(`${apiBaseUrl}/api/cv/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: selectedFile.value.name,
        mimeType: selectedFile.value.type || 'application/octet-stream',
        contentBase64,
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      message.value = data.message || 'CV 上傳失敗'
      return
    }

    extractedCandidate.value = data.candidate
    missingFields.value = data.candidate?.missingFields || []
    syncManualForm(data.candidate)

    await loadCandidates()
    selectedCandidateId.value = String(data.candidate.id)
    message.value = missingFields.value.length
      ? 'CV 已上傳，請補齊缺漏欄位後儲存'
      : 'CV 已上傳並完成候選人關鍵資訊擷取'
  } catch {
    message.value = 'CV 上傳失敗'
  } finally {
    isUploading.value = false
  }
}

const saveManualProfile = async () => {
  if (!extractedCandidate.value?.id) return
  message.value = ''
  if (!manualFullName.value.trim()) {
    message.value = '姓名為必填'
    return
  }

  isSubmittingManual.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/candidates/${extractedCandidate.value.id}/complete-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: manualFullName.value,
        email: manualEmail.value,
        phone: manualPhone.value,
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      message.value = data.message || '儲存候選人資料失敗'
      return
    }

    extractedCandidate.value = data.candidate
    missingFields.value = []
    await loadCandidates()
    message.value = '候選人資料已補齊'
  } catch {
    message.value = '儲存候選人資料失敗'
  } finally {
    isSubmittingManual.value = false
  }
}

watch(selectedCandidateId, async () => {
  try {
    await loadCandidateFiles()
  } catch {
    message.value = '讀取 CV 列表失敗'
  }
})

onMounted(async () => {
  try {
    await loadCandidates()
    if (candidates.value[0]?.id) selectedCandidateId.value = String(candidates.value[0].id)
  } catch {
    message.value = '初始化資料失敗'
  }
})
</script>

<template>
  <section class="cv-page">
    <h2>CV 管理</h2>
    <p>流程：先上傳 CV → 系統擷取候選人關鍵資訊 → 若有缺漏再手動補齊。</p>

    <div class="card">
      <h3>第一步：上傳 CV</h3>
      <input type="file" accept=".pdf,.doc,.docx,.txt" @change="handleFileChange" />
      <button type="button" :disabled="isUploading" @click="intakeCv">{{ isUploading ? '上傳與解析中...' : '上傳 CV 並解析' }}</button>
      <p v-if="message" class="message">{{ message }}</p>
    </div>

    <div v-if="extractedCandidate" class="card">
      <h3>LLM 擷取結果</h3>
      <p>姓名：{{ extractedCandidate.fullName || '（未擷取）' }}</p>
      <p>Email：{{ extractedCandidate.email || '（未擷取）' }}</p>
      <p>電話：{{ extractedCandidate.phone || '（未擷取）' }}</p>
      <p v-if="missingFields.length" class="warning">缺漏欄位：{{ missingFields.join('、') }}</p>
    </div>

    <div v-if="missingFields.length" class="card">
      <h3>第二步：補齊缺漏欄位</h3>
      <div class="grid">
        <input v-model="manualFullName" type="text" placeholder="姓名（必填）" />
        <input v-model="manualEmail" type="email" placeholder="Email" />
        <input v-model="manualPhone" type="text" placeholder="電話" />
      </div>
      <button type="button" :disabled="isSubmittingManual" @click="saveManualProfile">
        {{ isSubmittingManual ? '儲存中...' : '儲存候選人資料' }}
      </button>
    </div>

    <div class="card">
      <h3>候選人 CV 清單</h3>
      <select v-model="selectedCandidateId">
        <option value="">請選擇候選人</option>
        <option v-for="candidate in candidates" :key="candidate.id" :value="String(candidate.id)">
          {{ candidate.fullName }}{{ candidate.email ? ` (${candidate.email})` : '' }}
        </option>
      </select>
      <ul>
        <li v-for="file in uploadedFiles" :key="file.id">
          <span>v{{ file.versionNo }} - {{ file.originalFileName }}</span>
          <span>{{ formatSize(file.fileSize) }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.cv-page { display: grid; gap: 1rem; }
.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem; display: grid; gap: .6rem; }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .6rem; }
.message { color: #2563eb; margin: 0; }
.warning { color: #b45309; margin: 0; }
ul { margin: .5rem 0 0; padding: 0; list-style: none; display: grid; gap: .4rem; }
li { display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0; padding-bottom: .4rem; }
@media (max-width: 900px) {
  .grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
