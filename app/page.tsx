import { supabase } from '@/lib/supabase';
import { redirect } from 'next/navigation';

export default async function RootPage() {
  // Check if someone is already logged in
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    // If they are logged in, send them to your new Dark Dashboard
    redirect('/dashboard');
  } else {
    // If they aren't, send them to the Login page you just shared
    redirect('/login');
  }
}
