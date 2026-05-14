<script setup>
import { computed } from 'vue'
import {
  formatWeightPercent,
  normalizeDimensionEvaluationsForDisplay,
} from '../scripts/jobScoring.js'

const props = defineProps({
  evaluations: {
    type: Array,
    default: () => [],
  },
})

const rows = computed(() => normalizeDimensionEvaluationsForDisplay(props.evaluations))
</script>

<template>
  <div v-if="rows.length" class="dimension-breakdown">
    <table>
      <thead>
        <tr>
          <th>維度</th>
          <th>權重</th>
          <th>等級</th>
          <th>分值</th>
          <th>證據</th>
          <th>缺口</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.dimensionKey">
          <th>{{ row.dimensionLabel }}</th>
          <td>{{ formatWeightPercent(row.weight) }}</td>
          <td>
            <span class="level-pill" :class="`level-${row.level}`">{{ row.levelLabel }}</span>
          </td>
          <td>{{ row.levelScore }}</td>
          <td>{{ row.evidence || '--' }}</td>
          <td>{{ row.gap || '--' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.dimension-breakdown {
  overflow: auto;
  margin-top: 0.65rem;
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
}

.dimension-breakdown table {
  width: 100%;
  min-width: 780px;
  border-collapse: collapse;
  background: rgba(255, 255, 255, 0.7);
}

.dimension-breakdown th,
.dimension-breakdown td {
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
  vertical-align: top;
}

.dimension-breakdown thead th {
  background: rgba(241, 245, 249, 0.84);
  color: var(--text-strong);
}

.dimension-breakdown tbody th {
  color: var(--text-strong);
  white-space: nowrap;
}

.level-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.4rem;
  padding: 0.18rem 0.45rem;
  border-radius: 999px;
  font-weight: 700;
  font-size: 0.78rem;
}

.level-high {
  color: #047857;
  background: rgba(16, 185, 129, 0.14);
}

.level-medium {
  color: #1d4ed8;
  background: rgba(59, 130, 246, 0.14);
}

.level-low {
  color: #b91c1c;
  background: rgba(248, 113, 113, 0.16);
}
</style>
