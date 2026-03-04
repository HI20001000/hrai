import mysql from 'mysql2/promise'

const {
  MYSQL_HOST = 'localhost',
  MYSQL_PORT = '3306',
  MYSQL_USER = 'root',
  MYSQL_PASSWORD = '12345',
  MYSQL_DATABASE = 'aisql',
} = process.env

let connection = null

const createConnection = async (withDatabase = true) => {
  return mysql.createConnection({
    host: MYSQL_HOST,
    port: Number(MYSQL_PORT),
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: withDatabase ? MYSQL_DATABASE : undefined,
  })
}

const ensureDatabase = async () => {
  const baseConnection = await createConnection(false)
  await baseConnection.query(`CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\``)
  await baseConnection.end()
}

const ensureCreateProjectTables = async (db) => {
  await db.query(`CREATE TABLE IF NOT EXISTS statuses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    color VARCHAR(32) NOT NULL DEFAULT '#e2e8f0',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_status_name (name)
  )`)
  await db.query(`CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    owner_mail VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`)
  await db.query(`CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_products_project_id (project_id)
  )`)
  await db.query(`CREATE TABLE IF NOT EXISTS tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    current_status VARCHAR(64) NOT NULL,
    status_id INT NULL,
    created_by VARCHAR(255) NOT NULL,
    assignee_user_id VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tasks_product_id (product_id),
    INDEX idx_tasks_status (current_status),
    INDEX idx_tasks_assignee (assignee_user_id)
  )`)
  await db.query(`CREATE TABLE IF NOT EXISTS task_steps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_id INT NOT NULL,
    status VARCHAR(64) NOT NULL,
    status_id INT NULL,
    content TEXT NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    assignee_user_id VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_task_steps_task_id (task_id)
  )`)

  await ensureStatusDefaults(db)
  await ensureStatusColumns(db)
  await backfillStatusIds(db)
}

const ensureStatusDefaults = async (db) => {
  const [rows] = await db.query('SELECT COUNT(*) AS count FROM statuses')
  if ((rows[0]?.count ?? 0) > 0) return
  await db.query(
    `INSERT INTO statuses (name, color) VALUES
      ('待處理', '#e2e8f0'),
      ('進行中', '#bfdbfe'),
      ('完成', '#bbf7d0')`
  )
}

const ensureStatusColumns = async (db) => {
  await ensureColumn(db, 'tasks', 'status_id', 'INT NULL')
  await ensureColumn(db, 'task_steps', 'status_id', 'INT NULL')
  await ensureColumnType(db, 'tasks', 'assignee_user_id', 'INT NULL')
  await ensureColumnType(db, 'task_steps', 'assignee_user_id', 'INT NULL')
}

const ensureColumn = async (db, table, column, definition) => {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [MYSQL_DATABASE, table, column]
  )
  if ((rows[0]?.count ?? 0) > 0) return
  try {
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN ${column} ${definition}`)
  } catch (error) {
    if (error?.code === 'ER_DUP_FIELDNAME') return
    throw error
  }
}

const ensureColumnType = async (db, table, column, definition) => {
  const [rows] = await db.query(
    `SELECT data_type AS dataType
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [MYSQL_DATABASE, table, column]
  )
  if (!rows.length) return
  if (rows[0]?.dataType === 'int') return
  await db.query(`ALTER TABLE \`${table}\` MODIFY COLUMN ${column} ${definition}`)
}

const backfillStatusIds = async (db) => {
  await db.query(
    `UPDATE tasks t
     JOIN statuses s ON s.name = t.current_status
     SET t.status_id = s.id
     WHERE t.status_id IS NULL`
  )
  await db.query(
    `UPDATE task_steps ts
     JOIN statuses s ON s.name = ts.status
     SET ts.status_id = s.id
     WHERE ts.status_id IS NULL`
  )
}

const initDatabase = async () => {
  await ensureDatabase()
  const db = await createConnection(true)
  await ensureCreateProjectTables(db)
  return db
}

export const getConnection = async () => {
  if (!connection) {
    connection = await initDatabase()
    return connection
  }
  try {
    await connection.ping()
  } catch {
    try {
      await connection.end()
    } catch {
      // ignore
    }
    connection = await initDatabase()
  }
  return connection
}
