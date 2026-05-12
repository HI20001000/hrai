<script setup>
import { computed } from 'vue'
import ExperienceEntriesField from './ExperienceEntriesField.vue'
import ProjectExperiencesField from './ProjectExperiencesField.vue'
import { buildExtractedPreviewData, EXTRACTED_EMPTY_TEXT } from '../scripts/cvExtractedEditor.js'

const props = defineProps({
  content: { type: String, default: '' },
  extracted: { type: Object, default: () => ({}) },
  parser: { type: String, default: '' },
  missingFields: { type: Array, default: () => [] },
})

const previewData = computed(() =>
  buildExtractedPreviewData({
    content: props.content,
    extracted: props.extracted,
    parser: props.parser,
    missingFields: props.missingFields,
  })
)

const basicRows = computed(() => previewData.value.basicRows || [])
const dimensionRows = computed(() => previewData.value.dimensionRows || [])
const workExperienceField = computed(() => previewData.value.workExperienceField || null)
const internshipExperienceField = computed(() => previewData.value.internshipExperienceField || null)
const projectExperienceField = computed(() => previewData.value.projectExperienceField || null)
</script>

<template>
  <div class="extracted-preview">
    <section class="preview-section">
      <h4>基本資料</h4>
      <table class="structured-table">
        <tbody>
          <tr v-for="row in basicRows" :key="`basic-${row.label}`">
            <th>{{ row.label }}</th>
            <td :class="{ 'is-empty': row.value === EXTRACTED_EMPTY_TEXT }">{{ row.value }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="preview-section">
      <h4>關鍵維度</h4>
      <table class="structured-table">
        <tbody>
          <tr v-for="row in dimensionRows" :key="`dim-${row.label}`">
            <th>{{ row.label }}</th>
            <td :class="{ 'is-empty': row.value === EXTRACTED_EMPTY_TEXT }">{{ row.value }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="workExperienceField" class="preview-section">
      <h4>工作經驗</h4>
      <div class="project-section">
        <ExperienceEntriesField
          :model-value="workExperienceField?.rawValue || []"
          entry-label="工作經驗"
          readonly
        />
      </div>
    </section>

    <section v-if="internshipExperienceField" class="preview-section">
      <h4>實習經驗</h4>
      <div class="project-section">
        <ExperienceEntriesField
          :model-value="internshipExperienceField?.rawValue || []"
          entry-label="實習經驗"
          readonly
        />
      </div>
    </section>

    <section v-if="projectExperienceField" class="preview-section">
      <h4>專案經歷</h4>
      <div class="project-section">
        <ProjectExperiencesField
          :model-value="projectExperienceField.rawValue || []"
          :legacy-text="projectExperienceField.legacyText || ''"
          readonly
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.extracted-preview {
  display: grid;
  gap: 0.9rem;
}

.preview-section {
  overflow: hidden;
  background: rgba(255, 255, 255, 0.72);
}

.preview-section h4 {
  margin: 0;
  padding: 0.88rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
  background: rgba(244, 248, 252, 0.86);
  color: var(--text-strong);
  font-size: 0.92rem;
}

.project-section {
  padding: 0.95rem 1rem 1rem;
}

.structured-table th {
  width: 150px;
}

.structured-table td.is-empty {
  color: var(--danger);
  font-weight: 600;
}

@media (max-width: 700px) {
  .structured-table th {
    width: 110px;
  }
}
</style>
