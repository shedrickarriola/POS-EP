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
    
    // --- STRICT MIDNIGHT PHT CALCULATION ---
    // 1. Get the current date/time in PHT
    const phtNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    
    // 2. Create a date object for 12:00:00 AM TODAY in PHT
    const midnightPHT = new Date(phtNow.getFullYear(), phtNow.getMonth(), phtNow.getDate(), 0, 0, 0);
    
    // 3. Convert that PHT midnight to a UTC ISO string so Supabase understands it
    // This correctly subtracts 8 hours from the PHT midnight to get the UTC equivalent
    const startOfTodayISO = midnightPHT.toISOString();

    const [
      { data: allUncheckedOrders },
      { data: todaySales },
      { data: branches },
      { data: orgs },
      { data: todayLogs },
      { data: allPendingReports },
      { data: allPendingPOs },
    ] = await Promise.all([
      supabase.from('orders').select('branch_id, is_checked').or('is_checked.eq.false,is_checked.is.null'),
      supabase.from('orders').select('*').gte('created_at', startOfTodayISO),
      supabase.from('branches').select('*'),
      supabase.from('organizations').select('*'),
      supabase.from('system_logs').select('*')
        .in('event_type', ['LOGIN', 'BRANCH_CHANGE'])
        .gte('created_at', startOfTodayISO)
        .order('created_at', { ascending: true }),
      supabase.from('daily_reports').select('branch_id, is_checked').or('is_checked.eq.false,is_checked.is.null'),
      supabase.from('purchase_orders').select('branch_id, is_checked').or('is_checked.eq.false,is_checked.is.null'),
    ]);

    // 1. Staff Mapping
    const activeStaffMap: Record<string, string[]> = {};
    todayLogs?.forEach((log: any) => {
      const bName = log.branch_name?.toString().trim().toUpperCase();
      const staffName = log.user_name?.toString().trim().toUpperCase();
      
      if (bName && staffName) {
        if (!activeStaffMap[bName]) activeStaffMap[bName] = [];
        const alreadyExists = activeStaffMap[bName].some(s => s.startsWith(staffName));
        
        if (!alreadyExists) {
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

    const orgMap: Record<string, any> = {};
    orgs?.forEach((org) => { orgMap[org.id] = org; });

    const orgGroups: Record<string, any> = {};
    branches?.forEach((b: any) => {
      const org = orgMap[b.org_id];
      if (!org?.telegram_chat_id) return;
      if (!orgGroups[org.id]) orgGroups[org.id] = { chatId: org.telegram_chat_id, name: org.name, branches: [] };
      orgGroups[org.id].branches.push(b);
    });

    // 2. Build & Send Message
    await Promise.all(
      Object.values(orgGroups).map(async (group: any) => {
        let header = '';
        switch (type) {
          case 'REPORT_CHECKER': header = '🚨 ALL-TIME REPORT CHECKER (6AM)'; break;
          case 'LOGIN':          header = '👥 STAFF LOGIN STATUS (12NN)'; break;
          case 'UPDATE':         header = '📊 SALES UPDATE (5PM)'; break;
          default:               header = '🏁 FINAL EOD REPORT (11PM)';
        }

        let message = `<b>${header}</b>\n🏢 <b>${group.name.toUpperCase()}</b>\n`;
        message += `━━━━━━━━━━━━━━━━━━\n`;

        group.branches.forEach((b: any) => {
          const stats = branchStats[b.id];
          const bNameFull = b.branch_name?.toString().trim().toUpperCase();
          const staffList = activeStaffMap[bNameFull] || [];

          const hasSales = stats.total > 0;
          const quotaReached = b.daily_generic_quota > 0 && stats.generic >= b.daily_generic_quota;

          let statusIcon = (type === 'REPORT_CHECKER') ? '🔍' : 
                          (!hasSales && staffList.length === 0 ? '💤' : 
                          (!hasSales ? '🛠️' : (quotaReached ? '✅' : '🚨')));

          message += `<b>📍 ${bNameFull} ${statusIcon}</b>\n`;

          if (type !== 'REPORT_CHECKER') {
            message += `👤 ${staffList.length > 0 ? staffList.join(', ') : 'OFFLINE'}\n`;
            message += `• Generic: ₱${stats.generic.toLocaleString()}\n`;
            message += `• Branded: ₱${stats.branded.toLocaleString()}\n`;
            message += `• Total: ₱${stats.total.toLocaleString()}\n`;
            if (b.daily_generic_quota > 0) {
              message += `• Progress: ${((stats.generic / b.daily_generic_quota) * 100).toFixed(1)}%\n`;
            }
          } else {
             message += `• Reports: ${stats.pendingDRs} | Orders: ${stats.pendingOrders}\n`;
          }
          message += `━━━━━━━━━━━━━━━━━━\n`;
        });

        return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: group.chatId, text: message, parse_mode: 'HTML' }),
        });
      })
    );

    return NextResponse.json({ 
      success: true, 
      pht_midnight_queried: startOfTodayISO,
      logs_found: todayLogs?.length 
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}