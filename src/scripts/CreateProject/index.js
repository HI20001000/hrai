export { getConnection } from './dbClient.js'
export { createProject, fetchProjects } from './projects.js'
export { createProduct, fetchProducts } from './products.js'
export { createTask, fetchTasksWithParents } from './tasks.js'
export { createTaskStep, fetchTaskStepsByTaskId, updateTaskStepStatus } from './taskSteps.js'
export { createStatus, fetchStatuses, getDefaultStatusId } from './statuses.js'
export {
  deleteProductTree,
  deleteProjectTree,
  deleteTaskTree,
  updateProductName,
  updateProjectName,
  updateTaskFields,
} from './mutations.js'
export {
  buildProjectTreeRows,
  createProjectNode,
  createProductNode,
  createTaskNode,
} from './treeService.js'
