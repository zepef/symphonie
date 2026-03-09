import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.SYMPHONY_SECRET
  if (!secret) {
    // Auth is disabled — no session needed
    return NextResponse.json({ ok: true })
  }

  let body: { secret?: string }
  try {
    body = await request.json() as { secret?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (body.secret !== secret) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set('symphony_session', secret, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })
  return response
}
