import mysql from 'mysql2/promise'

const {
  MYSQL_HOST = 'localhost',
  MYSQL_PORT = '3306',
  MYSQL_USER = 'root',
  MYSQL_PASSWORD = '12345',
  MYSQL_DATABASE = 'aisql',
} = process.env

const createConnection = async () => {
  return mysql.createConnection({
    host: MYSQL_HOST,
    port: Number(MYSQL_PORT),
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
  })
}

const ensureExists = async (connection, table, idColumn, id) => {
  const [rows] = await connection.query(
    `SELECT ${idColumn} AS id FROM ${table} WHERE ${idColumn} = ? LIMIT 1`,
    [id]
  )
  return rows.length > 0
}

const selectIds = async (connection, sql, params) => {
  const [rows] = await connection.query(sql, params)
  return rows.map((row) => row.id)
}

const deleteByIds = async (connection, table, idColumn, ids) => {
  if (ids.length === 0) return 0
  const placeholders = ids.map(() => '?').join(',')
  const [result] = await connection.query(
    `DELETE FROM ${table} WHERE ${idColumn} IN (${placeholders})`,
    ids
  )
  return result.affectedRows || 0
}

const deleteProjectHard = async (connection, projectId) => {
  const productIds = await selectIds(
    connection,
    `SELECT id FROM products WHERE project_id = ?`,
    [projectId]
  )
  const taskIds =
    productIds.length > 0
      ? await selectIds(
          connection,
          `SELECT id FROM tasks WHERE product_id IN (${productIds.map(() => '?').join(',')})`,
          productIds
        )
      : []

  const deletedTaskSteps = await deleteByIds(connection, 'task_steps', 'task_id', taskIds)
  const deletedTasks = await deleteByIds(connection, 'tasks', 'id', taskIds)
  const deletedProducts = await deleteByIds(connection, 'products', 'id', productIds)
  const [projectResult] = await connection.query(`DELETE FROM projects WHERE id = ?`, [projectId])

  return {
    projects: projectResult.affectedRows || 0,
    products: deletedProducts,
    tasks: deletedTasks,
    task_steps: deletedTaskSteps,
  }
}

const deleteProductHard = async (connection, productId) => {
  const taskIds = await selectIds(connection, `SELECT id FROM tasks WHERE product_id = ?`, [productId])
  const deletedTaskSteps = await deleteByIds(connection, 'task_steps', 'task_id', taskIds)
  const deletedTasks = await deleteByIds(connection, 'tasks', 'id', taskIds)
  const [productResult] = await connection.query(`DELETE FROM products WHERE id = ?`, [productId])

  return {
    projects: 0,
    products: productResult.affectedRows || 0,
    tasks: deletedTasks,
    task_steps: deletedTaskSteps,
  }
}

const deleteTaskHard = async (connection, taskId) => {
  const deletedTaskSteps = await deleteByIds(connection, 'task_steps', 'task_id', [taskId])
  const [taskResult] = await connection.query(`DELETE FROM tasks WHERE id = ?`, [taskId])
  return {
    projects: 0,
    products: 0,
    tasks: taskResult.affectedRows || 0,
    task_steps: deletedTaskSteps,
  }
}

const softDeleteByIds = async (connection, table, idColumn, ids) => {
  if (ids.length === 0) return 0
  const placeholders = ids.map(() => '?').join(',')
  const [result] = await connection.query(
    `UPDATE ${table} SET deleted_at = NOW() WHERE ${idColumn} IN (${placeholders})`,
    ids
  )
  return result.affectedRows || 0
}

const softDeleteProject = async (connection, projectId) => {
  const productIds = await selectIds(
    connection,
    `SELECT id FROM products WHERE project_id = ?`,
    [projectId]
  )
  const taskIds =
    productIds.length > 0
      ? await selectIds(
          connection,
          `SELECT id FROM tasks WHERE product_id IN (${productIds.map(() => '?').join(',')})`,
          productIds
        )
      : []

  const deletedTaskSteps = await softDeleteByIds(connection, 'task_steps', 'task_id', taskIds)
  const deletedTasks = await softDeleteByIds(connection, 'tasks', 'id', taskIds)
  const deletedProducts = await softDeleteByIds(connection, 'products', 'id', productIds)
  const [projectResult] = await connection.query(
    `UPDATE projects SET deleted_at = NOW() WHERE id = ?`,
    [projectId]
  )

  return {
    projects: projectResult.affectedRows || 0,
    products: deletedProducts,
    tasks: deletedTasks,
    task_steps: deletedTaskSteps,
  }
}

