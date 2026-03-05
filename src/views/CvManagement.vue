<script setup>
import { onMounted, ref, watch } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'

const candidateName = ref('')
const candidateEmail = ref('')
const candidatePhone = ref('')
const candidates = ref([])
const selectedCandidateId = ref('')
const selectedFile = ref(null)
const uploadedFiles = ref([])
const isSubmittingCandidate = ref(false)
const isUploading = ref(false)
const message = ref('')

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

const createCandidate = async () => {
  message.value = ''
  if (!candidateName.value.trim()) {
    message.value = '請先輸入候選人姓名'
    return
  }

  isSubmittingCandidate.value = true
  try {
    const response = await fetch(`${apiBaseUrl}/api/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: candidateName.value,
        email: candidateEmail.value,
        phone: candidatePhone.value,
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      message.value = data.message || '建立候選人失敗'
      return
    }

    candidateName.value = ''
    candidateEmail.value = ''
    candidatePhone.value = ''
    message.value = '候選人已建立'
    await loadCandidates()
    selectedCandidateId.value = String(data.candidate.id)
  } catch {
    message.value = '建立候選人失敗'
  } finally {
    isSubmittingCandidate.value = false
  }
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

const uploadCv = async () => {
  message.value = ''
  if (!selectedCandidateId.value) {
    message.value = '請先選擇候選人'
    return
  }
  if (!selectedFile.value) {
    message.value = '請先選擇 CV 檔案'
    return
  }

  isUploading.value = true
  try {
    const contentBase64 = await fileToBase64(selectedFile.value)
    const response = await fetch(`${apiBaseUrl}/api/candidates/${selectedCandidateId.value}/cvs`, {
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

    message.value = 'CV 上傳成功'
    selectedFile.value = null
    await loadCandidateFiles()
  } catch {
    message.value = 'CV 上傳失敗'
  } finally {
    isUploading.value = false
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
    if (candidates.value[0]?.id) {
      selectedCandidateId.value = String(candidates.value[0].id)
    }
  } catch {
    message.value = '初始化資料失敗'
  }
})
</script>

<template>
  <section class="cv-page">
    <h2>CV 管理</h2>
    <p>上傳後檔案會保存在 <code>server/storage/cv/</code></p>

    <div class="card">
      <h3>建立候選人</h3>
      <div class="grid">
        <input v-model="candidateName" type="text" placeholder="姓名（必填）" />
        <input v-model="candidateEmail" type="email" placeholder="Email" />
        <input v-model="candidatePhone" type="text" placeholder="電話" />
      </div>
      <button type="button" :disabled="isSubmittingCandidate" @click="createCandidate">
        {{ isSubmittingCandidate ? '建立中...' : '建立候選人' }}
      </button>
    </div>

    <div class="card">
      <h3>上傳 CV</h3>
      <select v-model="selectedCandidateId">
        <option value="">請選擇候選人</option>
        <option v-for="candidate in candidates" :key="candidate.id" :value="String(candidate.id)">
          {{ candidate.fullName }}{{ candidate.email ? ` (${candidate.email})` : '' }}
        </option>
      </select>
      <input type="file" accept=".pdf,.doc,.docx,.txt" @change="handleFileChange" />
      <button type="button" :disabled="isUploading" @click="uploadCv">{{ isUploading ? '上傳中...' : '上傳 CV' }}</button>
      <p v-if="message" class="message">{{ message }}</p>
    </div>

    <div class="card">
      <h3>已上傳 CV</h3>
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
ul { margin: .5rem 0 0; padding: 0; list-style: none; display: grid; gap: .4rem; }
li { display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0; padding-bottom: .4rem; }
@media (max-width: 900px) {
  .grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
