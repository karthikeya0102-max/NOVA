'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowUp, AudioLines, Brain, ChevronDown, ChevronRight, CircleHelp, Command, Expand, Globe, MessageSquare, Mic, Radio, Settings, ShieldCheck, Sparkles, Terminal, Trash2, Volume2, VolumeX, X, Zap } from 'lucide-react'
import { novaMission, novaRequest, type BackendStatus, type ChatReply, type ChatSource, type MissionEvent } from '@/lib/nova-api'
import type { MissionGraphNode, MissionNodeStatus } from './mission-graph'
import type { CoreState } from './orb'
const Orb = dynamic(() => import('./orb'), { ssr: false })
const DynamicMissionGraph = dynamic(() => import('./mission-graph'), {
  ssr: false,
  loading: () => <div className="mission-graph-loading">Preparing mission visualization…</div>,
})
type Panel = 'conversation' | 'memory' | 'tools' | 'settings' | null
type Entry = { role: 'user' | 'assistant' | 'system'; content: string; mode?: string; model?: string; sources?: ChatSource[] }
type VoiceRecognitionResult = { transcript: string }
type VoiceRecognitionEvent = { resultIndex: number; results: ArrayLike<ArrayLike<VoiceRecognitionResult> & { isFinal: boolean }> }
type VoiceRecognitionError = { error?: string }
type SpeechSession = { start: () => void; stop: () => void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: VoiceRecognitionEvent) => void) | null; onerror: ((e: VoiceRecognitionError) => void) | null; onend: (() => void) | null }
type VoiceMode = 'command' | 'wake' | 'wake-command'
type Mission = { request: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; progress: string; nodes: MissionGraphNode[]; answer?: string; error?: string; model?: string; mode?: string; sources?: ChatSource[] }

function createMissionNodes(research: boolean): MissionGraphNode[] {
  const stages: MissionGraphNode[] = [
    { id: 'mission_received', title: 'Mission received', status: 'pending', description: 'Waiting for the backend to accept this mission.' },
    { id: 'planning', title: 'Planning', status: 'pending', description: 'Waiting for backend context preparation.' },
  ]
  if (research) stages.push({ id: 'research', title: 'Web research', status: 'pending', description: 'Waiting for the configured research provider.' })
  stages.push(
    { id: 'analysis', title: 'Model analysis', status: 'pending', description: 'Waiting for model inference to start.' },
    { id: 'final_result', title: 'Final result', status: 'pending', description: 'Waiting for a completed backend response.' },
  )
  return stages
}

