<script setup>
import { computed } from 'vue'
import {
  createEmptyProjectExperienceGroup,
  createEmptyProjectExperienceItem,
  computeProjectDurationMonths,
  EXTRACTED_EMPTY_TEXT,
  formatProjectDurationDisplay,
  formatProjectDurationMonthsLabel,
  normalizeProjectExperiences,
  normalizeProjectSkills,
  normalizeText,
  PROJECT_GROUP_NAME,
} from '../scripts/cvExtractedEditor.js'

const props = defineProps({
  modelValue: {
    type: Array,
    default: () => [],
  },
  legacyText: {
    type: String,
    default: '',
  },
  readonly: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue'])

const cloneEditableGroups = (value) => {
  if (!Array.isArray(value)) return []
  return value
    .filter((group) => group && typeof group === 'object' && !Array.isArray(group))
    .map((group) => {
      const rawType = normalizeText(group.groupType).toLowerCase()
      const groupType = rawType === 'internship'
        ? 'internship'
        : rawType === 'project' || rawType === 'personal' || normalizeText(group.companyName) === '個人項目'
          ? 'project'
          : 'company'
      return {
        groupType,
        companyName: groupType === 'project' ? PROJECT_GROUP_NAME : normalizeText(group.companyName),
        projects: Array.isArray(group.projects) && group.projects.length
          ? group.projects.map((project) => ({
            projectName: normalizeText(project?.projectName),
            skills: normalizeProjectSkills(project?.skills),
            durationText: normalizeText(project?.durationText),
            durationMonths: Number(project?.durationMonths || 0) > 0
              ? Math.round(Number(project.durationMonths))
              : computeProjectDurationMonths(project?.durationText),
          }))
          : [createEmptyProjectExperienceItem()],
      }
    })
}

const groups = computed(() => (props.readonly ? normalizeProjectExperiences(props.modelValue) : cloneEditableGroups(props.modelValue)))
const hasProjectGroup = computed(() => groups.value.some((group) => group.groupType === 'project'))

const getGroupTypeLabel = (groupType) => {
  if (groupType === 'internship') return '實習'
  if (groupType === 'project') return '專案'
  return '公司'
}

const updateGroups = (nextGroups) => {
  emit('update:modelValue', cloneEditableGroups(nextGroups))
}

const addGroup = (groupType) => {
  if (props.readonly) return
  if (groupType === 'project' && hasProjectGroup.value) return
  updateGroups([...groups.value, createEmptyProjectExperienceGroup(groupType)])
}

const removeGroup = (groupIndex) => {
  if (props.readonly) return
  updateGroups(groups.value.filter((_, index) => index !== groupIndex))
}

const updateCompanyName = (groupIndex, value) => {
  if (props.readonly) return
  const nextGroups = cloneEditableGroups(groups.value)
  const target = nextGroups[groupIndex]
  if (!target || target.groupType === 'project') return
  target.companyName = normalizeText(value)
  updateGroups(nextGroups)
}

const addProject = (groupIndex) => {
  if (props.readonly) return
  const nextGroups = cloneEditableGroups(groups.value)
  const target = nextGroups[groupIndex]
  if (!target) return
  target.projects.push(createEmptyProjectExperienceItem())
  emit('update:modelValue', nextGroups)
}

const removeProject = (groupIndex, projectIndex) => {
  if (props.readonly) return
  const nextGroups = cloneEditableGroups(groups.value)
  const target = nextGroups[groupIndex]
  if (!target) return
  target.projects = target.projects.filter((_, index) => index !== projectIndex)
  emit('update:modelValue', nextGroups)
}

const updateProjectField = (groupIndex, projectIndex, fieldKey, value) => {
  if (props.readonly) return
  const nextGroups = cloneEditableGroups(groups.value)
  const targetGroup = nextGroups[groupIndex]
  const targetProject = targetGroup?.projects?.[projectIndex]
  if (!targetProject) return

  if (fieldKey === 'skills') {
    targetProject.skills = normalizeProjectSkills(value)
  } else if (fieldKey === 'durationText') {
    const durationText = normalizeText(value)
    targetProject.durationText = durationText
    targetProject.durationMonths = computeProjectDurationMonths(durationText)
  } else {
    targetProject[fieldKey] = normalizeText(value)
  }

  emit('update:modelValue', nextGroups)
}
</script>

<template>
  <div class="project-experiences-field">
    <div v-if="!readonly" class="project-toolbar">
      <button type="button" class="secondary-btn small-btn" @click="addGroup('company')">新增公司</button>
      <button type="button" class="secondary-btn small-btn" @click="addGroup('internship')">新增實習</button>
      <button
        type="button"
        class="secondary-btn small-btn"
        :disabled="hasProjectGroup"
        @click="addGroup('project')"
      >
        新增專案
      </button>
    </div>

    <div v-if="legacyText && !groups.length" class="legacy-note">
      <p>舊版文字參考</p>
      <pre>{{ legacyText }}</pre>
    </div>

    <p v-if="!groups.length && !legacyText" class="empty-text">{{ EXTRACTED_EMPTY_TEXT }}</p>

    <div v-for="(group, groupIndex) in groups" :key="`${group.groupType}-${groupIndex}`" class="group-card">
      <div class="group-header">
        <div class="group-title-wrap">
          <span class="group-badge">{{ getGroupTypeLabel(group.groupType) }}</span>
          <template v-if="readonly || group.groupType === 'project'">
            <strong>{{ group.companyName || PROJECT_GROUP_NAME }}</strong>
          </template>
          <input
            v-else
            :value="group.companyName"
            type="text"
            class="group-name-input"
            :placeholder="group.groupType === 'internship' ? '請輸入實習公司名稱' : '請輸入公司名稱'"
            @input="updateCompanyName(groupIndex, $event.target.value)"
          />
        </div>
        <button v-if="!readonly" type="button" class="ghost-btn danger-text" @click="removeGroup(groupIndex)">
          刪除此組
        </button>
      </div>

      <div class="project-list">
        <article
          v-for="(project, projectIndex) in group.projects"
          :key="`${groupIndex}-${projectIndex}`"
          class="project-card"
        >
          <div class="project-card-header">
            <strong>專案 {{ projectIndex + 1 }}</strong>
            <button v-if="!readonly" type="button" class="ghost-btn danger-text" @click="removeProject(groupIndex, projectIndex)">
              刪除專案
            </button>
          </div>

          <div v-if="readonly" class="project-copy">
            <div class="project-main-row">
              <p class="project-title-text">{{ project.projectName || EXTRACTED_EMPTY_TEXT }}</p>
              <p class="project-duration-text">{{ project.durationText ? formatProjectDurationDisplay(project.durationText) : EXTRACTED_EMPTY_TEXT }}</p>
            </div>
            <p><span>所用技能：</span>{{ project.skills.length ? project.skills.join('、') : EXTRACTED_EMPTY_TEXT }}</p>
          </div>

          <div v-else class="project-form">
            <div class="project-main-row editable">
              <label class="project-field project-title-field">
                <span>項目名稱</span>
                <input
                  :value="project.projectName"
                  type="text"
                  class="edit-input"
                  placeholder="請輸入項目名稱"
                  @input="updateProjectField(groupIndex, projectIndex, 'projectName', $event.target.value)"
                />
              </label>
              <label class="project-field project-duration-field">
                <span>項目時長</span>
                <input
                  :value="project.durationText"
                  type="text"
                  class="edit-input"
                  placeholder="請輸入原文時長"
                  @input="updateProjectField(groupIndex, projectIndex, 'durationText', $event.target.value)"
                />
                <small v-if="project.durationText" class="duration-hint">
                  {{ project.durationMonths ? `系統計算：${formatProjectDurationMonthsLabel(project.durationMonths)}` : '系統目前無法從這段時長計算月份' }}
                </small>
              </label>
            </div>
            <label class="project-field">
              <span>所用技能</span>
              <input
                :value="project.skills.join(', ')"
                type="text"
                class="edit-input"
                placeholder="請用逗號分隔技能"
                @input="updateProjectField(groupIndex, projectIndex, 'skills', $event.target.value)"
              />
            </label>
          </div>
        </article>
      </div>

      <button v-if="!readonly" type="button" class="ghost-btn add-project-btn" @click="addProject(groupIndex)">
        + 新增專案
      </button>
    </div>
  </div>
</template>

<style scoped>
.project-experiences-field {
  display: grid;
  gap: 0.85rem;
}

.project-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.small-btn {
  padding: 0.45rem 0.8rem;
}

.legacy-note,
.group-card {
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.78);
}

.legacy-note {
  padding: 0.85rem 0.95rem;
}

.legacy-note p,
.legacy-note pre {
  margin: 0;
}

.legacy-note pre {
  margin-top: 0.45rem;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-base);
}

