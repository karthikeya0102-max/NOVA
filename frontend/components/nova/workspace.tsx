'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowUp, AudioLines, Brain, ChevronDown, ChevronRight, CircleHelp, Command, Expand, Globe, LogOut, MessageSquare, Mic, Radio, Settings, ShieldCheck, Sparkles, Terminal, Trash2, Volume2, VolumeX, X, Zap } from 'lucide-react'
import { novaMission, novaRequest, type BackendStatus, type ChatReply, type ChatSource, type MissionEvent } from '@/lib/nova-api'
import { applyMissionEvent, createMissionState, markMissionInterrupted, type MissionState } from '@/lib/mission-events'
import { readMissionModePreference, writeMissionModePreference } from '@/lib/mission-mode'
import AuthGate from './auth-gate'
import { getSupabaseClient } from '@/lib/supabase'
import MissionDashboard from './mission-dashboard'
import type { CoreState } from './orb'
const Orb = dynamic(() => import('./orb'), { ssr: false })
const DynamicMissionGraph = dynamic(() => import('./mission-graph'), {
  ssr: false,
  loading: () => <div className="mission-graph-loading">Preparing mission visualization…</div>,
})
type Panel = 'conversation' | 'memory' | 'tools' | 'settings' | 'voice' | null
type Entry = { role: 'user' | 'assistant' | 'system'; content: string; mode?: string; model?: string; sources?: ChatSource[] }
type BrowserVoice = { voiceURI: string; name: string; lang: string; default: boolean; localService: boolean }
type WindowsVoice = { id: string; name: string; lang: string }
type DesktopStatus = { state: string; error: string | null; updated_at: string | null }
type VoiceRecognitionResult = { transcript: string }
type VoiceRecognitionEvent = { resultIndex: number; results: ArrayLike<ArrayLike<VoiceRecognitionResult> & { isFinal: boolean }> }
type VoiceRecognitionError = { error?: string }
type SpeechSession = { start: () => void; stop: () => void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: VoiceRecognitionEvent) => void) | null; onerror: ((e: VoiceRecognitionError) => void) | null; onend: (() => void) | null }
type VoiceMode = 'command' | 'wake' | 'wake-command'
export default function Workspace() {
  const [authReady, setAuthReady] = useState(false)
  const [authUser, setAuthUser] = useState<{ id: string; email?: string } | null>(null)
  const [authEnabled, setAuthEnabled] = useState(false)
  const [authConfigurationError, setAuthConfigurationError] = useState(false)
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
  const [browserVoices, setBrowserVoices] = useState<BrowserVoice[]>([])
  const [browserVoiceId, setBrowserVoiceId] = useState('')
  const [browserRate, setBrowserRate] = useState(0.95)
  const [browserPitch, setBrowserPitch] = useState(1)
  const [windowsVoices, setWindowsVoices] = useState<WindowsVoice[]>([])
  const [windowsVoiceId, setWindowsVoiceId] = useState('')
  const [windowsRate, setWindowsRate] = useState(0.9)
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus>({ state: 'stopped', error: null, updated_at: null })
  const [wakePhrase, setWakePhrase] = useState(false)
  const [wakePhraseText, setWakePhraseText] = useState('Hey NOVA')
  const [missionMode, setMissionMode] = useState(true)
  const [mission, setMission] = useState<MissionState | null>(null)
  const [selectedMissionNodeId, setSelectedMissionNodeId] = useState('')
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
  const transcriptRef = useRef<HTMLDivElement>(null)
  const activeUserId = useRef<string | null>(null)
  const busy = state === 'thinking' || Boolean(missionAbort.current)
  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase) {
      const productionBuild = process.env.NODE_ENV === 'production'
      setAuthEnabled(productionBuild)
      setAuthConfigurationError(productionBuild)
      if (!productionBuild) setAuthUser({ id: 'local', email: 'Local user' })
      setAuthReady(true)
      return
    }
    setAuthEnabled(true)
    let active = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setNotice('Could not restore your sign-in session. Please sign in again.')
      setAuthUser(data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null)
      setAuthReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ? { id: session.user.id, email: session.user.email } : null)
      setAuthReady(true)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])
  useEffect(() => {
    try {
      setMissionMode(readMissionModePreference(window.localStorage))
    } catch {
      setNotice('Mission Mode defaults to ON, but browser storage is unavailable; your choice will last for this page session only.')
    }
  }, [])
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
  useEffect(() => {
    try {
      const savedVoice = window.localStorage.getItem('browserVoiceId') || ''
      const savedRate = Number(window.localStorage.getItem('browserSpeechRate'))
      const savedPitch = Number(window.localStorage.getItem('browserSpeechPitch'))
      setBrowserVoiceId(savedVoice)
      if (Number.isFinite(savedRate) && savedRate >= 0.5 && savedRate <= 2) setBrowserRate(savedRate)
      if (Number.isFinite(savedPitch) && savedPitch >= 0 && savedPitch <= 2) setBrowserPitch(savedPitch)
    } catch {
      setNotice('Voice preferences could not be loaded from browser storage.')
    }
    const updateVoices = () => {
      const available = window.speechSynthesis?.getVoices() ?? []
      setBrowserVoices(available)
      let savedVoice = ''
      try {
        savedVoice = window.localStorage.getItem('browserVoiceId') || ''
      } catch {
        setNotice('Browser storage is unavailable; the suggested voice will last for this page session.')
      }
      if (available.length && (!savedVoice || !available.some(voice => voice.voiceURI === savedVoice))) {
        const preferred = available.find(voice => /david|mark|james|guy/i.test(voice.name))
          ?? available.find(voice => voice.default && /^en[-_]/i.test(voice.lang))
          ?? available.find(voice => /^en[-_]/i.test(voice.lang))
          ?? available.find(voice => voice.default)
          ?? available[0]
        setBrowserVoiceId(preferred.voiceURI)
        if (savedVoice) setNotice('The saved browser voice is unavailable. NOVA selected an available voice instead.')
        try {
          window.localStorage.setItem('browserVoiceId', preferred.voiceURI)
        } catch {
          setNotice('Could not save the selected browser voice; it remains active for this page session.')
        }
      }
    }
    updateVoices()
    window.speechSynthesis?.addEventListener('voiceschanged', updateVoices)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', updateVoices)
  }, [])
  useEffect(() => {
    const transcript = transcriptRef.current
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' })
  }, [messages])
  useEffect(() => {
    if (!authReady) return
    if (!authUser) {
      missionAbort.current?.abort()
      activeUserId.current = null
      setBase('')
      setStatus(null)
      setMessages([])
      setMemories([])
      setMission(null)
      setSelectedMissionNodeId('')
      return
    }
    if (activeUserId.current !== authUser.id) {
      activeUserId.current = authUser.id
      setMessages([])
      setMemories([])
      setMission(null)
      setSelectedMissionNodeId('')
      setInput('')
    }
    const localEndpoint = window.location.origin
    setEndpoint(localEndpoint)
    void connect(localEndpoint)
  }, [authReady, authUser?.id])
  useEffect(() => {
    if (!base || !status?.windows_desktop_available) {
      setDesktopStatus({ state: 'stopped', error: null, updated_at: null })
      return
    }
    let active = true
    const pollDesktop = async () => {
      try {
        const current = await novaRequest<DesktopStatus>(base, 'desktop/status')
        if (active) setDesktopStatus(current)
      } catch {
        if (active) setDesktopStatus({ state: 'error', error: 'Desktop assistant status is unavailable.', updated_at: null })
      }
    }
    void pollDesktop()
    const timer = window.setInterval(() => { void pollDesktop() }, 1000)
    return () => { active = false; window.clearInterval(timer) }
  }, [base, status?.windows_desktop_available])
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
    const selectedVoice = browserVoices.find(voice => voice.voiceURI === browserVoiceId)
    if (selectedVoice) {
      utterance.voice = selectedVoice
    } else {
      const fallbackVoice = browserVoices.find(voice => voice.default) ?? browserVoices[0]
      if (fallbackVoice) utterance.voice = fallbackVoice
      if (browserVoiceId) setNotice('The saved browser voice is unavailable. NOVA is using the browser default voice.')
    }
    utterance.rate = browserRate
    utterance.pitch = browserPitch
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
  function updateMissionMode(enabled: boolean) {
    setMissionMode(enabled)
    try {
      writeMissionModePreference(window.localStorage, enabled)
      setNotice(enabled
        ? 'Mission Mode is ON. Requests use the live backend mission workflow.'
        : 'Mission Mode is OFF. Requests use normal chat.')
    } catch {
      setNotice(`Mission Mode is ${enabled ? 'ON' : 'OFF'} for this page session, but browser storage is unavailable; the preference could not be saved.`)
    }
  }
  async function signOut() {
    const supabase = getSupabaseClient()
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) setNotice('Could not sign out. Please try again.')
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
    setInput(''); setPanel('conversation'); setNotice('')
    if (!isMission) setState('thinking')
    setMessages(previous => [...previous, { role: 'user', content: message }])
    let controller: AbortController | null = null
    if (isMission) {
      controller = new AbortController()
      missionAbort.current = controller
      setMission(createMissionState(message))
    }
    try {
      const onMissionEvent = (event: MissionEvent) => {
        setState('thinking')
        setSelectedMissionNodeId(event.node_id)
        setMission(previous => previous ? applyMissionEvent(previous, event) : previous)
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
        ? 'Mission stream cancelled. The backend stops before its next stage; an in-flight provider request may finish.'
        : error instanceof Error && error.name === 'TimeoutError'
          ? 'NOVA mission timed out. Check the FastAPI terminal and provider availability.'
          : content
      if (!cancelled && !isMission) setMessages(previous => [...previous, { role: 'system', content }])
      if (isMission) setMission(previous => previous
        ? markMissionInterrupted(previous, cancelled ? 'cancelled' : 'failed', missionError)
        : previous)
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
      const normalizedEndpoint = authEnabled
        ? window.location.origin
        : target.trim().replace(/\/+$/, '')
      const data = await novaRequest<BackendStatus>(normalizedEndpoint, 'status')
      setEndpoint(normalizedEndpoint)
      setBase(normalizedEndpoint)
      setStatus(data)
      let historyUnavailable = false
      try {
        const history = await novaRequest<{ messages: Array<{ role: string; content: string; mode?: string; model?: string; sources?: ChatSource[] }> }>(normalizedEndpoint, 'history')
        setMessages(history.messages.flatMap(message => {
          if (message.role !== 'user' && message.role !== 'assistant') return []
          return [{
            role: message.role,
            content: message.content,
            mode: message.mode,
            model: message.model,
            sources: message.sources,
          }]
        }))
      } catch {
        historyUnavailable = true
      }
      if (data.windows_desktop_available) {
        void loadWindowsVoiceSettings(normalizedEndpoint)
      } else {
        setWindowsVoices([])
      }
      const connectionNotice = data.nebius_configured
        ? 'NOVA backend reachable. Provider settings are configured; live inference has not been tested.'
        : 'NOVA backend reachable, but NVIDIA settings are incomplete. Check the FastAPI .env file.'
      setNotice(historyUnavailable
        ? `${connectionNotice} Saved chat history could not be loaded.`
        : connectionNotice)
      setState('idle')
    }
    catch (error) { setStatus(null); setBase(''); setNotice((error as Error).message) }
    finally { setConnecting(false) }
  }
  async function loadWindowsVoiceSettings(target = base) {
    try {
      const [voiceData, settings] = await Promise.all([
        novaRequest<{ voices: WindowsVoice[] }>(target, 'desktop/voices'),
        novaRequest<{ windowsVoiceId: string; windowsSpeechRate: number }>(target, 'desktop/voice'),
      ])
      setWindowsVoices(voiceData.voices)
      const savedVoiceAvailable = voiceData.voices.some(voice => voice.id === settings.windowsVoiceId)
      const preferredVoice = voiceData.voices.find(voice => /david|mark|james|guy/i.test(voice.name))
        ?? voiceData.voices.find(voice => /^en[-_]/i.test(voice.lang))
        ?? voiceData.voices[0]
      const selectedVoiceId = savedVoiceAvailable
        ? settings.windowsVoiceId
        : preferredVoice?.id ?? ''
      setWindowsVoiceId(selectedVoiceId)
      setWindowsRate(settings.windowsSpeechRate)
      if (selectedVoiceId && selectedVoiceId !== settings.windowsVoiceId) {
        try {
          await novaRequest(target, 'desktop/voice', {
            windowsVoiceId: selectedVoiceId,
            windowsSpeechRate: settings.windowsSpeechRate,
          }, 'PUT')
          setNotice(settings.windowsVoiceId
            ? 'The saved Windows voice is unavailable. NOVA selected and saved an available voice instead.'
            : 'NOVA selected an available Windows voice as the default.')
        } catch (error) {
          setNotice(`The selected Windows voice is active but could not be saved: ${(error as Error).message}`)
        }
      }
    } catch (error) {
      setWindowsVoices([])
      setNotice(`Windows voice settings are unavailable: ${(error as Error).message}`)
    }
  }
  function saveBrowserVoiceSetting(key: 'voice-id' | 'voice-rate' | 'voice-pitch', value: string) {
    try {
      const storageKey = key === 'voice-id' ? 'browserVoiceId' : key === 'voice-rate' ? 'browserSpeechRate' : 'browserSpeechPitch'
      window.localStorage.setItem(storageKey, value)
    } catch {
      setNotice('Could not save browser voice settings; they remain active for this page session.')
    }
  }
  async function updateWindowsVoice(voiceId: string, rate: number) {
    setWindowsVoiceId(voiceId)
    setWindowsRate(rate)
    try {
      await novaRequest(base, 'desktop/voice', { windowsVoiceId: voiceId, windowsSpeechRate: rate }, 'PUT')
      setNotice('Windows voice settings saved.')
    } catch (error) {
      setNotice(`Could not save Windows voice settings: ${(error as Error).message}`)
    }
  }
  function previewBrowserVoice() {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setNotice('Browser speech synthesis is unavailable in this browser.')
      return
    }
    const utterance = new SpeechSynthesisUtterance('Hello. I am NOVA. How can I help?')
    const voice = browserVoices.find(item => item.voiceURI === browserVoiceId)
      ?? browserVoices.find(item => item.default)
      ?? browserVoices[0]
    if (voice) utterance.voice = voice
    utterance.rate = browserRate
    utterance.pitch = browserPitch
    utterance.onerror = () => setNotice('The browser could not play the voice preview.')
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }
  async function previewWindowsVoice() {
    try {
      await novaRequest(base, 'desktop/voice/preview', {
        text: 'Hello. I am NOVA. How can I help?',
        windowsVoiceId,
        windowsSpeechRate: windowsRate,
      })
      setNotice('Windows voice preview completed.')
    } catch (error) {
      setNotice(`Windows voice preview failed: ${(error as Error).message}`)
    }
  }
  async function controlDesktop(action: 'start' | 'pause' | 'resume' | 'exit' | 'open') {
    try {
      await novaRequest(base, 'desktop/control', { action })
      setNotice(`Desktop assistant ${action} command sent.`)
    } catch (error) {
      setNotice(`Desktop assistant control failed: ${(error as Error).message}`)
    }
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
    if (controller && mission && (mission.status === 'connecting' || mission.status === 'running')) {
      const error = 'Mission stream cancelled. The backend stops before its next stage; an in-flight provider request may finish.'
      setMission(previous => previous ? markMissionInterrupted(previous, 'cancelled', error) : previous)
      controller.abort()
    }
  }
  function toggle(next: Panel) { setPanel(previous => previous === next ? null : next); setNotice('') }
  async function openMemory() {
    toggle('memory')
    if (base) try { const data = await novaRequest<{ memories: typeof memories }>(base, 'memories'); setMemories(data.memories) } catch (error) { setNotice((error as Error).message) }
  }
  const desktopState: Record<string, CoreState> = {
    idle: 'idle',
    wake_listening: 'wakeListening',
    wake_detected: 'wakeDetected',
    command_listening: 'commandListening',
    processing: 'thinking',
    speaking: 'speaking',
    paused: 'paused',
    error: 'error',
  }
  const displayState: CoreState = mission
    ? mission.status === 'failed'
      ? 'error'
      : mission.status === 'completed' || mission.status === 'cancelled' || mission.status === 'connecting'
        ? state === 'speaking' ? 'speaking' : 'idle'
        : state
    : state === 'idle' && desktopStatus.state !== 'stopped'
      ? desktopState[desktopStatus.state] ?? 'idle'
      : state
  const stateLabel: Record<CoreState, string> = {
    idle: 'Awaiting your command',
    listening: wakePhrase ? 'Browser wake phrase active' : 'Listening to you',
    wakeListening: 'Wake-word listening',
    wakeDetected: 'Wake phrase detected',
    commandListening: 'Listening for your command',
    recognized: 'Command recognized',
    thinking: 'Processing your request',
    responding: 'NOVA is responding',
    speaking: 'NOVA is speaking',
    paused: 'Wake listening paused',
    error: 'Request could not be completed',
  }
  const stateBadge: Record<CoreState, string> = {
    idle: 'IDLE',
    listening: 'BROWSER LISTENING',
    wakeListening: 'WAKE LISTENING',
    wakeDetected: 'WAKE DETECTED',
    commandListening: 'COMMAND LISTENING',
    recognized: 'COMMAND RECOGNIZED',
    thinking: 'PROCESSING',
    responding: 'PROCESSING',
    speaking: 'SPEAKING',
    paused: 'PAUSED',
    error: 'ERROR',
  }
  if (!authReady) {
    return <main className="auth-screen"><p className="auth-description">Securing your NOVA workspace…</p></main>
  }
  if (!authUser) return <AuthGate configurationError={authConfigurationError} />
  if (missionMode) {
    return <div className="nova-shell mission-shell">
      <MissionDashboard
        status={status}
        mission={mission}
        messages={messages}
        selectedNodeId={selectedMissionNodeId}
        onSelectNode={setSelectedMissionNodeId}
        onToggleMissionMode={() => updateMissionMode(false)}
        onExit={() => { updateMissionMode(false); setPanel('conversation') }}
        onOpenPanel={next => { updateMissionMode(false); setPanel(next) }}
        onNewChat={() => { setMessages([]); setMission(null); setSelectedMissionNodeId(''); setInput(''); setState('idle') }}
        onSend={() => { void send() }}
        onCancel={stopMission}
        onListen={() => listen()}
        onToggleResearch={() => setResearch(previous => !previous)}
        onToggleSpeech={toggleSpeech}
        onStopSpeaking={stopSpeaking}
        input={input}
        setInput={setInput}
        inputRef={inputRef}
        transcriptRef={transcriptRef}
        busy={busy}
        state={state}
        research={research}
        sound={sound}
        notice={notice}
        reducedMotion={reduced}
        onDismissNotice={() => setNotice('')}
        onSignOut={authEnabled ? () => void signOut() : undefined}
      />
    </div>
  }
  return <div className="nova-shell">
    <aside className="rail" aria-label="Main navigation">
      <button className="brand-icon" aria-label="NOVA home" onClick={() => setPanel(null)}><AudioLines /></button>
      <div className="rail-nav">
        <button className={panel === null ? 'selected' : ''} aria-label="Command center" title="Command center" onClick={() => setPanel(null)}><Command /></button>
        <button className={panel === 'conversation' ? 'selected' : ''} aria-label="Conversations" title="Conversations" onClick={() => toggle('conversation')}><MessageSquare />{messages.length > 0 && <i />}</button>
        <button className={panel === 'memory' ? 'selected' : ''} aria-label="Memory" title="Memory" onClick={openMemory}><Brain /></button>
        <button className={panel === 'tools' ? 'selected' : ''} aria-label="Tools" title="Tools" onClick={() => toggle('tools')}><Terminal /></button>
      </div>
      <div className="rail-bottom"><button aria-label="Help" title="Help" onClick={() => { setPanel('settings'); setNotice('Connect your FastAPI backend below. Enter sends a message; Shift + Enter adds a line. Voice transcription depends on browser support.') }}><CircleHelp /></button><button className={panel === 'voice' ? 'selected' : ''} aria-label="Voice settings" title="Voice settings" onClick={() => toggle('voice')}><Volume2 /></button><button className={panel === 'settings' ? 'selected' : ''} aria-label="Settings" title="Settings" onClick={() => toggle('settings')}><Settings /></button><span className="operator">K</span></div>
    </aside>
    <main className="command-center">
      <header className="topbar"><div className="wordmark">NOVA<span>PERSONAL INTELLIGENCE</span></div><div className="top-status"><span className={`connection-dot ${status ? 'online' : ''}`} />{status ? 'Backend reachable' : 'Not connected'}<span className="top-divider" /><button className="mode-button" onClick={() => { const next = !research; setResearch(next); setNotice(next && status && !status.tavily_configured ? 'Web research requires TAVILY_API_KEY on the FastAPI server. Assistant mode works without Tavily.' : '') }}>{research ? 'Research mode' : 'Assistant mode'}<ChevronDown size={12} /></button>{authEnabled && <button className="account-signout" onClick={() => void signOut()} title={`Sign out ${authUser.email ?? ''}`}><LogOut size={14} /> SIGN OUT</button>}</div><span className="version">LOCAL WORKSPACE <span>v.01</span></span></header>
      <div className="stage-area">
        <div className="stage-meta"><span><i /> NEURAL INTERFACE</span><span>CORE / 01</span></div>
        <div className={`stage ${panel ? 'with-panel' : ''}`}>
          <div className={`orb-zone ${mission ? 'mission-active' : ''}`}>
            <div className="orb-topline"><span /> INTELLIGENCE, IN YOUR ORBIT <span /></div>
            <div className={`orb-visual ${mission ? 'has-mission-graph' : ''}`}><div className="radar-ring ring-one" /><div className="radar-ring ring-two" />{mission ? <DynamicMissionGraph nodes={mission.nodes} status={mission.status} reducedMotion={reduced} request={mission.request} selectedNodeId={selectedMissionNodeId} onSelectNode={setSelectedMissionNodeId} /> : <><Orb state={displayState} reduced={reduced} /><div className="orb-wordmark">N O V A<span>PERSONAL AI CORE</span></div><span className="orb-coordinate left">N / 01<br />CORE ACTIVE</span><span className="orb-coordinate right">LOCAL<br />INTERFACE</span><div className="orb-floor" /></>}</div>
            <div className="core-caption"><span className={`state-pill ${displayState}`}><i />{stateBadge[displayState]}</span><h1>{stateLabel[displayState]}<span>.</span></h1><p>{displayState === 'idle' ? 'A space to think, create, and explore. Together.' : displayState === 'listening' || displayState === 'commandListening' ? 'Speak naturally. Your words will appear below.' : displayState === 'wakeListening' ? 'The desktop assistant is monitoring for its configured wake model.' : displayState === 'wakeDetected' ? 'Wake phrase detected. Listening for your command.' : displayState === 'paused' ? 'Desktop wake listening is paused.' : displayState === 'recognized' ? 'Your command was recognized and is being submitted.' : displayState === 'error' ? desktopStatus.error || 'Review the notice for details, then retry or check your connection.' : 'Your personal intelligence, at work.'}</p></div>
          </div>
          {panel && <section className="side-panel" aria-label={`${panel} panel`}><header><span>{panel === 'conversation' ? 'CONVERSATION' : panel.toUpperCase()}</span><div>{panel === 'conversation' && <button aria-label="Clear chat" disabled={busy} onClick={() => { setMessages([]); stopSpeaking(); setState('idle') }}><Trash2 size={15} /></button>}<button aria-label="Close panel" onClick={() => setPanel(null)}><X size={17} /></button></div></header>
            {panel === 'conversation' && <div ref={transcriptRef} className="transcript" role="log" aria-live="polite">{mission && <section className={`mission-card mission-${mission.status}`} aria-live="polite"><div className="mission-heading"><Activity size={15} /><strong>LIVE MISSION</strong><span className={`mission-status ${mission.status}`}>{mission.status === 'connecting' ? 'AWAITING BACKEND' : mission.status.toUpperCase()}</span></div><h2>{mission.request}</h2><p>{mission.progress}</p>{mission.error && <p className="mission-error">{mission.error}</p>}{mission.answer && <div className="mission-result"><p>{mission.answer}</p>{mission.model && <small>{mission.mode} · {mission.model}</small>}{mission.sources?.length ? <ul className="response-sources">{mission.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a></li>)}</ul> : null}</div>}{(mission.status === 'running' || mission.status === 'connecting') && <button className="mission-cancel" onClick={stopMission}>Cancel mission stream</button>}</section>}{!messages.length && !mission && <div className="panel-empty"><MessageSquare /><h2>A fresh conversation</h2><p>Your messages will appear here. Connect your backend to hear from NOVA.</p></div>}{messages.map((m, i) => <article className={`entry ${m.role}`} data-message-index={i} key={i}><div>{m.role === 'user' ? 'YOU' : m.role === 'system' ? 'SYSTEM NOTICE' : 'NOVA'}<span>{String(i + 1).padStart(2, '0')}</span></div><p>{m.content}</p>{m.role === 'assistant' && m.model && <div className="response-meta">{m.mode} · {m.model}</div>}{m.sources?.length ? <ul className="response-sources">{m.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a></li>)}</ul> : null}</article>)}{busy && !mission && <p className="thinking-line">Connecting to intelligence…</p>}</div>}
            {panel === 'memory' && <div className="panel-content"><Brain className="panel-symbol" /><h2>Memory vault</h2><p>Context that stays with you. Saved memories live in your Python backend, not this browser.</p>{!base ? <button className="text-action" onClick={() => setPanel('settings')}>Connect to view memories <ChevronRight size={14} /></button> : memories.length ? memories.map(m => <p className="memory-note" key={m.id}>{m.content}</p>) : <p>No saved memories.</p>}</div>}
            {panel === 'tools' && <div className="panel-content"><Terminal className="panel-symbol" /><h2>Tools & capabilities</h2><p>Tools execute through your existing FastAPI server.</p><label htmlFor="expression">ARITHMETIC CALCULATOR</label><input id="expression" value={expression} onChange={e => setExpression(e.target.value)} placeholder="12 * (3 + 4)" /><button className="primary-action" onClick={async () => { try { const data = await novaRequest<{ result: number }>(base, 'calculate', { expression }); setResult(String(data.result)) } catch (error) { setResult((error as Error).message) } }}>Calculate <ArrowUp size={14} /></button><p role="status">{result}</p><button className="setting-toggle" onClick={() => setResearch(!research)}><Globe size={16} />Web research<span>{research ? 'ON' : 'OFF'}</span></button><p>Research requires Tavily configured on your backend.</p></div>}
            {panel === 'settings' && <div className="panel-content"><Settings className="panel-symbol" /><h2>Your NOVA workspace</h2><p>Connect the existing NOVA FastAPI server. API keys remain on the Python server.</p><label htmlFor="endpoint">BACKEND URL</label><input id="endpoint" type="url" value={endpoint} disabled={authEnabled} onChange={e => setEndpoint(e.target.value)} /><button className="primary-action" onClick={() => void connect()} disabled={connecting}>{connecting ? 'Connecting…' : 'Test connection'}<Zap size={14} /></button><p className="connection-help">{authEnabled ? 'Authenticated connections use the secure same-origin backend proxy.' : 'By default, this same-origin URL uses the Next.js server-side proxy to FastAPI. Alternate backend URLs are called directly and may require CORS.'} {status ? `NVIDIA: ${status.nebius_configured ? `configured (${status.model ?? 'model not reported'})` : 'not configured'}. Tavily: ${status.tavily_configured ? 'configured' : 'not configured (optional for ordinary chat)'}.` : 'Backend status is unavailable.'}</p><label htmlFor="wake-phrase">WAKE PHRASE</label><input id="wake-phrase" maxLength={48} value={wakePhraseText} onChange={event => { const value = event.target.value; setWakePhraseText(value); try { window.localStorage.setItem('nova-wake-phrase', value) } catch { setNotice('Could not save the wake phrase; it remains active for this page session.') } }} /><p>Browser wake detection is available only while this page is visible. The desktop wake assistant runs independently from the browser microphone.</p><button className="setting-toggle" onClick={() => setReduced(!reduced)}>Reduced motion<span>{reduced ? 'ON' : 'OFF'}</span></button><button className="setting-toggle" onClick={toggleSpeech}>Read responses aloud<span>{sound ? 'ON' : 'OFF'}</span></button><p>Saved conversations and memories are private to your signed-in account.</p>{authEnabled && <button className="setting-toggle" onClick={() => void signOut()}>Sign out<span>{authUser.email ?? 'account'}</span></button>}</div>}
            {panel === 'voice' && <div className="panel-content voice-settings"><Volume2 className="panel-symbol" /><h2>Voice settings</h2><p>Browser and Windows voices are separate. Browser settings stay in this browser; Windows settings are stored by the local FastAPI backend.</p><label htmlFor="browser-voice">BROWSER VOICE</label><select id="browser-voice" value={browserVoiceId} onChange={event => { setBrowserVoiceId(event.target.value); saveBrowserVoiceSetting('voice-id', event.target.value) }}><option value="">Automatic browser voice</option>{browserVoiceId && !browserVoices.some(voice => voice.voiceURI === browserVoiceId) && <option value={browserVoiceId}>Saved voice unavailable — using browser fallback</option>}{browserVoices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang}){voice.localService ? ' · local' : ''}</option>)}</select><label htmlFor="browser-rate">BROWSER SPEAKING SPEED ({browserRate.toFixed(2)}×)</label><input id="browser-rate" type="range" min="0.5" max="2" step="0.05" value={browserRate} onChange={event => { const value = Number(event.target.value); setBrowserRate(value); saveBrowserVoiceSetting('voice-rate', String(value)) }} /><label htmlFor="browser-pitch">BROWSER PITCH ({browserPitch.toFixed(2)})</label><input id="browser-pitch" type="range" min="0" max="2" step="0.05" value={browserPitch} onChange={event => { const value = Number(event.target.value); setBrowserPitch(value); saveBrowserVoiceSetting('voice-pitch', String(value)) }} /><button className="primary-action" onClick={previewBrowserVoice}>Preview browser voice <Volume2 size={14} /></button><label htmlFor="windows-voice">WINDOWS DESKTOP VOICE</label><select id="windows-voice" value={windowsVoiceId} onChange={event => void updateWindowsVoice(event.target.value, windowsRate)}><option value="">Windows default voice</option>{windowsVoiceId && !windowsVoices.some(voice => voice.id === windowsVoiceId) && <option value={windowsVoiceId}>Saved voice unavailable — using Windows default</option>}{windowsVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} ({voice.lang})</option>)}</select><label htmlFor="windows-rate">WINDOWS SPEAKING SPEED (SAPI RATE)</label><input id="windows-rate" type="range" min="0.5" max="2" step="0.05" value={windowsRate} onChange={event => void updateWindowsVoice(windowsVoiceId, Number(event.target.value))} /><p>Windows System.Speech does not expose a supported pitch control. The desktop assistant uses the selected SAPI voice or Windows default if it is removed.</p><button className="primary-action" onClick={() => void previewWindowsVoice()} disabled={!base}>Preview Windows voice <Volume2 size={14} /></button><h2 className="desktop-settings-heading">Desktop assistant</h2><p>Live state: <strong>{desktopStatus.state.replaceAll('_', ' ')}</strong>{desktopStatus.error ? ` — ${desktopStatus.error}` : ''}</p><div className="desktop-actions"><button onClick={() => void controlDesktop('start')} disabled={desktopStatus.state === 'stopped'}>Start NOVA</button><button onClick={() => void controlDesktop('pause')} disabled={desktopStatus.state === 'stopped' || desktopStatus.state === 'paused'}>Pause listening</button><button onClick={() => void controlDesktop('resume')} disabled={desktopStatus.state === 'stopped'}>Resume listening</button><button onClick={() => void controlDesktop('open')}>Open NOVA</button><button onClick={() => void controlDesktop('exit')} disabled={desktopStatus.state === 'stopped'}>Exit NOVA</button></div><p>For system-tray startup consent and sign-in startup, use the tray menu in RUN_NOVA_DESKTOP.bat.</p></div>}
          </section>}
        </div>
        <div className={`composer-area ${missionMode ? 'mission-mode' : ''}`}>{notice && <div className="notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={14} /></button></div>}<div className="assistant-controls"><button className={`control-chip ${missionMode ? 'active' : ''}`} aria-pressed={missionMode} onClick={() => updateMissionMode(!missionMode)}><Activity size={14} /> Mission mode <span>{missionMode ? 'ON' : 'OFF'}</span></button><button className={`control-chip ${wakePhrase ? 'active' : ''}`} aria-pressed={wakePhrase} onClick={() => wakePhrase ? stopListening() : listen(true)} disabled={busy}><Radio size={14} /> {wakePhraseText || 'Wake phrase'} <span>{wakePhrase ? 'LISTENING' : 'WAKE'}</span></button></div><div className="suggestion-row"><button onClick={() => { setInput('Help me brainstorm an idea'); inputRef.current?.focus() }}><Sparkles />Brainstorm an idea<ChevronRight /></button><button onClick={() => { setResearch(true); setInput('Research a topic: '); inputRef.current?.focus() }}><Globe />Explore a topic<ChevronRight /></button><button onClick={() => { setInput('Help me plan my day'); inputRef.current?.focus() }}><Zap />Plan my day<ChevronRight /></button></div>
          <form className={`composer ${state === 'listening' ? 'is-listening' : ''}`} onSubmit={e => { e.preventDefault(); void send() }}><span className="composer-spark"><AudioLines /></span><textarea ref={inputRef} aria-label="Message NOVA" placeholder={missionMode ? 'Describe your mission…' : "What's on your mind?"} rows={1} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} /><button type="button" className={`mic ${state === 'listening' || state === 'wakeDetected' ? 'active' : ''}`} aria-label={speech.current ? 'Stop listening' : 'Start voice input'} onClick={() => listen()} disabled={busy}><Mic /><span>VOICE</span></button><span className="composer-divider" /><button type="submit" className="send" aria-label={missionMode ? 'Run mission' : 'Send message'} disabled={!input.trim() || busy}>{missionMode ? <Activity /> : <ArrowUp />}</button></form><div className="composer-foot"><span><ShieldCheck />Your space. Your intelligence.</span><span>{missionMode ? 'One mission at a time' : 'Enter to send'} <kbd>↵</kbd><span className="foot-separator">/</span> Shift + Enter for a new line</span></div></div>
        <footer className="system-footer"><span><i /> INTERFACE READY<span className="footer-divider" />{status ? 'BACKEND REACHABLE' : 'AWAITING BACKEND'}</span><div className="footer-wave">{Array.from({ length: 31 }, (_, i) => <i key={i} style={{ height: `${(3 + Math.sin(i * 1.7) ** 2 * 10).toFixed(2)}px` }} />)}</div><span>{(state === 'speaking' || (state === 'responding' && sound)) && <button aria-label="Stop spoken response" onClick={stopSpeaking}><VolumeX size={13} /> STOP</button>}<button aria-label={sound ? 'Mute spoken responses' : 'Enable spoken responses'} aria-pressed={sound} onClick={toggleSpeech}><Volume2 size={13} /> AUDIO {sound ? 'ON' : 'OFF'}</button><span className="footer-divider" /><button aria-label="Toggle conversation panel" onClick={() => toggle('conversation')}><Expand size={13} /> EXPAND</button></span></footer>
      </div>
    </main>
  </div>
}