const softDeleteProduct = async (connection, productId) => {
  const taskIds = await selectIds(connection, `SELECT id FROM tasks WHERE product_id = ?`, [productId])
  const deletedTaskSteps = await softDeleteByIds(connection, 'task_steps', 'task_id', taskIds)
  const deletedTasks = await softDeleteByIds(connection, 'tasks', 'id', taskIds)
  const [productResult] = await connection.query(
    `UPDATE products SET deleted_at = NOW() WHERE id = ?`,
    [productId]
  )
  return {
    projects: 0,
    products: productResult.affectedRows || 0,
    tasks: deletedTasks,
    task_steps: deletedTaskSteps,
  }
}

const softDeleteTask = async (connection, taskId) => {
  const deletedTaskSteps = await softDeleteByIds(connection, 'task_steps', 'task_id', [taskId])
  const [taskResult] = await connection.query(`UPDATE tasks SET deleted_at = NOW() WHERE id = ?`, [
    taskId,
  ])
  return {
    projects: 0,
    products: 0,
    tasks: taskResult.affectedRows || 0,
    task_steps: deletedTaskSteps,
  }
}

export const deleteProject = async (projectId, { softDelete = false } = {}) => {
  const connection = await createConnection()
  try {
    const exists = await ensureExists(connection, 'projects', 'id', projectId)
    if (!exists) {
      return { ok: false, message: 'project not found', deleted: null }
    }
    await connection.beginTransaction()
    const deleted = softDelete
      ? await softDeleteProject(connection, projectId)
      : await deleteProjectHard(connection, projectId)
    await connection.commit()
    return { ok: true, deleted }
  } catch (error) {
    try {
      await connection.rollback()
    } catch {
      // ignore rollback errors
    }
    throw error
  } finally {
    await connection.end()
  }
}

export const deleteProduct = async (productId, { softDelete = false } = {}) => {
  const connection = await createConnection()
  try {
    const exists = await ensureExists(connection, 'products', 'id', productId)
    if (!exists) {
      return { ok: false, message: 'product not found', deleted: null }
    }
    await connection.beginTransaction()
    const deleted = softDelete
      ? await softDeleteProduct(connection, productId)
      : await deleteProductHard(connection, productId)
    await connection.commit()
    return { ok: true, deleted }
  } catch (error) {
    try {
      await connection.rollback()
    } catch {
      // ignore rollback errors
    }
    throw error
  } finally {
    await connection.end()
  }
}

export const deleteTask = async (taskId, { softDelete = false } = {}) => {
  const connection = await createConnection()
  try {
    const exists = await ensureExists(connection, 'tasks', 'id', taskId)
    if (!exists) {
      return { ok: false, message: 'task not found', deleted: null }
    }
    await connection.beginTransaction()
    const deleted = softDelete
      ? await softDeleteTask(connection, taskId)
      : await deleteTaskHard(connection, taskId)
    await connection.commit()
    return { ok: true, deleted }
  } catch (error) {
    try {
      await connection.rollback()
    } catch {
      // ignore rollback errors
    }
    throw error
  } finally {
    await connection.end()
  }
}

export const cascadeDeleteNotes = `
-- Recommended if schema changes are allowed:\n
ALTER TABLE products
  ADD CONSTRAINT fk_products_project
  FOREIGN KEY (project_id) REFERENCES projects(id)
  ON DELETE CASCADE;

ALTER TABLE tasks
  ADD CONSTRAINT fk_tasks_product
  FOREIGN KEY (product_id) REFERENCES products(id)
  ON DELETE CASCADE;

ALTER TABLE task_steps
  ADD CONSTRAINT fk_task_steps_task
  FOREIGN KEY (task_id) REFERENCES tasks(id)
  ON DELETE CASCADE;

-- Manual cascading (hard delete) with transaction:\n
START TRANSACTION;
SELECT id FROM products WHERE project_id = ?; -- capture product ids
SELECT id FROM tasks WHERE product_id IN (...); -- capture task ids
DELETE FROM task_steps WHERE task_id IN (...);
DELETE FROM tasks WHERE id IN (...);
DELETE FROM products WHERE id IN (...);
DELETE FROM projects WHERE id = ?;
COMMIT;
`
