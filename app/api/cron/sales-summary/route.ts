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

    // Date Logic (Manila Time)
    const now = new Date();
    const phtNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const startOfPHTDayInUTC = new Date(
      new Date(phtNow.setUTCHours(0, 0, 0, 0)).getTime() - 8 * 60 * 60 * 1000
    );

    // 1. Fetch tables separately to bypass Join/FK alias issues
    const [
      { data: sales, error: salesError },
      { data: branches, error: branchError },
      { data: orgs, error: orgError },
    ] = await Promise.all([
      supabase
        .from('orders')
        .select('*')
        .gte('created_at', startOfPHTDayInUTC.toISOString()),
      supabase.from('branches').select('*'),
      supabase.from('organizations').select('*'),
    ]);

    if (salesError || branchError || orgError) {
      console.error('Fetch Error:', salesError || branchError || orgError);
      throw new Error('Database fetch failed');
    }

    // 2. Map Organizations by ID
    const orgMap: Record<string, any> = {};
    orgs?.forEach((org) => {
      orgMap[org.id] = org;
    });

    // 3. Map Sales to Branch IDs (Handling NULL branch_id)
    const branchStats: Record<string, any> = {};
    sales?.forEach((order: any) => {
      // FIX: Skip orders that aren't linked to a branch
      if (!order.branch_id) return;

      const bId = order.branch_id;
      if (!branchStats[bId])
        branchStats[bId] = { generic: 0, branded: 0, total: 0 };

      branchStats[bId].generic += Number(order.generic_amt || 0);
      branchStats[bId].branded += Number(order.branded_amt || 0);
      branchStats[bId].total += Number(order.total_amount || 0);
    });

    // 4. Group Branches by Organization
    const orgGroups: Record<
      string,
      { chatId: string; name: string; branches: any[] }
    > = {};
    branches?.forEach((b: any) => {
      // FIX: Skip branches not linked to an organization
      const org = orgMap[b.org_id];
      if (!org || !org.telegram_chat_id) return;

      if (!orgGroups[org.id]) {
        orgGroups[org.id] = {
          chatId: org.telegram_chat_id,
          name: org.name,
          branches: [],
        };
      }
      orgGroups[org.id].branches.push(b);
    });

    // 5. Build and Send Messages
    const sendPromises = Object.values(orgGroups).map(async (group) => {
      let header =
        type === 'LOGIN'
          ? '☀️ MORNING SYNC'
          : type === 'MIDDAY'
          ? '📊 MIDDAY QUOTA'
          : '🏁 FINAL EOD';
      let message = `<b>${header}</b>\n`;
      message += `🏢 <b>${group.name.toUpperCase()}</b>\n`;
      message += `━━━━━━━━━━━━━━━━━━\n`;

      group.branches.forEach((bInfo) => {
        const stats = branchStats[bInfo.id] || {
          generic: 0,
          branded: 0,
          total: 0,
        };
        const name = bInfo.branch_name.toUpperCase();
        const quota = bInfo.daily_generic_quota;

        message += `<b>📍 BRANCH: ${name}</b>\n`;
        message += `• Generic: ₱${stats.generic.toLocaleString()}\n`;

        if (quota) {
          const progress = (stats.generic / quota) * 100;
          message += `• Progress: ${progress.toFixed(1)}%\n`;
          if (stats.generic < quota) {
            message += `• <b>Target:</b> ₱${(
              quota - stats.generic
            ).toLocaleString()} left\n`;
          } else {
            message += `✅ <b>QUOTA MET</b>\n`;
          }
        }

        if (type !== 'LOGIN') {
          message += `• Branded: ₱${stats.branded.toLocaleString()}\n`;
          message += `• <b>Total: ₱${stats.total.toLocaleString()}</b>\n`;
        }
        message += `━━━━━━━━━━━━━━━━━━\n`;
      });

      message += `<i>Pharma_Ops Analytics Sync</i>`;

      return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: group.chatId,
          text: message,
          parse_mode: 'HTML',
        }),
      });
    });

    await Promise.all(sendPromises);

    return NextResponse.json({
      success: true,
      orgs_notified: Object.keys(orgGroups).length,
      orders_processed: sales?.length,
    });
  } catch (err: any) {
    console.error('CRON ERROR:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
