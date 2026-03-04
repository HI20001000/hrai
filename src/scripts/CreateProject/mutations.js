export const updateProjectName = async (connection, { projectId, name }) => {
  await connection.query(`UPDATE projects SET name = ? WHERE id = ?`, [name, projectId])
}

export const updateProductName = async (connection, { productId, name }) => {
  await connection.query(`UPDATE products SET name = ? WHERE id = ?`, [name, productId])
}

export const updateTaskFields = async (connection, { taskId, title, statusId, assigneeUserId }) => {
  const updates = []
  const values = []
  if (title !== undefined) {
    updates.push('title = ?')
    values.push(title)
  }
  if (statusId !== undefined) {
    updates.push('current_status = ?')
    updates.push('status_id = ?')
    values.push(String(statusId ?? ''))
    values.push(statusId)
  }
  if (assigneeUserId !== undefined) {
    updates.push('assignee_user_id = ?')
    values.push(assigneeUserId)
  }
  if (updates.length === 0) return
  values.push(taskId)
  await connection.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, values)
}

export const deleteProjectTree = async (connection, { projectId }) => {
  const [productRows] = await connection.query(`SELECT id FROM products WHERE project_id = ?`, [
    projectId,
  ])
  const productIds = productRows.map((row) => row.id)
  if (productIds.length > 0) {
    const [taskRows] = await connection.query(
      `SELECT id FROM tasks WHERE product_id IN (${productIds.map(() => '?').join(',')})`,
      productIds
    )
    const taskIds = taskRows.map((row) => row.id)
    if (taskIds.length > 0) {
      await connection.query(
        `DELETE FROM task_steps WHERE task_id IN (${taskIds.map(() => '?').join(',')})`,
        taskIds
      )
      await connection.query(
        `DELETE FROM tasks WHERE id IN (${taskIds.map(() => '?').join(',')})`,
        taskIds
      )
    }
    await connection.query(
      `DELETE FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`,
      productIds
    )
  }
  await connection.query(`DELETE FROM projects WHERE id = ?`, [projectId])
}

export const deleteProductTree = async (connection, { productId }) => {
  const [taskRows] = await connection.query(`SELECT id FROM tasks WHERE product_id = ?`, [productId])
  const taskIds = taskRows.map((row) => row.id)
  if (taskIds.length > 0) {
    await connection.query(
      `DELETE FROM task_steps WHERE task_id IN (${taskIds.map(() => '?').join(',')})`,
      taskIds
    )
    await connection.query(
      `DELETE FROM tasks WHERE id IN (${taskIds.map(() => '?').join(',')})`,
      taskIds
    )
  }
  await connection.query(`DELETE FROM products WHERE id = ?`, [productId])
}

export const deleteTaskTree = async (connection, { taskId }) => {
  await connection.query(`DELETE FROM task_steps WHERE task_id = ?`, [taskId])
  await connection.query(`DELETE FROM tasks WHERE id = ?`, [taskId])
}
