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

    // 4. MESSAGE LOOP (Telegram only — skip for email-only types)
    if (type !== 'DAILY_EMAIL' && type !== 'WEEKLY_EMAIL') {
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

          // Filter — now type-aware (GENERIC: 2 weeks, BRANDED: 1 week)
          const meaningfulItems = (branchInventory || [])
            .filter((p: any) => {
              const stock = Number(p?.stock || 0);
              const soldWeekly = Number(p?.sold_weekly || 0);
              const snapshot = Number(p?.sold_weekly_snapshot || 0);
              const itemNameUpper = String(p?.item_name || '').toUpperCase();
              const isSyrup = /\b(SYRUP|SYR)\b/.test(itemNameUpper);

              const itemType = String(p?.item_type || '')
                .toUpperCase()
                .trim();
              const targetWeeks = itemType === 'BRANDED' ? 1 : 2;

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

              // Type-specific threshold
              return (
                hasSalesHistory &&
                weeklyDemand > 0 &&
                stock < weeklyDemand * targetWeeks
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

            // Batch suggestion logic — now type-aware
            let suggested = 0;
            if (weekly > 0) {
              const targetWeeks = isGeneric ? 2 : 1;
              const target = weekly * targetWeeks;
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

            // ALWAYS show in pcs now (no more boxes)
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
        // ← REGULAR REPORTS (LOGIN 12NN, UPDATE 5PM, EOD 11PM)
        // Only show DRUGSTORE branches (is_office_use = false / null)

        const drugstoreBranches = group.branches.filter(
          (b: any) => !b.is_office_use
        );

        if (drugstoreBranches.length === 0) {
          console.log(`⏭️ ${group.name} has no drugstore branches for ${type}`);
          continue; // skip this org if no drugstore branches
        }

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

        let message = `<b>${header}</b>\n🏢 <b>${group.name.toUpperCase()}</b>\n━━━━━━━━━━━━━━━━━━\n`;

        drugstoreBranches.forEach((b: any) => {
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

        // Send Telegram (only drugstore report)
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: group.chatId,
            text: message,
            parse_mode: 'HTML',
          }),
        });
      } // end else (regular reports)
    } // end for loop
    } // end Telegram-only type guard

    // ==================== DAILY EMAIL REPORT (8PM) - ONLY OFFICE BRANCHES ====================
    if (type === 'DAILY_EMAIL') {
      console.log(
        '📧 Starting Daily Email Report (8PM) - Office Branches Only'
      );

      const { data: orgs } = await supabaseAdmin
        .from('organizations')
        .select('id, name, owner_email')
        .not('owner_email', 'is', null);

      for (const org of orgs || []) {
        if (!org.owner_email) continue;

        // ONLY office branches, exclude test environments
        const { data: branches } = await supabaseAdmin
          .from('branches')
          .select('*')
          .eq('org_id', org.id)
          .eq('is_office_use', true)
          .not('test_env', 'eq', true);

        if (!branches || branches.length === 0) {
          console.log(`⏭️ ${org.name} has no office branches`);
          continue;
        }

        let emailHtml = `
              <div style="font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 30px; background: #0f172a; color: #e2e8f0;">
                <h1 style="color: #10b981; text-align: center;">📊 Daily Report - ${yesterdayStr}</h1>
                <h2 style="color: #64748b; text-align: center;">${org.name} (Office Use Only)</h2>
                <hr style="border: 1px solid #334155;">
            `;

        for (const b of branches) {
          const { data: report } = await supabaseAdmin
            .from('daily_reports')
            .select('*')
            .eq('branch_id', b.id)
            .eq('report_date', yesterdayStr)
            .single();

          const { data: payments } = await supabaseAdmin
            .from('daily_payments')
            .select('amount, payment_method')
            .eq('branch_id', b.id)
            .eq('report_date', yesterdayStr);

          const totalCash = (payments || [])
            .filter((p) => p.payment_method === 'CASH')
            .reduce((sum, p) => sum + Number(p.amount || 0), 0);

          const totalCheque = (payments || [])
            .filter((p) => p.payment_method === 'CHEQUE')
            .reduce((sum, p) => sum + Number(p.amount || 0), 0);

          const totalPayments = totalCash + totalCheque;

          emailHtml += `
                <div style="background:#1e2937; padding:20px; border-radius:12px; margin:20px 0;">
                  <h3 style="margin:0 0 15px 0; color:#67e8f9;">${
                    b.branch_name
                  }</h3>
                  <table style="width:100%; border-collapse:collapse; color:#e2e8f0;">
                    <tr><td style="padding:8px 0;"><strong>Generic Sales</strong></td><td style="text-align:right;">₱${Number(
                      report?.generic_sales || 0
                    ).toLocaleString()}</td></tr>
                    <tr><td style="padding:8px 0;"><strong>Branded Sales</strong></td><td style="text-align:right;">₱${Number(
                      report?.branded_sales || 0
                    ).toLocaleString()}</td></tr>
                    <tr><td style="padding:8px 0; border-top:2px solid #64748b;"><strong>Total Sales</strong></td><td style="text-align:right; border-top:2px solid #64748b; font-weight:bold;">₱${Number(
                      report?.total_sales || 0
                    ).toLocaleString()}</td></tr>
                    <tr><td style="padding:8px 0;"><strong>Remittances</strong></td><td style="text-align:right;">₱${totalPayments.toLocaleString()}</td></tr>
                    <tr><td style="padding:8px 0;"><strong>Expenses</strong></td><td style="text-align:right; color:#f87171;">₱${Number(
                      report?.expenses || 0
                    ).toLocaleString()}</td></tr>
                    <tr style="background:#0f172a;"><td style="padding:12px 0; font-size:18px; font-weight:bold;">Actual Cash</td>
                        <td style="text-align:right; font-size:18px; font-weight:bold; color:#10b981;">₱${Number(
                          report?.actual_cash || 0
                        ).toLocaleString()}</td></tr>
                  </table>
                </div>
              `;
        }

        emailHtml += `</div>`;

        // Send email
        await resend.emails.send({
          from: 'Econo Drugstore <stock@alerts.econo-pos.com>',
          to: org.owner_email,
          subject: `📊 Daily Report - ${yesterdayStr} | ${org.name} (Office)`,
          html: emailHtml,
        });

        console.log(`✅ Daily email sent to ${org.owner_email}`);
      }

      return NextResponse.json({
        success: true,
        message: 'Daily email reports sent (Office branches only)',
      });
    }

    // ==================== WEEKLY EMAIL REPORT (8:30PM SAT) - OFFICE BRANCHES ====================
    if (type === 'WEEKLY_EMAIL') {
      console.log(
        '📧 Starting Weekly Email Report (8:30PM SAT) - Office Branches Only'
      );

      const { data: weeklyOrgs } = await supabaseAdmin
        .from('organizations')
        .select('id, name, owner_email')
        .not('owner_email', 'is', null);

      // Compute the week range: Sunday → Saturday ending today (PHT)
      const todayDate = new Date(todayPHT);
      const dayOfWeek = todayDate.getDay(); // 6 = Saturday
      const saturdayDate = new Date(todayDate);
      const sundayDate = new Date(todayDate);
      sundayDate.setDate(todayDate.getDate() - dayOfWeek);
      const weekDates: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(sundayDate);
        d.setDate(sundayDate.getDate() + i);
        weekDates.push(d.toISOString().split('T')[0]);
      }
      const weekStart = weekDates[0];
      const weekEnd = weekDates[6];

      for (const org of weeklyOrgs || []) {
        if (!org.owner_email) continue;

        // Only office branches
        const { data: officeBranches } = await supabaseAdmin
          .from('branches')
          .select('*')
          .eq('org_id', org.id)
          .eq('is_office_use', true)
          .not('test_env', 'eq', true);

        if (!officeBranches || officeBranches.length === 0) {
          console.log(
            `⏭️ ${org.name} has no office branches, skipping weekly email`
          );
          continue;
        }

        let emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 1000px; margin: 0 auto; padding: 30px; background: #0f172a; color: #e2e8f0;">
            <h1 style="color: #a855f7; text-align: center; margin-bottom: 4px;">📅 Weekly Report</h1>
            <p style="text-align:center; color:#64748b; margin:0 0 4px 0; font-size:16px;">${org.name}</p>
            <p style="text-align:center; color:#94a3b8; margin:0 0 24px 0; font-size:14px;">${weekStart} — ${weekEnd}</p>
            <hr style="border: 1px solid #334155; margin-bottom: 30px;">
        `;

        for (const b of officeBranches) {
          // ── Fetch all data for this branch for the week ──
          const [
            { data: reportsData },
            { data: ordersData },
            { data: paymentsData },
            { data: expensesData },
            { data: profilesData },
          ] = await Promise.all([
            supabaseAdmin
              .from('daily_reports')
              .select('*')
              .eq('branch_id', b.id)
              .in('report_date', weekDates),

            supabaseAdmin
              .from('orders')
              .select(
                'id, total_amount, client_name, created_date_pht, agent, order_number, dr_number'
              )
              .eq('branch_id', b.id)
              .in('created_date_pht', weekDates),

            supabaseAdmin
              .from('daily_payments')
              .select(
                `
                id, amount, payment_method, report_date, order_id,
                customer_name, pr_number, notes,
                orders ( id, order_number, dr_number, client_name, agent )
              `
              )
              .eq('branch_id', b.id)
              .in('report_date', weekDates),

            supabaseAdmin
              .from('daily_expenses')
              .select('amount, report_date')
              .eq('branch_id', b.id)
              .in('report_date', weekDates),

            supabaseAdmin
              .from('profiles')
              .select('full_name, agent_weekly_quota')
              .not('agent_weekly_quota', 'is', null)
              .gt('agent_weekly_quota', 0),
          ]);

          // ── Office account lookup ──
          const clientNames = [
            ...new Set(
              (ordersData || []).map((o: any) => o.client_name).filter(Boolean)
            ),
          ];
          let officeMap: Record<string, boolean> = {};
          if (clientNames.length > 0) {
            const { data: clientsData } = await supabaseAdmin
              .from('clients')
              .select('client_name, is_office_account')
              .in('client_name', clientNames);
            (clientsData || []).forEach((c: any) => {
              officeMap[c.client_name] = c.is_office_account === true;
            });
          }

          const isOfficeOrder = (o: any) => officeMap[o.client_name] || false;
          const isOfficePayment = (p: any) =>
            officeMap[
              (p.orders as any)?.client_name || p.customer_name || ''
            ] || false;

          // ── Report map ──
          const reportMap: Record<string, any> = {};
          (reportsData || []).forEach((r: any) => {
            reportMap[r.report_date] = r;
          });

          // ── Totals ──
          const totalExpenses = (expensesData || []).reduce(
            (s: number, e: any) => s + Number(e.amount || 0),
            0
          );

          let weekGen = 0,
            weekBrd = 0,
            weekDisc = 0,
            weekOthers = 0;
          let weekCash = 0,
            weekCheque = 0,
            weekOnline = 0;

          const dayRows: Array<{
            dateStr: string;
            gen: number;
            brd: number;
            disc: number;
            others: number;
            netTotal: number;
            cash: number;
            cheque: number;
            online: number;
            hasReport: boolean;
            isChecked: boolean;
          }> = weekDates.map((dateStr) => {
            const report = reportMap[dateStr];
            const dayOrders = (ordersData || []).filter(
              (o: any) => o.created_date_pht === dateStr
            );
            const others = dayOrders
              .filter(isOfficeOrder)
              .reduce(
                (s: number, o: any) => s + Number(o.total_amount || 0),
                0
              );
            const gen = Number(report?.generic_sales || 0);
            const brd = Number(report?.branded_sales || 0);
            const disc = Number(report?.discount_total || 0);
            const netTotal = gen + brd - disc - others;

            const dayPay = (paymentsData || []).filter(
              (p: any) => p.report_date === dateStr
            );
            const cash = dayPay
              .filter(
                (p: any) => p.payment_method === 'CASH' && !isOfficePayment(p)
              )
              .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
            const cheque = dayPay
              .filter(
                (p: any) => p.payment_method === 'CHEQUE' && !isOfficePayment(p)
              )
              .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
            const online = dayPay
              .filter(
                (p: any) => p.payment_method === 'ONLINE' && !isOfficePayment(p)
              )
              .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

            weekGen += gen;
            weekBrd += brd;
            weekDisc += disc;
            weekOthers += others;
            weekCash += cash;
            weekCheque += cheque;
            weekOnline += online;

            return {
              dateStr,
              gen,
              brd,
              disc,
              others,
              netTotal,
              cash,
              cheque,
              online,
              hasReport: !!report,
              isChecked: report?.is_checked || false,
            };
          });

          const weekNetTotal = weekGen + weekBrd - weekDisc - weekOthers;
          const weekActualCash = weekCash - totalExpenses;

          // ── Agent sales + quota ──
          const quotaMap = new Map<string, number>();
          (profilesData || []).forEach((p: any) => {
            if (p.full_name)
              quotaMap.set(
                p.full_name.trim().toUpperCase(),
                Number(p.agent_weekly_quota || 0)
              );
          });

          const agentSalesMap = new Map<
            string,
            { total: number; displayName: string }
          >();
          (profilesData || []).forEach((p: any) => {
            if (p.full_name) {
              const key = p.full_name.trim().toUpperCase();
              agentSalesMap.set(key, {
                total: 0,
                displayName: p.full_name.trim(),
              });
            }
          });
          (ordersData || [])
            .filter((o: any) => !isOfficeOrder(o))
            .forEach((o: any) => {
              const display = (o.agent || 'MAIN OFFICE').trim();
              const key = display.toUpperCase();
              const ex = agentSalesMap.get(key);
              agentSalesMap.set(key, {
                total: (ex?.total || 0) + Number(o.total_amount || 0),
                displayName: ex?.displayName || display,
              });
            });

          const agentSalesRows = Array.from(agentSalesMap.entries())
            .map(([key, v]) => ({
              agent: v.displayName,
              total: v.total,
              quota: quotaMap.get(key) || 0,
            }))
            .filter((r) => r.total > 0)
            .sort((a, b) => b.total - a.total);

          // ── Agent collections ──
          const agentCollMap = new Map<
            string,
            { cash: number; cheque: number; online: number }
          >();
          (paymentsData || [])
            .filter((p: any) => !isOfficePayment(p))
            .forEach((p: any) => {
              const agent = ((p.orders as any)?.agent || 'MAIN OFFICE').trim();
              const key = agent.toUpperCase();
              if (!agentCollMap.has(key))
                agentCollMap.set(key, { cash: 0, cheque: 0, online: 0 });
              const entry = agentCollMap.get(key)!;
              const method = (p.payment_method || 'CASH').toUpperCase();
              const amt = Number(p.amount || 0);
              if (method === 'CASH') entry.cash += amt;
              else if (method === 'CHEQUE') entry.cheque += amt;
              else entry.online += amt;
            });
          const agentCollRows = Array.from(agentCollMap.entries())
            .map(([key, v]) => ({
              agent: key.charAt(0) + key.slice(1).toLowerCase(),
              cash: v.cash,
              cheque: v.cheque,
              online: v.online,
              total: v.cash + v.cheque + v.online,
            }))
            .sort((a, b) => b.total - a.total);

          // ── Online payments ──
          const onlinePayments = (paymentsData || [])
            .filter((p: any) => p.payment_method === 'ONLINE')
            .sort((a: any, b: any) =>
              (
                (a.orders as any)?.client_name ||
                a.customer_name ||
                ''
              ).localeCompare(
                (b.orders as any)?.client_name || b.customer_name || ''
              )
            );

          // ── Client rows ──
          const clientSalesMap = new Map<
            string,
            { total: number; agent: string }
          >();
          (ordersData || [])
            .filter((o: any) => !isOfficeOrder(o))
            .forEach((o: any) => {
              const client = o.client_name || 'WALK-IN';
              const ex = clientSalesMap.get(client);
              clientSalesMap.set(client, {
                total: (ex?.total || 0) + Number(o.total_amount || 0),
                agent: ex?.agent || o.agent || 'MAIN OFFICE',
              });
            });
          const clientPayMap = new Map<
            string,
            { cash: number; cheque: number; online: number }
          >();
          (paymentsData || [])
            .filter((p: any) => !isOfficePayment(p))
            .forEach((p: any) => {
              const client =
                (p.orders as any)?.client_name || p.customer_name || 'WALK-IN';
              if (!clientPayMap.has(client))
                clientPayMap.set(client, { cash: 0, cheque: 0, online: 0 });
              const entry = clientPayMap.get(client)!;
              const method = (p.payment_method || 'CASH').toUpperCase();
              const amt = Number(p.amount || 0);
              if (method === 'CASH') entry.cash += amt;
              else if (method === 'CHEQUE') entry.cheque += amt;
              else entry.online += amt;
            });
          const allClientKeys = [
            ...new Set([...clientSalesMap.keys(), ...clientPayMap.keys()]),
          ];
          const clientRows = allClientKeys
            .map((client) => {
              const sd = clientSalesMap.get(client);
              const pay = clientPayMap.get(client) || {
                cash: 0,
                cheque: 0,
                online: 0,
              };
              const totalPaid = pay.cash + pay.cheque + pay.online;
              return {
                client,
                agent: sd?.agent || '—',
                sales: sd?.total || 0,
                cash: pay.cash,
                cheque: pay.cheque,
                online: pay.online,
                totalPaid,
                balance: (sd?.total || 0) - totalPaid,
              };
            })
            .sort((a, b) => b.sales - a.sales);

          // ────────────────────────────────────────────
          // BUILD HTML FOR THIS BRANCH
          // ────────────────────────────────────────────
          const fmt = (n: number) =>
            `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
          const pct = (val: number, quota: number) =>
            quota > 0 ? `${((val / quota) * 100).toFixed(1)}%` : '—';

          const tdR = `style="padding:8px 12px; text-align:right; font-family:monospace;"`;
          const tdL = `style="padding:8px 12px; text-align:left;"`;
          const thR = `style="padding:10px 12px; text-align:right; background:#1e293b; color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:1px;"`;
          const thL = `style="padding:10px 12px; text-align:left; background:#1e293b; color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:1px;"`;
          const trAlt = `style="background:#1e293b;"`;
          const trNorm = `style="background:#0f172a;"`;

          emailHtml += `
            <div style="background:#1e293b; border-radius:16px; padding:24px; margin-bottom:32px; border:1px solid #334155;">
              <h2 style="color:#a78bfa; margin:0 0 20px 0; font-size:20px;">🏢 ${b.branch_name.toUpperCase()}</h2>

              <!-- WEEKLY TOTALS CARDS -->
              <table style="width:100%; border-collapse:collapse; margin-bottom:24px;">
                <tr>
                  <td style="padding:4px;">
                    <div style="background:#0f172a; border:1px solid #059669; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#10b981; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">GENERIC</div>
                      <div style="color:#fff; font-size:20px; font-weight:900; font-family:monospace;">${fmt(
                        weekGen
                      )}</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:#0f172a; border:1px solid #7c3aed; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#a855f7; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">BRANDED</div>
                      <div style="color:#fff; font-size:20px; font-weight:900; font-family:monospace;">${fmt(
                        weekBrd
                      )}</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:#0f172a; border:1px solid #d97706; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#f59e0b; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">OTHERS</div>
                      <div style="color:#f59e0b; font-size:20px; font-weight:900; font-family:monospace;">${fmt(
                        weekOthers
                      )}</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:#0f172a; border:1px solid #ea580c; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#f97316; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">DISCOUNT</div>
                      <div style="color:#f97316; font-size:20px; font-weight:900; font-family:monospace;">${fmt(
                        weekDisc
                      )}</div>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:4px;">
                    <div style="background:#064e3b; border:2px solid #10b981; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#10b981; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">NET SALES</div>
                      <div style="color:#10b981; font-size:22px; font-weight:900; font-family:monospace;">${fmt(
                        weekNetTotal
                      )}</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:#0f172a; border:1px solid #2563eb; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#60a5fa; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">CASH</div>
                      <div style="color:#fff; font-size:20px; font-weight:900; font-family:monospace;">${fmt(
                        weekCash
                      )}</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:#0f172a; border:1px solid #0284c7; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#38bdf8; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">CHEQUE</div>
                      <div style="color:#fff; font-size:20px; font-weight:900; font-family:monospace;">${fmt(
                        weekCheque
                      )}</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:#0f172a; border:1px solid #dc2626; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#f87171; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">EXPENSES</div>
                      <div style="color:#f87171; font-size:20px; font-weight:900; font-family:monospace;">${fmt(
                        totalExpenses
                      )}</div>
                    </div>
                  </td>
                </tr>
              </table>
              <div style="background:#064e3b; border:2px solid #10b981; border-radius:12px; padding:20px; text-align:center; margin-bottom:28px;">
                <div style="color:#10b981; font-size:12px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">ACTUAL CASH (COLLECTED − EXPENSES)</div>
                <div style="color:#10b981; font-size:28px; font-weight:900; font-family:monospace;">${fmt(
                  weekActualCash
                )}</div>
              </div>

              <!-- DAY BY DAY BREAKDOWN -->
              <h3 style="color:#94a3b8; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:0 0 12px 0;">Day-by-Day Breakdown</h3>
              <div style="overflow-x:auto; margin-bottom:28px;">
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                  <thead>
                    <tr>
                      <th ${thL}>Day</th>
                      <th ${thR}>Generic</th>
                      <th ${thR}>Branded</th>
                      <th ${thR}>Others</th>
                      <th ${thR}>Disc</th>
                      <th ${thR}>Net Sales</th>
                      <th ${thR}>Cash</th>
                      <th ${thR}>Online</th>
                      <th ${thR}>Cheque</th>
                      <th style="padding:10px 12px; text-align:center; background:#1e293b; color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:1px;">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${dayRows
                      .map((d, i) => {
                        const date = new Date(d.dateStr + 'T00:00:00');
                        const dayLabel = date.toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        });
                        const isToday = d.dateStr === todayPHT;
                        const isFuture = date > new Date(todayPHT);
                        const status = isFuture
                          ? '<span style="color:#475569;font-size:10px;font-weight:700;">FUTURE</span>'
                          : !d.hasReport
                          ? '<span style="color:#ef4444;font-size:10px;font-weight:700;">MISSING</span>'
                          : d.isChecked
                          ? '<span style="color:#10b981;font-size:10px;font-weight:700;">✓ CHECKED</span>'
                          : '<span style="color:#f97316;font-size:10px;font-weight:700;">PENDING</span>';
                        const row = i % 2 === 0 ? trNorm : trAlt;
                        return `<tr ${row}>
                        <td ${tdL} style="padding:8px 12px; font-weight:700; color:${
                          isToday ? '#10b981' : '#e2e8f0'
                        };">${dayLabel}${
                          isToday
                            ? ' <span style="background:#10b981;color:#000;font-size:9px;font-weight:900;padding:1px 6px;border-radius:99px;">TODAY</span>'
                            : ''
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#6ee7b7;">${
                          d.hasReport ? fmt(d.gen) : '—'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#c4b5fd;">${
                          d.hasReport ? fmt(d.brd) : '—'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#fcd34d;">${
                          d.hasReport ? fmt(d.others) : '—'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#fdba74;">${
                          d.hasReport ? fmt(d.disc) : '—'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#10b981; font-weight:900;">${
                          d.hasReport ? fmt(d.netTotal) : '—'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#93c5fd;">${fmt(
                          d.cash
                        )}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#c4b5fd;">${fmt(
                          d.online
                        )}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#7dd3fc;">${fmt(
                          d.cheque
                        )}</td>
                        <td style="padding:8px 12px; text-align:center;">${status}</td>
                      </tr>`;
                      })
                      .join('')}
                    <tr style="background:#1e293b; border-top:2px solid #475569;">
                      <td ${tdL} style="padding:10px 12px; font-weight:900; color:#fff; font-size:12px; text-transform:uppercase; letter-spacing:1px;">WEEKLY TOTAL</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#6ee7b7; font-weight:900;">${fmt(
            weekGen
          )}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#c4b5fd; font-weight:900;">${fmt(
            weekBrd
          )}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#fcd34d; font-weight:900;">${fmt(
            weekOthers
          )}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#fdba74; font-weight:900;">${fmt(
            weekDisc
          )}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#10b981; font-weight:900;">${fmt(
            weekNetTotal
          )}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#93c5fd; font-weight:900;">${fmt(
            weekCash
          )}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#c4b5fd; font-weight:900;">${fmt(
            weekOnline
          )}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#7dd3fc; font-weight:900;">${fmt(
            weekCheque
          )}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- AGENT SALES + QUOTA -->
              <h3 style="color:#10b981; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:0 0 12px 0;">📦 Weekly Sales by Agent</h3>
              <div style="overflow-x:auto; margin-bottom:28px;">
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                  <thead>
                    <tr>
                      <th ${thL}>Agent</th>
                      <th ${thR}>Sales</th>
                      <th ${thR}>Quota</th>
                      <th ${thR}>% Achieved</th>
                      <th style="padding:10px 12px; text-align:left; background:#1e293b; color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:1px; width:160px;">Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${agentSalesRows
                      .map((r, i) => {
                        const rawPct =
                          r.quota > 0 ? (r.total / r.quota) * 100 : 0;
                        const barPct = Math.min(rawPct, 100);
                        const barColor =
                          rawPct >= 100
                            ? '#10b981'
                            : rawPct >= 75
                            ? '#f59e0b'
                            : rawPct >= 50
                            ? '#f97316'
                            : '#ef4444';
                        const pctColor =
                          rawPct >= 100
                            ? '#10b981'
                            : rawPct >= 75
                            ? '#f59e0b'
                            : '#ef4444';
                        const metBadge =
                          rawPct >= 100
                            ? ' <span style="background:#064e3b;color:#10b981;font-size:9px;font-weight:900;padding:1px 6px;border-radius:99px;">✓ MET</span>'
                            : '';
                        const row = i % 2 === 0 ? trNorm : trAlt;
                        return `<tr ${row}>
                        <td ${tdL} style="padding:8px 12px; font-weight:700; color:#e2e8f0;">${
                          r.agent
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#10b981; font-weight:900;">${fmt(
                          r.total
                        )}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#64748b;">${
                          r.quota > 0 ? fmt(r.quota) : '—'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:${pctColor}; font-weight:700;">${
                          r.quota > 0 ? rawPct.toFixed(1) + '%' : '—'
                        }${metBadge}</td>
                        <td style="padding:8px 12px;">
                          ${
                            r.quota > 0
                              ? `
                            <div style="background:#1e293b; border-radius:99px; height:8px; overflow:hidden; width:140px;">
                              <div style="background:${barColor}; height:8px; width:${barPct}%; border-radius:99px;"></div>
                            </div>`
                              : '<span style="color:#334155;font-size:11px;">—</span>'
                          }
                        </td>
                      </tr>`;
                      })
                      .join('')}
                    <tr style="background:#1e293b; border-top:2px solid #475569;">
                      <td ${tdL} style="padding:10px 12px; font-weight:900; color:#10b981; font-size:11px; text-transform:uppercase; letter-spacing:1px;">TOTAL</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#10b981; font-weight:900;">${fmt(
            agentSalesRows.reduce((s, r) => s + r.total, 0)
          )}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#64748b; font-weight:900;">${fmt(
            agentSalesRows.reduce((s, r) => s + r.quota, 0)
          )}</td>
                      <td></td><td></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- AGENT COLLECTIONS -->
              <h3 style="color:#a855f7; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:0 0 12px 0;">💰 Weekly Collections by Agent</h3>
              <div style="overflow-x:auto; margin-bottom:28px;">
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                  <thead>
                    <tr>
                      <th ${thL}>Agent</th>
                      <th ${thR}>Cash</th>
                      <th ${thR}>Cheque</th>
                      <th ${thR}>Online</th>
                      <th ${thR}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${agentCollRows
                      .map((r, i) => {
                        const row = i % 2 === 0 ? trNorm : trAlt;
                        return `<tr ${row}>
                        <td ${tdL} style="padding:8px 12px; font-weight:700; color:#e2e8f0;">${
                          r.agent
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#6ee7b7;">${
                          r.cash > 0
                            ? fmt(r.cash)
                            : '<span style="color:#1e293b;">—</span>'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#fcd34d;">${
                          r.cheque > 0
                            ? fmt(r.cheque)
                            : '<span style="color:#1e293b;">—</span>'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#7dd3fc;">${
                          r.online > 0
                            ? fmt(r.online)
                            : '<span style="color:#1e293b;">—</span>'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#c4b5fd; font-weight:900;">${fmt(
                          r.total
                        )}</td>
                      </tr>`;
                      })
                      .join('')}
                    ${(() => {
                      const tc = agentCollRows.reduce((s, r) => s + r.cash, 0);
                      const tch = agentCollRows.reduce(
                        (s, r) => s + r.cheque,
                        0
                      );
                      const to = agentCollRows.reduce(
                        (s, r) => s + r.online,
                        0
                      );
                      return `<tr style="background:#1e293b; border-top:2px solid #475569;">
                        <td ${tdL} style="padding:10px 12px; font-weight:900; color:#a855f7; font-size:11px; text-transform:uppercase; letter-spacing:1px;">TOTAL</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#6ee7b7; font-weight:900;">${fmt(
                        tc
                      )}</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#fcd34d; font-weight:900;">${fmt(
                        tch
                      )}</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#7dd3fc; font-weight:900;">${fmt(
                        to
                      )}</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#c4b5fd; font-weight:900;">${fmt(
                        tc + tch + to
                      )}</td>
                      </tr>`;
                    })()}
                  </tbody>
                </table>
              </div>

              ${
                onlinePayments.length > 0
                  ? `
              <!-- ONLINE PAYMENTS -->
              <h3 style="color:#38bdf8; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:0 0 12px 0;">🌐 Online Payments This Week</h3>
              <div style="overflow-x:auto; margin-bottom:28px;">
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                  <thead>
                    <tr>
                      <th ${thL}>Date</th>
                      <th ${thL}>Client</th>
                      <th ${thL}>SO#</th>
                      <th ${thL}>DR#</th>
                      <th ${thL}>PR#</th>
                      <th ${thR}>Amount</th>
                      <th ${thL}>Reference / Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${onlinePayments
                      .map((p: any, i: number) => {
                        const order = p.orders || {};
                        const row = i % 2 === 0 ? trNorm : trAlt;
                        return `<tr ${row}>
                        <td ${tdL} style="padding:8px 12px; font-family:monospace; color:#64748b; font-size:11px;">${
                          p.report_date
                        }</td>
                        <td ${tdL} style="padding:8px 12px; font-weight:700; color:#e2e8f0;">${
                          p.customer_name || order.client_name || '—'
                        }</td>
                        <td ${tdL} style="padding:8px 12px; font-family:monospace; color:#94a3b8;">${
                          order.order_number || '—'
                        }</td>
                        <td ${tdL} style="padding:8px 12px; font-family:monospace; color:#94a3b8;">${
                          order.dr_number || '—'
                        }</td>
                        <td ${tdL} style="padding:8px 12px; font-family:monospace; color:#fcd34d;">${
                          p.pr_number || order.pr_number || '—'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#38bdf8; font-weight:900;">${fmt(
                          Number(p.amount || 0)
                        )}</td>
                        <td ${tdL} style="padding:8px 12px; color:#7dd3fc; font-size:12px;">${
                          p.notes?.trim() || '—'
                        }</td>
                      </tr>`;
                      })
                      .join('')}
                    <tr style="background:#1e293b; border-top:2px solid #475569;">
                      <td colspan="5" ${tdL} style="padding:10px 12px; font-weight:900; color:#38bdf8; font-size:11px; text-transform:uppercase; letter-spacing:1px;">TOTAL ONLINE</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#38bdf8; font-weight:900;">${fmt(
                      onlinePayments.reduce(
                        (s: number, p: any) => s + Number(p.amount || 0),
                        0
                      )
                    )}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>`
                  : ''
              }

              <!-- CLIENT SALES & PAYMENTS -->
              <h3 style="color:#f59e0b; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:0 0 12px 0;">👤 Sales & Payments by Client</h3>
              <div style="overflow-x:auto; margin-bottom:8px;">
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                  <thead>
                    <tr>
                      <th ${thL}>Client</th>
                      <th ${thL}>Agent</th>
                      <th ${thR}>Total Sales</th>
                      <th ${thR}>Cash Paid</th>
                      <th ${thR}>Cheque Paid</th>
                      <th ${thR}>Online Paid</th>
                      <th ${thR}>Total Paid</th>
                      <th ${thR}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${clientRows
                      .map((r, i) => {
                        const balColor =
                          r.balance > 0
                            ? '#ef4444'
                            : r.balance < 0
                            ? '#38bdf8'
                            : '#475569';
                        const balText =
                          r.balance !== 0
                            ? fmt(Math.abs(r.balance)) +
                              (r.balance < 0 ? ' (over)' : '')
                            : '—';
                        const row = i % 2 === 0 ? trNorm : trAlt;
                        return `<tr ${row}>
                        <td ${tdL} style="padding:8px 12px; font-weight:700; color:#e2e8f0;">${
                          r.client
                        }</td>
                        <td ${tdL} style="padding:8px 12px; color:#64748b; font-size:11px;">${
                          r.agent
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#6ee7b7;">${
                          r.sales > 0 ? fmt(r.sales) : '—'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#93c5fd;">${
                          r.cash > 0 ? fmt(r.cash) : '—'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#fcd34d;">${
                          r.cheque > 0 ? fmt(r.cheque) : '—'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#7dd3fc;">${
                          r.online > 0 ? fmt(r.online) : '—'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#c4b5fd; font-weight:900;">${
                          r.totalPaid > 0 ? fmt(r.totalPaid) : '—'
                        }</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:${balColor}; font-weight:700;">${balText}</td>
                      </tr>`;
                      })
                      .join('')}
                    ${(() => {
                      const ts = clientRows.reduce((s, r) => s + r.sales, 0);
                      const tc = clientRows.reduce((s, r) => s + r.cash, 0);
                      const tch = clientRows.reduce((s, r) => s + r.cheque, 0);
                      const to = clientRows.reduce((s, r) => s + r.online, 0);
                      const tp = tc + tch + to;
                      return `<tr style="background:#1e293b; border-top:2px solid #475569;">
                        <td colspan="2" ${tdL} style="padding:10px 12px; font-weight:900; color:#f59e0b; font-size:11px; text-transform:uppercase; letter-spacing:1px;">TOTAL</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#6ee7b7; font-weight:900;">${fmt(
                        ts
                      )}</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#93c5fd; font-weight:900;">${fmt(
                        tc
                      )}</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#fcd34d; font-weight:900;">${fmt(
                        tch
                      )}</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#7dd3fc; font-weight:900;">${fmt(
                        to
                      )}</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#c4b5fd; font-weight:900;">${fmt(
                        tp
                      )}</td>
                        <td></td>
                      </tr>`;
                    })()}
                  </tbody>
                </table>
              </div>

            </div>
          `;
        } // end branch loop

        emailHtml += `
          <p style="text-align:center; color:#475569; font-size:12px; margin-top:32px;">
            Generated by EconoPOS • Weekly Report • ${weekStart} to ${weekEnd}
          </p>
        </div>`;

        const emailList = org.owner_email
          .split(',')
          .map((e: string) => e.trim())
          .filter(Boolean);
        if (emailList.length > 0) {
          try {
            await resend.emails.send({
              from: 'Econo Drugstore <stock@alerts.econo-pos.com>',
              to: emailList,
              subject: `📅 Weekly Report — ${weekStart} to ${weekEnd} | ${org.name}`,
              html: emailHtml,
            });
            console.log(
              `✅ Weekly email sent to ${org.owner_email} (${org.name})`
            );
          } catch (err) {
            console.error(`❌ Weekly email failed for ${org.name}:`, err);
          }
        }
      } // end org loop

      return NextResponse.json({
        success: true,
        message: `Weekly email reports sent for ${weekStart} to ${weekEnd}`,
      });
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Telegram Report Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}