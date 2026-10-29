import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const requestHopByHopHeaders = ['connection', 'content-length', 'host', 'transfer-encoding']
const responseHopByHopHeaders = ['connection', 'content-length', 'keep-alive', 'transfer-encoding']

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const backend = (process.env.NOVA_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '')
  const target = new URL(`${backend}/api/${path.map(segment => encodeURIComponent(segment)).join('/')}${request.nextUrl.search}`)
  const headers = new Headers(request.headers)
  for (const header of requestHopByHopHeaders) headers.delete(header)

  try {
    const body = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.arrayBuffer()
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
    const detail = error instanceof Error ? error.message : 'Unknown network error.'
    return Response.json(
      { detail: `Cannot reach the configured FastAPI backend at ${backend}. ${detail}` },
      { status: 502 },
    )
  }
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
