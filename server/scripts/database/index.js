import mysql from 'mysql2/promise'

const getDbName = () => process.env.HRAI_DATABASE || process.env.MYSQL_DATABASE || 'hrai'

const baseConfig = () => ({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
})

export const ensureDatabaseExists = async () => {
  const config = baseConfig()
  const database = getDbName()
  const connection = await mysql.createConnection(config)
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  } finally {
    await connection.end()
  }
}

export const createDatabasePool = () => {
  const database = getDbName()
  return mysql.createPool({
    ...baseConfig(),
    database,
    connectionLimit: 5,
  })
}

export const ensureAuthTables = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      password_salt VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_expires_at (expires_at),
      CONSTRAINT fk_auth_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)
}

export const ensureCvTables = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidates (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      full_name VARCHAR(120) NOT NULL,
      email VARCHAR(255) NULL,
      phone VARCHAR(40) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_candidate_name (full_name),
      INDEX idx_candidate_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_cvs (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      candidate_id BIGINT NOT NULL,
      version_no INT NOT NULL,
      storage_provider VARCHAR(30) NOT NULL DEFAULT 'local',
      storage_key VARCHAR(500) NOT NULL,
      original_filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      file_size BIGINT NOT NULL,
      sha256 CHAR(64) NOT NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_candidate_id (candidate_id),
      INDEX idx_candidate_uploaded_at (uploaded_at),
      UNIQUE KEY uniq_candidate_version (candidate_id, version_no),
      CONSTRAINT fk_candidate_cvs_candidate FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)
}

export const getDatabaseName = getDbName
