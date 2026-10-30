'use client'

import dynamic from 'next/dynamic'
import { useState, type RefObject } from 'react'
import { Activity, ArrowUp, Brain, Check, ChevronRight, Database, Globe, LogOut, MessageSquare, Mic, Settings, Terminal, Volume2, X } from 'lucide-react'
import type { BackendStatus, ChatSource } from '@/lib/nova-api'
import type { MissionGraphNode, MissionState } from '@/lib/mission-events'
import type { CoreState } from './orb'

type ConversationEntry = {
  role: 'user' | 'assistant' | 'system'
  content: string
  mode?: string
  model?: string
  sources?: ChatSource[]
}

interface MissionDashboardProps {
  status: BackendStatus | null
  mission: MissionState | null
  messages: ConversationEntry[]
  selectedNodeId: string
  onSelectNode: (id: string) => void
  onToggleMissionMode: () => void
  onExit: () => void
  onOpenPanel: (panel: 'memory' | 'tools' | 'settings' | 'voice') => void
  onNewChat: () => void
  onSend: () => void
  onCancel: () => void
  onListen: () => void
  onToggleResearch: () => void
  onToggleSpeech: () => void
  onStopSpeaking: () => void
  input: string
  setInput: (value: string) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  transcriptRef: RefObject<HTMLDivElement | null>
  busy: boolean
  state: CoreState
  research: boolean
  sound: boolean
  notice: string
  reducedMotion: boolean
  onDismissNotice: () => void
  onSignOut?: () => void
}

function displayDuration(node: MissionGraphNode) {
  if (!node.startedAt || !node.endedAt) return null
  const started = Date.parse(node.startedAt)
  const ended = Date.parse(node.endedAt)
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return null
  return `${((ended - started) / 1000).toFixed(1)}s`
}

function nodeStatusText(status: MissionGraphNode['status']) {
  if (status === 'cancelled') return 'INTERRUPTED'
  return status.toUpperCase()
}

function detailValue(value: unknown) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function SourceList({ sources }: { sources: ChatSource[] }) {
  if (!sources.length) return null
  return <ul className="mission-source-list">
    {sources.map(source => <li key={source.url}>
      <a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a>
    </li>)}
  </ul>
}

