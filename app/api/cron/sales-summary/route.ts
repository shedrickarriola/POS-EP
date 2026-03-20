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
    
    // 1. Strict PHT Midnight Calculation
    const phtNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    const midnightPHT = new Date(phtNow.getFullYear(), phtNow.getMonth(), phtNow.getDate(), 0, 0, 0);
    const startOfTodayISO = midnightPHT.toISOString();

    const [
      { data: allUncheckedOrders },
      { data: todaySales },
      { data: branches },
      { data: orgs },
      { data: todayLogs },
    ] = await Promise.all([
      supabase.from('orders').select('branch_id, is_checked').or('is_checked.eq.false,is_checked.is.null'),
      supabase.from('orders').select('*').gte('created_at', startOfTodayISO),
      supabase.from('branches').select('*'),
      supabase.from('organizations').select('*'),
      supabase.from('system_logs').select('*')
        .in('event_type', ['LOGIN', 'BRANCH_CHANGE'])
        .gte('created_at', startOfTodayISO)
        .order('created_at', { ascending: true }),
    ]);

    // 2. Build Staff Map with "Clean" Keys
    const activeStaffMap: Record<string, string[]> = {};
    todayLogs?.forEach((log: any) => {
      // CLEANING: Remove all spaces and make uppercase (e.g., "Pansol " -> "PANSOL")
      const rawBName = log.branch_name?.toString() || "";
      const cleanBName = rawBName.replace(/\s+/g, '').toUpperCase();
      const staffName = log.user_name?.toString().trim().toUpperCase() || "UNKNOWN";
      
      if (cleanBName) {
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

    // 3. Match and Build Message
    for (const group of Object.values(orgGroups) as any[]) {
      let header = (type === 'REPORT_CHECKER') ? '🚨 REPORT CHECKER' : '📊 SALES SUMMARY';
      let message = `<b>${header}</b>\n🏢 <b>${group.name.toUpperCase()}</b>\n`;
      message += `━━━━━━━━━━━━━━━━━━\n`;

      group.branches.forEach((b: any) => {
        const stats = branchStats[b.id];
        
        // CLEANING the Branch Table Name for matching
        const cleanBranchTableName = b.branch_name?.toString().replace(/\s+/g, '').toUpperCase();
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
      staff_map_keys: Object.keys(activeStaffMap)
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}