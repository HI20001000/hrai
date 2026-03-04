export const fetchTaskStepsByTaskId = async (connection, taskId) => {
  const [rows] = await connection.query(
    `SELECT id, task_id, status, status_id, content, assignee_user_id, created_by, created_at
     FROM task_steps
     WHERE task_id = ?
     ORDER BY created_at ASC`,
    [taskId]
  )
  return rows
}

export const createTaskStep = async (
  connection,
  { taskId, content, createdBy, assigneeUserId, statusId }
) => {
  const [result] = await connection.query(
    `INSERT INTO task_steps (task_id, status, status_id, content, created_by, assignee_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [taskId, String(statusId ?? ''), statusId, content, createdBy, assigneeUserId]
  )
  const [rows] = await connection.query(
    `SELECT id, task_id, status, content, assignee_user_id, created_by, created_at
     FROM task_steps
     WHERE id = ?`,
    [result.insertId]
  )
  return rows[0]
}

export const updateTaskStepStatus = async (connection, { stepId, statusId, statusName }) => {
  await connection.query(`UPDATE task_steps SET status_id = ?, status = ? WHERE id = ?`, [
    statusId,
    statusName,
    stepId,
  ])
  const [rows] = await connection.query(
    `SELECT id, task_id, status, status_id, content, assignee_user_id, created_by, created_at
     FROM task_steps
     WHERE id = ?`,
    [stepId]
  )
  return rows[0]
}
