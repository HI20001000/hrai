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
  const ensureColumn = async (sql) => {
    try {
      await pool.query(sql)
    } catch (error) {
      if (!/duplicate column name/i.test(String(error?.message || ''))) throw error
    }
  }

  const ensureIndex = async (sql) => {
    try {
      await pool.query(sql)
    } catch (error) {
      if (!/duplicate key name/i.test(String(error?.message || ''))) throw error
    }
  }

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
      application_status VARCHAR(40) NOT NULL DEFAULT 'screening',
      first_interview_arrangement VARCHAR(40) NULL,
      remark TEXT NULL,
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

  await pool.query(`
    ALTER TABLE job_post_applications
    MODIFY COLUMN application_status VARCHAR(40) NOT NULL DEFAULT 'screening'
  `)

  try {
    await pool.query('ALTER TABLE job_post_applications ADD COLUMN remark TEXT NULL AFTER application_status')
  } catch (error) {
    if (!/duplicate column name/i.test(String(error?.message || ''))) throw error
  }

  try {
    await pool.query(
      'ALTER TABLE job_post_applications ADD COLUMN first_interview_arrangement VARCHAR(40) NULL AFTER application_status'
    )
  } catch (error) {
    if (!/duplicate column name/i.test(String(error?.message || ''))) throw error
  }

  await pool.query(`
    UPDATE job_post_applications
    SET application_status = 'screening'
    WHERE application_status = 'submitted' OR application_status IS NULL OR application_status = ''
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_post_application_status_history (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      application_id BIGINT NOT NULL,
      application_status VARCHAR(40) NOT NULL DEFAULT 'screening',
      first_interview_arrangement VARCHAR(40) NULL,
      remark TEXT NULL,
      operator_user_id BIGINT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_application_status_history_application (application_id),
      INDEX idx_application_status_history_created (created_at),
      INDEX idx_application_status_history_operator (operator_user_id),
      CONSTRAINT fk_application_status_history_application FOREIGN KEY (application_id) REFERENCES job_post_applications(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await ensureColumn(
    'ALTER TABLE job_post_application_status_history ADD COLUMN operator_user_id BIGINT NULL AFTER remark'
  )
  await ensureIndex(
    'ALTER TABLE job_post_application_status_history ADD INDEX idx_application_status_history_operator (operator_user_id)'
  )

  await pool.query(`
    INSERT INTO job_post_application_status_history
      (application_id, application_status, first_interview_arrangement, remark, created_at, updated_at)
    SELECT
      app.id,
      app.application_status,
      app.first_interview_arrangement,
      app.remark,
      app.created_at,
      app.updated_at
    FROM job_post_applications app
    WHERE NOT EXISTS (
      SELECT 1
      FROM job_post_application_status_history history
      WHERE history.application_id = app.id
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS personnel (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      full_name VARCHAR(120) NOT NULL,
      department VARCHAR(120) NULL,
      team VARCHAR(120) NULL,
      title VARCHAR(120) NULL,
      email VARCHAR(255) NULL,
      phone VARCHAR(40) NULL,
      manager_personnel_id BIGINT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      remark TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_personnel_full_name (full_name),
      INDEX idx_personnel_status (status),
      INDEX idx_personnel_manager (manager_personnel_id),
      CONSTRAINT fk_personnel_manager FOREIGN KEY (manager_personnel_id) REFERENCES personnel(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      project_name VARCHAR(255) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'planned',
      owner_personnel_id BIGINT NULL,
      start_date DATE NULL,
      end_date DATE NULL,
      remark TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_projects_name (project_name),
      INDEX idx_projects_status (status),
      INDEX idx_projects_owner (owner_personnel_id),
      CONSTRAINT fk_projects_owner FOREIGN KEY (owner_personnel_id) REFERENCES personnel(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_personnel_assignments (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      project_id BIGINT NOT NULL,
      personnel_id BIGINT NOT NULL,
      project_role VARCHAR(120) NULL,
      start_date DATE NULL,
      end_date DATE NULL,
      source VARCHAR(30) NOT NULL DEFAULT 'manual',
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      remark TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_project_personnel_assignment (project_id, personnel_id),
      INDEX idx_project_personnel_project (project_id),
      INDEX idx_project_personnel_personnel (personnel_id),
      INDEX idx_project_personnel_status (status),
      CONSTRAINT fk_project_personnel_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      CONSTRAINT fk_project_personnel_personnel FOREIGN KEY (personnel_id) REFERENCES personnel(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_personnel_movements (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      assignment_id BIGINT NULL,
      personnel_id BIGINT NOT NULL,
      from_project_id BIGINT NULL,
      to_project_id BIGINT NULL,
      movement_type VARCHAR(30) NOT NULL,
      movement_date DATE NULL,
      project_role VARCHAR(120) NULL,
      source VARCHAR(30) NOT NULL DEFAULT 'manual',
      remark TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_project_movements_assignment (assignment_id),
      INDEX idx_project_movements_personnel (personnel_id),
      INDEX idx_project_movements_from_project (from_project_id),
      INDEX idx_project_movements_to_project (to_project_id),
      INDEX idx_project_movements_type (movement_type),
      CONSTRAINT fk_project_movements_assignment FOREIGN KEY (assignment_id) REFERENCES project_personnel_assignments(id) ON DELETE SET NULL,
      CONSTRAINT fk_project_movements_personnel FOREIGN KEY (personnel_id) REFERENCES personnel(id) ON DELETE CASCADE,
      CONSTRAINT fk_project_movements_from_project FOREIGN KEY (from_project_id) REFERENCES projects(id) ON DELETE SET NULL,
      CONSTRAINT fk_project_movements_to_project FOREIGN KEY (to_project_id) REFERENCES projects(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_blacklist (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      display_name VARCHAR(120) NULL,
      phone VARCHAR(40) NULL,
      normalized_phone VARCHAR(40) NULL,
      email VARCHAR(255) NULL,
      normalized_email VARCHAR(255) NULL,
      reason TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      remark TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_candidate_blacklist_status (status),
      INDEX idx_candidate_blacklist_phone (normalized_phone),
      INDEX idx_candidate_blacklist_email (normalized_email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  try {
    await pool.query('ALTER TABLE candidate_blacklist ADD COLUMN normalized_phone VARCHAR(40) NULL AFTER phone')
  } catch (error) {
    if (!/duplicate column name/i.test(String(error?.message || ''))) throw error
  }

  try {
    await pool.query('ALTER TABLE candidate_blacklist ADD COLUMN normalized_email VARCHAR(255) NULL AFTER email')
  } catch (error) {
    if (!/duplicate column name/i.test(String(error?.message || ''))) throw error
  }
}

export const getDatabaseName = getDbName
