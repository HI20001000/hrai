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
      username VARCHAR(80) NULL,
      avatar_text VARCHAR(16) NULL,
      avatar_bg_color VARCHAR(20) NULL,
      password_hash VARCHAR(255) NOT NULL,
      password_salt VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  const ensureColumn = async (sql) => {
    try {
      await pool.query(sql)
    } catch (error) {
      if (!/duplicate column name/i.test(String(error?.message || ''))) throw error
    }
  }

  await ensureColumn('ALTER TABLE users ADD COLUMN username VARCHAR(80) NULL')
  await ensureColumn('ALTER TABLE users ADD COLUMN avatar_text VARCHAR(16) NULL')
  await ensureColumn('ALTER TABLE users ADD COLUMN avatar_bg_color VARCHAR(20) NULL')

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_cv_extractions (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      candidate_id BIGINT NOT NULL,
      candidate_cv_id BIGINT NOT NULL,
      target_position VARCHAR(255) NULL,
      cv_text LONGTEXT NULL,
      extracted_text LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_candidate_cv_extraction (candidate_cv_id),
      INDEX idx_candidate_extractions_candidate (candidate_id),
      CONSTRAINT fk_candidate_cv_extractions_candidate FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
      CONSTRAINT fk_candidate_cv_extractions_cv FOREIGN KEY (candidate_cv_id) REFERENCES candidate_cvs(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_posts (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(255) NOT NULL,
      job_key VARCHAR(120) NOT NULL,
      job_snapshot_json LONGTEXT NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_job_posts_status (status),
      INDEX idx_job_posts_job_key (job_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_cv_job_matches (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      candidate_id BIGINT NOT NULL,
      candidate_cv_id BIGINT NOT NULL,
      job_key VARCHAR(120) NOT NULL,
      job_title VARCHAR(255) NOT NULL,
      rank_no INT NOT NULL,
      match_score INT NOT NULL,
      match_level VARCHAR(20) NOT NULL,
      reason_summary TEXT NULL,
      strengths_json LONGTEXT NULL,
      gaps_json LONGTEXT NULL,
      raw_llm_json LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_candidate_cv_job_matches_cv (candidate_cv_id),
      INDEX idx_candidate_cv_job_matches_candidate (candidate_id),
      CONSTRAINT fk_candidate_cv_job_matches_candidate FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
      CONSTRAINT fk_candidate_cv_job_matches_cv FOREIGN KEY (candidate_cv_id) REFERENCES candidate_cvs(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_post_applications (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      job_post_id BIGINT NOT NULL,
      candidate_id BIGINT NOT NULL,
      candidate_cv_id BIGINT NOT NULL,
      application_status VARCHAR(40) NOT NULL DEFAULT 'submitted',
      matched_score INT NULL,
      matched_level VARCHAR(20) NULL,
      matched_position VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_job_post_application_cv (candidate_cv_id),
      INDEX idx_job_post_applications_job_post (job_post_id),
      INDEX idx_job_post_applications_candidate (candidate_id),
      CONSTRAINT fk_job_post_applications_job_post FOREIGN KEY (job_post_id) REFERENCES job_posts(id) ON DELETE CASCADE,
      CONSTRAINT fk_job_post_applications_candidate FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
      CONSTRAINT fk_job_post_applications_cv FOREIGN KEY (candidate_cv_id) REFERENCES candidate_cvs(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)
}

export const getDatabaseName = getDbName
