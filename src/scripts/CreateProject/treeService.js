import { getConnection } from './dbClient.js'
import { createProject, fetchProjects } from './projects.js'
import { createProduct, fetchProducts } from './products.js'
import { createTask, fetchTasksWithParents } from './tasks.js'

const normalizeArray = (value) => {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

const upsertProject = (projectsById, projectOrder, projectData) => {
  if (projectsById.has(projectData.id)) return
  projectsById.set(projectData.id, projectData)
  projectOrder.push(projectData.id)
}

const upsertProduct = (productsById, productOrderByProject, productData) => {
  if (productsById.has(productData.id)) return
  productsById.set(productData.id, productData)
  if (!productOrderByProject.has(productData.parentId)) {
    productOrderByProject.set(productData.parentId, [])
  }
  productOrderByProject.get(productData.parentId).push(productData.id)
}

const upsertTask = (tasksById, taskOrderByProduct, taskData) => {
  if (tasksById.has(taskData.id)) return
  tasksById.set(taskData.id, taskData)
  if (!taskOrderByProduct.has(taskData.parentId)) {
    taskOrderByProduct.set(taskData.parentId, [])
  }
  taskOrderByProduct.get(taskData.parentId).push(taskData.id)
}

export const buildProjectTreeRows = async ({ q, status, assignee, includeEmpty = true } = {}) => {
  const connection = await getConnection()
  const statusFilters = normalizeArray(status)
  const assigneeFilters = normalizeArray(assignee)
  const keyword = q?.trim() || ''

  // 搜尋規則：命中父層（project/product）時會包含其全部子層，再套用任務層級的狀態/負責人篩選。
  const taskRecords = await fetchTasksWithParents(connection, {
    q: keyword,
    status: statusFilters,
    assignee: assigneeFilters,
  })

  const projectsById = new Map()
  const productsById = new Map()
  const tasksById = new Map()
  const projectOrder = []
  const productOrderByProject = new Map()
  const taskOrderByProduct = new Map()

  taskRecords.forEach((record) => {
    upsertProject(projectsById, projectOrder, {
      rowType: 'project',
      id: record.project_id,
      parentId: null,
      level: 0,
      name: record.project_name,
      status: '-',
      assignee_user_id: '-',
      created_at: record.project_created_at,
      updated_at: record.project_updated_at,
      hasChildren: true,
    })

    upsertProduct(productsById, productOrderByProject, {
      rowType: 'product',
      id: record.product_id,
      parentId: record.project_id,
      level: 1,
      name: record.product_name,
      status: '-',
      assignee_user_id: '-',
      created_at: record.product_created_at,
      updated_at: record.product_updated_at,
      hasChildren: true,
    })

    upsertTask(tasksById, taskOrderByProduct, {
      rowType: 'task',
      id: record.task_id,
      parentId: record.product_id,
      level: 2,
      name: record.task_title,
      status: record.status_name || record.current_status || '-',
      status_id: record.status_id ?? null,
      status_color: record.status_color || '#e2e8f0',
      assignee_user_id: record.assignee_user_id ?? '-',
      created_at: record.task_created_at,
      updated_at: record.task_updated_at,
      hasChildren: false,
    })
  })

  if (includeEmpty) {
    const projectRecords = await fetchProjects(connection, { q: keyword || undefined })
    projectRecords.forEach((project) => {
      upsertProject(projectsById, projectOrder, {
        rowType: 'project',
        id: project.id,
        parentId: null,
        level: 0,
        name: project.name,
        status: '-',
        assignee_user_id: '-',
        created_at: project.created_at,
        updated_at: project.updated_at,
        hasChildren: false,
      })
    })

    const productRecords = await fetchProducts(connection, { q: keyword || undefined })
    productRecords.forEach((product) => {
      upsertProject(projectsById, projectOrder, {
        rowType: 'project',
        id: product.project_id,
        parentId: null,
        level: 0,
        name: product.project_name,
        status: '-',
        assignee_user_id: '-',
        created_at: product.project_created_at,
        updated_at: product.project_updated_at,
        hasChildren: true,
      })

      upsertProduct(productsById, productOrderByProject, {
        rowType: 'product',
        id: product.id,
        parentId: product.project_id,
        level: 1,
        name: product.name,
        status: '-',
        assignee_user_id: '-',
        created_at: product.created_at,
        updated_at: product.updated_at,
        hasChildren: false,
      })
    })
  }

  const rows = []

  projectOrder.forEach((projectId) => {
    const project = projectsById.get(projectId)
    if (!project) return
    const productIds = productOrderByProject.get(projectId) || []
    project.hasChildren = productIds.length > 0
    rows.push(project)

    productIds.forEach((productId) => {
      const product = productsById.get(productId)
      if (!product) return
      const taskIds = taskOrderByProduct.get(productId) || []
      product.hasChildren = taskIds.length > 0
      rows.push(product)

      taskIds.forEach((taskId) => {
        const task = tasksById.get(taskId)
        if (task) rows.push(task)
      })
    })
  })

  return { rows, taskCount: tasksById.size }
}

export const createProjectNode = async ({ name, ownerMail, q, status, assignee, includeEmpty }) => {
  const connection = await getConnection()
  await createProject(connection, { name, ownerMail })
  return buildProjectTreeRows({ q, status, assignee, includeEmpty })
}

export const createProductNode = async ({
  projectId,
  name,
  createdBy,
  q,
  status,
  assignee,
  includeEmpty,
}) => {
  const connection = await getConnection()
  await createProduct(connection, { projectId, name, createdBy })
  return buildProjectTreeRows({ q, status, assignee, includeEmpty })
}

export const createTaskNode = async ({
  productId,
  title,
  statusId,
  createdBy,
  assigneeUserId,
  q,
  status,
  assignee,
  includeEmpty,
}) => {
  const connection = await getConnection()
  await createTask(connection, {
    productId,
    title,
    statusId,
    createdBy,
    assigneeUserId,
  })
  return buildProjectTreeRows({ q, status, assignee, includeEmpty })
}
