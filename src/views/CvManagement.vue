<script setup>
import { onMounted, ref } from 'vue'
import { apiBaseUrl } from '../scripts/apiBaseUrl.js'

const selectedFile = ref(null)
const uploadMessage = ref('')
const isUploading = ref(false)
const uploadedFiles = ref([])

const formatSize = (bytes) => {
  if (!Number.isFinite(bytes)) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const loadFiles = async () => {
  try {
    const response = await fetch(`${apiBaseUrl}/api/cv/files`)
    const data = await response.json()
    if (!response.ok) {
      uploadMessage.value = data.message || '載入檔案列表失敗'
      return
    }
    uploadedFiles.value = data.files || []
  } catch {
    uploadMessage.value = '載入檔案列表失敗'
  }
}

const handleFileChange = (event) => {
  const file = event.target.files?.[0] || null
  selectedFile.value = file
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
  uploadMessage.value = ''
  if (!selectedFile.value) {
    uploadMessage.value = '請先選擇 CV 檔案'
    return
  }

  isUploading.value = true
  try {
    const contentBase64 = await fileToBase64(selectedFile.value)
    const response = await fetch(`${apiBaseUrl}/api/cv/upload`, {
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
      uploadMessage.value = data.message || 'CV 上傳失敗'
      return
    }

    uploadMessage.value = 'CV 上傳成功'
    selectedFile.value = null
    await loadFiles()
  } catch {
    uploadMessage.value = 'CV 上傳失敗'
  } finally {
    isUploading.value = false
  }
}

onMounted(() => {
  loadFiles()
})
</script>

<template>
  <section class="cv-page">
    <h2>CV 管理</h2>
    <p>上傳後檔案會存放於 <code>server/storage/cv/</code></p>

    <div class="upload-card">
      <input type="file" accept=".pdf,.doc,.docx,.txt" @change="handleFileChange" />
      <button type="button" :disabled="isUploading" @click="uploadCv">{{ isUploading ? '上傳中...' : '上傳 CV' }}</button>
      <p v-if="uploadMessage" class="message">{{ uploadMessage }}</p>
    </div>

    <div class="list-card">
      <h3>已上傳檔案</h3>
      <ul>
        <li v-for="file in uploadedFiles" :key="file.name">
          <span>{{ file.name }}</span>
          <span>{{ formatSize(file.size) }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.cv-page { display: grid; gap: 1rem; }
.upload-card, .list-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem; }
.message { color: #2563eb; margin-top: .5rem; }
ul { margin: .5rem 0 0; padding: 0; list-style: none; display: grid; gap: .4rem; }
li { display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0; padding-bottom: .4rem; }
</style>
