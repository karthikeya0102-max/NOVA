'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowUp, AudioLines, Brain, ChevronDown, ChevronRight, CircleHelp, Command, Cpu, Expand, Globe, MessageSquare, Mic, Plus, Settings, ShieldCheck, Sparkles, Terminal, Trash2, Volume2, X, Zap } from 'lucide-react'
import { novaRequest, type BackendStatus, type ChatReply, type ChatSource } from '@/lib/nova-api'
import type { CoreState } from './orb'
const Orb = dynamic(() => import('./orb'), { ssr: false })
type Panel = 'conversation' | 'memory' | 'tools' | 'settings' | null
type Entry = { role: 'user' | 'assistant' | 'system'; content: string; mode?: string; model?: string; sources?: ChatSource[] }
type SpeechSession = { start: () => void; stop: () => void; onresult: ((e: { results: { transcript: string }[][] }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null }

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
  const [connecting, setConnecting] = useState(false)
  const [expression, setExpression] = useState('')
  const [result, setResult] = useState('')
  const [memories, setMemories] = useState<{ id: number; content: string }[]>([])
  const speech = useRef<SpeechSession | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const busy = state === 'thinking'
  useEffect(() => { setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches); return () => { speech.current?.stop(); window.speechSynthesis?.cancel() } }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => {
    const localEndpoint = window.location.origin
    setEndpoint(localEndpoint)
    void connect(localEndpoint)
  }, [])
  async function send() {
    const message = input.trim()
    if (!message || busy) return
    if (research && status && !status.tavily_configured) {
      setNotice('Web research requires TAVILY_API_KEY on the FastAPI server. Assistant mode works without Tavily.')
      return
    }
    speech.current?.stop()
    setInput(''); setPanel('conversation'); setNotice(''); setState('thinking')
    setMessages(previous => [...previous, { role: 'user', content: message }])
    try {
      const data = await novaRequest<ChatReply>(base, 'chat', { message, research })
      setMessages(previous => [...previous, { role: 'assistant', content: data.answer, mode: data.mode, model: data.model, sources: data.sources }]); setState('responding')
      if (sound && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(data.answer)
        utterance.onend = () => setState('idle'); utterance.onerror = () => setState('idle')
        window.speechSynthesis.speak(utterance)
      } else setTimeout(() => setState('idle'), 1800)
    } catch (error) {
      const content = error instanceof Error ? error.message : 'Request failed.'
      setMessages(previous => [...previous, { role: 'system', content }]); setState('error')
      try {
        const currentStatus = await novaRequest<BackendStatus>(base, 'status')
        setStatus(currentStatus)
      } catch {
        setStatus(null)
        setBase('')
      }
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
  function listen() {
    if (state === 'listening') { speech.current?.stop(); setState('idle'); return }
    const browser = window as unknown as { SpeechRecognition?: new () => SpeechSession; webkitSpeechRecognition?: new () => SpeechSession }
    const Recognition = browser.SpeechRecognition || browser.webkitSpeechRecognition
    if (!Recognition) { setNotice('Voice input is unavailable in this browser. Try Chrome or Edge, or type your message.'); return }
    const recognition = new Recognition(); speech.current = recognition
    recognition.onresult = e => { setInput(e.results[0][0].transcript); setState('idle'); inputRef.current?.focus() }
    recognition.onerror = () => { setState('error'); setNotice('Microphone unavailable. Check browser permissions or type your message.') }
    recognition.onend = () => setState(previous => previous === 'listening' ? 'idle' : previous)
    try { recognition.start(); setState('listening'); setNotice('') } catch { setNotice('Unable to start microphone.'); setState('error') }
  }
  function toggle(next: Panel) { setPanel(previous => previous === next ? null : next); setNotice('') }
  async function openMemory() {
    toggle('memory')
    if (base) try { const data = await novaRequest<{ memories: typeof memories }>(base, 'memories'); setMemories(data.memories) } catch (error) { setNotice((error as Error).message) }
  }
  const stateLabel = { idle: 'Awaiting your command', listening: 'Listening to you', thinking: 'Processing your request', responding: 'NOVA is responding', error: 'Request could not be completed' }[state]
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
            <div className="orb-visual"><div className="radar-ring ring-one" /><div className="radar-ring ring-two" /><Orb state={state} reduced={reduced} /><div className="orb-wordmark">N O V A<span>PERSONAL AI CORE</span></div><span className="orb-coordinate left">N / 01<br />CORE ACTIVE</span><span className="orb-coordinate right">LOCAL<br />INTERFACE</span><div className="orb-floor" /></div>
            <div className="core-caption"><span className={`state-pill ${state}`}><i />{state === 'idle' ? 'STANDBY' : state.toUpperCase()}</span><h1>{stateLabel}<span>.</span></h1><p>{state === 'idle' ? 'A space to think, create, and explore. Together.' : state === 'listening' ? 'Speak naturally. Your words will appear below.' : state === 'error' ? 'Review the notice for details, then retry or check your connection.' : 'Your personal intelligence, at work.'}</p></div>
          </div>
          {panel && <section className="side-panel" aria-label={`${panel} panel`}><header><span>{panel === 'conversation' ? 'CONVERSATION' : panel.toUpperCase()}</span><div>{panel === 'conversation' && <button aria-label="Clear chat" disabled={busy} onClick={() => { setMessages([]); setState('idle'); window.speechSynthesis?.cancel() }}><Trash2 size={15} /></button>}<button aria-label="Close panel" onClick={() => setPanel(null)}><X size={17} /></button></div></header>
            {panel === 'conversation' && <div className="transcript" role="log" aria-live="polite">{!messages.length && <div className="panel-empty"><MessageSquare /><h2>A fresh conversation</h2><p>Your messages will appear here. Connect your backend to hear from NOVA.</p></div>}{messages.map((m, i) => <article className={`entry ${m.role}`} key={i}><div>{m.role === 'user' ? 'YOU' : m.role === 'system' ? 'SYSTEM NOTICE' : 'NOVA'}<span>{String(i + 1).padStart(2, '0')}</span></div><p>{m.content}</p>{m.role === 'assistant' && m.model && <div className="response-meta">{m.mode} · {m.model}</div>}{m.sources?.length ? <ul className="response-sources">{m.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a></li>)}</ul> : null}</article>)}{busy && <p className="thinking-line">Connecting to intelligence…</p>}<div ref={endRef} /></div>}
            {panel === 'memory' && <div className="panel-content"><Brain className="panel-symbol" /><h2>Memory vault</h2><p>Context that stays with you. Saved memories live in your Python backend, not this browser.</p>{!base ? <button className="text-action" onClick={() => setPanel('settings')}>Connect to view memories <ChevronRight size={14} /></button> : memories.length ? memories.map(m => <p className="memory-note" key={m.id}>{m.content}</p>) : <p>No saved memories.</p>}</div>}
            {panel === 'tools' && <div className="panel-content"><Terminal className="panel-symbol" /><h2>Tools & capabilities</h2><p>Tools execute through your existing FastAPI server.</p><label htmlFor="expression">ARITHMETIC CALCULATOR</label><input id="expression" value={expression} onChange={e => setExpression(e.target.value)} placeholder="12 * (3 + 4)" /><button className="primary-action" onClick={async () => { try { const data = await novaRequest<{ result: number }>(base, 'calculate', { expression }); setResult(String(data.result)) } catch (error) { setResult((error as Error).message) } }}>Calculate <ArrowUp size={14} /></button><p role="status">{result}</p><button className="setting-toggle" onClick={() => setResearch(!research)}><Globe size={16} />Web research<span>{research ? 'ON' : 'OFF'}</span></button><p>Research requires Tavily configured on your backend.</p></div>}
            {panel === 'settings' && <div className="panel-content"><Settings className="panel-symbol" /><h2>Your local workspace</h2><p>Connect the existing NOVA FastAPI server. API keys remain on the Python server.</p><label htmlFor="endpoint">BACKEND URL</label><input id="endpoint" type="url" value={endpoint} onChange={e => setEndpoint(e.target.value)} /><button className="primary-action" onClick={() => void connect()} disabled={connecting}>{connecting ? 'Connecting…' : 'Test connection'}<Zap size={14} /></button><p className="connection-help">By default, this same-origin URL uses the Next.js server-side proxy to FastAPI. Alternate backend URLs are called directly and may require CORS. {status ? `NVIDIA: ${status.nebius_configured ? `configured (${status.model ?? 'model not reported'})` : 'not configured'}. Tavily: ${status.tavily_configured ? 'configured' : 'not configured (optional for ordinary chat)'}.` : 'Backend status is unavailable.'}</p><button className="setting-toggle" onClick={() => setReduced(!reduced)}>Reduced motion<span>{reduced ? 'ON' : 'OFF'}</span></button><button className="setting-toggle" onClick={() => setSound(!sound)}>Read responses aloud<span>{sound ? 'ON' : 'OFF'}</span></button><p>This prototype keeps unsent messages and settings only for the current session.</p></div>}
          </section>}
        </div>
        <div className="composer-area">{notice && <div className="notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={14} /></button></div>}<div className="suggestion-row"><button onClick={() => { setInput('Help me brainstorm an idea'); inputRef.current?.focus() }}><Sparkles />Brainstorm an idea<ChevronRight /></button><button onClick={() => { setResearch(true); setInput('Research a topic: '); inputRef.current?.focus() }}><Globe />Explore a topic<ChevronRight /></button><button onClick={() => { setInput('Help me plan my day'); inputRef.current?.focus() }}><Zap />Plan my day<ChevronRight /></button></div>
          <form className={`composer ${state === 'listening' ? 'is-listening' : ''}`} onSubmit={e => { e.preventDefault(); void send() }}><span className="composer-spark"><AudioLines /></span><textarea ref={inputRef} aria-label="Message NOVA" placeholder="What's on your mind?" rows={1} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} /><button type="button" className={state === 'listening' ? 'mic active' : 'mic'} aria-label={state === 'listening' ? 'Stop listening' : 'Start voice input'} onClick={listen} disabled={busy}><Mic /></button><span className="composer-divider" /><button type="submit" className="send" aria-label="Send message" disabled={!input.trim() || busy}><ArrowUp /></button></form><div className="composer-foot"><span><ShieldCheck />Your space. Your intelligence.</span><span>Enter to send <kbd>↵</kbd><span className="foot-separator">/</span> Shift + Enter for a new line</span></div></div>
        <footer className="system-footer"><span><i /> INTERFACE READY<span className="footer-divider" />{status ? 'BACKEND REACHABLE' : 'AWAITING BACKEND'}</span><div className="footer-wave">{Array.from({ length: 31 }, (_, i) => <i key={i} style={{ height: `${(3 + Math.sin(i * 1.7) ** 2 * 10).toFixed(2)}px` }} />)}</div><span><button aria-label="Toggle spoken responses" aria-pressed={sound} onClick={() => setSound(!sound)}><Volume2 size={13} /> AUDIO {sound ? 'ON' : 'OFF'}</button><span className="footer-divider" /><button aria-label="Toggle conversation panel" onClick={() => toggle('conversation')}><Expand size={13} /> EXPAND</button></span></footer>
      </div>
    </main>
  </div>
}
