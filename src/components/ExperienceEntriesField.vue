<script setup>
import { computed } from 'vue'
import {
  EXTRACTED_EMPTY_TEXT,
  createEmptyExperienceItem,
  normalizeExperienceHighlights,
  normalizeExperienceItems,
  normalizeText,
} from '../scripts/cvExtractedEditor.js'

const props = defineProps({
  modelValue: {
    type: Array,
    default: () => [],
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  entryLabel: {
    type: String,
    default: '經驗',
  },
})

const emit = defineEmits(['update:modelValue'])

const cloneEditableEntries = (value) => {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      companyName: normalizeText(entry.companyName),
      roleTitle: normalizeText(entry.roleTitle),
      durationText: normalizeText(entry.durationText),
      highlights: normalizeExperienceHighlights(entry.highlights),
    }))
}

const entries = computed(() =>
  props.readonly ? normalizeExperienceItems(props.modelValue) : cloneEditableEntries(props.modelValue)
)

const updateEntries = (nextEntries) => {
  emit('update:modelValue', cloneEditableEntries(nextEntries))
}

const addEntry = () => {
  if (props.readonly) return
  updateEntries([...entries.value, createEmptyExperienceItem()])
}

const removeEntry = (index) => {
  if (props.readonly) return
  updateEntries(entries.value.filter((_, entryIndex) => entryIndex !== index))
}

const updateEntryField = (index, fieldKey, value) => {
  if (props.readonly) return
  const nextEntries = cloneEditableEntries(entries.value)
  const target = nextEntries[index]
  if (!target) return

  if (fieldKey === 'highlights') {
    target.highlights = normalizeExperienceHighlights(value)
  } else {
    target[fieldKey] = normalizeText(value)
  }

  emit('update:modelValue', nextEntries)
}
</script>

<template>
  <div class="experience-entries-field">
    <div v-if="!readonly" class="experience-toolbar">
      <button type="button" class="secondary-btn small-btn" @click="addEntry">
        新增{{ entryLabel }}
      </button>
    </div>

    <p v-if="!entries.length" class="empty-text">{{ EXTRACTED_EMPTY_TEXT }}</p>

    <article
      v-for="(entry, index) in entries"
      :key="`${entryLabel}-${index}`"
      class="experience-card"
    >
      <div class="experience-card-header">
        <strong>{{ entryLabel }} {{ index + 1 }}</strong>
        <button
          v-if="!readonly"
          type="button"
          class="ghost-btn danger-text"
          @click="removeEntry(index)"
        >
          刪除此筆
        </button>
      </div>

      <div v-if="readonly" class="experience-copy">
        <div class="experience-main-row">
          <p class="experience-title-text">
            {{ [entry.companyName, entry.roleTitle].filter(Boolean).join('｜') || EXTRACTED_EMPTY_TEXT }}
          </p>
          <p class="experience-duration-text">{{ entry.durationText || EXTRACTED_EMPTY_TEXT }}</p>
        </div>
        <p>
          <span>內容：</span>
          {{ entry.highlights.length ? entry.highlights.join('；') : EXTRACTED_EMPTY_TEXT }}
        </p>
      </div>

      <div v-else class="experience-form">
        <div class="experience-grid">
          <label class="experience-field">
            <span>公司名稱</span>
            <input
              :value="entry.companyName"
              type="text"
              class="edit-input"
              placeholder="請輸入公司名稱"
              @input="updateEntryField(index, 'companyName', $event.target.value)"
            />
          </label>
          <label class="experience-field">
            <span>職稱</span>
            <input
              :value="entry.roleTitle"
              type="text"
              class="edit-input"
              placeholder="請輸入職稱"
              @input="updateEntryField(index, 'roleTitle', $event.target.value)"
            />
          </label>
          <label class="experience-field">
            <span>任職時段</span>
            <input
              :value="entry.durationText"
              type="text"
              class="edit-input"
              placeholder="請輸入原文時段"
              @input="updateEntryField(index, 'durationText', $event.target.value)"
            />
          </label>
        </div>
        <label class="experience-field">
          <span>內容</span>
          <textarea
            :value="entry.highlights.join('\n')"
            rows="4"
            class="edit-input"
            placeholder="一行一條職責、成果或工作內容"
            @input="updateEntryField(index, 'highlights', $event.target.value)"
          ></textarea>
        </label>
      </div>
    </article>
  </div>
</template>

<style scoped>
.experience-entries-field {
  display: grid;
  gap: 0.85rem;
}

.experience-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.small-btn {
  padding: 0.45rem 0.8rem;
}

.empty-text {
  margin: 0;
  color: var(--text-muted);
}

.experience-card {
  display: grid;
  gap: 0.8rem;
  padding: 0.9rem;
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.78);
}

.experience-card-header,
.experience-main-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.85rem;
}

.experience-copy,
.experience-form {
  display: grid;
  gap: 0.65rem;
}

.experience-copy p {
  margin: 0;
  color: var(--text-base);
  white-space: pre-wrap;
  word-break: break-word;
}

.experience-copy span,
.experience-field span {
  font-weight: 600;
}

.experience-title-text {
  flex: 1 1 auto;
  font-weight: 600;
}

.experience-duration-text {
  flex: none;
  color: var(--text-muted);
  white-space: nowrap;
  text-align: right;
}

.experience-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.experience-field {
  display: grid;
  gap: 0.35rem;
}

.danger-text {
  color: var(--danger);
}

@media (max-width: 860px) {
  .experience-grid {
    grid-template-columns: 1fr;
  }

  .experience-card-header,
  .experience-main-row {
    flex-direction: column;
  }

  .experience-duration-text {
    white-space: normal;
    text-align: left;
  }
}
</style>
