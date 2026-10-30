import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const responseHopByHopHeaders = ['connection', 'content-length', 'keep-alive', 'transfer-encoding']
const maxRequestBytes = 65536

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const configuredBackend = process.env.NOVA_API_BASE_URL
  const backend = (configuredBackend || (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8000' : '')).replace(/\/+$/, '')
  if (!backend) {
    return Response.json({ detail: 'The NOVA backend is not configured for this deployment.' }, { status: 503 })
  }
  const target = new URL(`${backend}/api/${path.map(segment => encodeURIComponent(segment)).join('/')}${request.nextUrl.search}`)
  const headers = new Headers()
  for (const name of ['authorization', 'content-type', 'accept']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    return Response.json({ detail: 'Request body exceeds the 64 KiB limit.' }, { status: 413 })
  }

  try {
    const body = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.arrayBuffer()
    if (body && body.byteLength > maxRequestBytes) {
      return Response.json({ detail: 'Request body exceeds the 64 KiB limit.' }, { status: 413 })
    }
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: body?.byteLength ? body : undefined,
      cache: 'no-store',
      signal: request.signal,
    })
    const responseHeaders = new Headers(upstream.headers)
    for (const header of responseHopByHopHeaders) responseHeaders.delete(header)
    responseHeaders.set('Cache-Control', 'no-cache, no-transform')
    responseHeaders.set('X-Accel-Buffering', 'no')
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  } catch (error) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499, statusText: 'Client Closed Request' })
    }
    return Response.json(
      { detail: 'The NOVA backend is temporarily unavailable.' },
      { status: 502 },
    )
  }
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
