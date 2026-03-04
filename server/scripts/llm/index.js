const DEFAULT_LLM_BASE_URL = 'http://192.168.3.71:8000/v1'
const DEFAULT_LLM_MODEL = 'Qwen3-30B-A3B-Instruct-2507-FP8'
const DEFAULT_LLM_API_KEY = 'empty'

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

export const createLlmHandlers = ({ sendJson, parseBody, logger }) => {
  const summarizeMeetingRecords = async (req, res) => {
    const body = await parseBody(req)
    const meetingDate = body?.meetingDate || ''
    const productName = body?.productName || ''
    const records = Array.isArray(body?.records) ? body.records : []

    if (!records.length) {
      sendJson(res, 400, { message: 'records 為必填，且至少要有一筆資料。' })
      return
    }

    const baseUrl = process.env.LLM_BASE_URL || DEFAULT_LLM_BASE_URL
    const model = process.env.LLM_MODEL || DEFAULT_LLM_MODEL
    const apiKey = process.env.LLM_API_KEY || DEFAULT_LLM_API_KEY
    const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`

    try {
      const prompt = buildPrompt({ meetingDate, productName, records })
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: '你是企業會議記錄分析助理，擅長把多份會議紀錄整合成可執行摘要。',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.2,
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        const message = payload?.message || payload?.error?.message || payload?.error || 'LLM API 呼叫失敗'
        sendJson(res, response.status, { message })
        return
      }

      const summary = payload?.choices?.[0]?.message?.content?.trim() || ''
      if (!summary) {
        sendJson(res, 500, { message: 'LLM 沒有返回可用的 summary。' })
        return
      }

      sendJson(res, 200, { summary })
    } catch (error) {
      await logger.error(`LLM summarize failed: ${error?.message || error}`)
      sendJson(res, 500, { message: 'LLM 總結失敗，請稍後再試。' })
    }
  }

  return {
    summarizeMeetingRecords,
  }
}
