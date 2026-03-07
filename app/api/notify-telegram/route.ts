export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Admin (needed to check logs)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use Service Role Key for bypass RLS if needed
);

export async function POST(request: Request) {
  try {
    const { name, branch, time, email } = await request.json();

    const BOT_TOKEN = '8743953425:AAF2qLUU5aMK7SySJ9txxkEoda08GeP8kb8';
    const CHAT_ID = '-5253546552';

    // 1. Calculate the start of "Today" in PHT (UTC+8)
    const now = new Date();
    const phtNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const startOfPHTDay = new Date(phtNow.setUTCHours(0, 0, 0, 0));
    const startOfPHTDayInUTC = new Date(
      startOfPHTDay.getTime() - 8 * 60 * 60 * 1000
    );

    // 2. Check if this user has already logged in today
    const { data: existingLogs, error: fetchError } = await supabase
      .from('system_logs')
      .select('id')
      .eq('user_email', email)
      .gte('created_at', startOfPHTDayInUTC.toISOString())
      .limit(1);

    if (fetchError) throw fetchError;

    // 3. IF LOGS EXIST: Return success but DO NOT send Telegram
    if (existingLogs && existingLogs.length > 0) {
      console.log(`Skipping Telegram: ${email} already logged in today.`);
      return NextResponse.json({ success: true, skipped: true });
    }

    // 4. IF NO LOGS: Send the Telegram Alert
    const message = `
<b>🔔 FIRST LOGIN OF THE DAY</b>
━━━━━━━━━━━━━━━━━━
<b>👤 User:</b> ${name}
<b>📧 Email:</b> ${email}
<b>📍 Branch:</b> ${branch}
<b>🕒 Time:</b> ${time} (PHT)
━━━━━━━━━━━━━━━━━━
<i>Pharma_Ops System Log</i>
    `;

    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: message,
          parse_mode: 'HTML',
        }),
      }
    );

    const data = await response.json();

    if (!data.ok) {
      console.error('TELEGRAM ERROR:', data.description);
      return NextResponse.json({ error: data.description }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('SERVER ERROR:', error.message);
    return NextResponse.json({ error: 'Process failed' }, { status: 500 });
  }
}
