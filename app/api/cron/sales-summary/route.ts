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

    const now = new Date();
    const phtNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const startOfPHTDayInUTC = new Date(
      new Date(phtNow.setUTCHours(0, 0, 0, 0)).getTime() - 8 * 60 * 60 * 1000
    ).toISOString();

    // 1. Fetch Sales, Branches, Orgs, and Logs
    const [
      { data: sales },
      { data: branches },
      { data: orgs },
      { data: logs },
    ] = await Promise.all([
      supabase.from('orders').select('*').gte('created_at', startOfPHTDayInUTC),
      supabase.from('branches').select('*'),
      supabase.from('organizations').select('*'),
      supabase
        .from('system_logs')
        .select('created_at, branch_name, user_email, event_type')
        .in('event_type', ['LOGIN', 'BRANCH_CHANGE']) // Capture both events
        .gte('created_at', startOfPHTDayInUTC)
        .order('created_at', { ascending: true }),
    ]);

    // 2. Mapping Earliest Activity per Branch
    const activeStaffMap: Record<string, string[]> = {};
    const seenStaffAtBranch = new Set<string>();

    logs?.forEach((log: any) => {
      const bName = log.branch_name?.trim().toUpperCase();
      const email = log.user_email?.toLowerCase();
      if (!bName || !email) return;

      const uniqueKey = `${email}-${bName}`;

      if (!seenStaffAtBranch.has(uniqueKey)) {
        seenStaffAtBranch.add(uniqueKey);

        if (!activeStaffMap[bName]) activeStaffMap[bName] = [];

        const time = new Date(log.created_at).toLocaleTimeString('en-PH', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });

        const staffName = email.split('@')[0].toUpperCase();
        activeStaffMap[bName].push(`${staffName} (${time})`);
      }
    });

    const branchStats: Record<string, any> = {};
    sales?.forEach((order: any) => {
      const bId = order.branch_id;
      if (!branchStats[bId])
        branchStats[bId] = { generic: 0, branded: 0, total: 0 };
      branchStats[bId].generic += Number(order.generic_amt || 0);
      branchStats[bId].total += Number(order.total_amount || 0);
    });

    const orgMap: Record<string, any> = {};
    orgs?.forEach((org) => {
      orgMap[org.id] = org;
    });

    const orgGroups: Record<string, any> = {};
    branches?.forEach((b: any) => {
      const org = orgMap[b.org_id];
      if (!org?.telegram_chat_id) return;
      if (!orgGroups[org.id])
        orgGroups[org.id] = {
          chatId: org.telegram_chat_id,
          name: org.name,
          branches: [],
        };
      orgGroups[org.id].branches.push(b);
    });

    // 3. Build Telegram Messages
    await Promise.all(
      Object.values(orgGroups).map(async (group: any) => {
        let header =
          type === 'LOGIN'
            ? '☀️ MORNING SYNC & LOGINS'
            : type === 'MIDDAY'
            ? '📊 MIDDAY QUOTA'
            : '🏁 FINAL EOD';
        let message = `<b>${header}</b>\n🏢 <b>${group.name.toUpperCase()}</b>\n`;
        message += `━━━━━━━━━━━━━━━━━━\n`;

        group.branches.forEach((b: any) => {
          const stats = branchStats[b.id] || { generic: 0, total: 0 };
          const branchKey = b.branch_name?.trim().toUpperCase();
          const staff = activeStaffMap[branchKey] || [];

          message += `<b>📍 ${b.branch_name.toUpperCase()}</b>\n`;

          if (type === 'LOGIN') {
            message +=
              staff.length > 0
                ? `👤 ${staff.join(', ')}\n`
                : `⚠️ <b>NO LOGIN DETECTED</b>\n`;
          }

          message += `• Generic: ₱${stats.generic.toLocaleString()}\n`;
          if (b.daily_generic_quota) {
            const progress = (stats.generic / b.daily_generic_quota) * 100;
            message += `• Progress: ${progress.toFixed(1)}%\n`;
          }
          message += `━━━━━━━━━━━━━━━━━━\n`;
        });

        return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: group.chatId,
            text: message,
            parse_mode: 'HTML',
          }),
        });
      })
    );

    return NextResponse.json({
      success: true,
      logs_analyzed: logs?.length || 0,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
