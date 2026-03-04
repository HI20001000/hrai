const DEFAULT_DIFY_BASE_URL = 'https://api.dify.ai/v1'

const buildPrompt = ({ meetingDate, productName, records }) => {
  const joinedRecords = records
    .map(
      (record, index) =>
        `## 文件 ${index + 1}: ${record.filename}\n` +
        `檔案類型: ${record.fileType || 'unknown'}\n` +
        `內容:\n${record.content || '(空白)'}\n`
    )
    .join('\n')

  return [
    '你是一位會議分析助理，請根據輸入的會議記錄整理摘要。',
    `會議日期: ${meetingDate || '未知'}`,
    `產品名稱: ${productName || '未知'}`,
    '',
    '請輸出繁體中文，且至少包含以下段落：',
    '1. 會議重點摘要',
    '2. 關鍵決策',
    '3. 待辦事項（列出負責人與時程，若缺資訊請標記待補）',
    '4. 風險與阻塞',
    '',
    '以下是會議文件內容：',
    joinedRecords,
  ].join('\n')
}

export const createDifyHandlers = ({ sendJson, parseBody, logger }) => {
  const summarizeMeetingRecords = async (req, res) => {
    const apiKey = process.env.DIFY_API_KEY
    if (!apiKey) {
      sendJson(res, 500, { message: 'DIFY_API_KEY 未設定，無法進行總結。' })
      return
    }

    const body = await parseBody(req)
    const meetingDate = body?.meetingDate || ''
    const productName = body?.productName || ''
    const records = Array.isArray(body?.records) ? body.records : []
    const user = body?.user || 'meeting-records-user'

    if (!records.length) {
      sendJson(res, 400, { message: 'records 為必填，且至少要有一筆資料。' })
      return
    }

    const endpoint = `${process.env.DIFY_BASE_URL || DEFAULT_DIFY_BASE_URL}/chat-messages`

    try {
      const prompt = buildPrompt({ meetingDate, productName, records })
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: {
            meetingDate,
            productName,
          },
          query: prompt,
          response_mode: 'blocking',
          user,
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        const message = payload?.message || payload?.error || 'Dify API 呼叫失敗'
        sendJson(res, response.status, { message })
        return
      }

      const summary = payload?.answer || payload?.data?.answer || ''
      if (!summary) {
        sendJson(res, 500, { message: 'Dify 沒有返回可用的 summary。' })
        return
      }

      sendJson(res, 200, { summary })
    } catch (error) {
      await logger.error(`Dify summarize failed: ${error?.message || error}`)
      sendJson(res, 500, { message: 'Dify 總結失敗，請稍後再試。' })
    }
  }

  return {
    summarizeMeetingRecords,
  }
}
