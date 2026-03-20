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
    const startOfTodayUTC = new Date(
      new Date(phtNow).setUTCHours(0, 0, 0, 0) - 8 * 60 * 60 * 1000
    ).toISOString();

    const [
      { data: allUncheckedOrders },
      { data: todaySales },
      { data: branches },
      { data: orgs },
      { data: todayLogs },
      { data: allPendingReports },
      { data: allPendingPOs },
    ] = await Promise.all([
      supabase
        .from('orders')
        .select('branch_id, is_checked')
        .or('is_checked.eq.false,is_checked.is.null'),
      supabase.from('orders').select('*').gte('created_at', startOfTodayUTC),
      supabase.from('branches').select('*'),
      supabase.from('organizations').select('*'),
      supabase
        .from('system_logs')
        .select('*')
        .in('event_type', ['LOGIN', 'BRANCH_CHANGE'])
        .gte('created_at', startOfTodayUTC),
      supabase
        .from('daily_reports')
        .select('branch_id, is_checked')
        .or('is_checked.eq.false,is_checked.is.null'),
      supabase
        .from('purchase_orders')
        .select('branch_id, is_checked')
        .or('is_checked.eq.false,is_checked.is.null'),
    ]);

    // 1. Map Staff Activity with Trimming to prevent mismatch
    const activeStaffMap: Record<string, string[]> = {};
    todayLogs?.forEach((log: any) => {
      const bName = log.branch_name?.toString().trim().toUpperCase();
      const email = log.user_email?.split('@').trim().toUpperCase();
      if (!bName || !email) return;

      if (!activeStaffMap[bName]) activeStaffMap[bName] = [];
      if (!activeStaffMap[bName].includes(email)) {
        activeStaffMap[bName].push(email);
      }
    });

    // 2. Process Branch Stats
    const branchStats: Record<string, any> = {};
    branches?.forEach((b) => {
      branchStats[b.id] = {
        generic: 0,
        branded: 0,
        total: 0,
        pendingOrders:
          allUncheckedOrders?.filter((o) => o.branch_id === b.id).length || 0,
        pendingDRs:
          allPendingReports?.filter((r) => r.branch_id === b.id).length || 0,
        pendingPOs:
          allPendingPOs?.filter((p) => p.branch_id === b.id).length || 0,
      };
    });

    todaySales?.forEach((order: any) => {
      const bId = order.branch_id;
      if (branchStats[bId]) {
        branchStats[bId].generic += Number(order.generic_amt || 0);
        branchStats[bId].branded += Number(order.branded_amt || 0);
        branchStats[bId].total += Number(order.total_amount || 0);
      }
    });

    const orgMap: Record<string, any> = {};
    orgs?.forEach((org) => {
      orgMap[org.id] = org;
    });

    const orgGroups: Record<string, any> = {};
    branches?.forEach((b: any) => {
      const org = orgMap[b.org_id];
      if (!org?.telegram_chat_id) return;
      if (!orgGroups[org.id]) {
        orgGroups[org.id] = {
          chatId: org.telegram_chat_id,
          name: org.name,
          branches: [],
        };
      }
      orgGroups[org.id].branches.push(b);
    });

    // 3. Build & Send Message
    await Promise.all(
      Object.values(orgGroups).map(async (group: any) => {
        let header = '';
        switch (type) {
          case 'REPORT_CHECKER':
            header = '🚨 ALL-TIME REPORT CHECKER (6AM)';
            break;
          case 'LOGIN':
            header = '👥 STAFF LOGIN STATUS (12NN)';
            break;
          case 'UPDATE':
            header = '📊 SALES UPDATE (5PM)';
            break;
          default:
            header = '🏁 FINAL EOD REPORT (11PM)';
        }

        let message = `<b>${header}</b>\n🏢 <b>${group.name.toUpperCase()}</b>\n`;
        message += `━━━━━━━━━━━━━━━━━━\n`;

        group.branches.forEach((b: any) => {
          const stats = branchStats[b.id];

          // Match Branch Name using trimmed uppercase
          const bKey = b.branch_name?.toString().trim().toUpperCase();
          const staff = activeStaffMap[bKey] || [];

          const hasBacklog =
            stats.pendingOrders > 0 ||
            stats.pendingDRs > 0 ||
            stats.pendingPOs > 0;
          const hasSales = stats.total > 0;
          const quotaReached =
            b.daily_generic_quota > 0 && stats.generic >= b.daily_generic_quota;

          let statusIcon = '✅';
          if (type === 'REPORT_CHECKER') {
            statusIcon = hasBacklog ? '❌' : '✅';
          } else {
            if (!hasSales && staff.length === 0) {
              statusIcon = '💤'; // No sales, No staff = Not opens
            } else if (!hasSales && staff.length > 0) {
              statusIcon = '🛠️'; // Staff present but 0 sales = Maintenance/Preparing
            } else if (hasSales && b.daily_generic_quota > 0 && !quotaReached) {
              statusIcon = '🚨'; // Open and selling, but below quotaa
            } else {
              statusIcon = '✅'; // Target met or no quota set
            }
          }

          message += `<b>📍 ${b.branch_name.toUpperCase()} ${statusIcon}</b>\n`;

          if (type === 'REPORT_CHECKER') {
            if (stats.pendingDRs > 0)
              message += `• 📝 Pending Reports: <b>${stats.pendingDRs}</b>\n`;
            if (stats.pendingOrders > 0)
              message += `• 🛒 Unchecked Orders: <b>${stats.pendingOrders}</b>\n`;
            if (stats.pendingPOs > 0)
              message += `• 📦 Pending POs: <b>${stats.pendingPOs}</b>\n`;
            if (!hasBacklog) message += `• <i>No pending backlogs found.</i>\n`;
          } else {
            // Display staff for all other report types
            message += `👤 ${
              staff.length > 0 ? staff.join(', ') : 'OFFLINE'
            }\n`;
            message += `• Generic: ₱${stats.generic.toLocaleString()}\n`;
            message += `• Total: ₱${stats.total.toLocaleString()}\n`;

            if (b.daily_generic_quota > 0) {
              const prog = (
                (stats.generic / b.daily_generic_quota) *
                100
              ).toFixed(1);
              message += `• Progress: ${prog}%\n`;
            }
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

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
