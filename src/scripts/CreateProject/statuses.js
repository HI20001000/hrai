export const fetchStatuses = async (connection) => {
  const [rows] = await connection.query(
    `SELECT id, name, color
     FROM statuses
     ORDER BY id ASC`
  )
  return rows
}

export const createStatus = async (connection, { name, color }) => {
  const [result] = await connection.query(
    `INSERT INTO statuses (name, color) VALUES (?, ?)`,
    [name, color]
  )
  const [rows] = await connection.query(
    `SELECT id, name, color
     FROM statuses
     WHERE id = ?`,
    [result.insertId]
  )
  return rows[0]
}

export const getDefaultStatusId = async (connection) => {
  const [rows] = await connection.query(`SELECT id FROM statuses ORDER BY id ASC LIMIT 1`)
  return rows[0]?.id ?? null
}
