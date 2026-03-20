import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = (searchParams.get('type') || 'EOD').toUpperCase();
  const key = searchParams.get('key');

  if (key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Use Service Role to bypass RLS
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const BOT_TOKEN = '8743953425:AAF2qLUU5aMK7SySJ9txxkEoda08GeP8kb8';
    
    // Look back 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: todayLogs, error: logError },
      { data: branches },
      { data: orgs }
    ] = await Promise.all([
      supabaseAdmin.from('system_logs').select('*')
        .in('event_type', ['LOGIN', 'BRANCH_CHANGE'])
        .gte('created_at', twentyFourHoursAgo),
      supabaseAdmin.from('branches').select('*'),
      supabaseAdmin.from('organizations').select('*')
    ]);

    if (logError) throw logError;

    // 1. Staff Mapping with NULL checks
    const activeStaffMap: Record<string, string[]> = {};
    
    todayLogs?.forEach((log: any) => {
      // Use Optional Chaining (?.) and fallback to empty string to prevent the toUpperCase() error
      const bKey = (log.branch_name || "").toString().trim().toUpperCase();
      const sName = (log.user_name || "").toString().trim().toUpperCase();
      
      // Only process if BOTH names exist
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

    // 2. Build and Send Telegram Message
    for (const group of Object.values(orgGroups) as any[]) {
      let message = `<b>📊 STAFF STATUS REPORT</b>\n`;
      message += `━━━━━━━━━━━━━━━━━━\n`;

      group.branches.forEach((b: any) => {
        // Safe check for branch table name too
        const bName = (b.branch_name || "UNKNOWN").toString().trim().toUpperCase();
        const staff = activeStaffMap[bName] || [];

        message += `<b>📍 ${bName}</b>\n`;
        message += `👤 ${staff.length > 0 ? staff.join(', ') : 'OFFLINE'}\n`;
        message += `━━━━━━━━━━━━━━━━━━\n`;
      });

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            chat_id: group.chatId, 
            text: message, 
            parse_mode: 'HTML' 
        }),
      });
    }

    return NextResponse.json({ 
        success: true, 
        logs_processed: todayLogs?.length 
    });

  } catch (err: any) {
    // If it still fails, this will tell us exactly where
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}