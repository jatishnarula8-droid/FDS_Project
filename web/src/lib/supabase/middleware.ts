import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/auth'];

const SETUP_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Setup needed</title><body style="font-family:system-ui;max-width:640px;margin:10vh auto;padding:0 16px;line-height:1.5">
<h1>Almost there: connect Supabase</h1>
<p>Open <code>web/.env.local</code> and replace the placeholders with your real values from
<b>Supabase → Project Settings → API</b>:</p>
<pre style="background:#f4f4f4;padding:12px;border-radius:8px">NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...</pre>
<p>Then stop and restart <code>npm run dev</code>. See <code>SETUP.md</code>, step 1.</p></body>`;

export async function updateSession(request: NextRequest) {
  const url0 = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key0 = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!/^https?:\/\//.test(url0) || !key0 || key0.startsWith('YOUR_')) {
    return new NextResponse(SETUP_PAGE, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser(); // validates the JWT with Supabase Auth
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return response;
}
