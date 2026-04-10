export class HttpError extends Error {
  constructor(statusCode, message) {
    super(String(message || 'Unexpected error'))
    this.name = 'HttpError'
    this.statusCode = Number(statusCode) || 500
  }
}

export class LlmRequestError extends HttpError {
  constructor(message) {
    super(502, message || 'LLM request failed')
    this.name = 'LlmRequestError'
  }
}

export class LlmOutputFormatError extends HttpError {
  constructor(message) {
    super(502, message || 'LLM output format is invalid')
    this.name = 'LlmOutputFormatError'
  }
}
