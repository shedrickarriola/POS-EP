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
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY!);
    // Get reliable PHT date for today
    const { data: todayPHT, error: dateError } = await supabaseAdmin.rpc(
      'get_current_pht_date'
    );

    if (dateError || !todayPHT) {
      console.error('Failed to get PHT date:', dateError);
      return NextResponse.json({ error: 'Date error' }, { status: 500 });
    }

    // Calculate yesterday for safe buffer (3 AM PHT yesterday)
    const yesterdayDate = new Date(todayPHT);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

    // 1. DATA FETCHING
    const [
      { data: allUncheckedOrders },
      { data: todaySales },
      { data: branches },
      { data: orgs },
      { data: todayLogs },
      { data: allPendingReports },
      { data: allPendingPOs },
      { data: products },
    ] = await Promise.all([
      supabaseAdmin
        .from('orders')
        .select('branch_id, is_checked')
        .or('is_checked.eq.false,is_checked.is.null'),

      supabaseAdmin.from('orders').select('*').eq('created_date_pht', todayPHT),

      supabaseAdmin.from('branches').select('*'),
      supabaseAdmin.from('organizations').select('*'),

      // FIXED: Safe buffer starting from 3:00 AM PHT yesterday
      supabaseAdmin
        .from('system_logs')
        .select('*')
        .in('event_type', ['LOGIN', 'BRANCH_CHANGE'])
        .gte('created_at', `${yesterdayStr}T19:00:00Z`) // 3:00 AM PHT yesterday (19:00 UTC)
        .lte('created_at', `${todayPHT}T23:59:59Z`)
        .order('created_at', { ascending: true }),

      supabaseAdmin
        .from('daily_reports')
        .select('branch_id, is_checked')
        .or('is_checked.eq.false,is_checked.is.null'),

      supabaseAdmin
        .from('purchase_orders')
        .select('branch_id, is_checked')
        .or('is_checked.eq.false,is_checked.is.null'),

      supabaseAdmin
        .from('inventory')
        .select('*')
        .order('sold_weekly', { ascending: false })
        .range(0, 9999),
    ]);

    // 2. STAFF MAPPING
    const activeStaffMap: Record<string, string[]> = {};
    todayLogs?.forEach((log: any) => {
      const bName = log.branch_name?.toString().trim().toUpperCase();
      const staffName = log.user_name?.toString().trim().toUpperCase();
      if (bName && staffName) {
        if (!activeStaffMap[bName]) activeStaffMap[bName] = [];
        if (!activeStaffMap[bName].some((s) => s.startsWith(staffName))) {
          const loginTime = new Date(log.created_at).toLocaleTimeString(
            'en-PH',
            {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: 'Asia/Manila',
            }
          );
          activeStaffMap[bName].push(`${staffName} (${loginTime})`);
        }
      }
    });

    // 3. BRANCH STATS
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
          orderingEmail: org.ordering_email, // ← NEW (for stock advisory email)
          branches: [],
        };
      }
      orgGroups[org.id].branches.push(b);
    });

    // 4. MESSAGE LOOP (unchanged)
    for (const group of Object.values(orgGroups) as any[]) {
      let message = '';
      if (type === 'STOCK_ADVISORY') {
        console.log(
          '🚀 STOCK_ADVISORY → Telegram (per branch) + Email (consolidated)'
        );

        // MONDAY SNAPSHOT
        const todayDate = new Date(todayPHT);
        const isMonday = todayDate.getDay() === 1;

        if (isMonday) {
          console.log('📸 Monday snapshot running...');
          const { error: snapshotError } = await supabaseAdmin.rpc(
            'snapshot_monday_inventory',
            { p_today: todayPHT }
          );
          if (snapshotError)
            console.error('❌ Snapshot failed:', snapshotError);
          else console.log('✅ Monday snapshot completed');
        }

        let fullEmailHtml = `<h2>📦 TOP TO RESTOCK - ${group.name.toUpperCase()}</h2>`;
        fullEmailHtml += `<p><strong>Date:</strong> ${todayPHT}</p><hr>`;

        for (const b of group.branches) {
          const { data: branchInventory } = await supabaseAdmin
            .from('inventory')
            .select('*')
            .eq('branch_id', b.id)
            .order('sold_weekly', { ascending: false });

          // Filter — STRICT 2-week rule (no more low-stock safety net)
          const meaningfulItems = (branchInventory || [])
            .filter((p: any) => {
              const stock = Number(p?.stock || 0);
              const soldWeekly = Number(p?.sold_weekly || 0);
              const snapshot = Number(p?.sold_weekly_snapshot || 0);
              const itemNameUpper = String(p?.item_name || '').toUpperCase();
              const isSyrup = /\b(SYRUP|SYR)\b/.test(itemNameUpper);

              const lastRestockStr = p?.last_restock_date;
              const lastRestock = lastRestockStr
                ? new Date(lastRestockStr)
                : new Date('2020-01-01');
              const daysAgo = Math.floor(
                (new Date(todayPHT).getTime() - lastRestock.getTime()) /
                  86400000
              );

              let weeklyDemand =
                soldWeekly ||
                snapshot ||
                Number(p?.sold_monthly || 0) / 4.3 ||
                0;

              const hasSalesHistory = soldWeekly > 0 || snapshot > 0;

              // STRICT: only items that cannot cover 2 weeks
              return (
                hasSalesHistory && weeklyDemand > 0 && stock < weeklyDemand * 2
              );
            })
            .sort((a: any, b: any) => {
              const soldA =
                Number(a?.sold_weekly || 0) ||
                Number(a?.sold_weekly_snapshot || 0);
              const soldB =
                Number(b?.sold_weekly || 0) ||
                Number(b?.sold_weekly_snapshot || 0);
              return soldB - soldA;
            });

          // Normal items first, SYRUP at the bottom
          const genericItems = [
            ...meaningfulItems
              .filter(
                (p) =>
                  String(p?.item_type || '')
                    .toUpperCase()
                    .trim() === 'GENERIC' &&
                  !/\b(SYRUP|SYR)\b/.test(
                    String(p?.item_name || '').toUpperCase()
                  )
              )
              .slice(0, 30),
            ...meaningfulItems
              .filter(
                (p) =>
                  String(p?.item_type || '')
                    .toUpperCase()
                    .trim() === 'GENERIC' &&
                  /\b(SYRUP|SYR)\b/.test(
                    String(p?.item_name || '').toUpperCase()
                  )
              )
              .slice(0, 10),
          ].slice(0, 40);

          const brandedItems = [
            ...meaningfulItems
              .filter(
                (p) =>
                  String(p?.item_type || '')
                    .toUpperCase()
                    .trim() === 'BRANDED' &&
                  !/\b(SYRUP|SYR)\b/.test(
                    String(p?.item_name || '').toUpperCase()
                  )
              )
              .slice(0, 15),
            ...meaningfulItems
              .filter(
                (p) =>
                  String(p?.item_type || '')
                    .toUpperCase()
                    .trim() === 'BRANDED' &&
                  /\b(SYRUP|SYR)\b/.test(
                    String(p?.item_name || '').toUpperCase()
                  )
              )
              .slice(0, 5),
          ].slice(0, 20);

          // ─────────────────────────────────────────────────────────────
          // BATCH SUGGESTION + SKIP ZERO-SUGGESTION ITEMS
          // ─────────────────────────────────────────────────────────────
          let totalEstimatedCost = 0;
          let telegramItems = '';
          let emailItemsHtml = '';

          const processItem = (p: any, isGeneric: boolean) => {
            const stock = Number(p?.stock || 0);
            let weekly = Number(p?.sold_weekly || 0);
            if (weekly === 0)
              weekly =
                Number(p?.sold_weekly_snapshot || 0) ||
                Number(p?.sold_monthly || 0) / 4.3 ||
                0;

            // Batch suggestion logic — GENERIC = 2 weeks, BRANDED = 1 week
            let suggested = 0;
            if (weekly > 0) {
              const weeksTarget = isGeneric ? 2 : 1;
              const target = weekly * weeksTarget;
              let delta = Math.max(0, target - stock);

              if (weekly < 5) {
                suggested = Math.ceil(delta);
              } else if (weekly < 100) {
                suggested = Math.ceil(delta / 10) * 10;
              } else {
                suggested = Math.ceil(delta / 100) * 100;
              }
            }

            // Skip if nothing needs to be ordered
            if (suggested <= 0) return;

            const buyCost = Number(p?.buy_cost || 0);
            const cost = suggested * buyCost;
            totalEstimatedCost += cost;

            // ALWAYS show as pcs (boxes removed)
            const displayQty = `${Math.round(suggested)} pcs`;

            const itemNameUpper = String(p?.item_name || '').toUpperCase();
            const isSyrup = /\b(SYRUP|SYR)\b/.test(itemNameUpper);
            const lastRestockStr = p?.last_restock_date;
            const daysAgo = lastRestockStr
              ? Math.floor(
                  (new Date(todayPHT).getTime() -
                    new Date(lastRestockStr).getTime()) /
                    86400000
                )
              : 999;
            const restockText =
              daysAgo < 999 ? ` • restock ${daysAgo}d ago` : '';
            const demandText = weekly > 0 ? ` (~${weekly.toFixed(0)}/wk)` : '';
            const syrupTag = isSyrup ? ' [SYRUP]' : '';
            const icon = stock <= 0 ? '🚨' : '>';

            // Telegram line
            telegramItems += `${icon} ${
              p?.item_name
            }${syrupTag}: ${stock} left${demandText}${restockText} → ${displayQty} [₱${Math.round(
              cost
            ).toLocaleString()}]\n`;

            // EMAIL — colorful single line
            emailItemsHtml += `<p style="margin: 4px 0; line-height: 1.45; font-family: monospace; color: #1f2937;">
              ${icon} <strong style="color: ${
              isGeneric ? '#3b82f6' : '#a855f7'
            };">${p?.item_name}${syrupTag}</strong>: 
              <span style="color:#64748b;">${stock} left${demandText}${restockText}</span> → 
              <span style="color:#10b981; font-weight:700;">${displayQty} [₱${Math.round(
              cost
            ).toLocaleString()}]</span>
            </p>`;
          };

          // Generic section
          if (genericItems.length > 0) {
            telegramItems += `<b>🟦 GENERIC ITEMS</b>\n`;
            emailItemsHtml += `<p style="color:#3b82f6; font-weight:700; margin: 16px 0 6px 0; border-bottom: 2px solid #e0f2fe;">🟦 GENERIC ITEMS</p>`;
            genericItems.forEach((p) => processItem(p, true));
          } else {
            telegramItems += `✅ No generic items need restock\n`;
          }

          // Branded section
          if (brandedItems.length > 0) {
            telegramItems += `━━━━━━━━━━━━━━━━━━\n<b>🟪 BRANDED ITEMS</b>\n`;
            emailItemsHtml += `<p style="color:#a855f7; font-weight:700; margin: 16px 0 6px 0; border-bottom: 2px solid #f3e8ff;">━━━━━━━━━━━━━━━━━━<br>🟪 BRANDED ITEMS</p>`;
            brandedItems.forEach((p) => processItem(p, false));
          } else {
            telegramItems += `━━━━━━━━━━━━━━━━━━\n✅ No branded items need restock\n`;
          }

          // Build Telegram message
          let branchMessage = `<b>📦 TOP TO RESTOCK</b>\n`;
          branchMessage += `<b>🏢 ${group.name.toUpperCase()} • ${b.branch_name.toUpperCase()}</b>   💰 EST. TOTAL: ₱${Math.round(
            totalEstimatedCost
          ).toLocaleString()}\n`;
          branchMessage += `━━━━━━━━━━━━━━━━━━\n`;
          branchMessage += telegramItems;
          branchMessage += `━━━━━━━━━━━━━━━━━━\n`;

          // Send Telegram
          try {
            await fetch(
              `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: group.chatId,
                  text: branchMessage,
                  parse_mode: 'HTML',
                }),
              }
            );
            console.log(`✅ Telegram sent → ${b.branch_name}`);
          } catch (err) {
            console.error(`❌ Telegram failed:`, err);
          }

          // Build Email HTML
          fullEmailHtml += `<h3>🏢 ${b.branch_name.toUpperCase()}</h3>`;
          fullEmailHtml +=
            emailItemsHtml ||
            '<p><em>No items need restocking at this time.</em></p>';
          fullEmailHtml += `<p><strong style="color:#10b981;">💰 ESTIMATED TOTAL TO RESTOCK: ₱${Math.round(
            totalEstimatedCost
          ).toLocaleString()}</strong></p><hr>`;
        }

        // Send consolidated email
        if (group.orderingEmail) {
          const emailList = group.orderingEmail
            .split(',')
            .map((e: string) => e.trim())
            .filter(Boolean);
          if (emailList.length > 0) {
            try {
              await resend.emails.send({
                from: 'Econo Stock Alert <stock@alerts.econo-pos.com>',
                to: emailList,
                subject: `📦 TOP TO RESTOCK - ${group.name.toUpperCase()}`,
                html: fullEmailHtml,
              });
              console.log(`✅ Consolidated email sent to ${group.name}`);
            } catch (err) {
              console.error(`❌ Email failed:`, err);
            }
          }
        }
      } else {
        // ← ALL OTHER TYPES (REPORT_CHECKER, LOGIN, UPDATE, EOD) — unchanged
        // ← ALL OTHER TYPES (REPORT_CHECKER, LOGIN, UPDATE, EOD) — unchanged
        // ← ALL OTHER TYPES (unchanged)//
        // ← ALL OTHER TYPES (REPORT_CHECKER, LOGIN, UPDATE, EOD) — unchanged
        // (your original code here)
        // ← ALL OTHER TYPES (REPORT_CHECKER, LOGIN, UPDATE, EOD) still use Telegram
        // (your original code here - no changes needed)else {
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

        message = `<b>${header}</b>\n🏢 <b>${group.name.toUpperCase()}</b>\n━━━━━━━━━━━━━━━━━━\n`;

        group.branches.forEach((b: any) => {
          const stats = branchStats[b.id];
          const bNameFull = b.branch_name?.toString().trim().toUpperCase();
          const staffList = activeStaffMap[bNameFull] || [];
          const hasPending =
            stats.pendingDRs > 0 ||
            stats.pendingOrders > 0 ||
            stats.pendingPOs > 0;

          let statusIcon =
            type === 'REPORT_CHECKER'
              ? hasPending
                ? '🚨'
                : '✅'
              : stats.total === 0 && staffList.length === 0
              ? '💤'
              : stats.total === 0
              ? '🛠️'
              : b.daily_generic_quota > 0 &&
                stats.generic >= b.daily_generic_quota
              ? '✅'
              : '🚨';

          message += `<b>📍 ${bNameFull} ${statusIcon}</b>\n`;

          if (type === 'REPORT_CHECKER') {
            message += `• Reports: ${stats.pendingDRs} | Orders: ${stats.pendingOrders}\n`;
            if (stats.pendingPOs > 0)
              message += `• PO Verification: ${stats.pendingPOs}\n`;
            if (!hasPending) message += `• <i>No pending tasks</i>\n`;
          } else {
            message += `👤 ${
              staffList.length > 0 ? staffList.join(', ') : 'OFFLINE'
            }\n`;
            message += `• Generic: ₱${stats.generic.toLocaleString()}\n`;
            message += `• Branded: ₱${stats.branded.toLocaleString()}\n`;
            message += `• Total: ₱${stats.total.toLocaleString()}\n`;
            if (b.daily_generic_quota > 0) {
              message += `• Progress: ${(
                (stats.generic / b.daily_generic_quota) *
                100
              ).toFixed(1)}%\n`;
            }
          }
          message += `━━━━━━━━━━━━━━━━━━\n`;
        });
      }

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: group.chatId,
          text: message,
          parse_mode: 'HTML',
        }),
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Telegram Report Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
