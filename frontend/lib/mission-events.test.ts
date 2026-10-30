import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MissionEvent } from './nova-api.ts'
import { applyMissionEvent, createMissionState, markMissionInterrupted } from './mission-events.ts'
import { novaMission } from './nova-api.ts'

function event(
  sequence: number,
  stage: string,
  nodeId: string,
  status: MissionEvent['status'],
  type: MissionEvent['type'] = 'step',
  dependsOn: string[] = [],
): MissionEvent {
  return {
    type,
    mission_id: 'mission-test',
    sequence,
    stage,
    node_id: nodeId,
    depends_on: dependsOn,
    status,
    timestamp: new Date(0).toISOString(),
    description: `${stage} ${status}`,
    ...(type === 'completed' ? { answer: 'Done.', mode: 'chat', model: 'test-model', sources: [] } : {}),
  }
}

test('graph starts with no speculative stages and applies sequential backend events', () => {
  let state = createMissionState('Explain this.')
  assert.equal(state.nodes.length, 0)
  assert.equal(state.status, 'connecting')

  state = applyMissionEvent(state, event(1, 'request_received', 'mission_received', 'completed'))
  state = applyMissionEvent(state, event(2, 'planning', 'planning', 'running', 'step', ['mission_received']))
  assert.deepEqual(state.nodes.map(node => node.id), ['mission_received', 'planning'])
  assert.equal(state.nodes[1].dependsOn[0], 'mission_received')
  assert.equal(state.nodes[1].status, 'running')
})

test('conditional stages stay omitted when the backend does not execute them', () => {
  let state = createMissionState('A direct question.')
  state = applyMissionEvent(state, event(1, 'request_received', 'mission_received', 'completed'))
  state = applyMissionEvent(state, event(2, 'analysis', 'analysis', 'running', 'step', ['mission_received']))
  assert.deepEqual(state.nodes.map(node => node.stage), ['request_received', 'analysis'])
  assert.equal(state.nodes.some(node => node.stage === 'tavily_search'), false)
})

test('completed and failed stages reflect terminal backend events', () => {
  let completed = createMissionState('Complete this.')
  completed = applyMissionEvent(completed, event(1, 'response_delivery', 'response_delivery', 'completed', 'completed'))
  assert.equal(completed.status, 'completed')
  assert.equal(completed.answer, 'Done.')

  let failed = createMissionState('Fail this.')
  failed = applyMissionEvent(failed, {
    ...event(1, 'analysis', 'analysis', 'failed', 'failed'),
    error: 'Model unavailable.',
  })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.nodes[0].error, 'Model unavailable.')
})

test('four completed execution nodes plus final response produce a completed mission', () => {
  let state = createMissionState('Plan my day.')
  const stages = [
    ['request_received', 'mission_received', []],
    ['planning', 'planning', ['mission_received']],
    ['analysis', 'analysis', ['planning']],
    ['response_delivery', 'response_delivery', ['analysis']],
  ] as const
  stages.forEach(([stage, nodeId, dependsOn], index) => {
    state = applyMissionEvent(state, event(index + 1, stage, nodeId, 'completed', 'step', [...dependsOn]))
  })
  assert.equal(state.status, 'running')
  assert.equal(state.nodes.length, 4)
  assert.equal(state.nodes.every(node => node.status === 'completed'), true)

  state = applyMissionEvent(state, event(5, 'response_delivery', 'response_delivery', 'completed', 'completed', ['analysis']))
  assert.equal(state.status, 'completed')
  assert.equal(state.nodes.filter(node => node.status === 'completed').length, 4)
  assert.equal(state.answer, 'Done.')
})

