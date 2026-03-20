import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = (searchParams.get('type') || 'EOD').toUpperCase();
  const key = searchParams.get('key');

  if (key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 1. USE SERVICE ROLE KEY TO BYPASS RLS
  // Make sure you have SUPABASE_SERVICE_ROLE_KEY in your .env
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! 
  );

  try {
    const BOT_TOKEN = '8743953425:AAF2qLUU5aMK7SySJ9txxkEoda08GeP8kb8';
    
    // 2. WIDE WINDOW (Last 3 days just to TEST if we can see ANY logs)
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: todayLogs, error: logError },
      { data: branches },
      { data: orgs }
    ] = await Promise.all([
      supabaseAdmin.from('system_logs').select('*')
        .in('event_type', ['LOGIN', 'BRANCH_CHANGE'])
        .gte('created_at', threeDaysAgo), // Testing with a very wide window
      supabaseAdmin.from('branches').select('*'),
      supabaseAdmin.from('organizations').select('*')
    ]);

    if (logError) throw logError;

    // 3. STAFF MAPPING
    const activeStaffMap: Record<string, string[]> = {};
    todayLogs?.forEach((log: any) => {
      const bKey = log.branch_name?.toString().trim().toUpperCase();
      const sName = log.user_name?.toString().trim().toUpperCase();
      
      if (bKey && sName) {
        if (!activeStaffMap[bKey]) activeStaffMap[bKey] = [];
        if (!activeStaffMap[bKey].some(n => n.startsWith(sName))) {
          const time = new Date(log.created_at).toLocaleTimeString('en-PH', {
            hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila'
          });
          activeStaffMap[bKey].push(`${sName} (${time})`);
        }
      }
    });

    const orgMap: Record<string, any> = {};
    orgs?.forEach(org => orgMap[org.id] = org);

    const orgGroups: Record<string, any> = {};
    branches?.forEach((b: any) => {
      const org = orgMap[b.org_id];
      if (!org?.telegram_chat_id) return;
      if (!orgGroups[org.id]) orgGroups[org.id] = { chatId: org.telegram_chat_id, branches: [] };
      orgGroups[org.id].branches.push(b);
    });

    // 4. Send Message
    for (const group of Object.values(orgGroups) as any[]) {
      let message = `<b>📊 STAFF STATUS REPORT</b>\n`;
      message += `<i>Debug: Found ${todayLogs?.length || 0} logs in last 72hrs</i>\n`;
      message += `━━━━━━━━━━━━━━━━━━\n`;

      group.branches.forEach((b: any) => {
        const bName = b.branch_name.toString().trim().toUpperCase();
        const staff = activeStaffMap[bName] || [];
        message += `<b>📍 ${bName}</b>\n👤 ${staff.length > 0 ? staff.join(', ') : 'OFFLINE'}\n`;
        message += `━━━━━━━━━━━━━━━━━━\n`;
      });

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: group.chatId, text: message, parse_mode: 'HTML' }),
      });
    }

    return NextResponse.json({ success: true, logs_count: todayLogs?.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}