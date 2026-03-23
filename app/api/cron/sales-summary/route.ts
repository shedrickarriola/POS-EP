import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = (searchParams.get('type') || 'EOD').toUpperCase();
  const key = searchParams.get('key');

  if (key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const BOT_TOKEN = '8743953425:AAF2qLUU5aMK7SySJ9txxkEoda08GeP8kb8';
    const phtNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    const midnightPHT = new Date(phtNow.getFullYear(), phtNow.getMonth(), phtNow.getDate(), 0, 0, 0);
    const startOfTodayISO = midnightPHT.toISOString();

    // 1. DATA FETCHING (Includes the inventory table from your schema)
    const [
      { data: allUncheckedOrders },
      { data: todaySales },
      { data: branches },
      { data: orgs },
      { data: todayLogs },
      { data: allPendingReports },
      { data: allPendingPOs },
      { data: inventory }
    ] = await Promise.all([
      supabaseAdmin.from('orders').select('branch_id, is_checked').or('is_checked.eq.false,is_checked.is.null'),
      supabaseAdmin.from('orders').select('*').gte('created_at', startOfTodayISO),
      supabaseAdmin.from('branches').select('*'),
      supabaseAdmin.from('organizations').select('*'),
      supabaseAdmin.from('system_logs').select('*')
        .in('event_type', ['LOGIN', 'BRANCH_CHANGE'])
        .gte('created_at', startOfTodayISO)
        .order('created_at', { ascending: true }),
      supabaseAdmin.from('daily_reports').select('branch_id, is_checked').or('is_checked.eq.false,is_checked.is.null'),
      supabaseAdmin.from('purchase_orders').select('branch_id, is_checked').or('is_checked.eq.false,is_checked.is.null'),
      supabaseAdmin.from('inventory').select('*').order('sold_weekly', { ascending: false }) // Prioritize top sellers
    ]);

    // 2. STAFF MAPPING (Retained from Telegram320.txt)
    const activeStaffMap: Record<string, string[]> = {};
    todayLogs?.forEach((log: any) => {
      const bName = log.branch_name?.toString().trim().toUpperCase();
      const staffName = log.user_name?.toString().trim().toUpperCase();
      if (bName && staffName) {
        if (!activeStaffMap[bName]) activeStaffMap[bName] = [];
        if (!activeStaffMap[bName].some(s => s.startsWith(staffName))) {
          const loginTime = new Date(log.created_at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
          activeStaffMap[bName].push(`${staffName} (${loginTime})`);
        }
      }
    });

    // 3. BRANCH STATS (Retained all original Generic/Branded/Total logic)
    const branchStats: Record<string, any> = {};
    branches?.forEach((b) => {
      branchStats[b.id] = {
        generic: 0, branded: 0, total: 0,
        pendingOrders: allUncheckedOrders?.filter((o) => o.branch_id === b.id).length || 0,
        pendingDRs: allPendingReports?.filter((r) => r.branch_id === b.id).length || 0,
        pendingPOs: allPendingPOs?.filter((p) => p.branch_id === b.id).length || 0,
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

    const orgMap = Object.fromEntries(orgs?.map(o => [o.id, o]) || []);
    const orgGroups: Record<string, any> = {};
    branches?.forEach((b: any) => {
      const org = orgMap[b.org_id];
      if (!org?.telegram_chat_id) return;
      if (!orgGroups[org.id]) orgGroups[org.id] = { chatId: org.telegram_chat_id, name: org.name, branches: [] };
      orgGroups[org.id].branches.push(b);
    });

    // 4. MESSAGE LOOP
    for (const group of Object.values(orgGroups) as any[]) {
      let message = "";

      if (type === 'STOCK_ADVISORY') {
        message = `<b>📦 2-WEEK STOCK ADVISORY</b>\n🏢 <b>${group.name.toUpperCase()}</b>\n━━━━━━━━━━━━━━━━━━\n`;
        group.branches.forEach((b: any) => {
          // RECOMMENDATION LOGIC:
          // 1. Filter by branch.
          // 2. Item is critical if: Stock is <= (Weekly Sales * 2) OR Stock is < 5.
          // 3. Take top 20 items by sales volume.
          const toOrder = inventory?.filter((p: any) => 
            p.branch_id === b.id && 
            (Number(p.stock) <= (Number(p.sold_weekly || 0) * 2) || Number(p.stock) < 5)
          ).slice(0, 20);

          message += `<b>📍 ${b.branch_name.toUpperCase()}</b>\n`;
          if (toOrder && toOrder.length > 0) {
            toOrder.forEach((p: any) => {
              const icon = Number(p.stock) <= 0 ? '🚨' : '⚠️';
              message += `${icon} ${p.item_name}: ${p.stock} left (Avg. ${p.sold_weekly}/wk)\n`;
            });
          } else {
            message += `✅ <i>Stock levels healthy</i>\n`;
          }
          message += `━━━━━━━━━━━━━━━━━━\n`;
        });
      } else {
        // --- RETAIN ORIGINAL REPORTS (Checker, Login, Update, EOD) ---
        let header = '';
        switch (type) {
          case 'REPORT_CHECKER': header = '🚨 ALL-TIME REPORT CHECKER (6AM)'; break;
          case 'LOGIN':          header = '👥 STAFF LOGIN STATUS (12NN)'; break;
          case 'UPDATE':         header = '📊 SALES UPDATE (5PM)'; break;
          default:               header = '🏁 FINAL EOD REPORT (11PM)';
        }
        message = `<b>${header}</b>\n🏢 <b>${group.name.toUpperCase()}</b>\n━━━━━━━━━━━━━━━━━━\n`;

        group.branches.forEach((b: any) => {
          const stats = branchStats[b.id];
          const bNameFull = b.branch_name?.toString().trim().toUpperCase();
          const staffList = activeStaffMap[bNameFull] || [];
          const hasPending = stats.pendingDRs > 0 || stats.pendingOrders > 0 || stats.pendingPOs > 0;
          
          let statusIcon = (type === 'REPORT_CHECKER') ? (hasPending ? '🚨' : '✅') : 
                          (stats.total === 0 && staffList.length === 0 ? '💤' : 
                          (stats.total === 0 ? '🛠️' : (b.daily_generic_quota > 0 && stats.generic >= b.daily_generic_quota ? '✅' : '🚨')));

          message += `<b>📍 ${bNameFull} ${statusIcon}</b>\n`;
          if (type === 'REPORT_CHECKER') {
            message += `• Reports: ${stats.pendingDRs} | Orders: ${stats.pendingOrders}\n`;
            if (stats.pendingPOs > 0) message += `• PO Verification: ${stats.pendingPOs}\n`;
          } else {
            message += `👤 ${staffList.length > 0 ? staffList.join(', ') : 'OFFLINE'}\n`;
            message += `• Generic: ₱${stats.generic.toLocaleString()}\n• Branded: ₱${stats.branded.toLocaleString()}\n• Total: ₱${stats.total.toLocaleString()}\n`;
            if (b.daily_generic_quota > 0) message += `• Progress: ${((stats.generic / b.daily_generic_quota) * 100).toFixed(1)}%\n`;
          }
          message += `━━━━━━━━━━━━━━━━━━\n`;
        });
      }

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: group.chatId, text: message, parse_mode: 'HTML' }),
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}