import { NextRequest, NextResponse } from 'next/server'

export const config = {
  matcher: '/api/v1/((?!health$).+)',
}

export function proxy(request: NextRequest): NextResponse {
  const secret = process.env.SYMPHONY_SECRET
  if (!secret) return NextResponse.next()

  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const queryToken = request.nextUrl.searchParams.get('token')
  const cookieToken = request.cookies.get('symphony_session')?.value ?? null
  const provided = bearerToken ?? queryToken ?? cookieToken

  if (!provided || provided !== secret) {
    return new NextResponse(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )
  }
  return NextResponse.next()
}
