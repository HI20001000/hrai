import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

const normalizeMeetingDate = (value) => {
  if (!value) return null
  const normalized = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  return normalized
}

const parseBase64Payload = (payload) => {
  if (!payload) return null
  const normalized = String(payload)
  const match = normalized.match(/^data:([^;]+);base64,(.+)$/)
  if (match) {
    return {
      buffer: Buffer.from(match[2], 'base64'),
      mimeType: match[1],
    }
  }
  return {
    buffer: Buffer.from(normalized, 'base64'),
    mimeType: null,
  }
}

const sanitizeFilename = (name) => {
  if (!name) return ''
  return String(name).replace(/[\\\/:*?"<>|]+/g, '_')
}

const sanitizeFolderName = (name) => {
  if (!name) return ''
  return String(name).trim().replace(/[\\\/:*?"<>|]+/g, '_')
}

export const createMeetingHandlers = ({
  getConnection,
  fetchProjects,
  fetchProducts,
  sendJson,
  parseBody,
  logger,
  meetingRootPath,
}) => {
  const getMeetingPathInfo = async (connection, productId, meetingDate) => {
    const [rows] = await connection.query(
      `SELECT pr.name AS project_name, p.name AS product_name
       FROM products p
       JOIN projects pr ON pr.id = p.project_id
       WHERE p.id = ?
       LIMIT 1`,
      [productId]
    )
    if (!rows.length) return null
    const projectName = sanitizeFolderName(rows[0].project_name)
    const productName = sanitizeFolderName(rows[0].product_name)
    const relativePath = path.posix.join(projectName, productName, meetingDate)
    const absolutePath = path.join(meetingRootPath, relativePath)
    return { projectName, productName, relativePath, absolutePath }
  }

  const ensureMeetingTables = async (connection) => {
    await connection.query(`CREATE TABLE IF NOT EXISTS meeting_days (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      meeting_date DATE NOT NULL,
      created_by VARCHAR(255) NOT NULL DEFAULT 'system',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_meeting_day (product_id, meeting_date),
      INDEX idx_meeting_day_product (product_id)
    )`)
  }

  const ensureMeetingStorage = async () => {
    await fs.mkdir(meetingRootPath, { recursive: true })
  }

  const fetchMeetingTree = async (_req, res) => {
    try {
      const connection = await getConnection()
      await ensureMeetingTables(connection)
      const projects = await fetchProjects(connection)
      const products = await fetchProducts(connection)
      const [meetingRows] = await connection.query(
        `SELECT id, product_id,
                DATE_FORMAT(meeting_date, '%Y-%m-%d') AS meeting_date
         FROM meeting_days
         ORDER BY meeting_date DESC`
      )

      const meetingDaysByProduct = new Map()
      meetingRows.forEach((row) => {
        if (!meetingDaysByProduct.has(row.product_id)) {
          meetingDaysByProduct.set(row.product_id, [])
        }
        meetingDaysByProduct.get(row.product_id).push({
          id: row.id,
          meeting_date: row.meeting_date,
        })
      })

      const productsByProject = new Map()
      products.forEach((product) => {
        if (!productsByProject.has(product.project_id)) {
          productsByProject.set(product.project_id, [])
        }
        productsByProject.get(product.project_id).push({
          id: product.id,
          name: product.name,
          meeting_days: meetingDaysByProduct.get(product.id) || [],
        })
      })

      const tree = projects.map((project) => ({
        id: project.id,
        name: project.name,
        products: productsByProject.get(project.id) || [],
      }))

      sendJson(res, 200, { tree })
    } catch (error) {
      await logger.error(`Meeting tree load failed: ${error?.message || error}`)
      sendJson(res, 500, { message: 'Failed to load meeting tree' })
    }
  }

  const createMeetingDay = async (req, res) => {
    const body = await parseBody(req)
    const productId = Number(body?.productId)
    const meetingDate = normalizeMeetingDate(body?.meetingDate)
    if (!productId || !meetingDate) {
      sendJson(res, 400, { message: 'productId and meetingDate are required' })
      return
    }
    try {
      const connection = await getConnection()
      await ensureMeetingTables(connection)
      const [existingRows] = await connection.query(
        `SELECT id FROM meeting_days WHERE product_id = ? AND meeting_date = ? LIMIT 1`,
        [productId, meetingDate]
      )
      let meetingDayId = existingRows[0]?.id
      if (!meetingDayId) {
        const [result] = await connection.query(
          `INSERT INTO meeting_days (product_id, meeting_date, created_by)
           VALUES (?, ?, ?)`,
          [productId, meetingDate, body?.created_by?.trim() || 'system']
        )
        meetingDayId = result.insertId
      }
      await ensureMeetingStorage()
      const pathInfo = await getMeetingPathInfo(connection, productId, meetingDate)
      if (!pathInfo) {
        sendJson(res, 404, { message: 'Product not found' })
        return
      }
      const { absolutePath } = pathInfo
      await fs.mkdir(absolutePath, { recursive: true })
      sendJson(res, 200, { id: meetingDayId, meeting_date: meetingDate })
    } catch (error) {
      await logger.error(`Meeting day create failed: ${error?.message || error}`)
      sendJson(res, 500, { message: 'Failed to create meeting day' })
    }
  }

  const renameMeetingDay = async (req, res) => {
    const body = await parseBody(req)
    const meetingDayId = Number(body?.meetingDayId)
    const meetingDate = normalizeMeetingDate(body?.meetingDate)
    if (!meetingDayId || !meetingDate) {
      sendJson(res, 400, { message: 'meetingDayId and meetingDate are required' })
      return
    }
    try {
      const connection = await getConnection()
      await ensureMeetingTables(connection)
      const [rows] = await connection.query(
        `SELECT product_id, DATE_FORMAT(meeting_date, '%Y-%m-%d') AS meeting_date
         FROM meeting_days
         WHERE id = ?`,
        [meetingDayId]
      )
      if (!rows.length) {
        sendJson(res, 404, { message: 'Meeting day not found' })
        return
      }
      const productId = rows[0].product_id
      const oldMeetingDate = rows[0].meeting_date
      if (oldMeetingDate === meetingDate) {
        sendJson(res, 200, { id: meetingDayId, meeting_date: meetingDate })
        return
      }
      await ensureMeetingStorage()
      const oldPathInfo = await getMeetingPathInfo(connection, productId, oldMeetingDate)
      const newPathInfo = await getMeetingPathInfo(connection, productId, meetingDate)
      if (!oldPathInfo || !newPathInfo) {
        sendJson(res, 404, { message: 'Product not found' })
        return
      }
      await fs.mkdir(path.dirname(newPathInfo.absolutePath), { recursive: true })
      try {
        await fs.rename(oldPathInfo.absolutePath, newPathInfo.absolutePath)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        await fs.mkdir(newPathInfo.absolutePath, { recursive: true })
      }
      await connection.query(`UPDATE meeting_days SET meeting_date = ? WHERE id = ?`, [
        meetingDate,
        meetingDayId,
      ])
      sendJson(res, 200, { id: meetingDayId, meeting_date: meetingDate })
    } catch (error) {
      await logger.error(`Meeting day rename failed: ${error?.message || error}`)
      sendJson(res, 500, { message: 'Failed to rename meeting day' })
    }
  }

  const deleteMeetingDay = async (req, res) => {
    const body = await parseBody(req)
    const meetingDayId = Number(body?.meetingDayId)
    if (!meetingDayId) {
      sendJson(res, 400, { message: 'meetingDayId is required' })
      return
    }
    try {
      const connection = await getConnection()
      await ensureMeetingTables(connection)
      const [rows] = await connection.query(
        `SELECT product_id, DATE_FORMAT(meeting_date, '%Y-%m-%d') AS meeting_date
         FROM meeting_days
         WHERE id = ?`,
        [meetingDayId]
      )
      if (!rows.length) {
        sendJson(res, 404, { message: 'Meeting day not found' })
        return
      }
      const meetingInfo = {
        productId: rows[0].product_id,
        meetingDate: rows[0].meeting_date,
      }
      const pathInfo = await getMeetingPathInfo(
        connection,
        meetingInfo.productId,
        meetingInfo.meetingDate
      )
      if (!pathInfo) {
        sendJson(res, 404, { message: 'Product not found' })
        return
      }
      const { absolutePath } = pathInfo
      await fs.rm(absolutePath, { recursive: true, force: true })
      await connection.query(`DELETE FROM meeting_days WHERE id = ?`, [meetingDayId])
      sendJson(res, 200, { ok: true })
    } catch (error) {
      await logger.error(`Meeting day delete failed: ${error?.message || error}`)
      sendJson(res, 500, { message: 'Failed to delete meeting day' })
    }
  }

  const listMeetingFiles = async (_req, res, url) => {
    const meetingDayId = Number(url.searchParams.get('meetingDayId'))
    if (!meetingDayId) {
      sendJson(res, 400, { message: 'meetingDayId is required' })
      return
    }
    try {
      const connection = await getConnection()
      await ensureMeetingTables(connection)
      const [rows] = await connection.query(
        `SELECT product_id, DATE_FORMAT(meeting_date, '%Y-%m-%d') AS meeting_date
         FROM meeting_days
         WHERE id = ?`,
        [meetingDayId]
      )
      if (!rows.length) {
        sendJson(res, 404, { message: 'Meeting day not found' })
        return
      }
      const meetingInfo = {
        productId: rows[0].product_id,
        meetingDate: rows[0].meeting_date,
      }
      const pathInfo = await getMeetingPathInfo(
        connection,
        meetingInfo.productId,
        meetingInfo.meetingDate
      )
      if (!pathInfo) {
        sendJson(res, 404, { message: 'Product not found' })
        return
      }
      const { absolutePath } = pathInfo
      let entries = []
      try {
        entries = await fs.readdir(absolutePath, { withFileTypes: true })
      } catch (error) {
        if (error?.code === 'ENOENT') {
          sendJson(res, 200, { files: [] })
          return
        }
        throw error
      }
      const files = await Promise.all(
        entries
          .filter((entry) => entry.isFile())
          .map(async (entry) => {
            const filePath = path.join(absolutePath, entry.name)
            const stats = await fs.stat(filePath)
            return {
              id: entry.name,
              filename: entry.name,
              file_type: path.extname(entry.name).slice(1) || '-',
              file_size: stats.size,
              created_at: stats.mtime.toISOString(),
            }
          })
      )
      sendJson(res, 200, { files })
    } catch (error) {
      await logger.error(`Meeting files load failed: ${error?.message || error}`)
      sendJson(res, 500, { message: 'Failed to load meeting files' })
    }
  }

  const uploadMeetingFiles = async (req, res, url) => {
    const body = await parseBody(req)
    const meetingDayId = Number(body?.meetingDayId ?? url.searchParams.get('meetingDayId'))
    const files = Array.isArray(body?.files) ? body.files : []
    if (!meetingDayId || files.length === 0) {
      sendJson(res, 400, { message: 'meetingDayId and files are required' })
      return
    }
    try {
      const connection = await getConnection()
      await ensureMeetingTables(connection)
      const [rows] = await connection.query(
        `SELECT product_id, DATE_FORMAT(meeting_date, '%Y-%m-%d') AS meeting_date
         FROM meeting_days
         WHERE id = ?`,
        [meetingDayId]
      )
      if (!rows.length) {
        sendJson(res, 404, { message: 'Meeting day not found' })
        return
      }
      const meetingInfo = {
        productId: rows[0].product_id,
        meetingDate: rows[0].meeting_date,
      }
      await ensureMeetingStorage()
      const pathInfo = await getMeetingPathInfo(
        connection,
        meetingInfo.productId,
        meetingInfo.meetingDate
      )
      if (!pathInfo) {
        sendJson(res, 404, { message: 'Product not found' })
        return
      }
      const { absolutePath, relativePath } = pathInfo
      await fs.mkdir(absolutePath, { recursive: true })
      for (const file of files) {
        const parsed = parseBase64Payload(file?.content)
        if (!parsed?.buffer) continue
        const originalName = sanitizeFilename(file?.name || '')
        const ext = path.extname(originalName)
        const baseName = originalName ? path.basename(originalName, ext) : ''
        const fallbackName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`
        let storedName = originalName || fallbackName
        let storedAbsolutePath = path.join(meetingRootPath, relativePath, storedName)
        let attempt = 1
        while (true) {
          try {
            await fs.access(storedAbsolutePath)
            storedName = baseName
              ? `${baseName}-${attempt}${ext}`
              : `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`
            storedAbsolutePath = path.join(meetingRootPath, relativePath, storedName)
            attempt += 1
          } catch (error) {
            if (error?.code === 'ENOENT') break
            throw error
          }
        }
        const storedRelativePath = path.posix.join(relativePath, storedName)
        await fs.writeFile(storedAbsolutePath, parsed.buffer)
      }
      sendJson(res, 200, { ok: true })
    } catch (error) {
      await logger.error(`Meeting upload failed: ${error?.message || error}`)
      sendJson(res, 500, { message: 'Failed to upload meeting files' })
    }
  }

  const downloadMeetingFile = async (_req, res, url) => {
    const meetingDayId = Number(url.searchParams.get('meetingDayId'))
    const filename = sanitizeFilename(url.searchParams.get('filename') || '')
    if (!meetingDayId || !filename) {
      sendJson(res, 400, { message: 'meetingDayId and filename are required' })
      return
    }
    try {
      const connection = await getConnection()
      await ensureMeetingTables(connection)
      const [rows] = await connection.query(
        `SELECT product_id, DATE_FORMAT(meeting_date, '%Y-%m-%d') AS meeting_date
         FROM meeting_days
         WHERE id = ?`,
        [meetingDayId]
      )
      if (!rows.length) {
        sendJson(res, 404, { message: 'Meeting day not found' })
        return
      }
      const meetingInfo = {
        productId: rows[0].product_id,
        meetingDate: rows[0].meeting_date,
      }
      const pathInfo = await getMeetingPathInfo(
        connection,
        meetingInfo.productId,
        meetingInfo.meetingDate
      )
      if (!pathInfo) {
        sendJson(res, 404, { message: 'Product not found' })
        return
      }
      const { absolutePath } = pathInfo
      const filePath = path.join(absolutePath, filename)
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      })
      const stream = createReadStream(filePath)
      stream.on('error', () => {
        sendJson(res, 500, { message: 'Failed to read file' })
      })
      stream.pipe(res)
    } catch (error) {
      await logger.error(`Meeting file download failed: ${error?.message || error}`)
      sendJson(res, 500, { message: 'Failed to download meeting file' })
    }
  }

  const deleteMeetingFile = async (req, res) => {
    const body = await parseBody(req)
    const meetingDayId = Number(body?.meetingDayId)
    const filename = sanitizeFilename(body?.filename || '')
    if (!meetingDayId || !filename) {
      sendJson(res, 400, { message: 'meetingDayId and filename are required' })
      return
    }
    try {
      const connection = await getConnection()
      await ensureMeetingTables(connection)
      const [rows] = await connection.query(
        `SELECT product_id, DATE_FORMAT(meeting_date, '%Y-%m-%d') AS meeting_date
         FROM meeting_days
         WHERE id = ?`,
        [meetingDayId]
      )
      if (!rows.length) {
        sendJson(res, 404, { message: 'Meeting day not found' })
        return
      }
      const meetingInfo = {
        productId: rows[0].product_id,
        meetingDate: rows[0].meeting_date,
      }
      const pathInfo = await getMeetingPathInfo(
        connection,
        meetingInfo.productId,
        meetingInfo.meetingDate
      )
      if (!pathInfo) {
        sendJson(res, 404, { message: 'Product not found' })
        return
      }
      const { absolutePath } = pathInfo
      await fs.rm(path.join(absolutePath, filename), { force: true })
      sendJson(res, 200, { ok: true })
    } catch (error) {
      await logger.error(`Meeting file delete failed: ${error?.message || error}`)
      sendJson(res, 500, { message: 'Failed to delete meeting file' })
    }
  }

  return {
    fetchMeetingTree,
    createMeetingDay,
    renameMeetingDay,
    deleteMeetingDay,
    listMeetingFiles,
    uploadMeetingFiles,
    downloadMeetingFile,
    deleteMeetingFile,
  }
}
