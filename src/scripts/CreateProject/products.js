export const fetchProducts = async (connection, { q, projectIds } = {}) => {
  const conditions = []
  const params = []
  if (q) {
    conditions.push('p.name LIKE ?')
    params.push(`%${q}%`)
  }
  if (projectIds?.length) {
    conditions.push(`p.project_id IN (${projectIds.map(() => '?').join(',')})`)
    params.push(...projectIds)
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const [rows] = await connection.query(
    `SELECT p.id, p.project_id, p.name, p.created_by, p.created_at, p.updated_at,
            pr.name AS project_name, pr.owner_mail AS project_owner_mail,
            pr.created_at AS project_created_at, pr.updated_at AS project_updated_at
     FROM products p
     JOIN projects pr ON pr.id = p.project_id
     ${whereClause}
     ORDER BY pr.created_at ASC, p.created_at ASC`,
    params
  )
  return rows
}

export const createProduct = async (connection, { projectId, name, createdBy }) => {
  const [result] = await connection.query(
    `INSERT INTO products (project_id, name, created_by) VALUES (?, ?, ?)`,
    [projectId, name, createdBy]
  )
  return result.insertId
}