export default function MissionDashboard({
  status,
  mission,
  messages,
  selectedNodeId,
  onSelectNode,
  onToggleMissionMode,
  onExit,
  onOpenPanel,
  onNewChat,
  onSend,
  onCancel,
  onListen,
  onToggleResearch,
  onToggleSpeech,
  onStopSpeaking,
  input,
  setInput,
  inputRef,
  transcriptRef,
  busy,
  state,
  research,
  sound,
  notice,
  reducedMotion,
  onDismissNotice,
  onSignOut,
}: MissionDashboardProps) {
  const [rightTab, setRightTab] = useState<'chat' | 'details'>('chat')
  const nodes = mission?.nodes ?? []
  const selectedNode = nodes.find(node => node.id === selectedNodeId) ?? nodes.at(-1)
  const completedCount = nodes.filter(node => node.status === 'completed').length
  const history = messages
    .map((message, index) => ({ message, index }))
    .filter(item => item.message.role === 'user')

  function showHistoryItem(index: number) {
    const transcript = transcriptRef.current
    const target = transcript?.querySelector<HTMLElement>(`[data-message-index="${index}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return <main className="command-center mission-command-center">
    <header className="mission-topbar">
      <button className="mission-brand" onClick={onExit} aria-label="Return to NOVA chat">
        <span className="mission-brand-mark">N</span>
        <span><strong>NOVA</strong><small>INTELLIGENCE, IN YOUR ORBIT</small></span>
      </button>
      <nav className="mission-topnav" aria-label="Workspace sections">
        <button onClick={onExit}><MessageSquare size={14} />CHAT</button>
        <button
          className="active"
          type="button"
          aria-pressed="true"
          aria-label="Mission Mode ON. Turn off to use normal chat."
          onClick={onToggleMissionMode}
        ><Activity size={14} />MISSION MODE ON</button>
        <button onClick={() => onOpenPanel('memory')}><Brain size={14} />KNOWLEDGE</button>
        <button onClick={() => onOpenPanel('tools')}><Terminal size={14} />TOOLS</button>
        <button onClick={() => onOpenPanel('settings')}><Settings size={14} />SETTINGS</button>
      </nav>
      <div className={`mission-local-mode ${status ? 'online' : ''}`}><i />{status ? 'LOCAL MODE' : 'BACKEND OFFLINE'}</div>
      <button className="mission-audio-toggle" onClick={onToggleSpeech} aria-label={sound ? 'Mute spoken responses' : 'Enable spoken responses'}>
        {sound ? <Volume2 size={16} /> : <Volume2 size={16} />}<span>{sound ? 'AUDIO ON' : 'AUDIO OFF'}</span>
      </button>
      {onSignOut && <button className="mission-signout" onClick={onSignOut}><LogOut size={14} /> SIGN OUT</button>}
    </header>

    <div className="mission-workspace">
      <aside className="mission-sidebar" aria-label="Mission navigation">
        <div className="mission-sidebar-main">
          <button className="mission-sidebar-action" onClick={onNewChat} disabled={busy}>
            <MessageSquare size={17} />New Chat
          </button>
          <button className="mission-sidebar-action selected" aria-current="page">
            <Activity size={17} />Mission Mode
          </button>
          <button className={`mission-sidebar-action ${research ? 'selected' : ''}`} onClick={onToggleResearch} aria-pressed={research}>
            <Globe size={17} />Research {research ? 'Enabled' : 'Agent'}
          </button>
          <button className="mission-sidebar-action" onClick={() => onOpenPanel('tools')}>
            <Terminal size={17} />Tools
          </button>
          <div className="mission-history-heading">CURRENT CONVERSATION</div>
          <div className="mission-history" aria-label="Current conversation messages">
            {history.length ? history.map(({ message, index }) => (
              <button key={index} title={message.content} onClick={() => showHistoryItem(index)}>
                <ChevronRight size={13} /><span>{message.content}</span>
              </button>
            )) : <p>Your current conversation will appear here.</p>}
          </div>
        </div>
        <button className="mission-profile" onClick={() => onOpenPanel('voice')}>
          <span className="mission-profile-orb">N</span>
          <span><strong>NOVA</strong><small>Your AI Engineering Assistant</small></span>
        </button>
      </aside>

      <section className="mission-center-column" aria-label="Mission execution">
        <div className="mission-graph-host">
          <div className="mission-graph-placeholder">
            <DynamicMissionGraphProxy
              nodes={nodes}
              status={mission?.status ?? 'connecting'}
              reducedMotion={reducedMotion}
              request={mission?.request ?? ''}
              selectedNodeId={selectedNode?.id ?? ''}
              onSelectNode={onSelectNode}
            />
          </div>
        </div>

        <div className="mission-inspection">
          <section className="mission-steps-panel" aria-label="Actual execution steps">
            <header><span>EXECUTION STEPS</span><strong>{completedCount}/{nodes.length} COMPLETED</strong></header>
            {nodes.length ? <ol>
              {nodes.map((node, index) => {
                const duration = displayDuration(node)
                return <li key={node.id} className={`${node.status} ${selectedNode?.id === node.id ? 'selected' : ''}`}>
                  <button type="button" onClick={() => onSelectNode(node.id)} aria-pressed={selectedNode?.id === node.id}>
                    <span className="mission-step-mark">{node.status === 'completed' ? <Check size={14} /> : node.status === 'failed' ? '!' : node.status === 'cancelled' ? '×' : '·'}</span>
                    <span className="mission-step-content">
                      <strong>{index + 1}. {node.title}</strong>
                      <small>{node.description}</small>
                    </span>
                    {duration && <time>{duration}</time>}
                  </button>
                </li>
              })}
            </ol> : <p className="mission-empty-steps">Execution stages appear here only after NOVA reports them.</p>}
          </section>

          <section className="mission-node-details" aria-label="Selected node details">
            <header>
              <span>NODE DETAILS</span>
              {selectedNode && <strong className={`mission-detail-status ${selectedNode.status}`}>{nodeStatusText(selectedNode.status)}</strong>}
            </header>
            {selectedNode ? <div className="mission-node-detail-body">
              <div className={`mission-detail-emblem ${selectedNode.status}`}><Activity size={21} /></div>
              <div className="mission-detail-title">
                <strong>{nodes.findIndex(node => node.id === selectedNode.id) + 1}. {selectedNode.title}</strong>
                {displayDuration(selectedNode) && <small>{displayDuration(selectedNode)}</small>}
                <p>{selectedNode.error || selectedNode.description}</p>
              </div>
              {selectedNode.dependsOn.length > 0 && <p className="mission-dependencies">
                <span>DEPENDS ON</span>
                {selectedNode.dependsOn.map(id => nodes.find(node => node.id === id)?.title ?? id).join(' · ')}
              </p>}
              {selectedNode.details && <details className="mission-detail-accordion" open>
                <summary>EVENT DETAILS</summary>
                <dl><div><dt>first event sequence</dt><dd>{selectedNode.firstSequence}</dd></div>{Object.entries(selectedNode.details).map(([key, value]) => <div key={key}>
                  <dt>{key.replaceAll('_', ' ')}</dt><dd>{detailValue(value)}</dd>
                </div>)}</dl>
              </details>}
              {!selectedNode.details && <small className="mission-raw-sequence">First backend event sequence: {selectedNode.firstSequence}</small>}
              {mission?.model && <details className="mission-detail-accordion">
                <summary>MODEL CONFIGURATION</summary>
                <p>{mission.model}</p>
              </details>}
              {selectedNode.output && <details className="mission-detail-accordion">
                <summary>OUTPUT SUMMARY</summary>
                <p>{selectedNode.output}</p>
              </details>}
              {selectedNode.sources && <SourceList sources={selectedNode.sources} />}
              {selectedNode.timestamp && <time className="mission-node-time" dateTime={selectedNode.timestamp}>
                Last event: {new Date(selectedNode.timestamp).toLocaleTimeString()}
              </time>}
            </div> : <p className="mission-node-empty">Select an execution node to inspect backend-reported details.</p>}
          </section>
        </div>
      </section>

      <aside className="mission-chat-panel" aria-label="Mission conversation">
        <header className="mission-chat-tabs">
          <button className={rightTab === 'chat' ? 'active' : ''} onClick={() => setRightTab('chat')}>CHAT</button>
          <button className={rightTab === 'details' ? 'active' : ''} onClick={() => setRightTab('details')}>MISSION DETAILS</button>
        </header>
        {rightTab === 'chat' ? <>
          <div className="mission-chat-transcript" ref={transcriptRef} role="log" aria-live="polite">
            {mission && <section className={`mission-chat-status ${mission.status}`}>
              <div><Activity size={14} /><strong>{mission.status === 'connecting' ? 'AWAITING BACKEND' : `MISSION ${mission.status.toUpperCase()}`}</strong></div>
              <p>{mission.progress}</p>
              {mission.error && <p className="mission-chat-error">{mission.error}</p>}
              {(mission.status === 'running' || mission.status === 'connecting') && <button onClick={onCancel}>Cancel mission</button>}
            </section>}
            {!messages.length && !mission && <div className="mission-chat-empty"><MessageSquare size={19} /><p>Start a mission or send NOVA a message.</p></div>}
            {messages.map((message, index) => <article className={`mission-message ${message.role}`} data-message-index={index} key={index}>
              {message.role === 'user' ? <div className="mission-user-bubble">{message.content}</div> : <>
                <div className="mission-assistant-label"><span className="mission-mini-orb">N</span>NOVA</div>
                <p>{message.content}</p>
                {message.model && <small>{message.mode} · {message.model}</small>}
                <SourceList sources={message.sources ?? []} />
              </>}
            </article>)}
            {busy && !mission && <p className="mission-chat-waiting">Waiting for the backend response…</p>}
          </div>
          {notice && <div className="mission-notice" role="status">{notice}<button onClick={onDismissNotice} aria-label="Dismiss notice"><X size={13} /></button></div>}
          <form className="mission-composer" onSubmit={event => { event.preventDefault(); onSend() }}>
            <textarea
              ref={inputRef}
              aria-label="Message NOVA"
              placeholder="Send a message to NOVA…"
              rows={1}
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  onSend()
                }
              }}
            />
            <button type="button" className={state === 'listening' ? 'listening' : ''} aria-label={state === 'listening' ? 'Stop listening' : 'Start voice input'} onClick={onListen} disabled={busy}><Mic size={17} /></button>
            <button type="submit" className="mission-send" aria-label="Run mission" disabled={!input.trim() || busy}><ArrowUp size={18} /></button>
          </form>
          <div className="mission-composer-tools">
            <button className={research ? 'active' : ''} onClick={onToggleResearch} aria-pressed={research}><Globe size={13} />RESEARCH {research ? 'ON' : 'OFF'}</button>
            {(mission?.status === 'running' || mission?.status === 'connecting') && <button onClick={onCancel}>CANCEL</button>}
          </div>
        </> : <div className="mission-details-scroll">
          <h2>{mission?.request || 'No mission submitted'}</h2>
          <div className={`mission-detail-status ${mission?.status ?? 'connecting'}`}>
            {mission?.status === 'connecting' || !mission ? 'AWAITING BACKEND' : mission.status.toUpperCase()}
          </div>
          <dl>
            {mission?.missionId && <div><dt>Mission ID</dt><dd>{mission.missionId}</dd></div>}
            <div><dt>Reported stages</dt><dd>{nodes.length}</dd></div>
            <div><dt>Completed stages</dt><dd>{completedCount}</dd></div>
            {mission?.model && <div><dt>Model</dt><dd>{mission.model}</dd></div>}
            {mission?.mode && <div><dt>Mode</dt><dd>{mission.mode}</dd></div>}
            {mission?.sources && <div><dt>Sources returned</dt><dd>{mission.sources.length}</dd></div>}
          </dl>
          {mission?.error && <p className="mission-chat-error">{mission.error}</p>}
          {mission?.sources && <SourceList sources={mission.sources} />}
          {!mission && <p>Mission metadata appears here as the backend reports it.</p>}
        </div>}
      </aside>
    </div>

    <footer className="mission-statusbar">
      <strong>SYSTEM STATUS</strong>
      <span className={status ? 'ready' : 'offline'}><i />Backend <small>{status ? 'Connected' : 'Disconnected'}</small></span>
      <span className={status?.nebius_configured ? 'ready' : 'offline'}><i />NVIDIA (Nemotron)<small>{status?.nebius_configured ? 'Ready' : 'Not configured'}</small></span>
      <span className={status?.tavily_configured ? 'ready' : 'offline'}><i /><Globe size={13} />Tavily Search<small>{status?.tavily_configured ? 'Configured' : 'Not configured'}</small></span>
      <span className={status ? 'ready' : 'offline'}><i /><Database size={13} />Database<small>{status?.database || 'Unavailable'}</small></span>
      {status?.model && <span className="mission-status-model">MODEL <small>{status.model}</small></span>}
      <button onClick={onStopSpeaking} aria-label="Stop spoken response" className="mission-stop-speaking" disabled={!sound}><Volume2 size={14} />STOP AUDIO</button>
    </footer>
  </main>
}

const DynamicMissionGraphProxy = dynamic(() => import('./mission-graph'), {
  ssr: false,
  loading: () => <div className="mission-graph-loading">Preparing mission visualization…</div>,
})
