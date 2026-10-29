export interface ChatSource { title: string; url: string; snippet?: string; score?: number }
export interface ChatReply { answer: string; mode: string; model: string; sources: ChatSource[] }
export interface BackendStatus {
  nebius_configured: boolean
  tavily_configured: boolean
  model: string | null
  base_url: string
  database: string
  note: string
}

export async function novaRequest<T>(base: string, path: string, body?: unknown, method?: string): Promise<T> {
  if (!base) throw new Error('Backend not connected. Open Settings to connect your local FastAPI server. Your message has not been sent.')
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS backend URL without credentials.')
  let response: Response
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/api/${path}`, { method: method || (body ? 'POST' : 'GET'), headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) })
  } catch {
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