test('backend failure after completed stage nodes changes the mission to failed', () => {
  let state = createMissionState('Plan my day.')
  const stages = [
    ['request_received', 'mission_received', []],
    ['planning', 'planning', ['mission_received']],
    ['analysis', 'analysis', ['planning']],
    ['response_delivery', 'response_delivery', ['analysis']],
  ] as const
  stages.forEach(([stage, nodeId, dependsOn], index) => {
    state = applyMissionEvent(state, event(index + 1, stage, nodeId, 'completed', 'step', [...dependsOn]))
  })
  const backendFailure = {
    ...event(5, 'response_delivery', 'response_delivery', 'failed', 'failed', ['analysis']),
    error: 'Response persistence failed.',
  }
  state = applyMissionEvent(state, backendFailure)
  assert.equal(state.status, 'failed')
  assert.equal(state.error, 'Response persistence failed.')
  assert.equal(state.nodes.find(node => node.id === 'response_delivery')?.status, 'failed')
  assert.equal(state.nodes.filter(node => node.status === 'completed').length, 3)
})

test('cancellation marks only actually running nodes without inventing timestamps', () => {
  let state = createMissionState('Cancel this.')
  state = applyMissionEvent(state, event(1, 'planning', 'planning', 'running'))
  state = markMissionInterrupted(state, 'cancelled', 'Client cancelled.')
  assert.equal(state.nodes[0].status, 'cancelled')
  assert.equal(state.nodes[0].timestamp, new Date(0).toISOString())
  assert.equal(state.nodes.length, 1)
  assert.equal(state.status, 'cancelled')
})

test('out-of-order and cross-mission events are rejected by the reducer', () => {
  const initial = createMissionState('Order matters.')
  assert.throws(() => applyMissionEvent(initial, event(2, 'planning', 'planning', 'running')), /out of order/)
  const accepted = applyMissionEvent(initial, event(1, 'request_received', 'mission_received', 'completed'))
  assert.throws(() => applyMissionEvent(accepted, {
    ...event(2, 'analysis', 'analysis', 'running'),
    mission_id: 'another-mission',
  }), /Mission ID changed/)
})

