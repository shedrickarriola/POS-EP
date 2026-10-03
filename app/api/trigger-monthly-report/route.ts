import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// ============================================================================
// TRIGGER: MONTHLY_EMAIL (office branches) for a specific month, from StaffHub
// ============================================================================
// This is a NEW, standalone route — it does not modify Report103.txt at all.
// It exists purely so the StaffHub "TRIGGER MONTHLY REPORT" button has something
// safe to call: CRON_SECRET must never be sent to the browser, so this route
// runs server-side, re-checks who the caller actually is using their own
// Supabase session token (never trusting a role the client claims), and only
// then calls the real cron endpoint with the secret attached server-side.
//
// Place this file at something like: app/api/trigger-monthly-report/route.ts
// (any path is fine — just match it in the StaffHub fetch() call).
// ============================================================================

const CRON_ROUTE_PATH = '/api/cron/sales-summary'; // same route Report103.txt is deployed at

export async function POST(request: Request) {
  try {
    // 1. Pull the caller's own Supabase access token out of the Authorization header.
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 2. Verify that token server-side and find out who it actually belongs to.
    //    This never trusts anything the browser sends about its own role.
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 3. Look up that person's role fresh from the DB and require admin/manager,
    //    same gate StaffHub already uses client-side (profile?.role).
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('email', userData.user.email)
      .single();

    if (profile?.role !== 'branch_admin' && profile?.role !== 'org_manager') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 4. Validate the requested month.
    const body = await request.json().catch(() => ({}));
    const month = body?.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'Invalid month — expected YYYY-MM' }, { status: 400 });
    }

    // 5. Call the real cron route server-to-server, attaching CRON_SECRET here —
    //    it never leaves the server, let alone reaches the browser.
    const origin = new URL(request.url).origin;
    const cronUrl = `${origin}${CRON_ROUTE_PATH}?type=MONTHLY_EMAIL&month=${encodeURIComponent(month)}&key=${process.env.CRON_SECRET}`;

    const cronRes = await fetch(cronUrl);
    const cronJson = await cronRes.json().catch(() => ({}));

    if (!cronRes.ok) {
      return NextResponse.json({ error: 'Report trigger failed', detail: cronJson }, { status: 502 });
    }

    return NextResponse.json({ ok: true, month, result: cronJson });
  } catch (err: any) {
    console.error('trigger-monthly-report error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