export default function Workspace() {
  const [panel, setPanel] = useState<Panel>(null)
  const [state, setState] = useState<CoreState>('idle')
  const [messages, setMessages] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [base, setBase] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [status, setStatus] = useState<BackendStatus | null>(null)
  const [notice, setNotice] = useState('')
  const [research, setResearch] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [sound, setSound] = useState(false)
  const [wakePhrase, setWakePhrase] = useState(false)
  const [wakePhraseText, setWakePhraseText] = useState('Hey NOVA')
  const [missionMode, setMissionMode] = useState(false)
  const [mission, setMission] = useState<Mission | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [expression, setExpression] = useState('')
  const [result, setResult] = useState('')
  const [memories, setMemories] = useState<{ id: number; content: string }[]>([])
  const speech = useRef<SpeechSession | null>(null)
  const spoken = useRef<SpeechSynthesisUtterance | null>(null)
  const missionAbort = useRef<AbortController | null>(null)
  const wakeEnabled = useRef(false)
  const awaitingWakeCommand = useRef(false)
  const wakeRestartCount = useRef(0)
  const wakeRestartTimer = useRef<number | null>(null)
  const voiceConsent = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const busy = state === 'thinking'
  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    try {
      const savedWakePhrase = window.localStorage.getItem('nova-wake-phrase')
      if (savedWakePhrase?.trim()) setWakePhraseText(savedWakePhrase.trim())
    } catch {
      setNotice('Browser storage is unavailable; your wake phrase will last for this page session only.')
    }
    const stopWhenHidden = () => {
      if (document.visibilityState === 'visible') return
      if (wakeRestartTimer.current !== null) {
        window.clearTimeout(wakeRestartTimer.current)
        wakeRestartTimer.current = null
      }
      if (speech.current) {
        wakeEnabled.current = false
        awaitingWakeCommand.current = false
        setWakePhrase(false)
        const currentRecognition = speech.current
        speech.current = null
        currentRecognition.stop()
        setState(previous => previous === 'listening' ? 'idle' : previous)
        setNotice('Voice listening stopped because this page is no longer visible.')
      }
      if (spoken.current) {
        spoken.current.onend = null
        spoken.current.onerror = null
        spoken.current = null
        window.speechSynthesis?.cancel()
        setState(previous => previous === 'speaking' || previous === 'responding' ? 'idle' : previous)
      }
    }
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden)
      const currentRecognition = speech.current
      speech.current = null
      wakeEnabled.current = false
      if (wakeRestartTimer.current !== null) window.clearTimeout(wakeRestartTimer.current)
      currentRecognition?.stop()
      if (spoken.current) {
        spoken.current.onend = null
        spoken.current.onerror = null
        spoken.current = null
      }
      window.speechSynthesis?.cancel()
    }
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => {
    const localEndpoint = window.location.origin
    setEndpoint(localEndpoint)
    void connect(localEndpoint)
  }, [])
  function speak(answer: string) {
    if (!sound) {
      setState('idle')
      return
    }
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setNotice('Spoken responses are not supported in this browser. The text response is available in the conversation.')
      setState('idle')
      return
    }
    if (spoken.current) {
      spoken.current.onend = null
      spoken.current.onerror = null
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(answer)
    spoken.current = utterance
    utterance.onstart = () => setState('speaking')
    utterance.onend = () => {
      if (spoken.current !== utterance) return
      spoken.current = null
      setState('idle')
    }
    utterance.onerror = () => {
      if (spoken.current !== utterance) return
      spoken.current = null
      setState('error')
      setNotice('The browser could not play the spoken response. The text response is available in the conversation.')
    }
    setState('responding')
    window.speechSynthesis.speak(utterance)
  }
  function stopSpeaking() {
    const utterance = spoken.current
    spoken.current = null
    if (utterance) {
      utterance.onend = null
      utterance.onerror = null
    }
    window.speechSynthesis?.cancel()
    setState(previous => previous === 'speaking' || previous === 'responding' ? 'idle' : previous)
  }
  function toggleSpeech() {
    const next = !sound
    setSound(next)
    if (!next) {
      stopSpeaking()
    } else if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setSound(false)
      setState('error')
      setNotice('Spoken responses are not supported in this browser. Text chat remains available.')
    }
  }
  async function send(override?: string) {
    const message = (override ?? input).trim()
    if (!message || busy) return
    stopSpeaking()
    const isMission = missionMode
    const useResearch = research || (isMission && /\b(research|look up|find sources|web search|latest|current news)\b/i.test(message))
    if (useResearch && status && !status.tavily_configured && !isMission) {
      setNotice('Web research requires TAVILY_API_KEY on the FastAPI server. Assistant mode works without Tavily.')
      return
    }
    wakeEnabled.current = false
    awaitingWakeCommand.current = false
    setWakePhrase(false)
    if (wakeRestartTimer.current !== null) {
      window.clearTimeout(wakeRestartTimer.current)
      wakeRestartTimer.current = null
    }
    const currentRecognition = speech.current
    speech.current = null
    currentRecognition?.stop()
    setInput(''); setPanel('conversation'); setNotice(''); setState('thinking')
    setMessages(previous => [...previous, { role: 'user', content: message }])
    let controller: AbortController | null = null
    if (isMission) {
      controller = new AbortController()
      missionAbort.current = controller
      setMission({ request: message, status: 'running', progress: 'Connecting to the NOVA mission stream.', nodes: createMissionNodes(useResearch) })
    }
    try {
      const onMissionEvent = (event: MissionEvent) => {
        setMission(previous => {
          if (!previous) return previous
          const nodeId = event.step_id === 'accepted' ? 'mission_received'
            : event.step_id === 'tavily_search' ? 'research'
              : event.step_id === 'mission' ? 'final_result' : event.step_id
          const updateNode = (id: string, status: MissionNodeStatus, description: string, output?: string, error?: string, timestamp = event.timestamp) =>
            previous.nodes.map(node => node.id === id
              ? { ...node, status, description, timestamp, output, error }
              : node)
          if (event.type === 'step') {
            const output = event.step_id === 'tavily_search' && event.sources
              ? event.sources.map(source => `${source.title}: ${source.url}`).join('\n')
              : undefined
            return { ...previous, status: 'running', progress: event.description,
              nodes: updateNode(nodeId, event.status, event.description, output) }
          }
          if (event.type === 'completed') {
            const nodes = updateNode('final_result', 'completed', event.description,
              `${event.mode} · ${event.model}`, undefined, event.timestamp)
            return { ...previous, status: 'completed', progress: event.description, nodes,
              answer: event.answer, mode: event.mode, model: event.model, sources: event.sources }
          }
          return { ...previous, status: 'failed', progress: event.description,
            error: event.error || event.description,
            nodes: previous.nodes.map(node => node.id === nodeId || node.id === 'final_result'
              ? { ...node, status: 'failed', description: event.description, error: event.error || event.description, timestamp: event.timestamp }
              : node) }
        })
      }
      const data = isMission
        ? await novaMission(base, { message, research: useResearch }, controller!.signal, onMissionEvent)
        : await novaRequest<ChatReply>(base, 'chat', { message, research: useResearch })
      setMessages(previous => [...previous, { role: 'assistant', content: data.answer, mode: data.mode, model: data.model, sources: data.sources }]); setState('responding')
      speak(data.answer)
    } catch (error) {
      const content = error instanceof Error ? error.message : 'Request failed.'
      const cancelled = error instanceof Error && error.name === 'AbortError'
      const missionError = cancelled
        ? 'Waiting was cancelled in the interface. The FastAPI request may continue processing in the background.'
        : error instanceof Error && error.name === 'TimeoutError'
          ? 'NOVA mission timed out. Check the FastAPI terminal and provider availability.'
          : content
      if (!cancelled) setMessages(previous => [...previous, { role: 'system', content }])
      if (isMission) setMission(previous => previous ? {
        ...previous,
        status: cancelled ? 'cancelled' : 'failed',
        progress: cancelled ? 'Mission stream cancelled by the user.' : 'The backend request failed.',
        error: missionError,
        nodes: previous.nodes.map(node => node.status === 'running'
          ? { ...node, status: cancelled ? 'cancelled' : 'failed', description: missionError, error: missionError, timestamp: new Date().toISOString() }
          : node),
      } : previous)
      setState(cancelled ? 'idle' : 'error')
      if (!cancelled) {
        try {
          const currentStatus = await novaRequest<BackendStatus>(base, 'status')
          setStatus(currentStatus)
        } catch {
          setStatus(null)
          setBase('')
        }
      }
    } finally {
      if (missionAbort.current === controller) missionAbort.current = null
    }
  }
  async function connect(target = endpoint) {
    setConnecting(true); setNotice('')
    try {
      const normalizedEndpoint = target.trim().replace(/\/+$/, '')
      const data = await novaRequest<BackendStatus>(normalizedEndpoint, 'status')
      setEndpoint(normalizedEndpoint)
      setBase(normalizedEndpoint)
      setStatus(data)
      setNotice(data.nebius_configured
        ? 'NOVA backend reachable. Provider settings are configured; live inference has not been tested.'
        : 'NOVA backend reachable, but NVIDIA settings are incomplete. Check the FastAPI .env file.')
      setState('idle')
    }
    catch (error) { setStatus(null); setBase(''); setNotice((error as Error).message) }
    finally { setConnecting(false) }
  }
  function stopListening() {
    wakeEnabled.current = false
    awaitingWakeCommand.current = false
    setWakePhrase(false)
    if (wakeRestartTimer.current !== null) {
      window.clearTimeout(wakeRestartTimer.current)
      wakeRestartTimer.current = null
    }
    const currentRecognition = speech.current
    speech.current = null
    currentRecognition?.stop()
    setState('idle')
    setNotice('Voice listening stopped.')
  }
  function startRecognition(mode: 'command' | 'wake' | 'wake-command') {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      setNotice('Voice activation works only while this NOVA page is open and active.')
      return
    }
    if (!voiceConsent.current) {
      const accepted = window.confirm('Enable browser speech recognition? Your browser may process microphone audio using its speech service. NOVA receives only the recognized text. No microphone audio is sent to NOVA. Continue?')
      if (!accepted) {
        setNotice('Voice recognition was not enabled. You can continue typing messages.')
        return
      }
      voiceConsent.current = true
    }
    const browser = window as Window & { SpeechRecognition?: new () => SpeechSession; webkitSpeechRecognition?: new () => SpeechSession }
    const Recognition = browser.SpeechRecognition || browser.webkitSpeechRecognition
    if (!Recognition) {
      wakeEnabled.current = false
      awaitingWakeCommand.current = false
      setWakePhrase(false)
      setNotice('This browser does not support speech recognition. Use the microphone in a supported Chrome or Edge browser, or type your message.')
      setState('error')
      return
    }
    if (mode === 'wake' && wakePhraseText.trim().length < 3) {
      setNotice('Set a wake phrase with at least three characters in Settings before enabling wake listening.')
      setState('error')
      return
    }
    const recognition = new Recognition()
    speech.current = recognition
    if (mode === 'wake') {
      wakeEnabled.current = true
      awaitingWakeCommand.current = false
      setWakePhrase(true)
    }
    let commandSubmitted = false
    let receivedFinalResult = false
    let startedAt = 0
    recognition.lang = navigator.language || 'en-US'
    recognition.continuous = false
    recognition.interimResults = false
    const submitRecognizedCommand = (transcript: string) => {
      if (commandSubmitted) return
      commandSubmitted = true
      wakeEnabled.current = false
      awaitingWakeCommand.current = false
      setWakePhrase(false)
      speech.current = null
      recognition.stop()
      setState('recognized')
      setNotice(`Command recognized: “${transcript}”`)
      window.setTimeout(() => { void send(transcript) }, 0)
    }
    recognition.onresult = event => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result[0]?.transcript.trim()
        if (!result.isFinal || !transcript || commandSubmitted) continue
        receivedFinalResult = true
        if (mode === 'wake') {
          wakeRestartCount.current = 0
          const escapedPhrase = wakePhraseText.trim().replace(/\s+/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const match = transcript.match(new RegExp(`^\\s*${escapedPhrase}[\\s,.:;!?-]*(.*)$`, 'i'))
          if (!match) {
            recognition.stop()
            return
          }
          const command = match[1].trim()
          setState('wakeDetected')
          setNotice(`Wake phrase detected: “${wakePhraseText}”`)
          if (command) {
            submitRecognizedCommand(command)
          } else {
            awaitingWakeCommand.current = true
            recognition.stop()
          }
          return
        }
        submitRecognizedCommand(transcript)
      }
    }
    recognition.onerror = event => {
      if (speech.current !== recognition) return
      if ((event.error === 'no-speech' || event.error === 'network') && mode === 'wake') return
      if (event.error === 'no-speech' && mode === 'wake-command') {
        awaitingWakeCommand.current = false
        setNotice('No command detected after the wake phrase. Wake listening will resume.')
        return
      }
      wakeEnabled.current = false
      awaitingWakeCommand.current = false
      setWakePhrase(false)
      const detail = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone permission was denied. Allow microphone access for this site in browser settings.'
        : event.error === 'audio-capture'
          ? 'No microphone is available. Connect or enable a microphone, then try again.'
          : `Speech recognition failed${event.error ? ` (${event.error})` : ''}. Try the microphone again or type your message.`
      setState('error')
      setNotice(detail)
    }
    recognition.onend = () => {
      if (speech.current !== recognition) return
      speech.current = null
      if (mode === 'wake' && awaitingWakeCommand.current && wakeEnabled.current && document.visibilityState === 'visible') {
        wakeRestartTimer.current = window.setTimeout(() => {
          wakeRestartTimer.current = null
          if (wakeEnabled.current && awaitingWakeCommand.current) startRecognition('wake-command')
        }, 250)
        return
      }
      if (mode === 'wake' && wakeEnabled.current && document.visibilityState === 'visible') {
        const endedNormally = receivedFinalResult || Date.now() - startedAt >= 3000
        if (endedNormally) {
          wakeRestartCount.current = 0
        } else {
          wakeRestartCount.current += 1
        }
        if (wakeRestartCount.current > 5) {
          wakeEnabled.current = false
          setWakePhrase(false)
          setState('error')
          setNotice('The browser repeatedly stopped wake listening. Tap the wake control to retry, or use one-time voice input.')
          return
        }
        if (!endedNormally) setNotice('Wake listening was interrupted. Reconnecting with a fresh browser session…')
        const delay = endedNormally ? 300 : Math.min(500 * (2 ** (wakeRestartCount.current - 1)), 4000)
        wakeRestartTimer.current = window.setTimeout(() => {
          wakeRestartTimer.current = null
          if (wakeEnabled.current && document.visibilityState === 'visible') startRecognition('wake')
        }, delay)
        return
      }
      if (mode === 'wake-command' && wakeEnabled.current && document.visibilityState === 'visible') {
        awaitingWakeCommand.current = false
        const endedNormally = receivedFinalResult || Date.now() - startedAt >= 3000
        if (endedNormally) {
          wakeRestartCount.current = 0
        } else {
          wakeRestartCount.current += 1
        }
        if (wakeRestartCount.current > 5) {
          wakeEnabled.current = false
          setWakePhrase(false)
          setState('error')
          setNotice('The browser repeatedly stopped before a command was recognized. Tap the wake control to try again, or use one-time voice input.')
          return
        }
        if (receivedFinalResult) setNotice('No command followed the wake phrase. Listening for the wake phrase again.')
        const delay = endedNormally ? 300 : Math.min(500 * (2 ** (wakeRestartCount.current - 1)), 4000)
        wakeRestartTimer.current = window.setTimeout(() => {
          wakeRestartTimer.current = null
          if (wakeEnabled.current && document.visibilityState === 'visible') startRecognition('wake')
        }, delay)
        return
      }
      setState(previous => previous === 'listening' || previous === 'wakeDetected' ? 'idle' : previous)
    }
    try {
      recognition.start()
      startedAt = Date.now()
      setState('listening')
      setNotice(mode === 'wake'
        ? `Wake phrase “${wakePhraseText}” is listening while this page is visible.`
        : mode === 'wake-command'
          ? 'Wake phrase detected. Listening for your command now.'
          : 'Listening for one command. Recognized text is sent to NOVA.')
    }
    catch {
      speech.current = null
      wakeEnabled.current = false
      awaitingWakeCommand.current = false
      setWakePhrase(false)
      setNotice('Unable to start the microphone. Check browser permissions and try again.')
      setState('error')
    }
  }
  function listen(useWakePhrase = false) {
    if (speech.current || wakeEnabled.current) {
      stopListening()
      return
    }
    wakeRestartCount.current = 0
    startRecognition(useWakePhrase ? 'wake' : 'command')
  }
  function stopMission() {
    const controller = missionAbort.current
    if (controller && mission?.status === 'running') {
      const error = 'Waiting was cancelled in the interface. The FastAPI request may continue processing in the background.'
      setMission(previous => previous ? {
        ...previous,
        status: 'cancelled',
        progress: 'Mission stream cancelled by the user.',
        error,
        nodes: previous.nodes.map(node => node.status === 'running'
          ? { ...node, status: 'cancelled', description: error, error, timestamp: new Date().toISOString() }
          : node),
      } : previous)
      controller.abort()
    }
  }
  function toggle(next: Panel) { setPanel(previous => previous === next ? null : next); setNotice('') }
  async function openMemory() {
    toggle('memory')
    if (base) try { const data = await novaRequest<{ memories: typeof memories }>(base, 'memories'); setMemories(data.memories) } catch (error) { setNotice((error as Error).message) }
  }
  const stateLabel = { idle: 'Awaiting your command', listening: wakePhrase ? 'Wake phrase active' : 'Listening to you', wakeDetected: 'Wake phrase detected', recognized: 'Command recognized', thinking: 'Processing your request', responding: 'NOVA is responding', speaking: 'NOVA is speaking', error: 'Request could not be completed' }[state]
  const stateBadge = { idle: 'IDLE', listening: 'LISTENING', wakeDetected: 'WAKE DETECTED', recognized: 'COMMAND RECOGNIZED', thinking: 'PROCESSING', responding: 'PROCESSING', speaking: 'SPEAKING', error: 'ERROR' }[state]
  return <div className="nova-shell">
    <aside className="rail" aria-label="Main navigation">
      <button className="brand-icon" aria-label="NOVA home" onClick={() => setPanel(null)}><AudioLines /></button>
      <div className="rail-nav">
        <button className={panel === null ? 'selected' : ''} aria-label="Command center" title="Command center" onClick={() => setPanel(null)}><Command /></button>
        <button className={panel === 'conversation' ? 'selected' : ''} aria-label="Conversations" title="Conversations" onClick={() => toggle('conversation')}><MessageSquare />{messages.length > 0 && <i />}</button>
        <button className={panel === 'memory' ? 'selected' : ''} aria-label="Memory" title="Memory" onClick={openMemory}><Brain /></button>
        <button className={panel === 'tools' ? 'selected' : ''} aria-label="Tools" title="Tools" onClick={() => toggle('tools')}><Terminal /></button>
      </div>
      <div className="rail-bottom"><button aria-label="Help" title="Help" onClick={() => { setPanel('settings'); setNotice('Connect your FastAPI backend below. Enter sends a message; Shift + Enter adds a line. Voice transcription depends on browser support.') }}><CircleHelp /></button><button className={panel === 'settings' ? 'selected' : ''} aria-label="Settings" title="Settings" onClick={() => toggle('settings')}><Settings /></button><span className="operator">K</span></div>
    </aside>
    <main className="command-center">
      <header className="topbar"><div className="wordmark">NOVA<span>PERSONAL INTELLIGENCE</span></div><div className="top-status"><span className={`connection-dot ${status ? 'online' : ''}`} />{status ? 'Backend reachable' : 'Not connected'}<span className="top-divider" /><button className="mode-button" onClick={() => { const next = !research; setResearch(next); setNotice(next && status && !status.tavily_configured ? 'Web research requires TAVILY_API_KEY on the FastAPI server. Assistant mode works without Tavily.' : '') }}>{research ? 'Research mode' : 'Assistant mode'}<ChevronDown size={12} /></button></div><span className="version">LOCAL WORKSPACE <span>v.01</span></span></header>
      <div className="stage-area">
        <div className="stage-meta"><span><i /> NEURAL INTERFACE</span><span>CORE / 01</span></div>
        <div className={`stage ${panel ? 'with-panel' : ''}`}>
          <div className="orb-zone">
            <div className="orb-topline"><span /> INTELLIGENCE, IN YOUR ORBIT <span /></div>
            <div className={`orb-visual ${mission ? 'has-mission-graph' : ''}`}><div className="radar-ring ring-one" /><div className="radar-ring ring-two" />{mission ? <DynamicMissionGraph nodes={mission.nodes} reducedMotion={reduced} /> : <><Orb state={state} reduced={reduced} /><div className="orb-wordmark">N O V A<span>PERSONAL AI CORE</span></div><span className="orb-coordinate left">N / 01<br />CORE ACTIVE</span><span className="orb-coordinate right">LOCAL<br />INTERFACE</span><div className="orb-floor" /></>}</div>
            <div className="core-caption"><span className={`state-pill ${state}`}><i />{stateBadge}</span><h1>{stateLabel}<span>.</span></h1><p>{state === 'idle' ? 'A space to think, create, and explore. Together.' : state === 'listening' ? 'Speak naturally. Your words will appear below.' : state === 'wakeDetected' ? 'Wake phrase detected. Listening for your command.' : state === 'recognized' ? 'Your command was recognized and is being submitted.' : state === 'error' ? 'Review the notice for details, then retry or check your connection.' : 'Your personal intelligence, at work.'}</p></div>
          </div>
          {panel && <section className="side-panel" aria-label={`${panel} panel`}><header><span>{panel === 'conversation' ? 'CONVERSATION' : panel.toUpperCase()}</span><div>{panel === 'conversation' && <button aria-label="Clear chat" disabled={busy} onClick={() => { setMessages([]); stopSpeaking(); setState('idle') }}><Trash2 size={15} /></button>}<button aria-label="Close panel" onClick={() => setPanel(null)}><X size={17} /></button></div></header>
            {panel === 'conversation' && <div className="transcript" role="log" aria-live="polite">{mission && <section className={`mission-card mission-${mission.status}`} aria-live="polite"><div className="mission-heading"><Activity size={15} /><strong>LIVE MISSION</strong><span className={`mission-status ${mission.status}`}>{mission.status.toUpperCase()}</span></div><h2>{mission.request}</h2><p>{mission.progress}</p>{mission.error && <p className="mission-error">{mission.error}</p>}{mission.answer && <div className="mission-result"><p>{mission.answer}</p>{mission.model && <small>{mission.mode} · {mission.model}</small>}{mission.sources?.length ? <ul className="response-sources">{mission.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a></li>)}</ul> : null}</div>}{mission.status === 'running' && <button className="mission-cancel" onClick={stopMission}>Cancel mission stream</button>}</section>}{!messages.length && !mission && <div className="panel-empty"><MessageSquare /><h2>A fresh conversation</h2><p>Your messages will appear here. Connect your backend to hear from NOVA.</p></div>}{messages.map((m, i) => <article className={`entry ${m.role}`} key={i}><div>{m.role === 'user' ? 'YOU' : m.role === 'system' ? 'SYSTEM NOTICE' : 'NOVA'}<span>{String(i + 1).padStart(2, '0')}</span></div><p>{m.content}</p>{m.role === 'assistant' && m.model && <div className="response-meta">{m.mode} · {m.model}</div>}{m.sources?.length ? <ul className="response-sources">{m.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a></li>)}</ul> : null}</article>)}{busy && <p className="thinking-line">Connecting to intelligence…</p>}<div ref={endRef} /></div>}
            {panel === 'memory' && <div className="panel-content"><Brain className="panel-symbol" /><h2>Memory vault</h2><p>Context that stays with you. Saved memories live in your Python backend, not this browser.</p>{!base ? <button className="text-action" onClick={() => setPanel('settings')}>Connect to view memories <ChevronRight size={14} /></button> : memories.length ? memories.map(m => <p className="memory-note" key={m.id}>{m.content}</p>) : <p>No saved memories.</p>}</div>}
            {panel === 'tools' && <div className="panel-content"><Terminal className="panel-symbol" /><h2>Tools & capabilities</h2><p>Tools execute through your existing FastAPI server.</p><label htmlFor="expression">ARITHMETIC CALCULATOR</label><input id="expression" value={expression} onChange={e => setExpression(e.target.value)} placeholder="12 * (3 + 4)" /><button className="primary-action" onClick={async () => { try { const data = await novaRequest<{ result: number }>(base, 'calculate', { expression }); setResult(String(data.result)) } catch (error) { setResult((error as Error).message) } }}>Calculate <ArrowUp size={14} /></button><p role="status">{result}</p><button className="setting-toggle" onClick={() => setResearch(!research)}><Globe size={16} />Web research<span>{research ? 'ON' : 'OFF'}</span></button><p>Research requires Tavily configured on your backend.</p></div>}
            {panel === 'settings' && <div className="panel-content"><Settings className="panel-symbol" /><h2>Your local workspace</h2><p>Connect the existing NOVA FastAPI server. API keys remain on the Python server.</p><label htmlFor="endpoint">BACKEND URL</label><input id="endpoint" type="url" value={endpoint} onChange={e => setEndpoint(e.target.value)} /><button className="primary-action" onClick={() => void connect()} disabled={connecting}>{connecting ? 'Connecting…' : 'Test connection'}<Zap size={14} /></button><p className="connection-help">By default, this same-origin URL uses the Next.js server-side proxy to FastAPI. Alternate backend URLs are called directly and may require CORS. {status ? `NVIDIA: ${status.nebius_configured ? `configured (${status.model ?? 'model not reported'})` : 'not configured'}. Tavily: ${status.tavily_configured ? 'configured' : 'not configured (optional for ordinary chat)'}.` : 'Backend status is unavailable.'}</p><label htmlFor="wake-phrase">WAKE PHRASE</label><input id="wake-phrase" maxLength={48} value={wakePhraseText} onChange={event => { const value = event.target.value; setWakePhraseText(value); try { window.localStorage.setItem('nova-wake-phrase', value) } catch { setNotice('Could not save the wake phrase; it remains active for this page session.') } }} /><p>Wake listening works only while this page is visible and your browser supports speech recognition. It stops while NOVA speaks to avoid hearing its own response. The browser may process microphone audio; NOVA receives recognized text only.</p><button className="setting-toggle" onClick={() => setReduced(!reduced)}>Reduced motion<span>{reduced ? 'ON' : 'OFF'}</span></button><button className="setting-toggle" onClick={toggleSpeech}>Read responses aloud<span>{sound ? 'ON' : 'OFF'}</span></button><p>This prototype keeps unsent messages and settings only for the current session.</p></div>}
          </section>}
        </div>
        <div className="composer-area">{notice && <div className="notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={14} /></button></div>}<div className="assistant-controls"><button className={`control-chip ${missionMode ? 'active' : ''}`} aria-pressed={missionMode} onClick={() => { setMissionMode(!missionMode); setNotice(!missionMode ? 'Mission mode streams real backend execution. It does not execute external actions.' : '') }}><Activity size={14} /> Mission mode <span>{missionMode ? 'ON' : 'OFF'}</span></button><button className={`control-chip ${wakePhrase ? 'active' : ''}`} aria-pressed={wakePhrase} onClick={() => wakePhrase ? stopListening() : listen(true)} disabled={busy}><Radio size={14} /> {wakePhraseText || 'Wake phrase'} <span>{wakePhrase ? 'LISTENING' : 'WAKE'}</span></button></div><div className="suggestion-row"><button onClick={() => { setInput('Help me brainstorm an idea'); inputRef.current?.focus() }}><Sparkles />Brainstorm an idea<ChevronRight /></button><button onClick={() => { setResearch(true); setInput('Research a topic: '); inputRef.current?.focus() }}><Globe />Explore a topic<ChevronRight /></button><button onClick={() => { setInput('Help me plan my day'); inputRef.current?.focus() }}><Zap />Plan my day<ChevronRight /></button></div>
          <form className={`composer ${state === 'listening' ? 'is-listening' : ''}`} onSubmit={e => { e.preventDefault(); void send() }}><span className="composer-spark"><AudioLines /></span><textarea ref={inputRef} aria-label="Message NOVA" placeholder={missionMode ? 'Describe your mission…' : "What's on your mind?"} rows={1} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} /><button type="button" className={`mic ${state === 'listening' || state === 'wakeDetected' ? 'active' : ''}`} aria-label={speech.current ? 'Stop listening' : 'Start voice input'} onClick={() => listen()} disabled={busy}><Mic /><span>VOICE</span></button><span className="composer-divider" /><button type="submit" className="send" aria-label={missionMode ? 'Run mission' : 'Send message'} disabled={!input.trim() || busy}>{missionMode ? <Activity /> : <ArrowUp />}</button></form><div className="composer-foot"><span><ShieldCheck />Your space. Your intelligence.</span><span>{missionMode ? 'One mission at a time' : 'Enter to send'} <kbd>↵</kbd><span className="foot-separator">/</span> Shift + Enter for a new line</span></div></div>
        <footer className="system-footer"><span><i /> INTERFACE READY<span className="footer-divider" />{status ? 'BACKEND REACHABLE' : 'AWAITING BACKEND'}</span><div className="footer-wave">{Array.from({ length: 31 }, (_, i) => <i key={i} style={{ height: `${(3 + Math.sin(i * 1.7) ** 2 * 10).toFixed(2)}px` }} />)}</div><span>{(state === 'speaking' || (state === 'responding' && sound)) && <button aria-label="Stop spoken response" onClick={stopSpeaking}><VolumeX size={13} /> STOP</button>}<button aria-label={sound ? 'Mute spoken responses' : 'Enable spoken responses'} aria-pressed={sound} onClick={toggleSpeech}><Volume2 size={13} /> AUDIO {sound ? 'ON' : 'OFF'}</button><span className="footer-divider" /><button aria-label="Toggle conversation panel" onClick={() => toggle('conversation')}><Expand size={13} /> EXPAND</button></span></footer>
      </div>
    </main>
  </div>
}
