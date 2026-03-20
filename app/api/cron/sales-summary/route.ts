import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  if (key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // DIAGNOSTIC: Fetch the 5 most recent rows from system_logs with NO filters
    const { data: testLogs, error: testError } = await supabaseAdmin
      .from('system_logs')
      .select('*')
      .limit(5)
      .order('created_at', { ascending: false });

    if (testError) throw testError;

    // This will show us exactly what the columns are named and what the data looks like
    return NextResponse.json({ 
      success: true, 
      message: "Diagnostic Mode",
      record_count_received: testLogs?.length,
      sample_data: testLogs // This will show the actual raw rows in your browser
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}