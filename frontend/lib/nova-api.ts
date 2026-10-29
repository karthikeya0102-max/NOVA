export interface ChatSource { title: string; url: string; snippet?: string; score?: number }
export interface ChatReply { answer: string; mode: string; model: string; sources: ChatSource[] }
export interface MissionEvent {
  type: 'step' | 'completed' | 'failed'
  step_id: string
  status: 'running' | 'completed' | 'failed'
  timestamp: string
  description: string
  answer?: string
  mode?: string
  model?: string
  sources?: ChatSource[]
  error?: string
}
export interface BackendStatus {
  nebius_configured: boolean
  tavily_configured: boolean
  model: string | null
  base_url: string
  database: string
  note: string
}

export async function novaRequest<T>(base: string, path: string, body?: unknown, method?: string, options?: { signal?: AbortSignal }): Promise<T> {
  if (!base) throw new Error('Backend not connected. Open Settings to connect your local FastAPI server. Your message has not been sent.')
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS backend URL without credentials.')
  let response: Response
  try {
    const timeoutSignal = AbortSignal.timeout(60000)
    const signal = options?.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
    response = await fetch(`${base.replace(/\/$/, '')}/api/${path}`, { method: method || (body ? 'POST' : 'GET'), headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal })
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw error
    throw new Error('Cannot reach the NOVA API. Check that FastAPI is running and that the backend URL is correct.')
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error(`The NOVA API returned an invalid response (HTTP ${response.status}). Check the FastAPI service and frontend proxy configuration.`)
  }

  if (!response.ok) {
    const detail = typeof data === 'object' && data !== null && 'detail' in data ? data.detail : null
    throw new Error(typeof detail === 'string' ? detail : `The NOVA API rejected this request (HTTP ${response.status}).`)
  }

  return data as T
}

function isMissionEvent(value: unknown): value is MissionEvent {
  if (typeof value !== 'object' || value === null) return false
  const event = value as Record<string, unknown>
  const validSources = event.sources === undefined || (Array.isArray(event.sources) && event.sources.every(source =>
    typeof source === 'object' && source !== null && 'title' in source && typeof source.title === 'string'
      && 'url' in source && typeof source.url === 'string'))
  const validResult = event.type !== 'completed'
    || (typeof event.answer === 'string' && typeof event.mode === 'string' && typeof event.model === 'string' && validSources)
  return (event.type === 'step' || event.type === 'completed' || event.type === 'failed')
    && typeof event.step_id === 'string'
    && (event.status === 'running' || event.status === 'completed' || event.status === 'failed')
    && typeof event.timestamp === 'string'
    && typeof event.description === 'string'
    && validSources
    && validResult
    && (event.error === undefined || typeof event.error === 'string')
}

export async function novaMission(
  base: string,
  body: { message: string; research: boolean },
  signal: AbortSignal,
  onEvent: (event: MissionEvent) => void,
): Promise<ChatReply> {
  if (!base) throw new Error('Backend not connected. Open Settings to connect your local FastAPI server. Your mission has not been sent.')
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS backend URL without credentials.')

  let response: Response
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/api/mission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    })
  } catch (error) {
    if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) {
      if (error.name === 'TimeoutError') throw new Error('NOVA mission timed out after 120 seconds. Check the FastAPI terminal and provider availability.')
      throw error
    }
    throw new Error('Cannot reach the NOVA mission stream. Check that FastAPI is running and that the backend URL is correct.')
  }

  if (!response.ok) {
    let detail = `The NOVA API rejected this mission (HTTP ${response.status}).`
    try {
      const data: unknown = await response.json()
      if (typeof data === 'object' && data !== null && 'detail' in data && typeof data.detail === 'string') detail = data.detail
    } catch { /* The HTTP status remains the actionable error. */ }
    throw new Error(detail)
  }
  if (!response.body) throw new Error('The NOVA backend did not provide a readable mission stream.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let reply: ChatReply | null = null
  let streamError: string | null = null
  const dispatch = (frame: string) => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!data) return
    let parsed: unknown
    try { parsed = JSON.parse(data) } catch { throw new Error('The NOVA backend sent an invalid mission event.') }
    if (!isMissionEvent(parsed)) throw new Error('The NOVA backend sent a malformed mission event.')
    onEvent(parsed)
    if (parsed.type === 'failed') streamError = parsed.error || parsed.description
    if (parsed.type === 'completed') {
      if (typeof parsed.answer !== 'string' || typeof parsed.mode !== 'string' || typeof parsed.model !== 'string' || !Array.isArray(parsed.sources)) {
        throw new Error('The NOVA backend completed the stream without a valid answer.')
      }
      reply = { answer: parsed.answer, mode: parsed.mode, model: parsed.model, sources: parsed.sources }
    }
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        if (buffer.trim()) dispatch(buffer)
        break
      }
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.search(/\r?\n\r?\n/)
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        const delimiterLength = buffer[boundary] === '\r' ? 4 : 2
        buffer = buffer.slice(boundary + delimiterLength)
        dispatch(frame)
        boundary = buffer.search(/\r?\n\r?\n/)
      }
    }
  } catch (error) {
    try { await reader.cancel() } catch { /* The stream may already be closed. */ }
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('NOVA mission timed out after 120 seconds. Check the FastAPI terminal and provider availability.')
    }
    throw error
  } finally {
    reader.releaseLock()
  }
  if (streamError) throw new Error(streamError)
  if (!reply) throw new Error('The NOVA mission stream ended before a completion event arrived.')
  return reply
}
