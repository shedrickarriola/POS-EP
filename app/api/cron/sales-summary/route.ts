import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = (searchParams.get('type') || 'EOD').toUpperCase();
  const key = searchParams.get('key');

  if (key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const BOT_TOKEN = '8743953425:AAF2qLUU5aMK7SySJ9txxkEoda08GeP8kb8';
    
    // 1. PHT Date Logic (Calculates 12:00 AM PHT Today)
    const phtNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    const midnightPHT = new Date(phtNow.getFullYear(), phtNow.getMonth(), phtNow.getDate(), 0, 0, 0);
    const startOfTodayISO = midnightPHT.toISOString();

    const [
      { data: todaySales },
      { data: branches },
      { data: orgs },
      { data: todayLogs }
    ] = await Promise.all([
      supabase.from('orders').select('*').gte('created_at', startOfTodayISO),
      supabase.from('branches').select('*'),
      supabase.from('organizations').select('*'),
      supabase.from('system_logs').select('*')
        .in('event_type', ['LOGIN', 'BRANCH_CHANGE'])
        .gte('created_at', startOfTodayISO)
        .order('created_at', { ascending: true }),
    ]);

    // 2. Map Staff (Normalize keys to "PANSOL")
    const activeStaffMap: Record<string, string[]> = {};
    todayLogs?.forEach((log: any) => {
      const bKey = log.branch_name?.toString().trim().toUpperCase();
      const sName = log.user_name?.toString().trim().toUpperCase();
      
      if (bKey && sName) {
        if (!activeStaffMap[bKey]) activeStaffMap[bKey] = [];
        if (!activeStaffMap[bKey].some(name => name.startsWith(sName))) {
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

    // 3. Build Message
    for (const group of Object.values(orgGroups) as any[]) {
      let message = `<b>📊 STAFF STATUS REPORT</b>\n`;
      message += `<i>Found ${todayLogs?.length || 0} logs since midnight.</i>\n`; // DEBUG LINE
      message += `━━━━━━━━━━━━━━━━━━\n`;

      group.branches.forEach((b: any) => {
        const bName = b.branch_name.toString().trim().toUpperCase();
        
        // Match logic: Look for "Pansol" in the staff map
        const staffEntries = activeStaffMap[bName] || [];

        message += `<b>📍 ${bName}</b>\n`;
        message += `👤 ${staffEntries.length > 0 ? staffEntries.join(', ') : 'OFFLINE'}\n`;
        message += `━━━━━━━━━━━━━━━━━━\n`;
      });

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: group.chatId, text: message, parse_mode: 'HTML' }),
      });
    }

    return NextResponse.json({ success: true, logs: todayLogs?.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}