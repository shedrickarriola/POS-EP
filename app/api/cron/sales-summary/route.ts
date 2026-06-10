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