test('SSE reader rejects gaps and does not fabricate success when the stream ends early', async () => {
  const originalFetch = globalThis.fetch
  const start = event(2, 'planning', 'planning', 'running')
  globalThis.fetch = async () => new Response(`data: ${JSON.stringify(start)}\n\n`)
  try {
    await assert.rejects(
      novaMission('http://localhost:8000', { message: 'Test.', research: false }, new AbortController().signal, () => {}),
      /out of order or with a gap/,
    )

    const incomplete = event(1, 'planning', 'planning', 'running')
    globalThis.fetch = async () => new Response(`data: ${JSON.stringify(incomplete)}\n\n`)
    await assert.rejects(
      novaMission('http://localhost:8000', { message: 'Test.', research: false }, new AbortController().signal, () => {}),
      /ended before a completion event/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('known legacy step_id SSE events normalize into ordered graph events', async () => {
  const originalFetch = globalThis.fetch
  const legacyEvents = [
    { type: 'step', step_id: 'accepted', status: 'completed', timestamp: new Date(0).toISOString(), description: 'NOVA accepted the mission request.' },
    { type: 'step', step_id: 'planning', status: 'running', timestamp: new Date(1).toISOString(), description: 'Preparing context.' },
    { type: 'step', step_id: 'planning', status: 'completed', timestamp: new Date(2).toISOString(), description: 'Context ready.' },
    { type: 'step', step_id: 'analysis', status: 'running', timestamp: new Date(3).toISOString(), description: 'Calling model.' },
    { type: 'step', step_id: 'analysis', status: 'completed', timestamp: new Date(4).toISOString(), description: 'Model returned.' },
    { type: 'completed', step_id: 'mission', status: 'completed', timestamp: new Date(5).toISOString(), description: 'Mission complete.', answer: 'Done.', mode: 'chat', model: 'test-model', sources: [] },
  ]
  globalThis.fetch = async () => new Response(legacyEvents.map(item => `data: ${JSON.stringify(item)}\n\n`).join(''))
  const received: MissionEvent[] = []
  try {
    const reply = await novaMission(
      'http://localhost:8000',
      { message: 'Help me plan my day.', research: false },
      new AbortController().signal,
      item => received.push(item),
    )
    assert.equal(reply.answer, 'Done.')
    assert.deepEqual(received.map(item => item.sequence), [1, 2, 3, 4, 5, 6])
    assert.deepEqual(received.map(item => item.stage), [
      'request_received', 'planning', 'planning', 'analysis', 'analysis', 'response_delivery',
    ])
    assert.deepEqual(received[1].depends_on, ['mission_received'])
    assert.deepEqual(received[5].depends_on, ['analysis'])
    assert.equal(received.every(item => item.mission_id.startsWith('legacy-')), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('duplicate successful terminal payload is delivered once despite JSON key reordering', async () => {
  const originalFetch = globalThis.fetch
  const terminalEvent = event(1, 'response_delivery', 'response_delivery', 'completed', 'completed')
  const frame = `data: ${JSON.stringify(terminalEvent)}\n\n`
  const reorderedPayload = Object.fromEntries(Object.entries(terminalEvent).reverse())
  const duplicateFrame = `data: ${JSON.stringify(reorderedPayload)}\n\n`
  globalThis.fetch = async () => new Response(frame + duplicateFrame)
  const received: MissionEvent[] = []
  try {
    const reply = await novaMission(
      'http://localhost:8000',
      { message: 'Test.', research: false },
      new AbortController().signal,
      item => received.push(item),
    )
    assert.equal(reply.answer, 'Done.')
    assert.equal(received.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('backend failure after a completed-node event remains the authoritative terminal result', async () => {
  const originalFetch = globalThis.fetch
  const completedNode = event(1, 'response_delivery', 'response_delivery', 'completed', 'step')
  const backendFailure: MissionEvent = {
    ...event(2, 'response_delivery', 'response_delivery', 'failed', 'failed'),
    error: 'Backend persistence failed.',
  }
  globalThis.fetch = async () => new Response(
    [completedNode, backendFailure].map(item => `data: ${JSON.stringify(item)}\n\n`).join(''),
  )
  const received: MissionEvent[] = []
  try {
    await assert.rejects(
      novaMission(
        'http://localhost:8000',
        { message: 'Test.', research: false },
        new AbortController().signal,
        item => received.push(item),
      ),
      /Backend persistence failed\./,
    )
    assert.deepEqual(received.map(item => item.type), ['step', 'failed'])
    assert.equal(received.at(-1)?.error, 'Backend persistence failed.')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('completed graph stages without a final response remain interrupted, not successful', async () => {
  const originalFetch = globalThis.fetch
  const stages = [
    ['request_received', 'mission_received', []],
    ['planning', 'planning', ['mission_received']],
    ['analysis', 'analysis', ['planning']],
    ['response_delivery', 'response_delivery', ['analysis']],
  ] as const
  const events = stages.map(([stage, nodeId, dependsOn], index) =>
    event(index + 1, stage, nodeId, 'completed', 'step', [...dependsOn]))
  globalThis.fetch = async () => new Response(events.map(item => `data: ${JSON.stringify(item)}\n\n`).join(''))
  let state = createMissionState('Interrupted.')
  try {
    await assert.rejects(
      novaMission('http://localhost:8000', { message: 'Test.', research: false }, new AbortController().signal, item => {
        state = applyMissionEvent(state, item)
      }),
      /ended before a completion event/,
    )
    assert.equal(state.nodes.length, 4)
    assert.equal(state.nodes.every(node => node.status === 'completed'), true)
    assert.equal(state.status, 'running')
    assert.equal(state.answer, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('unknown malformed event reports its invalid fields instead of a generic schema error', async () => {
  const originalFetch = globalThis.fetch
  const malformed = {
    type: 'step',
    mission_id: 'mission-test',
    sequence: 1,
    stage: 'planning',
    status: 'running',
    timestamp: new Date(0).toISOString(),
    description: 'Preparing context.',
  }
  globalThis.fetch = async () => new Response(`data: ${JSON.stringify(malformed)}\n\n`)
  try {
    await assert.rejects(
      novaMission('http://localhost:8000', { message: 'Test.', research: false }, new AbortController().signal, () => {}),
      /invalid or missing fields: node_id, depends_on/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('backend disconnection is surfaced instead of leaving a false running state', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('network disconnected') }
  try {
    await assert.rejects(
      novaMission('http://localhost:8000', { message: 'Test.', research: false }, new AbortController().signal, () => {}),
      /Cannot reach the NOVA mission stream/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
