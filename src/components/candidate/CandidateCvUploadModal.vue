<script setup>
import { computed, ref, watch } from 'vue'
import { apiBaseUrl } from '../../scripts/apiBaseUrl.js'
import AppSelect from '../AppSelect.vue'
import CvUploadFlowPanel from '../CvUploadFlowPanel.vue'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close', 'uploaded'])

const isLoadingJobs = ref(false)
const error = ref('')
const jobPosts = ref([])
const selectedJobPostId = ref('')

const selectedJobPost = computed(() =>
  jobPosts.value.find((row) => String(row.id) === String(selectedJobPostId.value)) || null
)

const jobOptions = computed(() =>
  jobPosts.value.map((row) => ({
    value: String(row.id),
    label: row.title || row.jobKey || `職位 #${row.id}`,
  }))
)

const resetState = () => {
  error.value = ''
  selectedJobPostId.value = ''
  jobPosts.value = []
}

const loadOpenJobPosts = async () => {
  isLoadingJobs.value = true
  error.value = ''
  try {
    const response = await fetch(`${apiBaseUrl}/api/job-posts?status=open`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '讀取開放中的職位失敗')

    jobPosts.value = Array.isArray(data.jobPosts) ? data.jobPosts : []
    selectedJobPostId.value = jobPosts.value[0]?.id ? String(jobPosts.value[0].id) : ''
    if (!jobPosts.value.length) {
      error.value = '目前沒有開放中的職位'
    }
  } catch (nextError) {
    error.value = nextError?.message || '讀取開放中的職位失敗'
  } finally {
    isLoadingJobs.value = false
  }
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      resetState()
      return
    }
    await loadOpenJobPosts()
  }
)
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-panel candidate-upload-modal">
      <div class="panel-header">
        <div>
          <h3>上傳候選人 CV</h3>
          <p class="panel-subtitle">支援單檔與批量上傳，先選職位，再進入完整上傳流程。</p>
        </div>
        <button type="button" class="close-btn" @click="emit('close')">關閉</button>
      </div>

      <div class="modal-content">
        <p v-if="error" class="error">{{ error }}</p>

        <div class="field">
          <span>選擇職位</span>
          <AppSelect
            :model-value="selectedJobPostId"
            :options="jobOptions"
            :disabled="isLoadingJobs || !jobOptions.length"
            placeholder="請選擇開放中的職位"
            @update:model-value="selectedJobPostId = $event"
          />
        </div>

        <CvUploadFlowPanel
          v-if="selectedJobPost?.id"
          :job-post-id="Number(selectedJobPost.id)"
          :job-post-title="selectedJobPost.title || ''"
          @uploaded="emit('uploaded', $event)"
          @closed="emit('close')"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.candidate-upload-modal {
  display: grid;
  gap: 1rem;
  width: min(1040px, calc(100vw - 2rem));
}

.modal-content {
  display: grid;
  gap: 1rem;
  padding: 0 0.2rem;
}
</style>
