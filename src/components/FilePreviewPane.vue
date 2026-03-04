<template>
  <div class="preview-pane">
    <div class="preview-pane__header">
      <h3>{{ title || '文件預覽' }}</h3>
    </div>
    <div class="preview-pane__body">
      <div v-if="empty" class="preview-pane__empty">
        <div class="preview-pane__empty-title">請先選擇文件</div>
        <div class="preview-pane__empty-subtitle">從左側文件列表點選一個文件進行預覽。</div>
      </div>
      <div v-else-if="loading" class="preview-pane__state">載入中...</div>
      <div v-else-if="error" class="preview-pane__state preview-pane__state--error">{{ error }}</div>
      <iframe
        v-else-if="type === 'pdf' && url"
        class="preview-pane__frame"
        :src="url"
        title="file-preview"
      ></iframe>
      <div v-else-if="type === 'docx'" class="preview-pane__docx" v-html="content"></div>
      <div v-else-if="type === 'html'" class="preview-pane__html" v-html="content"></div>
      <pre v-else class="preview-pane__content">{{ content }}</pre>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  title: {
    type: String,
    default: '',
  },
  type: {
    type: String,
    default: 'text',
  },
  url: {
    type: String,
    default: '',
  },
  content: {
    type: String,
    default: '',
  },
  loading: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: '',
  },
  empty: {
    type: Boolean,
    default: false,
  },
})
</script>

<style scoped>
.preview-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
}

.preview-pane__header h3 {
  margin: 0;
  font-size: 1rem;
}

.preview-pane__body {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
}

.preview-pane__state {
  color: #475569;
}

.preview-pane__state--error {
  color: #dc2626;
}

.preview-pane__empty {
  height: 100%;
  border: 1px dashed #cbd5f5;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #475569;
  gap: 0.4rem;
  padding: 1rem;
}

.preview-pane__empty-title {
  font-weight: 600;
}

.preview-pane__empty-subtitle {
  font-size: 0.9rem;
}

.preview-pane__frame {
  width: 100%;
  height: 100%;
  border: none;
  min-height: 0;
}

.preview-pane__content {
  margin: 0;
  white-space: pre-wrap;
  font-family: 'SFMono-Regular', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    'Liberation Mono', 'Courier New', monospace;
  font-size: 0.9rem;
  color: #0f172a;
}

.preview-pane__html {
  color: #0f172a;
  line-height: 1.6;
}

.preview-pane__docx {
  font-family: 'Inter', 'Noto Sans TC', system-ui, sans-serif;
  color: #0f172a;
  line-height: 1.7;
}

.preview-pane__docx :deep(p) {
  margin: 0 0 0.9rem;
}

.preview-pane__docx :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 1rem;
}

.preview-pane__docx :deep(th),
.preview-pane__docx :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 0.4rem 0.6rem;
}

.preview-pane__docx :deep(ul),
.preview-pane__docx :deep(ol) {
  padding-left: 1.2rem;
  margin: 0 0 0.9rem;
}
</style>
