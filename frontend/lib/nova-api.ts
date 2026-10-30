import { authorizationHeaders, isSupabaseConfigured } from './supabase.ts'

export interface ChatSource { title: string; url: string; snippet?: string; score?: number }
export interface ChatReply { answer: string; mode: string; model: string; sources: ChatSource[] }
export interface MissionEvent {
  type: 'step' | 'completed' | 'failed' | 'cancelled'
  mission_id: string
  sequence: number
  stage: string
  node_id: string
  depends_on: string[]
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  timestamp: string
  description: string
  details?: Record<string, unknown>
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
  database: string
  windows_desktop_available: boolean
  note: string
}

export async function novaRequest<T>(base: string, path: string, body?: unknown, method?: string, options?: { signal?: AbortSignal }): Promise<T> {
  if (!base) throw new Error('Backend not connected. Open Settings to connect your local FastAPI server. Your message has not been sent.')
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS backend URL without credentials.')
  if (isSupabaseConfigured() && typeof window !== 'undefined' && url.origin !== window.location.origin) {
    throw new Error('Authenticated NOVA requests must use the same-origin backend proxy.')
  }
  let response: Response
  try {
    const timeoutSignal = AbortSignal.timeout(60000)
    const signal = options?.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
    response = await fetch(`${base.replace(/\/$/, '')}/api/${path}`, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...await authorizationHeaders() },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
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
  const validDetails = event.details === undefined || (
    typeof event.details === 'object' && event.details !== null && !Array.isArray(event.details)
  )
  const validSources = event.sources === undefined || (Array.isArray(event.sources) && event.sources.every(source =>
    typeof source === 'object' && source !== null && 'title' in source && typeof source.title === 'string'
      && 'url' in source && typeof source.url === 'string'
      && (!('snippet' in source) || typeof source.snippet === 'string')
      && (!('score' in source) || typeof source.score === 'number')))
  const validResult = event.type !== 'completed'
    || (typeof event.answer === 'string' && typeof event.mode === 'string' && typeof event.model === 'string'
      && Array.isArray(event.sources) && validSources)
  return (event.type === 'step' || event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled')
    && typeof event.mission_id === 'string'
    && event.mission_id.length > 0
    && Number.isSafeInteger(event.sequence)
    && Number(event.sequence) > 0
    && typeof event.stage === 'string'
    && typeof event.node_id === 'string'
    && Array.isArray(event.depends_on)
    && event.depends_on.every(dependency => typeof dependency === 'string')
    && (event.status === 'running' || event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled')
    && typeof event.timestamp === 'string'
    && typeof event.description === 'string'
    && validDetails
    && validSources
    && validResult
    && (event.error === undefined || typeof event.error === 'string')
}

type LegacyMissionEvent = {
  type: 'step' | 'completed' | 'failed' | 'cancelled'
  step_id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  timestamp: string
  description: string
  answer?: string
  mode?: string
  model?: string
  sources?: ChatSource[]
  error?: string
}

interface LegacyMissionContext {
  missionId: string
  sequence: number
  previousCompletedNode: string | null
  dependenciesByNode: Map<string, string[]>
}

const legacyStageIds: Record<string, { stage: string; nodeId: string }> = {
  accepted: { stage: 'request_received', nodeId: 'mission_received' },
  request_received: { stage: 'request_received', nodeId: 'mission_received' },
  planning: { stage: 'planning', nodeId: 'planning' },
  tavily_search: { stage: 'tavily_search', nodeId: 'research' },
  research: { stage: 'tavily_search', nodeId: 'research' },
  analysis: { stage: 'analysis', nodeId: 'analysis' },
  mission: { stage: 'response_delivery', nodeId: 'response_delivery' },
  final_result: { stage: 'response_delivery', nodeId: 'response_delivery' },
}

function isLegacyMissionEvent(value: unknown): value is LegacyMissionEvent {
  if (typeof value !== 'object' || value === null) return false
  const event = value as Record<string, unknown>
  return (event.type === 'step' || event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled')
    && typeof event.step_id === 'string'
    && typeof event.status === 'string'
    && ['running', 'completed', 'failed', 'cancelled'].includes(event.status)
    && typeof event.timestamp === 'string'
    && typeof event.description === 'string'
    && (event.answer === undefined || typeof event.answer === 'string')
    && (event.mode === undefined || typeof event.mode === 'string')
    && (event.model === undefined || typeof event.model === 'string')
    && (event.error === undefined || typeof event.error === 'string')
    && (event.sources === undefined || (Array.isArray(event.sources) && event.sources.every(source =>
      typeof source === 'object' && source !== null && 'title' in source && typeof source.title === 'string'
        && 'url' in source && typeof source.url === 'string')))
}

function normalizeLegacyMissionEvent(value: LegacyMissionEvent, context: LegacyMissionContext): MissionEvent {
  const finalResponse = value.type === 'completed' && value.step_id === 'mission'
  const { stage, nodeId } = legacyStageIds[value.step_id] ?? {
    stage: value.step_id,
    nodeId: value.step_id,
  }
  const status = finalResponse ? 'completed' : value.status
  if (!context.dependenciesByNode.has(nodeId)) {
    context.dependenciesByNode.set(
      nodeId,
      context.previousCompletedNode && context.previousCompletedNode !== nodeId
        ? [context.previousCompletedNode]
        : [],
    )
  }
  const normalized: MissionEvent = {
    type: value.type,
    mission_id: context.missionId,
    sequence: ++context.sequence,
    stage,
    node_id: nodeId,
    depends_on: context.dependenciesByNode.get(nodeId)!,
    status,
    timestamp: value.timestamp,
    description: value.description,
    ...(value.answer !== undefined ? { answer: value.answer } : {}),
    ...(value.mode !== undefined ? { mode: value.mode } : {}),
    ...(value.model !== undefined ? { model: value.model } : {}),
    ...(value.sources !== undefined ? { sources: value.sources } : {}),
    ...(value.error !== undefined ? { error: value.error } : {}),
  }
  if (status === 'completed') context.previousCompletedNode = nodeId
  return normalized
}

function malformedEventDescription(value: unknown): string {
  if (typeof value !== 'object' || value === null) return 'event must be a JSON object'
  const event = value as Record<string, unknown>
  if ('step_id' in event && !('mission_id' in event)) {
    return 'legacy step_id event could not be normalized (unknown stage or invalid legacy fields)'
  }
  const required: Array<[string, (field: unknown) => boolean]> = [
    ['type', field => field === 'step' || field === 'completed' || field === 'failed' || field === 'cancelled'],
    ['mission_id', field => typeof field === 'string' && field.length > 0],
    ['sequence', field => Number.isSafeInteger(field) && Number(field) > 0],
    ['stage', field => typeof field === 'string'],
    ['node_id', field => typeof field === 'string'],
    ['depends_on', field => Array.isArray(field) && field.every(item => typeof item === 'string')],
    ['status', field => field === 'running' || field === 'completed' || field === 'failed' || field === 'cancelled'],
    ['timestamp', field => typeof field === 'string'],
    ['description', field => typeof field === 'string'],
  ]
  const invalid = required.filter(([key, valid]) => !valid(event[key])).map(([key]) => key)
  return invalid.length ? `invalid or missing fields: ${invalid.join(', ')}` : 'optional fields have invalid types'
}

function stableEventValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableEventValue).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableEventValue(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
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
  if (isSupabaseConfigured() && typeof window !== 'undefined' && url.origin !== window.location.origin) {
    throw new Error('Authenticated NOVA requests must use the same-origin backend proxy.')
  }

  let response: Response
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/api/mission`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...await authorizationHeaders(),
      },
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
  let streamCancelled = false
  let missionId: string | null = null
  let lastSequence = 0
  let terminalEvent: MissionEvent | null = null
  let terminalEventPayload: unknown
  const legacyContext: LegacyMissionContext = {
    missionId: `legacy-${crypto.randomUUID()}`,
    sequence: 0,
    previousCompletedNode: null,
    dependenciesByNode: new Map(),
  }
  const dispatch = (frame: string) => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!data) return
    let payload: unknown
    try { payload = JSON.parse(data) } catch { throw new Error('The NOVA backend sent an invalid mission event.') }
    if (terminalEvent && stableEventValue(payload) === stableEventValue(terminalEventPayload)) return
    let parsed: MissionEvent
    if (isMissionEvent(payload)) {
      parsed = payload
    } else if (isLegacyMissionEvent(payload) && legacyStageIds[payload.step_id]) {
      parsed = normalizeLegacyMissionEvent(payload, legacyContext)
    } else {
      throw new Error(`The NOVA backend sent a malformed mission event (${malformedEventDescription(payload)}).`)
    }
    const failureAfterCompleted = terminalEvent?.type === 'completed' && parsed.type === 'failed'
    if (terminalEvent && !failureAfterCompleted) {
      throw new Error(`The NOVA backend sent a ${parsed.type} event after the mission had terminated with ${terminalEvent.type}.`)
    }
    if (missionId !== null && parsed.mission_id !== missionId) throw new Error('The NOVA backend changed mission IDs within the event stream.')
    if (parsed.sequence !== lastSequence + 1) throw new Error('The NOVA backend sent mission events out of order or with a gap.')
    missionId = parsed.mission_id
    lastSequence = parsed.sequence
    onEvent(parsed)
    if (parsed.type === 'failed') streamError = parsed.error || parsed.description
    if (parsed.type === 'cancelled') {
      streamError = parsed.error || parsed.description
      streamCancelled = true
    }
    if (parsed.type === 'completed') {
      if (typeof parsed.answer !== 'string' || typeof parsed.mode !== 'string' || typeof parsed.model !== 'string' || !Array.isArray(parsed.sources)) {
        throw new Error('The NOVA backend completed the stream without a valid answer.')
      }
      reply = { answer: parsed.answer, mode: parsed.mode, model: parsed.model, sources: parsed.sources }
    }
    if (parsed.type === 'failed' || parsed.type === 'cancelled' || parsed.type === 'completed') {
      terminalEvent = parsed
      terminalEventPayload = payload
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
  if (streamCancelled) throw new DOMException(streamError || 'Mission cancelled.', 'AbortError')
  if (streamError) throw new Error(streamError)
  if (!reply) throw new Error('The NOVA mission stream ended before a completion event arrived.')
  return reply
}
