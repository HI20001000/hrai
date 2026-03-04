export const fetchTasksWithParents = async (connection, { q, status, assignee } = {}) => {
  const conditions = []
  const params = []

  if (status?.length) {
    const statusIds = status.filter((item) => /^\d+$/.test(String(item)))
    const statusNames = status.filter((item) => !/^\d+$/.test(String(item)))
    if (statusIds.length) {
      conditions.push(`t.status_id IN (${statusIds.map(() => '?').join(',')})`)
      params.push(...statusIds)
    }
    if (statusNames.length) {
      conditions.push(`s.name IN (${statusNames.map(() => '?').join(',')})`)
      params.push(...statusNames)
    }
  }

  if (assignee?.length) {
    conditions.push(`u.username IN (${assignee.map(() => '?').join(',')})`)
    params.push(...assignee)
  }

  if (q) {
    conditions.push(
      '(pr.name LIKE ? OR p.name LIKE ? OR t.title LIKE ? OR s.name LIKE ? OR u.username LIKE ?)'
    )
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [rows] = await connection.query(
    `SELECT
        t.id AS task_id,
        t.product_id,
        t.title AS task_title,
        t.current_status,
        t.status_id,
        t.assignee_user_id,
        t.created_by AS task_created_by,
        t.created_at AS task_created_at,
        t.updated_at AS task_updated_at,
        s.name AS status_name,
        s.color AS status_color,
        p.id AS product_id,
        p.project_id,
        p.name AS product_name,
        p.created_by AS product_created_by,
        p.created_at AS product_created_at,
        p.updated_at AS product_updated_at,
        pr.id AS project_id,
        pr.name AS project_name,
        pr.owner_mail AS project_owner_mail,
        pr.created_at AS project_created_at,
        pr.updated_at AS project_updated_at
     FROM tasks t
     LEFT JOIN statuses s ON s.id = t.status_id
     LEFT JOIN users u ON u.id = t.assignee_user_id
     JOIN products p ON p.id = t.product_id
     JOIN projects pr ON pr.id = p.project_id
     ${whereClause}
     ORDER BY pr.created_at ASC, p.created_at ASC, t.created_at ASC`,
    params
  )
  return rows
}

export const createTask = async (
  connection,
  { productId, title, statusId, createdBy, assigneeUserId }
) => {
  const [result] = await connection.query(
    `INSERT INTO tasks (product_id, title, current_status, status_id, created_by, assignee_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [productId, title, String(statusId ?? ''), statusId, createdBy, assigneeUserId ?? null]
  )
  return result.insertId
}
