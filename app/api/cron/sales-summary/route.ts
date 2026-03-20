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
    
    // 1. PHT Time Calculations
    const phtNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    const dayOfWeek = phtNow.getDay(); // 0=Sun, 2=Tue
    const hour = phtNow.getHours();
    
    // Check if it's Tuesday (2) and around 3AM
    const isTuesdayMorning = (dayOfWeek === 2 && type === 'REPORT_CHECKER');

    const midnightPHT = new Date(phtNow.getFullYear(), phtNow.getMonth(), phtNow.getDate(), 0, 0, 0);
    const startOfTodayISO = midnightPHT.toISOString();

    // 2. Build Concurrent Queries
    const queries = [
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
    ];

    // Only fetch product data on Tuesday mornings
    if (isTuesdayMorning) {
      queries.push(
        supabaseAdmin.from('products')
          .select('*')
          .or('current_stock.lt.10,sold_weekly.gt.0') // Low stock or active sellers
          .order('sold_weekly', { ascending: false })
      );
    }

    const [
      { data: allOrders }, { data: todaySales }, { data: branches }, 
      { data: orgs }, { data: todayLogs }, { data: allDRs }, 
      { data: allPOs }, inventoryData
    ] = await Promise.all(queries);

    // 3. Mapping Staff & Branch Stats (Existing Logic)
    const activeStaffMap: Record<string, string[]> = {};
    todayLogs?.forEach((log: any) => {
      const bName = (log.branch_name || "").toString().trim().toUpperCase();
      const staffName = (log.user_name || "").toString().trim().toUpperCase();
      if (bName && staffName) {
        if (!activeStaffMap[bName]) activeStaffMap[bName] = [];
        if (!activeStaffMap[bName].some(s => s.startsWith(staffName))) {
          const loginTime = new Date(log.created_at).toLocaleTimeString('en-PH', {
            hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila'
          });
          activeStaffMap[bName].push(`${staffName} (${loginTime})`);
        }
      }
    });

    const branchStats: Record<string, any> = {};
    branches?.forEach((b) => {
      branchStats[b.id] = {
        generic: 0, total: 0,
        uncheckedOrders: allOrders?.filter((o) => o.branch_id === b.id).length || 0,
        pendingDRs: allDRs?.filter((r) => r.branch_id === b.id).length || 0,
        pendingPOs: allPOs?.filter((p) => p.branch_id === b.id).length || 0,
      };
    });

    todaySales?.forEach((order: any) => {
      if (branchStats[order.branch_id]) {
        branchStats[order.branch_id].generic += Number(order.generic_amt || 0);
        branchStats[order.branch_id].total += Number(order.total_amount || 0);
      }
    });

    const orgMap: Record<string, any> = {};
    orgs?.forEach((org) => { orgMap[org.id] = org; });

    const orgGroups: Record<string, any> = {};
    branches?.forEach((b: any) => {
      const org = orgMap[b.org_id];
      if (!org?.telegram_chat_id) return;
      if (!orgGroups[org.id]) orgGroups[org.id] = { chatId: org.telegram_chat_id, name: org.name, branches: [] };
      orgGroups[org.id].branches.push(b);
    });

    // 4. Build & Send Message
    for (const group of Object.values(orgGroups) as any[]) {
      let header = '';
      switch (type) {
        case 'REPORT_CHECKER': 
          header = isTuesdayMorning ? '📅 WEEKLY ORDER ADVISORY (3AM)' : '🚨 ALL-TIME REPORT CHECKER (6AM)'; 
          break;
        case 'LOGIN': header = '👥 STAFF LOGIN STATUS (12NN)'; break;
        case 'UPDATE': header = '📊 SALES UPDATE (5PM)'; break;
        default: header = '🏁 FINAL EOD REPORT (11PM)';
      }

      let message = `<b>${header}</b>\n🏢 <b>${group.name.toUpperCase()}</b>\n`;
      message += `━━━━━━━━━━━━━━━━━━\n`;

      group.branches.forEach((b: any) => {
        const stats = branchStats[b.id];
        const bNameFull = b.branch_name?.toString().toUpperCase();
        const staffList = activeStaffMap[bNameFull] || [];
        
        const hasPending = stats.pendingDRs > 0 || stats.uncheckedOrders > 0 || stats.pendingPOs > 0;
        let statusIcon = (type === 'REPORT_CHECKER') ? (hasPending ? '🚨' : '✅') : (staffList.length > 0 ? '🛠️' : '💤');

        message += `<b>📍 ${bNameFull} ${statusIcon}</b>\n`;

        if (type === 'REPORT_CHECKER') {
          // Task Counts
          if (stats.pendingDRs > 0) message += `• 📝 Daily Report: <b>${stats.pendingDRs}</b>\n`;
          if (stats.uncheckedOrders > 0) message += `• 🛒 Unchecked Orders: <b>${stats.uncheckedOrders}</b>\n`;
          if (stats.pendingPOs > 0) message += `• 📦 PO Verification: <b>${stats.pendingPOs}</b>\n`;
          if (!hasPending) message += `• <i>No pending tasks</i>\n`;

          // TUESDAY SPECIAL: Order Recommendations
          if (isTuesdayMorning && inventoryData?.data) {
            const recommendations = inventoryData.data
              .filter((p: any) => p.branch_id === b.id)
              .filter((p: any) => p.current_stock <= (p.sold_weekly || 5)) // Logic: Stock is less than weekly sales
              .slice(0, 3); // Top 3 most urgent

            if (recommendations.length > 0) {
              message += `\n<b>🛒 RE-ORDER SUGGESTIONS:</b>\n`;
              recommendations.forEach((p: any) => {
                message += `• ${p.name}: ${p.current_stock} left (Sold ${p.sold_weekly}/wk)\n`;
              });
            }
          }
        } else {
          // Standard Sales/Staff Report
          message += `👤 ${staffList.length > 0 ? staffList.join(', ') : 'OFFLINE'}\n`;
          message += `• Total Sales: ₱${stats.total.toLocaleString()}\n`;
          if (b.daily_generic_quota > 0) {
            message += `• Progress: ${((stats.generic / b.daily_generic_quota) * 100).toFixed(1)}%\n`;
          }
        }
        message += `━━━━━━━━━━━━━━━━━━\n`;
      });

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: group.chatId, text: message, parse_mode: 'HTML' }),
      });
    }

    return NextResponse.json({ success: true, is_tuesday: isTuesdayMorning });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}