import type { ChatSource, MissionEvent } from './nova-api'

export type MissionNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped'

export interface MissionGraphNode {
  id: string
  stage: string
  title: string
  status: MissionNodeStatus
  description: string
  dependsOn: string[]
  firstSequence: number
  startedAt?: string
  endedAt?: string
  timestamp?: string
  details?: Record<string, unknown>
  output?: string
  error?: string
  sources?: ChatSource[]
}

export interface MissionState {
  request: string
  status: 'connecting' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: string
  nodes: MissionGraphNode[]
  missionId?: string
  lastSequence: number
  answer?: string
  error?: string
  model?: string
  mode?: string
  sources?: ChatSource[]
}

const stageTitles: Record<string, string> = {
  request_received: 'Request received',
  planning: 'Context preparation',
  tavily_search: 'Tavily web search',
  analysis: 'Model inference',
  response_delivery: 'Response delivery',
}

export function createMissionState(request: string): MissionState {
  return {
    request,
    status: 'connecting',
    progress: 'Waiting for backend acceptance.',
    nodes: [],
    lastSequence: 0,
  }
}

export function applyMissionEvent(mission: MissionState, event: MissionEvent): MissionState {
  if (mission.status === 'failed' || mission.status === 'cancelled') {
    throw new Error('Mission already reached a terminal state.')
  }
  if (mission.status === 'completed' && event.type !== 'failed') {
    throw new Error('A completed mission cannot accept another non-failure event.')
  }
  if (mission.missionId && mission.missionId !== event.mission_id) {
    throw new Error('Mission ID changed while applying an execution event.')
  }
  if (event.sequence !== mission.lastSequence + 1) {
    throw new Error('Mission execution events were received out of order.')
  }

  const priorNode = mission.nodes.find(node => node.id === event.node_id)
  const node: MissionGraphNode = {
    id: event.node_id,
    stage: event.stage,
    title: stageTitles[event.stage] ?? event.stage.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()),
    status: event.status,
    description: event.description,
    dependsOn: priorNode?.dependsOn ?? event.depends_on,
    firstSequence: priorNode?.firstSequence ?? event.sequence,
    startedAt: priorNode?.startedAt ?? (event.status === 'running' ? event.timestamp : undefined),
    endedAt: event.status === 'running' ? undefined : event.timestamp,
    timestamp: event.timestamp,
    details: event.details,
    output: event.type === 'completed'
      ? event.answer
      : event.sources?.map(source => `${source.title}: ${source.url}`).join('\n') || undefined,
    error: event.error,
    sources: event.sources,
  }
  const nodes = priorNode
    ? mission.nodes.map(existing => existing.id === node.id ? node : existing)
    : [...mission.nodes, node]

  return {
    ...mission,
    missionId: event.mission_id,
    lastSequence: event.sequence,
    status: event.type === 'completed'
      ? 'completed'
      : event.type === 'failed'
        ? 'failed'
        : event.type === 'cancelled'
          ? 'cancelled'
          : 'running',
    progress: event.description,
    nodes,
    answer: event.type === 'completed' ? event.answer : mission.answer,
    model: event.type === 'completed' ? event.model : mission.model,
    mode: event.type === 'completed' ? event.mode : mission.mode,
    sources: event.type === 'completed' ? event.sources : mission.sources,
    error: event.type === 'failed' || event.type === 'cancelled'
      ? event.error || event.description
      : mission.error,
  }
}

export function markMissionInterrupted(
  mission: MissionState,
  status: 'failed' | 'cancelled',
  error: string,
): MissionState {
  return {
    ...mission,
    status,
    progress: error,
    error,
    nodes: mission.nodes.map(node => node.status === 'running'
      ? { ...node, status, description: error, error }
      : node),
  }
}
