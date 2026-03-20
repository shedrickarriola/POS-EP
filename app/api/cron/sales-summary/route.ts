import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = (searchParams.get('type') || 'EOD').toUpperCase();
  const key = searchParams.get('key');

  // 1. Security Check
  if (key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Initialize Admin Client to Bypass RLS
  // Ensure these exist in your Vercel/Environment variables
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const BOT_TOKEN = '8743953425:AAF2qLUU5aMK7SySJ9txxkEoda08GeP8kb8';
    
    // 3. Strict PHT Midnight Calculation
    const phtNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    const midnightPHT = new Date(phtNow.getFullYear(), phtNow.getMonth(), phtNow.getDate(), 0, 0, 0);
    const startOfTodayISO = midnightPHT.toISOString();

    // 4. Fetch Data with Admin Privileges
    const [
      { data: allUncheckedOrders },
      { data: todaySales },
      { data: branches },
      { data: orgs },
      { data: todayLogs },
    ] = await Promise.all([
      supabaseAdmin.from('orders').select('branch_id, is_checked').or('is_checked.eq.false,is_checked.is.null'),
      supabaseAdmin.from('orders').select('*').gte('created_at', startOfTodayISO),
      supabaseAdmin.from('branches').select('*'),
      supabaseAdmin.from('organizations').select('*'),
      supabaseAdmin.from('system_logs').select('*')
        .in('event_type', ['LOGIN', 'BRANCH_CHANGE'])
        .gte('created_at', startOfTodayISO)
        .order('created_at', { ascending: true }),
    ]);

    // 5. Build Staff Map (The "Matchmaker")
    const activeStaffMap: Record<string, string[]> = {};
    todayLogs?.forEach((log: any) => {
      const rawBName = log.branch_name?.toString() || "";
      const cleanBName = rawBName.replace(/\s+/g, '').toUpperCase();
      const staffName = (log.user_name || "UNKNOWN").toString().trim().toUpperCase();
      
      if (cleanBName && staffName) {
        if (!activeStaffMap[cleanBName]) activeStaffMap[cleanBName] = [];
        
        const alreadyExists = activeStaffMap[cleanBName].some(s => s.startsWith(staffName));
        
        if (!alreadyExists) {
          const loginTime = new Date(log.created_at).toLocaleTimeString('en-PH', {
            hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila'
          });
          activeStaffMap[cleanBName].push(`${staffName} (${loginTime})`);
        }
      }
    });

    // 6. Process Branch Stats
    const branchStats: Record<string, any> = {};
    branches?.forEach((b) => {
      branchStats[b.id] = {
        generic: 0, branded: 0, total: 0,
        pendingOrders: allUncheckedOrders?.filter((o) => o.branch_id === b.id).length || 0,
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

    // 7. Build & Send Telegram Messages
    for (const group of Object.values(orgGroups) as any[]) {
      let header = '';
      switch (type) {
        case 'REPORT_CHECKER': header = '🚨 REPORT CHECKER'; break;
        case 'LOGIN':          header = '👥 STAFF LOGIN STATUS'; break;
        case 'UPDATE':         header = '📊 SALES UPDATE'; break;
        default:               header = '🏁 FINAL EOD REPORT';
      }

      let message = `<b>${header}</b>\n🏢 <b>${group.name.toUpperCase()}</b>\n`;
      message += `━━━━━━━━━━━━━━━━━━\n`;

      group.branches.forEach((b: any) => {
        const stats = branchStats[b.id];
        const cleanBranchTableName = (b.branch_name || "").toString().replace(/\s+/g, '').toUpperCase();
        const staffList = activeStaffMap[cleanBranchTableName] || [];

        const hasSales = stats.total > 0;
        let statusIcon = (staffList.length > 0) ? '✅' : (hasSales ? '🚨' : '💤');

        message += `<b>📍 ${b.branch_name.toUpperCase()} ${statusIcon}</b>\n`;
        message += `👤 ${staffList.length > 0 ? staffList.join(', ') : 'OFFLINE'}\n`;
        message += `• Generic: ₱${stats.generic.toLocaleString()}\n`;
        message += `• Branded: ₱${stats.branded.toLocaleString()}\n`;
        message += `• Total: ₱${stats.total.toLocaleString()}\n`;
        message += `━━━━━━━━━━━━━━━━━━\n`;
      });

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: group.chatId, text: message, parse_mode: 'HTML' }),
      });
    }

    return NextResponse.json({ 
      success: true, 
      found_logs: todayLogs?.length,
      staff_keys: Object.keys(activeStaffMap)
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}