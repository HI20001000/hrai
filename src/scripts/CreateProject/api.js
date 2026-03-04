import { apiBaseUrl } from '../apiBaseUrl.js'

export const fetchProjectTree = async ({ q, status, assignee, includeEmpty } = {}) => {
  const response = await fetch(`${apiBaseUrl}/api/create-project/tree`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q, status, assignee, includeEmpty }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error?.message || 'Failed to load project tree')
  }

  return response.json()
}

export const fetchTaskSteps = async (taskId) => {
  const response = await fetch(`${apiBaseUrl}/api/create-project/task-steps`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ taskId }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error?.message || 'Failed to load task steps')
  }

  return response.json()
}

export const createTaskStep = async ({
  taskId,
  content,
  created_by,
  assignee_user_id,
  status_id,
}) => {
  return requestJson(`${apiBaseUrl}/api/create-project/task-step`, {
    taskId,
    content,
    created_by,
    assignee_user_id,
    status_id,
  })
}

export const updateRow = async ({ rowType, id, name, status, status_id, assignee_user_id }) => {
  return requestJson(`${apiBaseUrl}/api/create-project/update-row`, {
    rowType,
    id,
    name,
    status,
    status_id,
    assignee_user_id,
  })
}

export const updateTaskStepStatus = async ({ stepId, status_id }) => {
  return requestJson(`${apiBaseUrl}/api/create-project/task-step-status`, {
    stepId,
    status_id,
  })
}

export const deleteRow = async ({ rowType, id }) => {
  return requestJson(`${apiBaseUrl}/api/create-project/delete-row`, {
    rowType,
    id,
  })
}

const requestJson = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error?.message || 'Request failed')
  }

  return response.json()
}

export const createProject = async ({ name, owner_mail, q, status, assignee, includeEmpty }) => {
  return requestJson(`${apiBaseUrl}/api/create-project/project`, {
    name,
    owner_mail,
    q,
    status,
    assignee,
    includeEmpty,
  })
}

export const createProduct = async ({
  projectId,
  name,
  created_by,
  q,
  status,
  assignee,
  includeEmpty,
}) => {
  return requestJson(`${apiBaseUrl}/api/create-project/product`, {
    projectId,
    name,
    created_by,
    q,
    status,
    assignee,
    includeEmpty,
  })
}

export const createTask = async ({
  productId,
  title,
  status_id,
  created_by,
  assignee_user_id,
  q,
  status,
  assignee,
  includeEmpty,
}) => {
  return requestJson(`${apiBaseUrl}/api/create-project/task`, {
    productId,
    title,
    status_id,
    created_by,
    assignee_user_id,
    q,
    status,
    assignee,
    includeEmpty,
  })
}

export const fetchStatuses = async () => {
  const response = await fetch(`${apiBaseUrl}/api/create-project/statuses`)
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error?.message || 'Failed to load statuses')
  }
  return response.json()
}

export const createStatus = async ({ name, color }) => {
  return requestJson(`${apiBaseUrl}/api/create-project/status`, { name, color })
}

export const fetchUsers = async () => {
  const response = await fetch(`${apiBaseUrl}/api/users`)
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error?.message || 'Failed to load users')
  }
  return response.json()
}