.empty-text {
  margin: 0;
  color: var(--text-muted);
}

.group-card {
  padding: 0.9rem;
  display: grid;
  gap: 0.8rem;
}

.group-header,
.project-card-header,
.group-title-wrap {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  justify-content: space-between;
}

.group-title-wrap {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.group-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: rgba(47, 111, 237, 0.12);
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 700;
}

.group-name-input {
  min-width: min(280px, 100%);
  max-width: 100%;
}

.project-list {
  display: grid;
  gap: 0.75rem;
}

.project-card {
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 14px;
  padding: 0.8rem;
  background: rgba(248, 250, 252, 0.82);
}

.project-copy,
.project-form {
  display: grid;
  gap: 0.55rem;
  margin-top: 0.7rem;
}

.project-copy p {
  margin: 0;
  color: var(--text-base);
  white-space: pre-wrap;
  word-break: break-word;
}

.project-main-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.9rem;
}

.project-main-row.editable {
  align-items: stretch;
}

.project-title-text,
.project-duration-text {
  margin: 0;
  color: var(--text-base);
}

.project-title-text {
  flex: 1 1 auto;
  font-weight: 600;
}

.project-duration-text {
  flex: none;
  white-space: nowrap;
  color: var(--text-muted);
  text-align: right;
}

.project-copy span,
.project-field span {
  font-weight: 600;
}

.project-field {
  display: grid;
  gap: 0.35rem;
}

.project-title-field {
  flex: 1 1 auto;
}

.project-duration-field {
  flex: 0 0 210px;
}

.duration-hint {
  color: var(--text-muted);
  line-height: 1.4;
}

.danger-text {
  color: var(--danger);
}

.add-project-btn {
  justify-self: flex-start;
}

@media (max-width: 700px) {
  .group-header,
  .project-card-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .project-main-row {
    flex-direction: column;
  }

  .project-duration-text {
    text-align: left;
    white-space: normal;
  }

  .project-duration-field {
    flex-basis: auto;
    width: 100%;
  }
}
</style>
