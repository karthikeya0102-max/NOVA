import assert from 'node:assert/strict'
import test from 'node:test'
import { novaMission, novaRequest } from './nova-api.ts'
import { authorizationHeaders } from './supabase.ts'

test('local development omits auth headers when Supabase is not configured', async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  try {
    assert.deepEqual(await authorizationHeaders(), {})
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey
  }
})

test('authenticated chat and Mission Mode reject non-same-origin backends', async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-test-key'
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'https://nova.example' } },
  })
  try {
    await assert.rejects(
      novaRequest('https://attacker.example', 'status'),
      /same-origin backend proxy/,
    )
    await assert.rejects(
      novaMission(
        'https://attacker.example',
        { message: 'private request', research: false },
        new AbortController().signal,
        () => {},
      ),
      /same-origin backend proxy/,
    )
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
