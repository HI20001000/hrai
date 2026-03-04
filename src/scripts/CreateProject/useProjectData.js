import { computed, ref } from 'vue'
import { sampleProjects } from './data.js'
import { flattenProjects } from './flatten.js'

export const useProjectData = () => {
  const searchText = ref('')
  const rows = ref(flattenProjects(sampleProjects))
  const activeTask = ref(null)
  const expandedIds = ref(new Set())

  const filteredRows = computed(() => {
    const keyword = searchText.value.trim().toLowerCase()
    const baseRows = keyword
      ? rows.value.filter((row) => row.name.toLowerCase().includes(keyword))
      : rows.value

    if (keyword) return baseRows

    const visible = []
    const byParent = new Map()

    baseRows.forEach((row) => {
      const key = row.parentId || 'root'
      if (!byParent.has(key)) byParent.set(key, [])
      byParent.get(key).push(row)
    })

    const walk = (parentKey) => {
      const children = byParent.get(parentKey) || []
      children.forEach((child) => {
        visible.push(child)
        if (expandedIds.value.has(child.id)) {
          walk(child.id)
        }
      })
    }

    walk('root')
    return visible
  })

  const totalTasks = computed(
    () => rows.value.filter((row) => row.type === 'task').length
  )

  const openTaskSteps = (taskRow) => {
    if (!taskRow || taskRow.type !== 'task') return
    activeTask.value = taskRow.source
  }

  const toggleExpanded = (row) => {
    if (!row || row.type === 'task') return
    const next = new Set(expandedIds.value)
    if (next.has(row.id)) {
      next.delete(row.id)
    } else {
      next.add(row.id)
    }
    expandedIds.value = next
  }

  const closeTaskSteps = () => {
    activeTask.value = null
  }

  return {
    searchText,
    filteredRows,
    totalTasks,
    activeTask,
    openTaskSteps,
    closeTaskSteps,
    toggleExpanded,
    expandedIds,
  }
}
