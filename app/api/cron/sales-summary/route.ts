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
    if (type !== 'DAILY_EMAIL' && type !== 'WEEKLY_EMAIL' && type !== 'MONTHLY_EMAIL' && type !== 'DRUGSTORE_EMAIL' && type !== 'DRUGSTORE_EMAIL_WEEKLY') {
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

    if (type === 'DAILY_EMAIL') {
      console.log('📧 Starting Daily Email Report (8PM PHT) - Office Branches Only');

      const { data: orgsForEmail } = await supabaseAdmin
        .from('organizations')
        .select('id, name, owner_email')
        .not('owner_email', 'is', null);

      for (const org of orgsForEmail || []) {
        const rawEmail = org.owner_email?.trim();

        if (!rawEmail) {
          console.log(`⚠️ Skipping org "${org.name}" - no owner_email`);
          continue;
        }

        // Support multiple emails (comma separated)
        const emailList: string[] = rawEmail
          .split(',')
          .map((e) => e.trim())
          .filter((e) => e.includes('@'));

        if (emailList.length === 0) {
          console.log(`⚠️ Skipping org "${org.name}" - no valid emails`);
          continue;
        }

        const { data: officeBranchesRaw } = await supabaseAdmin
          .from('branches')
          .select('*')
          .eq('org_id', org.id)
          .eq('is_office_use', true);

        const officeBranches = (officeBranchesRaw || []).filter(
          (b: any) => b.test_env !== true
        );

        if (!officeBranches || officeBranches.length === 0) continue;

        for (const b of officeBranches) {
          const reportDate = todayPHT;

          const { data: report } = await supabaseAdmin
            .from('daily_reports')
            .select('*')
            .eq('branch_id', b.id)
            .eq('report_date', reportDate)
            .single();

          const { data: allPaymentsRaw, error: paymentsError } =
            await supabaseAdmin
              .from('daily_payments')
              .select(
                `*, orders (client_name, order_number, dr_number, delivery_date, created_date_pht, total_amount)`
              )
              .eq('branch_id', b.id)
              .eq('report_date', reportDate);

          if (paymentsError) {
            console.error(
              `⚠️ Payments Query Error for ${b.branch_name}:`,
              paymentsError
            );
          }

          const { data: expenses } = await supabaseAdmin
            .from('daily_expenses')
            .select('*')
            .eq('branch_id', b.id)
            .eq('report_date', reportDate);

          const legacyPayments = (allPaymentsRaw || []).filter(
            (p: any) => !p.order_id
          );
          const regularPayments = (allPaymentsRaw || []).filter(
            (p: any) => p.order_id
          );

          // === Calculate Others (Office Accounts) ===
          const { data: dayOrders } = await supabaseAdmin
            .from('orders')
            .select('total_amount, client_name')
            .eq('branch_id', b.id)
            .eq('created_date_pht', reportDate);

          let othersTotal = 0;
          let officeSet = new Set<string>();

          // Build officeSet from ALL client names: today's orders + all payment order links
          // This ensures previous-day order payments (e.g. remittances) are also filtered correctly
          const allClientNames = new Set<string>([
            ...(dayOrders || []).map((o: any) => o.client_name).filter(Boolean),
            ...(allPaymentsRaw || [])
              .map((p: any) => p.orders?.client_name)
              .filter(Boolean),
          ]);

          if (allClientNames.size > 0) {
            const { data: clientsData } = await supabaseAdmin
              .from('clients')
              .select('client_name, is_office_account')
              .in('client_name', [...allClientNames]);

            officeSet = new Set(
              (clientsData || [])
                .filter((c) => c.is_office_account)
                .map((c) => c.client_name)
            );
          }

          if (dayOrders && dayOrders.length > 0) {
            othersTotal = dayOrders
              .filter((o: any) => officeSet.has(o.client_name))
              .reduce((sum, o: any) => sum + Number(o.total_amount || 0), 0);
          }

          // Helper: check if a payment belongs to an office account
          const isOfficePayment = (p: any) =>
            officeSet.has(p.orders?.client_name || '');

          // === DAILY SALES ===
          const gen = Number(report?.generic_sales || 0);
          const brd = Number(report?.branded_sales || 0);
          const disc = Number(report?.discount_total || 0);
          const dailySalesTotal = gen + brd - disc - othersTotal;

          // Same-day order payments = regularPayments whose order was created TODAY
          const sameDayPayments = regularPayments.filter(
            (p: any) => p.orders?.created_date_pht === reportDate
          );
          // Previous-day order payments = regularPayments whose order was created on a PAST date
          const prevDayPayments = regularPayments.filter(
            (p: any) =>
              p.orders?.created_date_pht &&
              p.orders.created_date_pht !== reportDate
          );

          // Daily Sales Cash/Online/Cheque — exclude office accounts
          const dailyCash = sameDayPayments
            .filter(
              (p: any) => p.payment_method === 'CASH' && !isOfficePayment(p)
            )
            .reduce((sum, p) => sum + Number(p.amount || 0), 0);

          const dailyOnline = sameDayPayments
            .filter(
              (p: any) => p.payment_method === 'ONLINE' && !isOfficePayment(p)
            )
            .reduce((sum, p) => sum + Number(p.amount || 0), 0);

          const dailyCheque = sameDayPayments
            .filter(
              (p: any) => p.payment_method === 'CHEQUE' && !isOfficePayment(p)
            )
            .reduce((sum, p) => sum + Number(p.amount || 0), 0);

          // Remittances = previous-day order payments + legacy payments, exclude office accounts
          const allRemittances = [...prevDayPayments, ...legacyPayments];

          const remCash = allRemittances
            .filter(
              (p: any) => p.payment_method === 'CASH' && !isOfficePayment(p)
            )
            .reduce((sum, p) => sum + Number(p.amount || 0), 0);

          const remOnline = allRemittances
            .filter(
              (p: any) => p.payment_method === 'ONLINE' && !isOfficePayment(p)
            )
            .reduce((sum, p) => sum + Number(p.amount || 0), 0);

          const remCheque = allRemittances
            .filter(
              (p: any) => p.payment_method === 'CHEQUE' && !isOfficePayment(p)
            )
            .reduce((sum, p) => sum + Number(p.amount || 0), 0);

          const remittancesTotal = remCash + remOnline + remCheque;

          // Total Payments
          const totalPaymentsCash = dailyCash + remCash;
          const totalPaymentsOnline = dailyOnline + remOnline;
          const totalPaymentsCheque = dailyCheque + remCheque;

          const totalPayments =
            totalPaymentsCash + totalPaymentsOnline + totalPaymentsCheque;

          const totalExpenses = (expenses || []).reduce(
            (sum, e) => sum + Number(e.amount || 0),
            0
          );
          const actualCash = totalPaymentsCash - totalExpenses;

          // === Sort tables by Client Name ===
          const sortedRegular = [...regularPayments].sort((a, b) => {
            const dateA = a.orders?.created_date_pht || '';
            const dateB = b.orders?.created_date_pht || '';

            if (dateA !== dateB) {
              const timeA = dateA ? new Date(dateA).getTime() : 0;
              const timeB = dateB ? new Date(dateB).getTime() : 0;

              // Prevent NaN from breaking the array sort
              const validTimeA = isNaN(timeA) ? 0 : timeA;
              const validTimeB = isNaN(timeB) ? 0 : timeB;

              return validTimeA - validTimeB;
            }

            // Fallback to sorting by Client Name
            const nameA = (
              a.orders?.client_name ||
              a.customer_name ||
              ''
            ).toLowerCase();
            const nameB = (
              b.orders?.client_name ||
              b.customer_name ||
              ''
            ).toLowerCase();
            return nameA.localeCompare(nameB);
          });

          const sortedLegacy = [...legacyPayments].sort((a, b) =>
            (a.customer_name || '')
              .toLowerCase()
              .localeCompare((b.customer_name || '').toLowerCase())
          );

          const sortedOnline = [
            ...(allPaymentsRaw || []).filter(
              (p: any) => p.payment_method === 'ONLINE'
            ),
          ].sort((a, b) => {
            const nameA = (
              a.customer_name ||
              a.orders?.client_name ||
              ''
            ).toLowerCase();
            const nameB = (
              b.customer_name ||
              b.orders?.client_name ||
              ''
            ).toLowerCase();
            return nameA.localeCompare(nameB);
          });

          // === FULL HTML ===
          const reportNotes = report?.notes?.trim() || '';

          let emailHtml = `
            <!DOCTYPE html>
            <html lang="en">
            <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
            <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">

              <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);margin-top:24px;margin-bottom:24px;">

                <!-- ===== HEADER ===== -->
                <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 60%,#0f4c75 100%);padding:36px 32px 28px 32px;text-align:center;">
                  <div style="display:inline-block;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:6px 18px;margin-bottom:16px;">
                    <span style="color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">END OF DAY REPORT</span>
                  </div>
                  <h1 style="margin:0 0 6px 0;color:#ffffff;font-size:26px;font-weight:800;letter-spacing:-0.5px;">${b.branch_name.toUpperCase()}</h1>
                  <p style="margin:0;color:#64748b;font-size:14px;font-weight:500;">${reportDate}</p>
                </div>

                <!-- ===== DAILY SALES SUMMARY CARDS ===== -->
                <div style="padding:28px 32px 0 32px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:18px;">
                    <div style="width:4px;height:20px;background:#3b82f6;border-radius:2px;"></div>
                    <span style="font-size:11px;font-weight:800;letter-spacing:3px;color:#64748b;text-transform:uppercase;">Daily Sales</span>
                  </div>

                  <!-- 4 mini cards -->
                  <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
                    <div style="flex:1;min-width:120px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px 16px;">
                      <div style="font-size:10px;font-weight:700;color:#3b82f6;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">Generic</div>
                      <div style="font-size:18px;font-weight:800;color:#1e3a8a;">₱${gen.toLocaleString()}</div>
                    </div>
                    <div style="flex:1;min-width:120px;background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:14px 16px;">
                      <div style="font-size:10px;font-weight:700;color:#9333ea;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">Branded</div>
                      <div style="font-size:18px;font-weight:800;color:#581c87;">₱${brd.toLocaleString()}</div>
                    </div>
                    <div style="flex:1;min-width:120px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;">
                      <div style="font-size:10px;font-weight:700;color:#d97706;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">Others</div>
                      <div style="font-size:18px;font-weight:800;color:#92400e;">₱${othersTotal.toLocaleString()}</div>
                    </div>
                    <div style="flex:1;min-width:120px;background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:14px 16px;">
                      <div style="font-size:10px;font-weight:700;color:#e11d48;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">Discount</div>
                      <div style="font-size:18px;font-weight:800;color:#9f1239;">- ₱${disc.toLocaleString()}</div>
                    </div>
                  </div>

                  <!-- Total Sales NET -->
                  <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);border-radius:10px;padding:18px 20px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:#94a3b8;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Total Sales (Net)</span>
                    <span style="color:#34d399;font-size:22px;font-weight:900;font-variant-numeric:tabular-nums;">₱${dailySalesTotal.toLocaleString()}</span>
                  </div>

                  <!-- Cash breakdown sub-row -->
                  <div style="display:flex;gap:10px;margin-bottom:28px;flex-wrap:wrap;">
                    <div style="flex:1;min-width:100px;border-left:3px solid #10b981;padding:8px 12px;background:#f8fafc;">
                      <div style="font-size:10px;color:#64748b;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Cash</div>
                      <div style="font-size:15px;font-weight:700;color:#111827;">₱${dailyCash.toLocaleString()}</div>
                    </div>
                    <div style="flex:1;min-width:100px;border-left:3px solid #38bdf8;padding:8px 12px;background:#f8fafc;">
                      <div style="font-size:10px;color:#64748b;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Online</div>
                      <div style="font-size:15px;font-weight:700;color:#111827;">₱${dailyOnline.toLocaleString()}</div>
                    </div>
                    <div style="flex:1;min-width:100px;border-left:3px solid #a78bfa;padding:8px 12px;background:#f8fafc;">
                      <div style="font-size:10px;color:#64748b;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Cheque</div>
                      <div style="font-size:15px;font-weight:700;color:#111827;">₱${dailyCheque.toLocaleString()}</div>
                    </div>
                  </div>
                </div>

                <!-- ===== DIVIDER ===== -->
                <div style="margin:0 32px;border-top:1px solid #e2e8f0;"></div>

                <!-- ===== REMITTANCES ===== -->
                <div style="padding:24px 32px 0 32px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
                    <div style="width:4px;height:20px;background:#06b6d4;border-radius:2px;"></div>
                    <span style="font-size:11px;font-weight:800;letter-spacing:3px;color:#64748b;text-transform:uppercase;">Remittances</span>
                  </div>
                  <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:10px;padding:16px 20px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:#0f766e;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Total</span>
                    <span style="color:#0d9488;font-size:20px;font-weight:900;">₱${remittancesTotal.toLocaleString()}</span>
                  </div>
                  <div style="display:flex;gap:10px;margin-bottom:28px;flex-wrap:wrap;">
                    <div style="flex:1;min-width:100px;border-left:3px solid #10b981;padding:8px 12px;background:#f8fafc;">
                      <div style="font-size:10px;color:#64748b;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Cash</div>
                      <div style="font-size:15px;font-weight:700;color:#111827;">₱${remCash.toLocaleString()}</div>
                    </div>
                    <div style="flex:1;min-width:100px;border-left:3px solid #38bdf8;padding:8px 12px;background:#f8fafc;">
                      <div style="font-size:10px;color:#64748b;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Online</div>
                      <div style="font-size:15px;font-weight:700;color:#111827;">₱${remOnline.toLocaleString()}</div>
                    </div>
                    <div style="flex:1;min-width:100px;border-left:3px solid #a78bfa;padding:8px 12px;background:#f8fafc;">
                      <div style="font-size:10px;color:#64748b;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Cheque</div>
                      <div style="font-size:15px;font-weight:700;color:#111827;">₱${remCheque.toLocaleString()}</div>
                    </div>
                  </div>
                </div>

                <!-- ===== DIVIDER ===== -->
                <div style="margin:0 32px;border-top:1px solid #e2e8f0;"></div>

                <!-- ===== TOTAL PAYMENTS ===== -->
                <div style="padding:24px 32px 0 32px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
                    <div style="width:4px;height:20px;background:#f59e0b;border-radius:2px;"></div>
                    <span style="font-size:11px;font-weight:800;letter-spacing:3px;color:#64748b;text-transform:uppercase;">Total Payments</span>
                  </div>
                  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px 20px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:#92400e;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Total</span>
                    <span style="color:#b45309;font-size:20px;font-weight:900;">₱${totalPayments.toLocaleString()}</span>
                  </div>
                  <div style="display:flex;gap:10px;margin-bottom:28px;flex-wrap:wrap;">
                    <div style="flex:1;min-width:100px;border-left:3px solid #10b981;padding:8px 12px;background:#f8fafc;">
                      <div style="font-size:10px;color:#64748b;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Cash</div>
                      <div style="font-size:15px;font-weight:700;color:#111827;">₱${totalPaymentsCash.toLocaleString()}</div>
                    </div>
                    <div style="flex:1;min-width:100px;border-left:3px solid #38bdf8;padding:8px 12px;background:#f8fafc;">
                      <div style="font-size:10px;color:#64748b;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Online</div>
                      <div style="font-size:15px;font-weight:700;color:#111827;">₱${totalPaymentsOnline.toLocaleString()}</div>
                    </div>
                    <div style="flex:1;min-width:100px;border-left:3px solid #a78bfa;padding:8px 12px;background:#f8fafc;">
                      <div style="font-size:10px;color:#64748b;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Cheque</div>
                      <div style="font-size:15px;font-weight:700;color:#111827;">₱${totalPaymentsCheque.toLocaleString()}</div>
                    </div>
                  </div>
                </div>

                <!-- ===== DIVIDER ===== -->
                <div style="margin:0 32px;border-top:1px solid #e2e8f0;"></div>

                <!-- ===== EXPENSES ===== -->
                <div style="padding:24px 32px 0 32px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
                    <div style="width:4px;height:20px;background:#ef4444;border-radius:2px;"></div>
                    <span style="font-size:11px;font-weight:800;letter-spacing:3px;color:#64748b;text-transform:uppercase;">Expenses</span>
                  </div>
                  <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:13px;">
                    <tbody>
                      ${(expenses || [])
                        .map(
                          (e: any) => `
                        <tr style="border-bottom:1px solid #fee2e2;">
                          <td style="padding:9px 12px;color:#374151;">${
                            e.expense_name
                          }</td>
                          <td style="padding:9px 12px;text-align:right;color:#dc2626;font-weight:700;">₱${Number(
                            e.amount
                          ).toLocaleString()}</td>
                        </tr>
                      `
                        )
                        .join('')}
                      <tr style="background:#fef2f2;">
                        <td style="padding:11px 12px;font-weight:800;color:#991b1b;font-size:13px;">Total Expenses</td>
                        <td style="padding:11px 12px;text-align:right;font-weight:800;color:#dc2626;font-size:14px;">₱${totalExpenses.toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <!-- ===== ACTUAL CASH (hero card) ===== -->
                <div style="padding:20px 32px 0 32px;">
                  <div style="background:linear-gradient(135deg,#064e3b,#065f46);border-radius:12px;padding:24px 28px;display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <div style="color:#6ee7b7;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-bottom:6px;">Actual Cash</div>
                      <div style="color:#a7f3d0;font-size:12px;">Total Cash − Expenses</div>
                    </div>
                    <div style="color:#34d399;font-size:32px;font-weight:900;font-variant-numeric:tabular-nums;letter-spacing:-1px;">₱${actualCash.toLocaleString()}</div>
                  </div>
                </div>

                <!-- ===== NOTES / DISCREPANCIES (directly below actual cash) ===== -->
                ${
                  reportNotes
                    ? `
                <div style="padding:16px 32px 0 32px;">
                  <div style="background:#fefce8;border:1px solid #fde047;border-left:4px solid #eab308;border-radius:10px;padding:18px 20px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                      <span style="font-size:16px;">📝</span>
                      <span style="font-size:11px;font-weight:800;letter-spacing:2px;color:#854d0e;text-transform:uppercase;">Notes / Discrepancies</span>
                    </div>
                    <p style="margin:0;color:#713f12;font-size:13px;line-height:1.7;white-space:pre-wrap;">${reportNotes}</p>
                  </div>
                </div>
                `
                    : ''
                }

                <!-- ===== DAILY SALES TABLE ===== -->
                <div style="padding:28px 32px 0 32px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
                    <div style="width:4px;height:20px;background:#6366f1;border-radius:2px;"></div>
                    <span style="font-size:11px;font-weight:800;letter-spacing:3px;color:#64748b;text-transform:uppercase;">Daily Sales Table</span>
                  </div>
                  <div style="overflow-x:auto;border-radius:10px;border:1px solid #e2e8f0;">
                    <table style="width:100%;border-collapse:collapse;font-size:11.5px;min-width:600px;">
                      <thead>
                        <tr style="background:#1e293b;color:#94a3b8;text-align:left;">
                          <th style="padding:10px 10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:10px;">Order Date</th>
                          <th style="padding:10px 10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:10px;">Client</th>
                          <th style="padding:10px 10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:10px;">SO#</th>
                          <th style="padding:10px 10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:10px;">DR#</th>
                          <th style="padding:10px 10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:10px;">PR#</th>
                          <th style="padding:10px 10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:10px;text-align:right;">Cash</th>
                          <th style="padding:10px 10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:10px;text-align:right;">Cheque</th>
                          <th style="padding:10px 10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:10px;">Chq Date</th>
                          <th style="padding:10px 10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:10px;">Del Date</th>
                          <th style="padding:10px 10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:10px;text-align:right;">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${sortedRegular
                          .map((p: any, idx: number) => {
                            const order = p.orders || {};
                            const cashAmt =
                              p.payment_method === 'CASH' ||
                              p.payment_method === 'ONLINE'
                                ? Number(p.amount)
                                : 0;
                            const chequeAmt =
                              p.payment_method === 'CHEQUE'
                                ? Number(p.amount)
                                : 0;
                            const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
                            return `
                            <tr style="background:${rowBg};border-bottom:1px solid #f1f5f9;">
                              <td style="padding:9px 10px;color:#6b7280;">${
                                order.created_date_pht || '—'
                              }</td>
                              <td style="padding:9px 10px;font-weight:600;color:#111827;">${
                                order.client_name || p.customer_name || '—'
                              }</td>
                              <td style="padding:9px 10px;font-family:monospace;color:#6366f1;">${
                                order.order_number || '—'
                              }</td>
                              <td style="padding:9px 10px;font-family:monospace;color:#6b7280;">${
                                order.dr_number || '—'
                              }</td>
                              <td style="padding:9px 10px;font-family:monospace;color:#d97706;">${
                                p.pr_number || '—'
                              }</td>
                              <td style="padding:9px 10px;text-align:right;color:#059669;font-weight:600;">₱${cashAmt.toLocaleString()}</td>
                              <td style="padding:9px 10px;text-align:right;color:#7c3aed;font-weight:600;">₱${chequeAmt.toLocaleString()}</td>
                              <td style="padding:9px 10px;color:#6b7280;">${
                                p.cheque_date || '—'
                              }</td>
                              <td style="padding:9px 10px;color:#6b7280;">${
                                order.delivery_date || '—'
                              }</td>
                              <td style="padding:9px 10px;text-align:right;font-weight:700;color:#111827;">₱${Number(
                                p.amount || 0
                              ).toLocaleString()}</td>
                            </tr>
                          `;
                          })
                          .join('')}
                      </tbody>
                    </table>
                  </div>
                </div>

                <!-- ===== LEGACY / STANDALONE PAYMENTS ===== -->
                ${
                  sortedLegacy.length > 0
                    ? `
                <div style="padding:24px 32px 0 32px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
                    <div style="width:4px;height:20px;background:#f59e0b;border-radius:2px;"></div>
                    <span style="font-size:11px;font-weight:800;letter-spacing:3px;color:#92400e;text-transform:uppercase;">Legacy / Standalone Payments (Old POS)</span>
                  </div>
                  <div style="overflow-x:auto;border-radius:10px;border:1px solid #fde68a;">
                    <table style="width:100%;border-collapse:collapse;font-size:12px;">
                      <thead>
                        <tr style="background:#fef3c7;text-align:left;">
                          <th style="padding:9px 10px;font-weight:700;color:#92400e;font-size:10px;letter-spacing:1px;text-transform:uppercase;">Customer</th>
                          <th style="padding:9px 10px;font-weight:700;color:#92400e;font-size:10px;letter-spacing:1px;text-transform:uppercase;text-align:right;">Amount</th>
                          <th style="padding:9px 10px;font-weight:700;color:#92400e;font-size:10px;letter-spacing:1px;text-transform:uppercase;">Method</th>
                          <th style="padding:9px 10px;font-weight:700;color:#92400e;font-size:10px;letter-spacing:1px;text-transform:uppercase;">PR#</th>
                          <th style="padding:9px 10px;font-weight:700;color:#92400e;font-size:10px;letter-spacing:1px;text-transform:uppercase;">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${sortedLegacy
                          .map(
                            (p: any, idx: number) => `
                          <tr style="background:${
                            idx % 2 === 0 ? '#fffbeb' : '#ffffff'
                          };border-bottom:1px solid #fde68a;">
                            <td style="padding:9px 10px;font-weight:600;color:#111827;">${
                              p.customer_name
                            }</td>
                            <td style="padding:9px 10px;text-align:right;font-weight:700;color:#d97706;">₱${Number(
                              p.amount
                            ).toLocaleString()}</td>
                            <td style="padding:9px 10px;color:#374151;">${
                              p.payment_method
                            }</td>
                            <td style="padding:9px 10px;font-family:monospace;color:#d97706;">${
                              p.pr_number || '—'
                            }</td>
                            <td style="padding:9px 10px;color:#6b7280;">${
                              p.notes || '—'
                            }</td>
                          </tr>
                        `
                          )
                          .join('')}
                      </tbody>
                    </table>
                  </div>
                </div>
                `
                    : ''
                }

                <!-- ===== ONLINE PAYMENTS ===== -->
                ${
                  sortedOnline.length > 0
                    ? `
                <div style="padding:24px 32px 0 32px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
                    <div style="width:4px;height:20px;background:#38bdf8;border-radius:2px;"></div>
                    <span style="font-size:11px;font-weight:800;letter-spacing:3px;color:#0369a1;text-transform:uppercase;">Online Payments</span>
                  </div>
                  <div style="overflow-x:auto;border-radius:10px;border:1px solid #bae6fd;">
                    <table style="width:100%;border-collapse:collapse;font-size:12px;">
                      <thead>
                        <tr style="background:#0ea5e9;text-align:left;">
                          <th style="padding:9px 10px;font-weight:700;color:#fff;font-size:10px;letter-spacing:1px;text-transform:uppercase;">Client</th>
                          <th style="padding:9px 10px;font-weight:700;color:#fff;font-size:10px;letter-spacing:1px;text-transform:uppercase;">SO#</th>
                          <th style="padding:9px 10px;font-weight:700;color:#fff;font-size:10px;letter-spacing:1px;text-transform:uppercase;">DR#</th>
                          <th style="padding:9px 10px;font-weight:700;color:#fff;font-size:10px;letter-spacing:1px;text-transform:uppercase;">PR#</th>
                          <th style="padding:9px 10px;font-weight:700;color:#fff;font-size:10px;letter-spacing:1px;text-transform:uppercase;text-align:right;">Amount</th>
                          <th style="padding:9px 10px;font-weight:700;color:#fff;font-size:10px;letter-spacing:1px;text-transform:uppercase;">Method</th>
                          <th style="padding:9px 10px;font-weight:700;color:#fff;font-size:10px;letter-spacing:1px;text-transform:uppercase;">Reference / Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${sortedOnline
                          .map((p: any, idx: number) => {
                            const order = p.orders || {};
                            return `
                            <tr style="background:${
                              idx % 2 === 0 ? '#f0f9ff' : '#ffffff'
                            };border-bottom:1px solid #bae6fd;">
                              <td style="padding:9px 10px;font-weight:600;color:#111827;">${
                                p.customer_name || order.client_name || '—'
                              }</td>
                              <td style="padding:9px 10px;font-family:monospace;color:#6366f1;">${
                                order.order_number || '—'
                              }</td>
                              <td style="padding:9px 10px;font-family:monospace;color:#6b7280;">${
                                order.dr_number || '—'
                              }</td>
                              <td style="padding:9px 10px;font-family:monospace;color:#d97706;">${
                                p.pr_number || '—'
                              }</td>
                              <td style="padding:9px 10px;text-align:right;font-weight:700;color:#0369a1;">₱${Number(
                                p.amount
                              ).toLocaleString()}</td>
                              <td style="padding:9px 10px;color:#0284c7;font-weight:600;">ONLINE</td>
                              <td style="padding:9px 10px;color:#475569;">${
                                p.notes || '—'
                              }</td>
                            </tr>
                          `;
                          })
                          .join('')}
                      </tbody>
                    </table>
                  </div>
                </div>
                `
                    : ''
                }

                <!-- ===== FOOTER ===== -->
                <div style="padding:28px 32px 32px 32px;margin-top:24px;text-align:center;border-top:1px solid #e2e8f0;">
                  <p style="margin:0 0 4px 0;color:#94a3b8;font-size:11px;font-weight:600;letter-spacing:1px;">ECONO PHARMA TRADING</p>
                  <p style="margin:0;color:#cbd5e1;font-size:10px;">Generated automatically • ${new Date().toLocaleString(
                    'en-PH',
                    { timeZone: 'Asia/Manila' }
                  )}</p>
                </div>

              </div>
            </body>
            </html>

        `;

          try {
            await resend.emails.send({
              from: 'Econo Drugstore <stock@alerts.econo-pos.com>',
              to: emailList, // ← Now supports multiple emails
              subject: `📊 Daily Report (End of Day) - ${reportDate} | ${b.branch_name}`,
              html: emailHtml,
            });
            console.log(`✅ Daily Report sent to: ${emailList.join(', ')}`);
          } catch (err: any) {
            console.error('Email failed:', err);
          }
        }
      }

      console.log('✅ Office branch emails done.');
      return NextResponse.json({ success: true, message: 'Office daily email sent' });
    }

    // ==================== DRUGSTORE EMAIL (11PM PHT) - NON-OFFICE BRANCHES ====================
    if (type === 'DRUGSTORE_EMAIL') {
      console.log('📧 Starting Drugstore Email Report (11PM PHT) - Non-Office Branches');

      const { data: orgsForEmail } = await supabaseAdmin
        .from('organizations')
        .select('id, name, owner_email')
        .not('owner_email', 'is', null);

      // ── NON-OFFICE BRANCHES — CONSOLIDATED DAILY EMAIL ──
      for (const org of orgsForEmail || []) {
        const rawEmail = org.owner_email?.trim();
        if (!rawEmail) continue;

        const emailList: string[] = rawEmail
          .split(',')
          .map((e: string) => e.trim())
          .filter((e: string) => e.includes('@'));
        if (emailList.length === 0) continue;

        const { data: nonOfficeBranchesRaw } = await supabaseAdmin
          .from('branches')
          .select('*')
          .eq('org_id', org.id)
          .eq('is_office_use', false);

        const nonOfficeBranches = (nonOfficeBranchesRaw || []).filter(
          (b: any) => b.test_env !== true && b.is_office_use === false
        );

        if (!nonOfficeBranches || nonOfficeBranches.length === 0) continue;

        const reportDate = todayPHT;

        const fmt = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

        let consolidatedHtml = `
          <!DOCTYPE html>
          <html lang="en">
          <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
          <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
          <div style="max-width:1100px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
            <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 60%,#0f4c75 100%);padding:36px 32px 28px 32px;text-align:center;">
              <div style="display:inline-block;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:6px 18px;margin-bottom:16px;">
                <span style="color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">DAILY CONSOLIDATED REPORT</span>
              </div>
              <h1 style="margin:0 0 6px 0;color:#ffffff;font-size:26px;font-weight:800;">${org.name.toUpperCase()}</h1>
              <p style="margin:0;color:#64748b;font-size:14px;">${reportDate}</p>
            </div>

            <div style="padding:28px 32px;">
              <div style="overflow-x:auto;border-radius:10px;border:1px solid #e2e8f0;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:900px;">
                  <thead>
                    <tr style="background:#1e293b;color:#94a3b8;text-align:left;">
                      <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Branch</th>
                      <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Generic</th>
                      <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Branded</th>
                      <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Discount</th>
                      <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Total Sales</th>
                      <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Expenses</th>
                      <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;background:#064e3b;color:#34d399;">Actual</th>
                      <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Generic Quota</th>
                      <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:center;">Generic %</th>
                      <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">User (Login)</th>
                    </tr>
                  </thead>
                  <tbody>
        `;

        // Accumulate totals across all branches
        let grandGen = 0, grandBrd = 0, grandDisc = 0, grandTotal = 0, grandExp = 0, grandActual = 0, grandQuota = 0;

        for (const b of nonOfficeBranches) {
          const { data: branchOrders } = await supabaseAdmin
            .from('orders')
            .select('id, total_amount, client_name, agent, order_number, dr_number')
            .eq('branch_id', b.id)
            .eq('created_date_pht', reportDate);

          const { data: branchReport } = await supabaseAdmin
            .from('daily_reports')
            .select('generic_sales, branded_sales, discount_total, reported_by')
            .eq('branch_id', b.id)
            .eq('report_date', reportDate)
            .single();

          const { data: branchExpenses } = await supabaseAdmin
            .from('daily_expenses')
            .select('amount')
            .eq('branch_id', b.id)
            .eq('report_date', reportDate);

          // Fetch earliest login per user after 4AM PHT
          const reportDateObj = new Date(reportDate + 'T00:00:00+08:00');
          const after4amUTC = new Date(reportDateObj.getTime() - 4 * 60 * 60 * 1000);
          const endOfDayUTC = new Date(reportDateObj.getTime() + 16 * 60 * 60 * 1000);

          const { data: branchLogs } = await supabaseAdmin
            .from('system_logs')
            .select('user_email, user_name, created_at')
            .eq('branch_id', b.id)
            .eq('event_type', 'LOGIN')
            .gte('created_at', after4amUTC.toISOString())
            .lte('created_at', endOfDayUTC.toISOString())
            .order('created_at', { ascending: true });

          const userLoginMap = new Map<string, { name: string; loginTime: string }>();
          (branchLogs || []).forEach((log: any) => {
            const email = log.user_email || '';
            if (!userLoginMap.has(email)) {
              const localTime = new Date(log.created_at).toLocaleString('en-PH', {
                timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: true,
              });
              userLoginMap.set(email, { name: log.user_name || email, loginTime: localTime });
            }
          });
          const userLogins = Array.from(userLoginMap.values());

          const gen = Number(branchReport?.generic_sales || 0);
          const brd = Number(branchReport?.branded_sales || 0);
          const disc = Number(branchReport?.discount_total || 0);
          const totalSales = gen + brd - disc;
          const totalExp = (branchExpenses || []).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
          const actual = totalSales - totalExp;

          // Quota = branch daily_generic_quota from branches table
          const branchQuota = Number(b.daily_generic_quota || 0);
          // % = generic net (generic_sales - discount) vs generic quota
          const genericNet = gen - disc;
          const pct = branchQuota > 0 ? (genericNet / branchQuota) * 100 : 0;
          const pctColor = pct >= 100 ? '#16a34a' : pct >= 75 ? '#d97706' : '#dc2626';

          grandGen += gen; grandBrd += brd; grandDisc += disc;
          grandTotal += totalSales; grandExp += totalExp; grandActual += actual;
          grandQuota += branchQuota;

          const reportedBy = branchReport?.reported_by?.trim() || null;

          const userCell = (() => {
            const parts: string[] = [];
            // Login entries from system_logs
            userLogins.forEach(u => {
              parts.push(`<div style="white-space:nowrap;"><span style="color:#6366f1;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-right:4px;">LOGIN</span><span style="font-weight:600;color:#111827;">${u.name}</span> <span style="color:#94a3b8;font-size:10px;">(${u.loginTime})</span></div>`);
            });
            // Reported by from daily_reports
            if (reportedBy) {
              parts.push(`<div style="white-space:nowrap;margin-top:${parts.length > 0 ? '4px' : '0'};"><span style="color:#10b981;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-right:4px;">REPORT</span><span style="font-weight:600;color:#111827;">${reportedBy}</span></div>`);
            }
            return parts.length > 0 ? parts.join('') : '<span style="color:#94a3b8;">—</span>';
          })();

          consolidatedHtml += `
                    <tr style="border-bottom:1px solid #f1f5f9;">
                      <td style="padding:10px 12px;font-weight:700;color:#1e293b;">${b.branch_name}</td>
                      <td style="padding:10px 12px;text-align:right;font-family:monospace;color:#3b82f6;">${fmt(gen)}</td>
                      <td style="padding:10px 12px;text-align:right;font-family:monospace;color:#9333ea;">${fmt(brd)}</td>
                      <td style="padding:10px 12px;text-align:right;font-family:monospace;color:#e11d48;">${disc > 0 ? '- ' + fmt(disc) : '—'}</td>
                      <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:700;color:#111827;">${fmt(totalSales)}</td>
                      <td style="padding:10px 12px;text-align:right;font-family:monospace;color:#dc2626;">${totalExp > 0 ? '- ' + fmt(totalExp) : '—'}</td>
                      <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:900;color:#16a34a;background:#f0fdf4;">${fmt(actual)}</td>
                      <td style="padding:10px 12px;text-align:right;font-family:monospace;color:#64748b;">${branchQuota > 0 ? fmt(branchQuota) : '—'}</td>
                      <td style="padding:10px 12px;text-align:center;font-weight:700;color:${branchQuota > 0 ? pctColor : '#94a3b8'};">${branchQuota > 0 ? pct.toFixed(1) + '%' : '—'}</td>
                      <td style="padding:10px 12px;">${userCell}</td>
                    </tr>
          `;
        } // end branch loop

        const grandGenericNet = grandGen - grandDisc;
        const grandPct = grandQuota > 0 ? (grandGenericNet / grandQuota) * 100 : 0;

        consolidatedHtml += `
                    <!-- GRAND TOTAL ROW -->
                    <tr style="background:#1e293b;border-top:2px solid #475569;">
                      <td style="padding:11px 12px;font-weight:900;color:#ffffff;font-size:11px;text-transform:uppercase;letter-spacing:1px;">TOTAL</td>
                      <td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:800;color:#93c5fd;">${fmt(grandGen)}</td>
                      <td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:800;color:#c4b5fd;">${fmt(grandBrd)}</td>
                      <td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:800;color:#fca5a5;">- ${fmt(grandDisc)}</td>
                      <td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:800;color:#ffffff;">${fmt(grandTotal)}</td>
                      <td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:800;color:#fca5a5;">${grandExp > 0 ? '- ' + fmt(grandExp) : '—'}</td>
                      <td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:900;color:#34d399;background:#064e3b;">${fmt(grandActual)}</td>
                      <td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:800;color:#94a3b8;">${grandQuota > 0 ? fmt(grandQuota) : '—'}</td>
                      <td style="padding:11px 12px;text-align:center;font-weight:800;color:${grandQuota > 0 ? (grandPct >= 100 ? '#34d399' : grandPct >= 75 ? '#fcd34d' : '#fca5a5') : '#94a3b8'};">${grandQuota > 0 ? grandPct.toFixed(1) + '%' : '—'}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div style="padding:24px 32px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 4px 0;color:#94a3b8;font-size:11px;font-weight:600;letter-spacing:1px;">ECONO PHARMA TRADING</p>
              <p style="margin:0;color:#cbd5e1;font-size:10px;">Generated automatically • ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p>
            </div>
          </div></body></html>
        `;



        try {
          await resend.emails.send({
            from: 'Econo Drugstore <stock@alerts.econo-pos.com>',
            to: emailList,
            subject: `📦 Daily Branch Report - ${reportDate} | ${org.name}`,
            html: consolidatedHtml,
          });
          console.log(`✅ Non-office consolidated email sent to ${emailList.join(', ')} (${org.name})`);
        } catch (err: any) {
          console.error(`❌ Non-office email failed for ${org.name}:`, err);
        }
      } // end non-office org loop

      return NextResponse.json({ success: true, message: 'Drugstore daily email sent' });
    }

    // ==================== DRUGSTORE WEEKLY EMAIL (11PM SAT PHT) - NON-OFFICE BRANCHES ====================
    if (type === 'DRUGSTORE_EMAIL_WEEKLY') {
      console.log('📧 Starting Drugstore Weekly Email (11PM SAT PHT) - Non-Office Branches');

      const { data: orgsW } = await supabaseAdmin
        .from('organizations')
        .select('id, name, owner_email')
        .not('owner_email', 'is', null);

      // Week range: Sunday–Saturday ending today (PHT)
      const todayW = new Date(todayPHT + 'T00:00:00+08:00');
      const sunday = new Date(todayW);
      sunday.setDate(todayW.getDate() - todayW.getDay());
      const weekDates: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(sunday);
        d.setDate(sunday.getDate() + i);
        weekDates.push(d.toISOString().split('T')[0]);
      }
      const weekStart = weekDates[0];
      const weekEnd = weekDates[6];
      const fmt = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

      for (const org of orgsW || []) {
        if (!org.owner_email) continue;
        const emailList = org.owner_email.split(',').map((e: string) => e.trim()).filter((e: string) => e.includes('@'));
        if (emailList.length === 0) continue;

        const { data: nonOfficeBranchesRaw } = await supabaseAdmin
          .from('branches')
          .select('*')
          .eq('org_id', org.id)
          .eq('is_office_use', false);

        const nonOfficeBranches = (nonOfficeBranchesRaw || []).filter(
          (b: any) => b.test_env !== true && b.is_office_use === false
        );
        if (!nonOfficeBranches || nonOfficeBranches.length === 0) continue;

        // ── Per-branch data ──
        // For TABLE 1 (cash vs PO) and TABLE 2 (branch summary) and TABLE 3 (PO per branch per supplier)
        type BranchWeekData = {
          branch: any;
          gen: number; brd: number; disc: number; totalSales: number;
          totalExp: number; actual: number; quota: number;
          poTotal: number;
          poBySupplier: Map<string, { generic: number; branded: number; total: number; count: number }>;
          users: string[];
        };

        const branchDataList: BranchWeekData[] = [];

        for (const b of nonOfficeBranches) {
          // Daily reports for the week
          const { data: reports } = await supabaseAdmin
            .from('daily_reports')
            .select('generic_sales, branded_sales, discount_total, expenses')
            .eq('branch_id', b.id)
            .in('report_date', weekDates);

          const gen = (reports || []).reduce((s, r: any) => s + Number(r.generic_sales || 0), 0);
          const brd = (reports || []).reduce((s, r: any) => s + Number(r.branded_sales || 0), 0);
          const disc = (reports || []).reduce((s, r: any) => s + Number(r.discount_total || 0), 0);
          const totalSales = gen + brd - disc;

          const { data: expensesW } = await supabaseAdmin
            .from('daily_expenses')
            .select('amount')
            .eq('branch_id', b.id)
            .in('report_date', weekDates);
          const totalExp = (expensesW || []).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
          const actual = totalSales - totalExp;

          // Purchase orders for the week
          const { data: posData } = await supabaseAdmin
            .from('purchase_orders')
            .select('supplier_name, total_amount, generic_amt, branded_amt, created_by')
            .eq('branch_id', b.id)
            .in('created_date_pht', weekDates);

          const poTotal = (posData || []).reduce((s: number, p: any) => s + Number(p.total_amount || 0), 0);

          // Group POs by supplier
          const poBySupplier = new Map<string, { generic: number; branded: number; total: number; count: number }>();
          (posData || []).forEach((p: any) => {
            const sup = p.supplier_name || 'UNKNOWN';
            const ex = poBySupplier.get(sup) || { generic: 0, branded: 0, total: 0, count: 0 };
            poBySupplier.set(sup, {
              generic: ex.generic + Number(p.generic_amt || 0),
              branded: ex.branded + Number(p.branded_amt || 0),
              total: ex.total + Number(p.total_amount || 0),
              count: ex.count + 1,
            });
          });

          // Unique users (system_logs logins for the week)
          const { data: weekLogs } = await supabaseAdmin
            .from('system_logs')
            .select('user_name, user_email')
            .eq('branch_id', b.id)
            .eq('event_type', 'LOGIN')
            .in('created_date_pht', weekDates);

          const uniqueUsers = [...new Set((weekLogs || []).map((l: any) => l.user_name || l.user_email).filter(Boolean))];

          const quota = Number(b.daily_generic_quota || 0) * 6; // weekly quota = daily * 6 working days

          branchDataList.push({ branch: b, gen, brd, disc, totalSales, totalExp, actual, quota, poTotal, poBySupplier, users: uniqueUsers });
        } // end per-branch loop

        // ── Grand totals ──
        const grandGen = branchDataList.reduce((s, d) => s + d.gen, 0);
        const grandBrd = branchDataList.reduce((s, d) => s + d.brd, 0);
        const grandDisc = branchDataList.reduce((s, d) => s + d.disc, 0);
        const grandTotal = branchDataList.reduce((s, d) => s + d.totalSales, 0);
        const grandExp = branchDataList.reduce((s, d) => s + d.totalExp, 0);
        const grandActual = branchDataList.reduce((s, d) => s + d.actual, 0);
        const grandQuota = branchDataList.reduce((s, d) => s + d.quota, 0);
        const grandPO = branchDataList.reduce((s, d) => s + d.poTotal, 0);
        const grandNet = grandActual - grandPO;
        const grandGenNet = grandGen - grandDisc;
        const grandPct = grandQuota > 0 ? (grandGenNet / grandQuota) * 100 : 0;

        // ════════════════════════════════════
        // BUILD EMAIL HTML
        // ════════════════════════════════════
        let html = `
          <!DOCTYPE html>
          <html lang="en">
          <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
          <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
          <div style="max-width:1100px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">

            <!-- HEADER -->
            <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 60%,#0f4c75 100%);padding:36px 32px 28px 32px;text-align:center;">
              <div style="display:inline-block;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:6px 18px;margin-bottom:16px;">
                <span style="color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">WEEKLY CONSOLIDATED REPORT</span>
              </div>
              <h1 style="margin:0 0 6px 0;color:#ffffff;font-size:26px;font-weight:800;">${org.name.toUpperCase()}</h1>
              <p style="margin:0;color:#64748b;font-size:14px;">${weekStart} — ${weekEnd}</p>
            </div>

            <div style="padding:28px 32px;">

              <!-- ══════ TABLE 1: CASH vs PURCHASE ORDERS ══════ -->
              <div style="margin-bottom:32px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
                  <div style="width:4px;height:20px;background:#10b981;border-radius:2px;"></div>
                  <span style="font-size:11px;font-weight:800;letter-spacing:3px;color:#64748b;text-transform:uppercase;">Cash vs Stock Spending</span>
                </div>
                <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
                  <div style="flex:1;min-width:140px;background:#f0fdf4;border:2px solid #86efac;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:10px;font-weight:700;color:#16a34a;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">💰 Actual Cash</div>
                    <div style="font-size:22px;font-weight:900;color:#14532d;font-family:monospace;">${fmt(grandActual)}</div>
                    <div style="font-size:10px;color:#64748b;margin-top:4px;">Total Sales − Expenses</div>
                  </div>
                  <div style="flex:1;min-width:140px;background:#fef2f2;border:2px solid #fca5a5;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:10px;font-weight:700;color:#dc2626;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">📦 Purchase Orders</div>
                    <div style="font-size:22px;font-weight:900;color:#991b1b;font-family:monospace;">${fmt(grandPO)}</div>
                    <div style="font-size:10px;color:#64748b;margin-top:4px;">Total Stock Spending</div>
                  </div>
                  <div style="flex:1;min-width:140px;background:${grandNet >= 0 ? '#f0fdf4' : '#fef2f2'};border:2px solid ${grandNet >= 0 ? '#10b981' : '#ef4444'};border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:10px;font-weight:700;color:${grandNet >= 0 ? '#16a34a' : '#dc2626'};letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">📊 Net Position</div>
                    <div style="font-size:22px;font-weight:900;color:${grandNet >= 0 ? '#14532d' : '#991b1b'};font-family:monospace;">${fmt(grandNet)}</div>
                    <div style="font-size:10px;color:#64748b;margin-top:4px;">Cash − Stock Spending</div>
                  </div>
                </div>
                <!-- per-branch cash vs PO breakdown -->
                <div style="overflow-x:auto;border-radius:10px;border:1px solid #e2e8f0;">
                  <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead>
                      <tr style="background:#1e293b;color:#94a3b8;text-align:left;">
                        <th style="padding:9px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Branch</th>
                        <th style="padding:9px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;background:#064e3b;color:#34d399;">Actual Cash</th>
                        <th style="padding:9px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Purchase Orders</th>
                        <th style="padding:9px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${branchDataList.map((d, i) => {
                        const net = d.actual - d.poTotal;
                        const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
                        return `<tr style="background:${rowBg};border-bottom:1px solid #f1f5f9;">
                          <td style="padding:9px 12px;font-weight:700;color:#1e293b;">${d.branch.branch_name}</td>
                          <td style="padding:9px 12px;text-align:right;font-family:monospace;font-weight:800;color:#16a34a;background:#f0fdf4;">${fmt(d.actual)}</td>
                          <td style="padding:9px 12px;text-align:right;font-family:monospace;color:#dc2626;">${d.poTotal > 0 ? fmt(d.poTotal) : '—'}</td>
                          <td style="padding:9px 12px;text-align:right;font-family:monospace;font-weight:700;color:${net >= 0 ? '#16a34a' : '#dc2626'};">${fmt(net)}</td>
                        </tr>`;
                      }).join('')}
                      <tr style="background:#1e293b;">
                        <td style="padding:10px 12px;font-weight:900;color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:1px;">TOTAL</td>
                        <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:900;color:#34d399;background:#064e3b;">${fmt(grandActual)}</td>
                        <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:800;color:#fca5a5;">${grandPO > 0 ? fmt(grandPO) : '—'}</td>
                        <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:900;color:${grandNet >= 0 ? '#34d399' : '#fca5a5'};">${fmt(grandNet)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- ══════ TABLE 2: BRANCH WEEKLY SUMMARY ══════ -->
              <div style="margin-bottom:32px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
                  <div style="width:4px;height:20px;background:#6366f1;border-radius:2px;"></div>
                  <span style="font-size:11px;font-weight:800;letter-spacing:3px;color:#64748b;text-transform:uppercase;">Weekly Branch Summary</span>
                </div>
                <div style="overflow-x:auto;border-radius:10px;border:1px solid #e2e8f0;">
                  <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:900px;">
                    <thead>
                      <tr style="background:#1e293b;color:#94a3b8;text-align:left;">
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Branch</th>
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Generic</th>
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Branded</th>
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Discount</th>
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Total Sales</th>
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Expenses</th>
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;background:#064e3b;color:#34d399;">Actual</th>
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Generic Quota</th>
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:center;">Generic %</th>
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Users</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${branchDataList.map((d, i) => {
                        const genericNet = d.gen - d.disc;
                        const pct = d.quota > 0 ? (genericNet / d.quota) * 100 : 0;
                        const pctColor = pct >= 100 ? '#16a34a' : pct >= 75 ? '#d97706' : '#dc2626';
                        const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
                        return `<tr style="background:${rowBg};border-bottom:1px solid #f1f5f9;">
                          <td style="padding:10px 12px;font-weight:700;color:#1e293b;">${d.branch.branch_name}</td>
                          <td style="padding:10px 12px;text-align:right;font-family:monospace;color:#3b82f6;">${fmt(d.gen)}</td>
                          <td style="padding:10px 12px;text-align:right;font-family:monospace;color:#9333ea;">${fmt(d.brd)}</td>
                          <td style="padding:10px 12px;text-align:right;font-family:monospace;color:#e11d48;">${d.disc > 0 ? '- ' + fmt(d.disc) : '—'}</td>
                          <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:700;color:#111827;">${fmt(d.totalSales)}</td>
                          <td style="padding:10px 12px;text-align:right;font-family:monospace;color:#dc2626;">${d.totalExp > 0 ? '- ' + fmt(d.totalExp) : '—'}</td>
                          <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:900;color:#16a34a;background:#f0fdf4;">${fmt(d.actual)}</td>
                          <td style="padding:10px 12px;text-align:right;font-family:monospace;color:#64748b;">${d.quota > 0 ? fmt(d.quota) : '—'}</td>
                          <td style="padding:10px 12px;text-align:center;font-weight:700;color:${d.quota > 0 ? pctColor : '#94a3b8'};">${d.quota > 0 ? pct.toFixed(1) + '%' : '—'}</td>
                          <td style="padding:10px 12px;color:#374151;font-size:11px;">${d.users.length > 0 ? d.users.join(', ') : '—'}</td>
                        </tr>`;
                      }).join('')}
                      <tr style="background:#1e293b;border-top:2px solid #475569;">
                        <td style="padding:11px 12px;font-weight:900;color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:1px;">TOTAL</td>
                        <td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:800;color:#93c5fd;">${fmt(grandGen)}</td>
                        <td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:800;color:#c4b5fd;">${fmt(grandBrd)}</td>
                        <td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:800;color:#fca5a5;">${grandDisc > 0 ? '- ' + fmt(grandDisc) : '—'}</td>
                        <td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:800;color:#fff;">${fmt(grandTotal)}</td>
                        <td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:800;color:#fca5a5;">${grandExp > 0 ? '- ' + fmt(grandExp) : '—'}</td>
                        <td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:900;color:#34d399;background:#064e3b;">${fmt(grandActual)}</td>
                        <td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:800;color:#94a3b8;">${grandQuota > 0 ? fmt(grandQuota) : '—'}</td>
                        <td style="padding:11px 12px;text-align:center;font-weight:800;color:${grandQuota > 0 ? (grandPct >= 100 ? '#34d399' : grandPct >= 75 ? '#fcd34d' : '#fca5a5') : '#94a3b8'};">${grandQuota > 0 ? grandPct.toFixed(1) + '%' : '—'}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- ══════ TABLE 3: PURCHASE ORDERS PER BRANCH PER SUPPLIER ══════ -->
              <div style="margin-bottom:16px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
                  <div style="width:4px;height:20px;background:#f97316;border-radius:2px;"></div>
                  <span style="font-size:11px;font-weight:800;letter-spacing:3px;color:#64748b;text-transform:uppercase;">Purchase Orders by Branch & Supplier</span>
                </div>
                <div style="overflow-x:auto;border-radius:10px;border:1px solid #fed7aa;">
                  <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead>
                      <tr style="background:#1e293b;color:#94a3b8;text-align:left;">
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Branch</th>
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Supplier</th>
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:center;"># POs</th>
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Generic</th>
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Branded</th>
                        <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:right;">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${branchDataList.map((d) => {
                        if (d.poBySupplier.size === 0) return '';
                        const suppliers = Array.from(d.poBySupplier.entries())
                          .map(([sup, v]) => ({ sup, ...v }))
                          .sort((a, b) => b.total - a.total);
                        const branchPOTotal = suppliers.reduce((s, r) => s + r.total, 0);
                        return suppliers.map((s, i) => `
                          <tr style="background:${i % 2 === 0 ? '#fff7ed' : '#ffffff'};border-bottom:1px solid #fed7aa;">
                            <td style="padding:9px 12px;font-weight:${i === 0 ? '700' : '400'};color:${i === 0 ? '#1e293b' : '#94a3b8'};">${i === 0 ? d.branch.branch_name : ''}</td>
                            <td style="padding:9px 12px;font-weight:600;color:#111827;">${s.sup}</td>
                            <td style="padding:9px 12px;text-align:center;color:#64748b;">${s.count}</td>
                            <td style="padding:9px 12px;text-align:right;font-family:monospace;color:#3b82f6;">${s.generic > 0 ? fmt(s.generic) : '—'}</td>
                            <td style="padding:9px 12px;text-align:right;font-family:monospace;color:#9333ea;">${s.branded > 0 ? fmt(s.branded) : '—'}</td>
                            <td style="padding:9px 12px;text-align:right;font-family:monospace;font-weight:700;color:#f97316;">${fmt(s.total)}</td>
                          </tr>
                        `).join('') + `
                          <tr style="background:#fff3e0;border-bottom:2px solid #fdba74;">
                            <td style="padding:8px 12px;font-weight:800;color:#ea580c;font-size:10px;text-transform:uppercase;" colspan="2">${d.branch.branch_name} — Subtotal</td>
                            <td style="padding:8px 12px;text-align:center;color:#64748b;font-weight:700;">${suppliers.reduce((s, r) => s + r.count, 0)}</td>
                            <td style="padding:8px 12px;text-align:right;font-family:monospace;font-weight:700;color:#3b82f6;">${fmt(suppliers.reduce((s, r) => s + r.generic, 0))}</td>
                            <td style="padding:8px 12px;text-align:right;font-family:monospace;font-weight:700;color:#9333ea;">${fmt(suppliers.reduce((s, r) => s + r.branded, 0))}</td>
                            <td style="padding:8px 12px;text-align:right;font-family:monospace;font-weight:800;color:#ea580c;">${fmt(branchPOTotal)}</td>
                          </tr>
                        `;
                      }).join('')}
                      <tr style="background:#1e293b;">
                        <td colspan="5" style="padding:10px 12px;font-weight:900;color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:1px;">GRAND TOTAL</td>
                        <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:900;color:#fb923c;">${fmt(grandPO)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

            </div>

            <div style="padding:24px 32px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 4px 0;color:#94a3b8;font-size:11px;font-weight:600;letter-spacing:1px;">ECONO PHARMA TRADING</p>
              <p style="margin:0;color:#cbd5e1;font-size:10px;">Generated automatically • ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p>
            </div>
          </div></body></html>
        `;

        try {
          await resend.emails.send({
            from: 'Econo Drugstore <stock@alerts.econo-pos.com>',
            to: emailList,
            subject: `📦 Weekly Branch Report - ${weekStart} to ${weekEnd} | ${org.name}`,
            html,
          });
          console.log(`✅ Drugstore weekly email sent to ${emailList.join(', ')} (${org.name})`);
        } catch (err: any) {
          console.error(`❌ Drugstore weekly email failed for ${org.name}:`, err);
        }
      } // end org loop

      return NextResponse.json({ success: true, message: `Drugstore weekly email sent for ${weekStart} to ${weekEnd}` });
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

        // Only office branches, exclude test environments
        const { data: officeBranchesRaw } = await supabaseAdmin
          .from('branches')
          .select('*')
          .eq('org_id', org.id)
          .eq('is_office_use', true);

        const officeBranches = (officeBranchesRaw || []).filter(
          (b: any) => b.test_env !== true
        );

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
            { data: purchaseOrdersData },
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

            supabaseAdmin
              .from('purchase_orders')
              .select('id, supplier_name, po_number, invoice_id, total_amount, generic_amt, branded_amt, created_date_pht, status, is_checked, notes, created_by')
              .eq('branch_id', b.id)
              .in('created_date_pht', weekDates)
              .order('created_date_pht', { ascending: true }),
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

          // ── Purchase Orders ──
          const poTotal = (purchaseOrdersData || []).reduce((s: number, p: any) => s + Number(p.total_amount || 0), 0);
          const poGenTotal = (purchaseOrdersData || []).reduce((s: number, p: any) => s + Number(p.generic_amt || 0), 0);
          const poBrdTotal = (purchaseOrdersData || []).reduce((s: number, p: any) => s + Number(p.branded_amt || 0), 0);

          // Resolve created_by UUIDs to full names
          const poUserIds = [...new Set((purchaseOrdersData || []).map((p: any) => p.created_by).filter(Boolean))];
          const poUserNameMap: Record<string, string> = {};
          if (poUserIds.length > 0) {
            const { data: poProfiles } = await supabaseAdmin
              .from('profiles')
              .select('id, full_name')
              .in('id', poUserIds);
            (poProfiles || []).forEach((pr: any) => {
              if (pr.id && pr.full_name) poUserNameMap[pr.id] = pr.full_name.trim();
            });
          }

          // Group POs by supplier, sorted by total desc
          const poBySupplier = new Map<string, { generic: number; branded: number; total: number; count: number; allChecked: boolean; hasReceived: boolean; inputBy: Set<string> }>();
          (purchaseOrdersData || []).forEach((p: any) => {
            const supplier = p.supplier_name || 'UNKNOWN';
            const ex = poBySupplier.get(supplier) || { generic: 0, branded: 0, total: 0, count: 0, allChecked: true, hasReceived: false, inputBy: new Set<string>() };
            const inputName = poUserNameMap[p.created_by] || p.created_by || 'UNKNOWN';
            ex.inputBy.add(inputName);
            poBySupplier.set(supplier, {
              generic: ex.generic + Number(p.generic_amt || 0),
              branded: ex.branded + Number(p.branded_amt || 0),
              total: ex.total + Number(p.total_amount || 0),
              count: ex.count + 1,
              allChecked: ex.allChecked && !!p.is_checked,
              hasReceived: ex.hasReceived || p.status === 'RECEIVED',
              inputBy: ex.inputBy,
            });
          });
          const poRows = Array.from(poBySupplier.entries())
            .map(([supplier, v]) => ({ supplier, ...v, inputBy: Array.from(v.inputBy).join(', ') || '—' }))
            .sort((a, b) => b.total - a.total);

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

              <!-- CASH vs STOCKS SUMMARY -->
              <table style="width:100%; border-collapse:collapse; margin-bottom:28px;">
                <tr>
                  <td style="padding:4px;">
                    <div style="background:#064e3b; border:1px solid #10b981; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#10b981; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">💰 MONEY COMING IN</div>
                      <div style="color:#10b981; font-size:22px; font-weight:900; font-family:monospace;">${fmt(weekActualCash)}</div>
                      <div style="color:#64748b; font-size:10px; margin-top:4px;">Net Cash − Expenses</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:#450a0a; border:1px solid #ef4444; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#f87171; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">📦 MONEY FOR STOCKS</div>
                      <div style="color:#f87171; font-size:22px; font-weight:900; font-family:monospace;">${fmt(poTotal)}</div>
                      <div style="color:#64748b; font-size:10px; margin-top:4px;">Total Purchase Orders</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:${weekActualCash - poTotal >= 0 ? '#064e3b' : '#450a0a'}; border:2px solid ${weekActualCash - poTotal >= 0 ? '#10b981' : '#ef4444'}; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:${weekActualCash - poTotal >= 0 ? '#10b981' : '#f87171'}; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">📊 NET POSITION</div>
                      <div style="color:${weekActualCash - poTotal >= 0 ? '#10b981' : '#f87171'}; font-size:22px; font-weight:900; font-family:monospace;">${fmt(weekActualCash - poTotal)}</div>
                      <div style="color:#64748b; font-size:10px; margin-top:4px;">Cash − Stock Spending</div>
                    </div>
                  </td>
                </tr>
              </table>

              ${poRows.length > 0 ? `
              <!-- PURCHASE ORDERS -->
              <h3 style="color:#f97316; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:0 0 12px 0;">🧾 Purchase Orders This Week</h3>
              <div style="overflow-x:auto; margin-bottom:28px;">
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                  <thead>
                    <tr>
                      <th ${thL}>Supplier</th>
                      <th style="padding:10px 12px; text-align:center; background:#1e293b; color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:1px;"># POs</th>
                      <th ${thR}>Generic</th>
                      <th ${thR}>Branded</th>
                      <th ${thR}>Total</th>
                      <th ${thL}>Input By</th>
                      <th style="padding:10px 12px; text-align:center; background:#1e293b; color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:1px;">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${poRows.map((p: any, i: number) => {
                      const row = i % 2 === 0 ? trNorm : trAlt;
                      const status = p.allChecked
                        ? '<span style="color:#10b981;font-size:10px;font-weight:700;">✓ ALL CHECKED</span>'
                        : p.hasReceived
                        ? '<span style="color:#60a5fa;font-size:10px;font-weight:700;">RECEIVED</span>'
                        : '<span style="color:#f97316;font-size:10px;font-weight:700;">PENDING</span>';
                      return `<tr ${row}>
                        <td ${tdL} style="padding:8px 12px; font-weight:700; color:#e2e8f0;">${p.supplier}</td>
                        <td style="padding:8px 12px; text-align:center; font-family:monospace; color:#94a3b8;">${p.count}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#6ee7b7;">${p.generic > 0 ? fmt(p.generic) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#c4b5fd;">${p.branded > 0 ? fmt(p.branded) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#f97316; font-weight:900;">${fmt(p.total)}</td>
                        <td ${tdL} style="padding:8px 12px; color:#94a3b8; font-size:11px;">${p.inputBy}</td>
                        <td style="padding:8px 12px; text-align:center;">${status}</td>
                      </tr>`;
                    }).join('')}
                    <tr style="background:#1e293b; border-top:2px solid #475569;">
                      <td ${tdL} style="padding:10px 12px; font-weight:900; color:#f97316; font-size:11px; text-transform:uppercase; letter-spacing:1px;">TOTAL</td>
                      <td style="padding:10px 12px; text-align:center; font-family:monospace; color:#94a3b8; font-weight:900;">${poRows.reduce((s: number, r: any) => s + r.count, 0)}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#6ee7b7; font-weight:900;">${fmt(poGenTotal)}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#c4b5fd; font-weight:900;">${fmt(poBrdTotal)}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#f97316; font-weight:900;">${fmt(poTotal)}</td>
                      <td></td><td></td>
                    </tr>
                  </tbody>
                </table>
              </div>` : ''}

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
    // ==================== MONTHLY EMAIL REPORT (LAST DAY OF MONTH) - OFFICE BRANCHES ====================
    if (type === 'MONTHLY_EMAIL') {
      console.log('📧 Starting Monthly Email Report - Office Branches Only');

      const { data: monthlyOrgs } = await supabaseAdmin
        .from('organizations')
        .select('id, name, owner_email')
        .not('owner_email', 'is', null);

      // Compute the full month range: first day → last day of current month (PHT)
      const todayDateM = new Date(todayPHT);
      const monthStart = new Date(todayDateM.getFullYear(), todayDateM.getMonth(), 1)
        .toISOString().split('T')[0];
      const monthEnd = todayPHT; // last day of month (cron fires on last day)
      const monthLabel = todayDateM.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      // Build array of all dates in the month
      const monthDates: string[] = [];
      const cursor = new Date(monthStart + 'T00:00:00');
      const endDate = new Date(monthEnd + 'T00:00:00');
      while (cursor <= endDate) {
        monthDates.push(cursor.toISOString().split('T')[0]);
        cursor.setDate(cursor.getDate() + 1);
      }

      for (const org of monthlyOrgs || []) {
        if (!org.owner_email) continue;

        const { data: officeBranchesRaw } = await supabaseAdmin
          .from('branches')
          .select('*')
          .eq('org_id', org.id)
          .eq('is_office_use', true);

        const officeBranches = (officeBranchesRaw || []).filter(
          (b: any) => b.test_env !== true
        );

        if (!officeBranches || officeBranches.length === 0) {
          console.log(`⏭️ ${org.name} has no office branches, skipping monthly email`);
          continue;
        }

        let emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 1000px; margin: 0 auto; padding: 30px; background: #0f172a; color: #e2e8f0;">
            <h1 style="color: #f59e0b; text-align: center; margin-bottom: 4px;">📆 Monthly Report</h1>
            <p style="text-align:center; color:#64748b; margin:0 0 4px 0; font-size:16px;">${org.name}</p>
            <p style="text-align:center; color:#94a3b8; margin:0 0 24px 0; font-size:14px;">${monthLabel} • ${monthStart} — ${monthEnd}</p>
            <hr style="border: 1px solid #334155; margin-bottom: 30px;">
        `;

        for (const b of officeBranches) {
          const [
            { data: reportsData },
            { data: ordersData },
            { data: paymentsData },
            { data: expensesData },
            { data: profilesData },
            { data: purchaseOrdersData },
          ] = await Promise.all([
            supabaseAdmin
              .from('daily_reports')
              .select('*')
              .eq('branch_id', b.id)
              .in('report_date', monthDates),

            supabaseAdmin
              .from('orders')
              .select('id, total_amount, client_name, created_date_pht, agent, order_number, dr_number')
              .eq('branch_id', b.id)
              .in('created_date_pht', monthDates),

            supabaseAdmin
              .from('daily_payments')
              .select(`
                id, amount, payment_method, report_date, order_id,
                customer_name, pr_number, notes,
                orders ( id, order_number, dr_number, client_name, agent )
              `)
              .eq('branch_id', b.id)
              .in('report_date', monthDates),

            supabaseAdmin
              .from('daily_expenses')
              .select('amount, report_date')
              .eq('branch_id', b.id)
              .in('report_date', monthDates),

            supabaseAdmin
              .from('profiles')
              .select('full_name, agent_weekly_quota')
              .not('agent_weekly_quota', 'is', null)
              .gt('agent_weekly_quota', 0),

            supabaseAdmin
              .from('purchase_orders')
              .select('id, supplier_name, po_number, invoice_id, total_amount, generic_amt, branded_amt, created_date_pht, status, is_checked, notes, created_by')
              .eq('branch_id', b.id)
              .in('created_date_pht', monthDates)
              .order('created_date_pht', { ascending: true }),
          ]);

          // ── Office account lookup ──
          const clientNames = [
            ...new Set((ordersData || []).map((o: any) => o.client_name).filter(Boolean)),
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
            officeMap[(p.orders as any)?.client_name || p.customer_name || ''] || false;

          // ── Report map ──
          const reportMap: Record<string, any> = {};
          (reportsData || []).forEach((r: any) => { reportMap[r.report_date] = r; });

          // ── Totals ──
          const totalExpenses = (expensesData || []).reduce(
            (s: number, e: any) => s + Number(e.amount || 0), 0
          );

          let monthGenTotal = 0, monthBrdTotal = 0, monthDiscTotal = 0, monthOthersTotal = 0;
          let monthCashTotal = 0, monthChequeTotal = 0, monthOnlineTotal = 0;

          const dayRows: Array<{
            dateStr: string;
            gen: number; brd: number; disc: number; others: number; netTotal: number;
            cash: number; cheque: number; online: number;
            hasReport: boolean; isChecked: boolean;
          }> = monthDates.map((dateStr) => {
            const report = reportMap[dateStr];
            const dayOrders = (ordersData || []).filter((o: any) => o.created_date_pht === dateStr);
            const others = dayOrders.filter(isOfficeOrder)
              .reduce((s: number, o: any) => s + Number(o.total_amount || 0), 0);
            const gen = Number(report?.generic_sales || 0);
            const brd = Number(report?.branded_sales || 0);
            const disc = Number(report?.discount_total || 0);
            const netTotal = gen + brd - disc - others;

            const dayPay = (paymentsData || []).filter((p: any) => p.report_date === dateStr);
            const cash = dayPay.filter((p: any) => p.payment_method === 'CASH' && !isOfficePayment(p))
              .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
            const cheque = dayPay.filter((p: any) => p.payment_method === 'CHEQUE' && !isOfficePayment(p))
              .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
            const online = dayPay.filter((p: any) => p.payment_method === 'ONLINE' && !isOfficePayment(p))
              .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

            monthGenTotal += gen; monthBrdTotal += brd; monthDiscTotal += disc; monthOthersTotal += others;
            monthCashTotal += cash; monthChequeTotal += cheque; monthOnlineTotal += online;

            return { dateStr, gen, brd, disc, others, netTotal, cash, cheque, online, hasReport: !!report, isChecked: report?.is_checked || false };
          });

          const monthNetTotal = monthGenTotal + monthBrdTotal - monthDiscTotal - monthOthersTotal;
          const monthActualCash = monthCashTotal - totalExpenses;

          // ── Purchase Orders ──
          const poTotal = (purchaseOrdersData || []).reduce((s: number, p: any) => s + Number(p.total_amount || 0), 0);
          const poGenTotal = (purchaseOrdersData || []).reduce((s: number, p: any) => s + Number(p.generic_amt || 0), 0);
          const poBrdTotal = (purchaseOrdersData || []).reduce((s: number, p: any) => s + Number(p.branded_amt || 0), 0);

          // Resolve created_by UUIDs to full names
          const poUserIds = [...new Set((purchaseOrdersData || []).map((p: any) => p.created_by).filter(Boolean))];
          const poUserNameMap: Record<string, string> = {};
          if (poUserIds.length > 0) {
            const { data: poProfiles } = await supabaseAdmin
              .from('profiles')
              .select('id, full_name')
              .in('id', poUserIds);
            (poProfiles || []).forEach((pr: any) => {
              if (pr.id && pr.full_name) poUserNameMap[pr.id] = pr.full_name.trim();
            });
          }

          // Group POs by supplier, sorted by total desc
          const poBySupplier = new Map<string, { generic: number; branded: number; total: number; count: number; allChecked: boolean; hasReceived: boolean; inputBy: Set<string> }>();
          (purchaseOrdersData || []).forEach((p: any) => {
            const supplier = p.supplier_name || 'UNKNOWN';
            const ex = poBySupplier.get(supplier) || { generic: 0, branded: 0, total: 0, count: 0, allChecked: true, hasReceived: false, inputBy: new Set<string>() };
            const inputName = poUserNameMap[p.created_by] || p.created_by || 'UNKNOWN';
            ex.inputBy.add(inputName);
            poBySupplier.set(supplier, {
              generic: ex.generic + Number(p.generic_amt || 0),
              branded: ex.branded + Number(p.branded_amt || 0),
              total: ex.total + Number(p.total_amount || 0),
              count: ex.count + 1,
              allChecked: ex.allChecked && !!p.is_checked,
              hasReceived: ex.hasReceived || p.status === 'RECEIVED',
              inputBy: ex.inputBy,
            });
          });
          const poRows = Array.from(poBySupplier.entries())
            .map(([supplier, v]) => ({ supplier, ...v, inputBy: Array.from(v.inputBy).join(', ') || '—' }))
            .sort((a, b) => b.total - a.total);

          // ── Agent sales + quota ──
          // Daily quota = weekly_quota / 6 (Mon–Sat, Sunday is non-working)
          // Monthly quota = daily_quota × number of Mon–Sat days in the month
          const workingDaysInMonth = (() => {
            let count = 0;
            const d = new Date(todayDateM.getFullYear(), todayDateM.getMonth(), 1);
            const lastDay = new Date(todayDateM.getFullYear(), todayDateM.getMonth() + 1, 0).getDate();
            for (let day = 1; day <= lastDay; day++) {
              d.setDate(day);
              const dow = d.getDay(); // 0 = Sun, 6 = Sat
              if (dow !== 0) count++; // Mon–Sat
            }
            return count;
          })();
          const quotaMap = new Map<string, number>();
          (profilesData || []).forEach((p: any) => {
            if (p.full_name) {
              const dailyQuota = Number(p.agent_weekly_quota || 0) / 6;
              const monthlyQuota = dailyQuota * workingDaysInMonth;
              quotaMap.set(p.full_name.trim().toUpperCase(), monthlyQuota);
            }
          });

          const agentSalesMap = new Map<string, { total: number; displayName: string }>();
          (profilesData || []).forEach((p: any) => {
            if (p.full_name) {
              const key = p.full_name.trim().toUpperCase();
              agentSalesMap.set(key, { total: 0, displayName: p.full_name.trim() });
            }
          });
          (ordersData || []).filter((o: any) => !isOfficeOrder(o)).forEach((o: any) => {
            const display = (o.agent || 'MAIN OFFICE').trim();
            const key = display.toUpperCase();
            const ex = agentSalesMap.get(key);
            agentSalesMap.set(key, {
              total: (ex?.total || 0) + Number(o.total_amount || 0),
              displayName: ex?.displayName || display,
            });
          });

          const agentSalesRows = Array.from(agentSalesMap.entries())
            .map(([key, v]) => ({ agent: v.displayName, total: v.total, quota: quotaMap.get(key) || 0 }))
            .filter(r => r.total > 0)
            .sort((a, b) => b.total - a.total);

          // ── Agent collections ──
          const agentCollMap = new Map<string, { cash: number; cheque: number; online: number }>();
          (paymentsData || []).filter((p: any) => !isOfficePayment(p)).forEach((p: any) => {
            const agent = ((p.orders as any)?.agent || 'MAIN OFFICE').trim();
            const key = agent.toUpperCase();
            if (!agentCollMap.has(key)) agentCollMap.set(key, { cash: 0, cheque: 0, online: 0 });
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
              cash: v.cash, cheque: v.cheque, online: v.online,
              total: v.cash + v.cheque + v.online,
            }))
            .sort((a, b) => b.total - a.total);

          // ── Online payments ──
          const onlinePayments = (paymentsData || [])
            .filter((p: any) => p.payment_method === 'ONLINE')
            .sort((a: any, b: any) =>
              ((a.orders as any)?.client_name || a.customer_name || '').localeCompare(
                (b.orders as any)?.client_name || b.customer_name || ''
              )
            );

          // ── Client rows ──
          const clientSalesMap = new Map<string, { total: number; agent: string }>();
          (ordersData || []).filter((o: any) => !isOfficeOrder(o)).forEach((o: any) => {
            const client = o.client_name || 'WALK-IN';
            const ex = clientSalesMap.get(client);
            clientSalesMap.set(client, {
              total: (ex?.total || 0) + Number(o.total_amount || 0),
              agent: ex?.agent || o.agent || 'MAIN OFFICE',
            });
          });
          const clientPayMap = new Map<string, { cash: number; cheque: number; online: number }>();
          (paymentsData || []).filter((p: any) => !isOfficePayment(p)).forEach((p: any) => {
            const client = (p.orders as any)?.client_name || p.customer_name || 'WALK-IN';
            if (!clientPayMap.has(client)) clientPayMap.set(client, { cash: 0, cheque: 0, online: 0 });
            const entry = clientPayMap.get(client)!;
            const method = (p.payment_method || 'CASH').toUpperCase();
            const amt = Number(p.amount || 0);
            if (method === 'CASH') entry.cash += amt;
            else if (method === 'CHEQUE') entry.cheque += amt;
            else entry.online += amt;
          });
          const allClientKeys = [...new Set([...clientSalesMap.keys(), ...clientPayMap.keys()])];
          const clientRows = allClientKeys.map((client) => {
            const sd = clientSalesMap.get(client);
            const pay = clientPayMap.get(client) || { cash: 0, cheque: 0, online: 0 };
            const totalPaid = pay.cash + pay.cheque + pay.online;
            return {
              client, agent: sd?.agent || '—', sales: sd?.total || 0,
              cash: pay.cash, cheque: pay.cheque, online: pay.online,
              totalPaid, balance: (sd?.total || 0) - totalPaid,
            };
          }).sort((a, b) => b.sales - a.sales);

          // ── HTML helpers ──
          const fmt = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
          const tdR = `style="padding:8px 12px; text-align:right; font-family:monospace;"`;
          const tdL = `style="padding:8px 12px; text-align:left;"`;
          const thR = `style="padding:10px 12px; text-align:right; background:#1e293b; color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:1px;"`;
          const thL = `style="padding:10px 12px; text-align:left; background:#1e293b; color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:1px;"`;
          const trAlt = `style="background:#1e293b;"`;
          const trNorm = `style="background:#0f172a;"`;

          emailHtml += `
            <div style="background:#1e293b; border-radius:16px; padding:24px; margin-bottom:32px; border:1px solid #334155;">
              <h2 style="color:#fbbf24; margin:0 0 20px 0; font-size:20px;">🏢 ${b.branch_name.toUpperCase()}</h2>

              <!-- MONTHLY TOTALS CARDS -->
              <table style="width:100%; border-collapse:collapse; margin-bottom:24px;">
                <tr>
                  <td style="padding:4px;">
                    <div style="background:#0f172a; border:1px solid #059669; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#10b981; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">GENERIC</div>
                      <div style="color:#fff; font-size:20px; font-weight:900; font-family:monospace;">${fmt(monthGenTotal)}</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:#0f172a; border:1px solid #7c3aed; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#a855f7; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">BRANDED</div>
                      <div style="color:#fff; font-size:20px; font-weight:900; font-family:monospace;">${fmt(monthBrdTotal)}</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:#0f172a; border:1px solid #d97706; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#f59e0b; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">OTHERS</div>
                      <div style="color:#f59e0b; font-size:20px; font-weight:900; font-family:monospace;">${fmt(monthOthersTotal)}</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:#0f172a; border:1px solid #ea580c; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#f97316; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">DISCOUNT</div>
                      <div style="color:#f97316; font-size:20px; font-weight:900; font-family:monospace;">${fmt(monthDiscTotal)}</div>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:4px;">
                    <div style="background:#064e3b; border:2px solid #10b981; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#10b981; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">NET SALES</div>
                      <div style="color:#10b981; font-size:22px; font-weight:900; font-family:monospace;">${fmt(monthNetTotal)}</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:#0f172a; border:1px solid #2563eb; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#60a5fa; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">CASH</div>
                      <div style="color:#fff; font-size:20px; font-weight:900; font-family:monospace;">${fmt(monthCashTotal)}</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:#0f172a; border:1px solid #0284c7; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#38bdf8; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">CHEQUE</div>
                      <div style="color:#fff; font-size:20px; font-weight:900; font-family:monospace;">${fmt(monthChequeTotal)}</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:#0f172a; border:1px solid #dc2626; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#f87171; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">EXPENSES</div>
                      <div style="color:#f87171; font-size:20px; font-weight:900; font-family:monospace;">${fmt(totalExpenses)}</div>
                    </div>
                  </td>
                </tr>
              </table>
              <div style="background:#064e3b; border:2px solid #10b981; border-radius:12px; padding:20px; text-align:center; margin-bottom:28px;">
                <div style="color:#10b981; font-size:12px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">ACTUAL CASH (COLLECTED − EXPENSES)</div>
                <div style="color:#10b981; font-size:28px; font-weight:900; font-family:monospace;">${fmt(monthActualCash)}</div>
              </div>

              <!-- CASH vs STOCKS SUMMARY -->
              <table style="width:100%; border-collapse:collapse; margin-bottom:28px;">
                <tr>
                  <td style="padding:4px;">
                    <div style="background:#064e3b; border:1px solid #10b981; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#10b981; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">💰 MONEY COMING IN</div>
                      <div style="color:#10b981; font-size:22px; font-weight:900; font-family:monospace;">${fmt(monthActualCash)}</div>
                      <div style="color:#64748b; font-size:10px; margin-top:4px;">Net Cash − Expenses</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:#450a0a; border:1px solid #ef4444; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:#f87171; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">📦 MONEY FOR STOCKS</div>
                      <div style="color:#f87171; font-size:22px; font-weight:900; font-family:monospace;">${fmt(poTotal)}</div>
                      <div style="color:#64748b; font-size:10px; margin-top:4px;">Total Purchase Orders</div>
                    </div>
                  </td>
                  <td style="padding:4px;">
                    <div style="background:${monthActualCash - poTotal >= 0 ? '#064e3b' : '#450a0a'}; border:2px solid ${monthActualCash - poTotal >= 0 ? '#10b981' : '#ef4444'}; border-radius:12px; padding:16px; text-align:center;">
                      <div style="color:${monthActualCash - poTotal >= 0 ? '#10b981' : '#f87171'}; font-size:11px; font-weight:700; letter-spacing:2px; margin-bottom:6px;">📊 NET POSITION</div>
                      <div style="color:${monthActualCash - poTotal >= 0 ? '#10b981' : '#f87171'}; font-size:22px; font-weight:900; font-family:monospace;">${fmt(monthActualCash - poTotal)}</div>
                      <div style="color:#64748b; font-size:10px; margin-top:4px;">Cash − Stock Spending</div>
                    </div>
                  </td>
                </tr>
              </table>

              ${poRows.length > 0 ? `
              <!-- PURCHASE ORDERS -->
              <h3 style="color:#f97316; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:0 0 12px 0;">🧾 Purchase Orders This Month</h3>
              <div style="overflow-x:auto; margin-bottom:28px;">
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                  <thead>
                    <tr>
                      <th ${thL}>Supplier</th>
                      <th style="padding:10px 12px; text-align:center; background:#1e293b; color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:1px;"># POs</th>
                      <th ${thR}>Generic</th>
                      <th ${thR}>Branded</th>
                      <th ${thR}>Total</th>
                      <th ${thL}>Input By</th>
                      <th style="padding:10px 12px; text-align:center; background:#1e293b; color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:1px;">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${poRows.map((p: any, i: number) => {
                      const row = i % 2 === 0 ? trNorm : trAlt;
                      const status = p.allChecked
                        ? '<span style="color:#10b981;font-size:10px;font-weight:700;">✓ ALL CHECKED</span>'
                        : p.hasReceived
                        ? '<span style="color:#60a5fa;font-size:10px;font-weight:700;">RECEIVED</span>'
                        : '<span style="color:#f97316;font-size:10px;font-weight:700;">PENDING</span>';
                      return `<tr ${row}>
                        <td ${tdL} style="padding:8px 12px; font-weight:700; color:#e2e8f0;">${p.supplier}</td>
                        <td style="padding:8px 12px; text-align:center; font-family:monospace; color:#94a3b8;">${p.count}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#6ee7b7;">${p.generic > 0 ? fmt(p.generic) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#c4b5fd;">${p.branded > 0 ? fmt(p.branded) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#f97316; font-weight:900;">${fmt(p.total)}</td>
                        <td ${tdL} style="padding:8px 12px; color:#94a3b8; font-size:11px;">${p.inputBy}</td>
                        <td style="padding:8px 12px; text-align:center;">${status}</td>
                      </tr>`;
                    }).join('')}
                    <tr style="background:#1e293b; border-top:2px solid #475569;">
                      <td ${tdL} style="padding:10px 12px; font-weight:900; color:#f97316; font-size:11px; text-transform:uppercase; letter-spacing:1px;">TOTAL</td>
                      <td style="padding:10px 12px; text-align:center; font-family:monospace; color:#94a3b8; font-weight:900;">${poRows.reduce((s: number, r: any) => s + r.count, 0)}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#6ee7b7; font-weight:900;">${fmt(poGenTotal)}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#c4b5fd; font-weight:900;">${fmt(poBrdTotal)}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#f97316; font-weight:900;">${fmt(poTotal)}</td>
                      <td></td><td></td>
                    </tr>
                  </tbody>
                </table>
              </div>` : ''}

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
                    ${dayRows.map((d, i) => {
                      const date = new Date(d.dateStr + 'T00:00:00');
                      const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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
                        <td ${tdL} style="padding:8px 12px; font-weight:700; color:${isToday ? '#10b981' : '#e2e8f0'};">${dayLabel}${isToday ? ' <span style="background:#10b981;color:#000;font-size:9px;font-weight:900;padding:1px 6px;border-radius:99px;">TODAY</span>' : ''}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#6ee7b7;">${d.hasReport ? fmt(d.gen) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#c4b5fd;">${d.hasReport ? fmt(d.brd) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#fcd34d;">${d.hasReport ? fmt(d.others) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#fdba74;">${d.hasReport ? fmt(d.disc) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#10b981; font-weight:900;">${d.hasReport ? fmt(d.netTotal) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#93c5fd;">${fmt(d.cash)}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#c4b5fd;">${fmt(d.online)}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#7dd3fc;">${fmt(d.cheque)}</td>
                        <td style="padding:8px 12px; text-align:center;">${status}</td>
                      </tr>`;
                    }).join('')}
                    <tr style="background:#1e293b; border-top:2px solid #475569;">
                      <td ${tdL} style="padding:10px 12px; font-weight:900; color:#fff; font-size:12px; text-transform:uppercase; letter-spacing:1px;">MONTHLY TOTAL</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#6ee7b7; font-weight:900;">${fmt(monthGenTotal)}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#c4b5fd; font-weight:900;">${fmt(monthBrdTotal)}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#fcd34d; font-weight:900;">${fmt(monthOthersTotal)}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#fdba74; font-weight:900;">${fmt(monthDiscTotal)}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#10b981; font-weight:900;">${fmt(monthNetTotal)}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#93c5fd; font-weight:900;">${fmt(monthCashTotal)}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#c4b5fd; font-weight:900;">${fmt(monthOnlineTotal)}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#7dd3fc; font-weight:900;">${fmt(monthChequeTotal)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- AGENT SALES + QUOTA -->
              <h3 style="color:#10b981; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:0 0 12px 0;">📦 Monthly Sales by Agent</h3>
              <div style="overflow-x:auto; margin-bottom:28px;">
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                  <thead>
                    <tr>
                      <th ${thL}>Agent</th>
                      <th ${thR}>Sales</th>
                      <th ${thR}>Monthly Quota</th>
                      <th ${thR}>% Achieved</th>
                      <th style="padding:10px 12px; text-align:left; background:#1e293b; color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:1px; width:160px;">Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${agentSalesRows.map((r, i) => {
                      const rawPct = r.quota > 0 ? (r.total / r.quota) * 100 : 0;
                      const barPct = Math.min(rawPct, 100);
                      const barColor = rawPct >= 100 ? '#10b981' : rawPct >= 75 ? '#f59e0b' : rawPct >= 50 ? '#f97316' : '#ef4444';
                      const pctColor = rawPct >= 100 ? '#10b981' : rawPct >= 75 ? '#f59e0b' : '#ef4444';
                      const metBadge = rawPct >= 100 ? ' <span style="background:#064e3b;color:#10b981;font-size:9px;font-weight:900;padding:1px 6px;border-radius:99px;">✓ MET</span>' : '';
                      const row = i % 2 === 0 ? trNorm : trAlt;
                      return `<tr ${row}>
                        <td ${tdL} style="padding:8px 12px; font-weight:700; color:#e2e8f0;">${r.agent}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#10b981; font-weight:900;">${fmt(r.total)}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#64748b;">${r.quota > 0 ? fmt(r.quota) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:${pctColor}; font-weight:700;">${r.quota > 0 ? rawPct.toFixed(1) + '%' : '—'}${metBadge}</td>
                        <td style="padding:8px 12px;">
                          ${r.quota > 0 ? `
                            <div style="background:#1e293b; border-radius:99px; height:8px; overflow:hidden; width:140px;">
                              <div style="background:${barColor}; height:8px; width:${barPct}%; border-radius:99px;"></div>
                            </div>` : '<span style="color:#334155;font-size:11px;">—</span>'}
                        </td>
                      </tr>`;
                    }).join('')}
                    <tr style="background:#1e293b; border-top:2px solid #475569;">
                      <td ${tdL} style="padding:10px 12px; font-weight:900; color:#10b981; font-size:11px; text-transform:uppercase; letter-spacing:1px;">TOTAL</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#10b981; font-weight:900;">${fmt(agentSalesRows.reduce((s, r) => s + r.total, 0))}</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#64748b; font-weight:900;">${fmt(agentSalesRows.reduce((s, r) => s + r.quota, 0))}</td>
                      <td></td><td></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- AGENT COLLECTIONS -->
              <h3 style="color:#a855f7; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:0 0 12px 0;">💰 Monthly Collections by Agent</h3>
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
                    ${agentCollRows.map((r, i) => {
                      const row = i % 2 === 0 ? trNorm : trAlt;
                      return `<tr ${row}>
                        <td ${tdL} style="padding:8px 12px; font-weight:700; color:#e2e8f0;">${r.agent}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#6ee7b7;">${r.cash > 0 ? fmt(r.cash) : '<span style="color:#1e293b;">—</span>'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#fcd34d;">${r.cheque > 0 ? fmt(r.cheque) : '<span style="color:#1e293b;">—</span>'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#7dd3fc;">${r.online > 0 ? fmt(r.online) : '<span style="color:#1e293b;">—</span>'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#c4b5fd; font-weight:900;">${fmt(r.total)}</td>
                      </tr>`;
                    }).join('')}
                    ${(() => {
                      const tc = agentCollRows.reduce((s, r) => s + r.cash, 0);
                      const tch = agentCollRows.reduce((s, r) => s + r.cheque, 0);
                      const to = agentCollRows.reduce((s, r) => s + r.online, 0);
                      return `<tr style="background:#1e293b; border-top:2px solid #475569;">
                        <td ${tdL} style="padding:10px 12px; font-weight:900; color:#a855f7; font-size:11px; text-transform:uppercase; letter-spacing:1px;">TOTAL</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#6ee7b7; font-weight:900;">${fmt(tc)}</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#fcd34d; font-weight:900;">${fmt(tch)}</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#7dd3fc; font-weight:900;">${fmt(to)}</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#c4b5fd; font-weight:900;">${fmt(tc + tch + to)}</td>
                      </tr>`;
                    })()}
                  </tbody>
                </table>
              </div>

              ${onlinePayments.length > 0 ? `
              <!-- ONLINE PAYMENTS -->
              <h3 style="color:#38bdf8; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:0 0 12px 0;">🌐 Online Payments This Month</h3>
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
                    ${onlinePayments.map((p: any, i: number) => {
                      const order = p.orders || {};
                      const row = i % 2 === 0 ? trNorm : trAlt;
                      return `<tr ${row}>
                        <td ${tdL} style="padding:8px 12px; font-family:monospace; color:#64748b; font-size:11px;">${p.report_date}</td>
                        <td ${tdL} style="padding:8px 12px; font-weight:700; color:#e2e8f0;">${p.customer_name || order.client_name || '—'}</td>
                        <td ${tdL} style="padding:8px 12px; font-family:monospace; color:#94a3b8;">${order.order_number || '—'}</td>
                        <td ${tdL} style="padding:8px 12px; font-family:monospace; color:#94a3b8;">${order.dr_number || '—'}</td>
                        <td ${tdL} style="padding:8px 12px; font-family:monospace; color:#fcd34d;">${p.pr_number || order.pr_number || '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#38bdf8; font-weight:900;">${fmt(Number(p.amount || 0))}</td>
                        <td ${tdL} style="padding:8px 12px; color:#7dd3fc; font-size:12px;">${p.notes?.trim() || '—'}</td>
                      </tr>`;
                    }).join('')}
                    <tr style="background:#1e293b; border-top:2px solid #475569;">
                      <td colspan="5" ${tdL} style="padding:10px 12px; font-weight:900; color:#38bdf8; font-size:11px; text-transform:uppercase; letter-spacing:1px;">TOTAL ONLINE</td>
                      <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#38bdf8; font-weight:900;">${fmt(onlinePayments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0))}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>` : ''}

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
                    ${clientRows.map((r, i) => {
                      const balColor = r.balance > 0 ? '#ef4444' : r.balance < 0 ? '#38bdf8' : '#475569';
                      const balText = r.balance !== 0 ? fmt(Math.abs(r.balance)) + (r.balance < 0 ? ' (over)' : '') : '—';
                      const row = i % 2 === 0 ? trNorm : trAlt;
                      return `<tr ${row}>
                        <td ${tdL} style="padding:8px 12px; font-weight:700; color:#e2e8f0;">${r.client}</td>
                        <td ${tdL} style="padding:8px 12px; color:#64748b; font-size:11px;">${r.agent}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#6ee7b7;">${r.sales > 0 ? fmt(r.sales) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#93c5fd;">${r.cash > 0 ? fmt(r.cash) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#fcd34d;">${r.cheque > 0 ? fmt(r.cheque) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#7dd3fc;">${r.online > 0 ? fmt(r.online) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:#c4b5fd; font-weight:900;">${r.totalPaid > 0 ? fmt(r.totalPaid) : '—'}</td>
                        <td ${tdR} style="padding:8px 12px; text-align:right; font-family:monospace; color:${balColor}; font-weight:700;">${balText}</td>
                      </tr>`;
                    }).join('')}
                    ${(() => {
                      const ts = clientRows.reduce((s, r) => s + r.sales, 0);
                      const tc = clientRows.reduce((s, r) => s + r.cash, 0);
                      const tch = clientRows.reduce((s, r) => s + r.cheque, 0);
                      const to = clientRows.reduce((s, r) => s + r.online, 0);
                      const tp = tc + tch + to;
                      return `<tr style="background:#1e293b; border-top:2px solid #475569;">
                        <td colspan="2" ${tdL} style="padding:10px 12px; font-weight:900; color:#f59e0b; font-size:11px; text-transform:uppercase; letter-spacing:1px;">TOTAL</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#6ee7b7; font-weight:900;">${fmt(ts)}</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#93c5fd; font-weight:900;">${fmt(tc)}</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#fcd34d; font-weight:900;">${fmt(tch)}</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#7dd3fc; font-weight:900;">${fmt(to)}</td>
                        <td ${tdR} style="padding:10px 12px; text-align:right; font-family:monospace; color:#c4b5fd; font-weight:900;">${fmt(tp)}</td>
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
            Generated by EconoPOS • Monthly Report • ${monthLabel}
          </p>
        </div>`;

        const emailList = org.owner_email.split(',').map((e: string) => e.trim()).filter(Boolean);
        if (emailList.length > 0) {
          try {
            await resend.emails.send({
              from: 'Econo Drugstore <stock@alerts.econo-pos.com>',
              to: emailList,
              subject: `📆 Monthly Report — ${monthLabel} | ${org.name}`,
              html: emailHtml,
            });
            console.log(`✅ Monthly email sent to ${org.owner_email} (${org.name})`);
          } catch (err) {
            console.error(`❌ Monthly email failed for ${org.name}:`, err);
          }
        }
      } // end org loop

      return NextResponse.json({
        success: true,
        message: `Monthly email reports sent for ${monthLabel}`,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Telegram Report Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}