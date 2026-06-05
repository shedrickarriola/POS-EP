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

    // =====================================================
    if (type === 'DAILY_EMAIL') {
      console.log('📧 Starting Daily Email Report (8PM) - Full version');

      const { data: orgsForEmail } = await supabaseAdmin
        .from('organizations')
        .select('id, name, owner_email')
        .not('owner_email', 'is', null);

      for (const org of orgsForEmail || []) {
        if (!org.owner_email) continue;

        const { data: officeBranches } = await supabaseAdmin
          .from('branches')
          .select('*')
          .eq('org_id', org.id)
          .eq('is_office_use', true);

        if (!officeBranches || officeBranches.length === 0) continue;

        for (const b of officeBranches) {
          const reportDate = todayPHT;

          const { data: report } = await supabaseAdmin
            .from('daily_reports')
            .select('*')
            .eq('branch_id', b.id)
            .eq('report_date', reportDate)
            .single();

          const { data: allPaymentsRaw } = await supabaseAdmin
            .from('daily_payments')
            .select(
              `*, orders (client_name, order_number, dr_number, delivery_date)`
            )
            .eq('branch_id', b.id)
            .eq('report_date', reportDate);

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
          if (dayOrders && dayOrders.length > 0) {
            const clientNames = [
              ...new Set(dayOrders.map((o) => o.client_name).filter(Boolean)),
            ];
            if (clientNames.length > 0) {
              const { data: clientsData } = await supabaseAdmin
                .from('clients')
                .select('client_name, is_office_account')
                .in('client_name', clientNames);

              const officeSet = new Set(
                (clientsData || [])
                  .filter((c) => c.is_office_account)
                  .map((c) => c.client_name)
              );
              othersTotal = dayOrders
                .filter((o) => officeSet.has(o.client_name))
                .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
            }
          }

          // === DAILY SALES ===
          const gen = Number(report?.generic_sales || 0);
          const brd = Number(report?.branded_sales || 0);
          const disc = Number(report?.discount_total || 0);
          const dailySalesTotal = gen + brd - disc - othersTotal;

          // Raw daily collections
          const rawDailyCash = regularPayments
            .filter((p: any) => p.payment_method === 'CASH')
            .reduce((sum, p) => sum + Number(p.amount || 0), 0);

          const dailyOnline = regularPayments
            .filter((p: any) => p.payment_method === 'ONLINE')
            .reduce((sum, p) => sum + Number(p.amount || 0), 0);

          const dailyCheque = regularPayments
            .filter((p: any) => p.payment_method === 'CHEQUE')
            .reduce((sum, p) => sum + Number(p.amount || 0), 0);

          // Cash under Daily Sales now deducts Others
          const dailyCash = Math.max(0, rawDailyCash - othersTotal);

          // Remittances = ONLY legacyPayments
          const remCash = legacyPayments
            .filter((p: any) => p.payment_method === 'CASH')
            .reduce((sum, p) => sum + Number(p.amount || 0), 0);

          const remOnline = legacyPayments
            .filter((p: any) => p.payment_method === 'ONLINE')
            .reduce((sum, p) => sum + Number(p.amount || 0), 0);

          const remCheque = legacyPayments
            .filter((p: any) => p.payment_method === 'CHEQUE')
            .reduce((sum, p) => sum + Number(p.amount || 0), 0);

          const remittancesTotal = remCash + remOnline + remCheque;

          // Total Payments (Others already deducted from cash)
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

          // Sort tables
          const sortedRegular = [...regularPayments].sort((a, b) => {
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
          let emailHtml = `
            <div style="font-family: system-ui, Arial, sans-serif; max-width: 950px; margin: 0 auto; padding: 20px; background: #ffffff; color: #111827; border: 1px solid #e5e7eb;">
              
              <h1 style="text-align:center; margin:0 0 5px 0; font-size:22px;">DAILY REPORT (END OF DAY)</h1>
              <h2 style="text-align:center; margin:0 0 25px 0; font-size:16px; color:#374151;">${
                b.branch_name
              } — ${reportDate}</h2>
    
              <!-- DAILY SALES (Full breakdown) -->
              <h3 style="background:#f3f4f6; padding:8px 12px; margin:0 0 10px 0; font-size:14px;">DAILY SALES</h3>
              <table style="width:100%; border-collapse:collapse; margin-bottom:8px; font-size:14px;">
                <tr><td style="padding:6px 12px;">Generic</td><td style="padding:6px 12px; text-align:right; font-weight:600;">₱${gen.toLocaleString()}</td></tr>
                <tr><td style="padding:6px 12px;">Branded</td><td style="padding:6px 12px; text-align:right; font-weight:600;">₱${brd.toLocaleString()}</td></tr>
                <tr><td style="padding:6px 12px;">Others (Office Accounts)</td><td style="padding:6px 12px; text-align:right; font-weight:600; color:#d97706;">₱${othersTotal.toLocaleString()}</td></tr>
                <tr><td style="padding:6px 12px; color:#dc2626;">Discount</td><td style="padding:6px 12px; text-align:right; color:#dc2626; font-weight:600;">- ₱${disc.toLocaleString()}</td></tr>
                <tr style="background:#f3f4f6; font-weight:700;">
                  <td style="padding:10px 12px;">TOTAL SALES (NET)</td>
                  <td style="padding:10px 12px; text-align:right;">₱${dailySalesTotal.toLocaleString()}</td>
                </tr>
              </table>
    
              <!-- Cash / Online / Cheque under Daily Sales (Cash already deducts Others) -->
              <table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:13px;">
                <tr><td style="padding:6px 12px;">Cash</td><td style="padding:6px 12px; text-align:right;">₱${dailyCash.toLocaleString()}</td></tr>
                <tr><td style="padding:6px 12px;">Online</td><td style="padding:6px 12px; text-align:right;">₱${dailyOnline.toLocaleString()}</td></tr>
                <tr><td style="padding:6px 12px;">Cheque</td><td style="padding:6px 12px; text-align:right;">₱${dailyCheque.toLocaleString()}</td></tr>
              </table>
    
              <!-- REMITTANCES -->
              <h3 style="background:#f3f4f6; padding:8px 12px; margin:15px 0 8px 0; font-size:14px;">REMITTANCES</h3>
              <table style="width:100%; border-collapse:collapse; margin-bottom:8px; font-size:14px;">
                <tr style="background:#f3f4f6; font-weight:700;">
                  <td style="padding:8px 12px;">TOTAL</td>
                  <td style="padding:8px 12px; text-align:right;">₱${remittancesTotal.toLocaleString()}</td>
                </tr>
                <tr><td style="padding:6px 12px;">Cash</td><td style="padding:6px 12px; text-align:right;">₱${remCash.toLocaleString()}</td></tr>
                <tr><td style="padding:6px 12px;">Online</td><td style="padding:6px 12px; text-align:right;">₱${remOnline.toLocaleString()}</td></tr>
                <tr><td style="padding:6px 12px;">Cheque</td><td style="padding:6px 12px; text-align:right;">₱${remCheque.toLocaleString()}</td></tr>
              </table>
    
              <!-- TOTAL PAYMENTS -->
              <h3 style="background:#f3f4f6; padding:8px 12px; margin:15px 0 8px 0; font-size:14px;">TOTAL PAYMENTS</h3>
              <table style="width:100%; border-collapse:collapse; margin-bottom:8px; font-size:14px;">
                <tr style="background:#f3f4f6; font-weight:700;">
                  <td style="padding:8px 12px;">TOTAL</td>
                  <td style="padding:8px 12px; text-align:right;">₱${totalPayments.toLocaleString()}</td>
                </tr>
                <tr><td style="padding:6px 12px;">Cash</td><td style="padding:6px 12px; text-align:right;">₱${totalPaymentsCash.toLocaleString()}</td></tr>
                <tr><td style="padding:6px 12px;">Online</td><td style="padding:6px 12px; text-align:right;">₱${totalPaymentsOnline.toLocaleString()}</td></tr>
                <tr><td style="padding:6px 12px;">Cheque</td><td style="padding:6px 12px; text-align:right;">₱${totalPaymentsCheque.toLocaleString()}</td></tr>
              </table>
    
              <!-- EXPENSES -->
              <h3 style="background:#f3f4f6; padding:8px 12px; margin:15px 0 8px 0; font-size:14px;">EXPENSES</h3>
              <table style="width:100%; border-collapse:collapse; margin-bottom:8px; font-size:14px;">
                <tr><td style="padding:8px 12px;">Total Expenses</td><td style="padding:8px 12px; text-align:right; color:#dc2626;">₱${totalExpenses.toLocaleString()}</td></tr>
              </table>
    
              <!-- ACTUAL CASH -->
              <h3 style="background:#ecfdf5; padding:10px 12px; margin:15px 0 0 0; font-size:15px; color:#059669;">ACTUAL CASH</h3>
              <table style="width:100%; border-collapse:collapse; font-size:16px;">
                <tr style="background:#ecfdf5; font-weight:700;">
                  <td style="padding:12px;">Actual Cash</td>
                  <td style="padding:12px; text-align:right; color:#059669;">₱${actualCash.toLocaleString()}</td>
                </tr>
              </table>
    
              <!-- DAILY SALES TABLE -->
              <h3 style="background:#f3f4f6; padding:8px 12px; margin:25px 0 10px 0; font-size:14px;">DAILY SALES TABLE</h3>
              <table style="width:100%; border-collapse:collapse; margin-bottom:25px; font-size:12px;">
                <thead>
                  <tr style="background:#e5e7eb; text-align:left;">
                    <th style="padding:6px 8px;">CLIENT</th>
                    <th style="padding:6px 8px;">SO#</th>
                    <th style="padding:6px 8px;">DR#</th>
                    <th style="padding:6px 8px;">PR#</th>
                    <th style="padding:6px 8px; text-align:right;">CASH</th>
                    <th style="padding:6px 8px; text-align:right;">CHECK</th>
                    <th style="padding:6px 8px;">CHECK DATE</th>
                    <th style="padding:6px 8px;">DELIVERY DATE</th>
                    <th style="padding:6px 8px; text-align:right;">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  ${sortedRegular
                    .map((p: any) => {
                      const order = p.orders || {};
                      const cashAmt =
                        p.payment_method === 'CASH' ||
                        p.payment_method === 'ONLINE'
                          ? Number(p.amount)
                          : 0;
                      const chequeAmt =
                        p.payment_method === 'CHEQUE' ? Number(p.amount) : 0;
                      return `
                      <tr style="border-bottom:1px solid #e5e7eb;">
                        <td style="padding:6px 8px;">${
                          order.client_name || p.customer_name || '—'
                        }</td>
                        <td style="padding:6px 8px;">${
                          order.order_number || '—'
                        }</td>
                        <td style="padding:6px 8px;">${
                          order.dr_number || '—'
                        }</td>
                        <td style="padding:6px 8px;">${p.pr_number || '—'}</td>
                        <td style="padding:6px 8px; text-align:right;">₱${cashAmt.toLocaleString()}</td>
                        <td style="padding:6px 8px; text-align:right;">₱${chequeAmt.toLocaleString()}</td>
                        <td style="padding:6px 8px;">${
                          p.cheque_date || '—'
                        }</td>
                        <td style="padding:6px 8px;">${
                          order.delivery_date || '—'
                        }</td>
                        <td style="padding:6px 8px; text-align:right; font-weight:600;">₱${Number(
                          order.total_amount || 0
                        ).toLocaleString()}</td>
                      </tr>
                    `;
                    })
                    .join('')}
                </tbody>
              </table>
    
              <!-- REMITTANCES TABLE -->
              <h3 style="background:#f3f4f6; padding:8px 12px; margin:20px 0 10px 0; font-size:14px;">REMITTANCES / PAYMENTS</h3>
              <table style="width:100%; border-collapse:collapse; margin-bottom:25px; font-size:12px;">
                <thead>
                  <tr style="background:#e5e7eb; text-align:left;">
                    <th style="padding:6px 8px;">CLIENT</th>
                    <th style="padding:6px 8px;">SO#</th>
                    <th style="padding:6px 8px;">DR#</th>
                    <th style="padding:6px 8px;">PR#</th>
                    <th style="padding:6px 8px; text-align:right;">CASH</th>
                    <th style="padding:6px 8px; text-align:right;">CHECK</th>
                    <th style="padding:6px 8px;">CHECK DATE</th>
                    <th style="padding:6px 8px;">DELIVERY DATE</th>
                    <th style="padding:6px 8px; text-align:right;">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  ${sortedRegular
                    .map((p: any) => {
                      const order = p.orders || {};
                      const cashAmt =
                        p.payment_method === 'CASH' ||
                        p.payment_method === 'ONLINE'
                          ? Number(p.amount)
                          : 0;
                      const chequeAmt =
                        p.payment_method === 'CHEQUE' ? Number(p.amount) : 0;
                      return `
                      <tr style="border-bottom:1px solid #e5e7eb;">
                        <td style="padding:6px 8px;">${
                          order.client_name || p.customer_name || '—'
                        }</td>
                        <td style="padding:6px 8px;">${
                          order.order_number || '—'
                        }</td>
                        <td style="padding:6px 8px;">${
                          order.dr_number || '—'
                        }</td>
                        <td style="padding:6px 8px;">${p.pr_number || '—'}</td>
                        <td style="padding:6px 8px; text-align:right;">₱${cashAmt.toLocaleString()}</td>
                        <td style="padding:6px 8px; text-align:right;">₱${chequeAmt.toLocaleString()}</td>
                        <td style="padding:6px 8px;">${
                          p.cheque_date || '—'
                        }</td>
                        <td style="padding:6px 8px;">${
                          order.delivery_date || '—'
                        }</td>
                        <td style="padding:6px 8px; text-align:right; font-weight:600;">₱${Number(
                          p.amount
                        ).toLocaleString()}</td>
                      </tr>
                    `;
                    })
                    .join('')}
                </tbody>
              </table>
    
              <!-- LEGACY PAYMENTS -->
              ${
                sortedLegacy.length > 0
                  ? `
              <h3 style="background:#fef3c7; padding:8px 12px; margin:20px 0 10px 0; font-size:14px; color:#92400e;">LEGACY / STANDALONE PAYMENTS (Old POS)</h3>
              <table style="width:100%; border-collapse:collapse; margin-bottom:25px; font-size:12px;">
                <tbody>
                  ${sortedLegacy
                    .map(
                      (p: any) => `
                    <tr style="border-bottom:1px solid #fef3c7;">
                      <td style="padding:6px 12px;">${p.customer_name}</td>
                      <td style="padding:6px 12px; text-align:right; font-weight:600;">₱${Number(
                        p.amount
                      ).toLocaleString()}</td>
                      <td style="padding:6px 12px;">${p.payment_method}</td>
                      <td style="padding:6px 12px;">${p.pr_number || ''}</td>
                      <td style="padding:6px 12px;">${p.notes || ''}</td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>`
                  : ''
              }
    
              <!-- ONLINE PAYMENTS -->
              ${
                sortedOnline.length > 0
                  ? `
              <h3 style="background:#e0f2fe; padding:8px 12px; margin:20px 0 10px 0; font-size:14px; color:#0369a1;">ONLINE PAYMENTS</h3>
              <table style="width:100%; border-collapse:collapse; margin-bottom:25px; font-size:12px;">
                <thead>
                  <tr style="background:#bae6fd; text-align:left;">
                    <th style="padding:6px 8px;">CLIENT NAME</th>
                    <th style="padding:6px 8px;">SO#</th>
                    <th style="padding:6px 8px;">DR#</th>
                    <th style="padding:6px 8px;">PR#</th>
                    <th style="padding:6px 8px; text-align:right;">AMOUNT</th>
                    <th style="padding:6px 8px;">METHOD</th>
                    <th style="padding:6px 8px;">REFERENCE / NOTES</th>
                  </tr>
                </thead>
                <tbody>
                  ${sortedOnline
                    .map((p: any) => {
                      const order = p.orders || {};
                      return `
                      <tr style="border-bottom:1px solid #bae6fd;">
                        <td style="padding:6px 8px;">${
                          p.customer_name || order.client_name || '—'
                        }</td>
                        <td style="padding:6px 8px;">${
                          order.order_number || '—'
                        }</td>
                        <td style="padding:6px 8px;">${
                          order.dr_number || '—'
                        }</td>
                        <td style="padding:6px 8px;">${p.pr_number || '—'}</td>
                        <td style="padding:6px 8px; text-align:right; font-weight:600;">₱${Number(
                          p.amount
                        ).toLocaleString()}</td>
                        <td style="padding:6px 8px;">ONLINE</td>
                        <td style="padding:6px 8px;">${p.notes || '—'}</td>
                      </tr>
                    `;
                    })
                    .join('')}
                </tbody>
              </table>`
                  : ''
              }
    
              <!-- EXPENSES DETAIL -->
              <h3 style="background:#fee2e2; padding:8px 12px; margin:20px 0 10px 0; font-size:14px; color:#991b1b;">EXPENSES</h3>
              <table style="width:100%; border-collapse:collapse; margin-bottom:30px; font-size:13px;">
                <tbody>
                  ${(expenses || [])
                    .map(
                      (e: any) => `
                    <tr style="border-bottom:1px solid #fee2e2;">
                      <td style="padding:8px 12px;">${e.expense_name}</td>
                      <td style="padding:8px 12px; text-align:right; color:#dc2626; font-weight:600;">₱${Number(
                        e.amount
                      ).toLocaleString()}</td>
                    </tr>
                  `
                    )
                    .join('')}
                  <tr style="background:#fee2e2; font-weight:700;">
                    <td style="padding:10px 12px;">Total Expenses</td>
                    <td style="padding:10px 12px; text-align:right;">₱${totalExpenses.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
    
              <p style="text-align:center; color:#6b7280; font-size:11px; margin-top:30px;">
                Generated automatically • ${new Date().toLocaleString('en-PH')}
              </p>
            </div>
          `;

          try {
            await resend.emails.send({
              from: 'Econo Drugstore <stock@alerts.econo-pos.com>',
              to: org.owner_email,
              subject: `📊 Daily Report (End of Day) - ${reportDate} | ${b.branch_name}`,
              html: emailHtml,
            });
            console.log(`✅ Daily Report sent to ${org.owner_email}`);
          } catch (err: any) {
            console.error('Email failed:', err);
          }
        }
      }

      return NextResponse.json({ success: true, message: 'Daily email sent' });
    }
    // =====================================================
    // ALL OTHER REPORT TYPES CONTINUE BELOW
    // (STOCK_ADVISORY, REPORT_CHECKER, LOGIN, UPDATE, EOD)
    // =====================================================

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

    // 4. MESSAGE LOOP (for STOCK_ADVISORY + regular drugstore reports)
    for (const group of Object.values(orgGroups) as any[]) {
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

        // Send consolidated email (AFTER all branches processed)
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
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Telegram Report Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
