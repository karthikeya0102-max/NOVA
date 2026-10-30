'use client'

import { useState, type FormEvent } from 'react'
import { AudioLines, ArrowUp, ShieldCheck } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase'

export default function AuthGate({ configurationError = false }: { configurationError?: boolean }) {
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    const supabase = getSupabaseClient()
    if (!supabase) {
      setError('Secure sign-in is not configured. Contact the NOVA deployment administrator.')
      setBusy(false)
      return
    }
    try {
      if (creatingAccount) {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        })
        if (authError) throw authError
        if (!data.session) {
          setNotice('Account created. Verify your email, then sign in to NOVA.')
        } else {
          setNotice('Account created. Loading your secure NOVA workspace…')
        }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (authError) throw authError
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Sign-in failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-screen">
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-brand"><span><AudioLines size={22} /></span><strong>NOVA</strong></div>
      <p className="auth-eyebrow"><ShieldCheck size={14} /> PRIVATE WORKSPACE</p>
      <h1 id="auth-title">{creatingAccount ? 'Create your account' : 'Welcome back'}</h1>
      <p className="auth-description">Sign in to access your private conversations and mission history.</p>
      {configurationError
        ? <p className="auth-error" role="alert">Secure sign-in is not configured for this deployment. The workspace is locked until the administrator configures Supabase.</p>
        : <form onSubmit={event => void submit(event)}>
          <label htmlFor="nova-email">EMAIL</label>
          <input id="nova-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} />
          <label htmlFor="nova-password">PASSWORD</label>
          <input id="nova-password" type="password" autoComplete={creatingAccount ? 'new-password' : 'current-password'} required minLength={10} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : creatingAccount ? 'Create account' : 'Sign in'} <ArrowUp size={15} />
          </button>
          <button className="auth-mode-toggle" type="button" onClick={() => { setCreatingAccount(value => !value); setError(''); setNotice('') }}>
            {creatingAccount ? 'Already have an account? Sign in' : 'New to NOVA? Create an account'}
          </button>
        </form>}
      <p className="auth-footnote">Your account secures access to your NOVA data. Never share your password or sign-in link.</p>
    </section>
  </main>
}
