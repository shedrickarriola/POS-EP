'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function Gatekeeper() {
  const router = useRouter();

  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 5;

    const resolvePath = async () => {
      // 1. Get the session
      const {
        data: { session },
      } = await supabase.auth.getSession();

      // 2. If no session, wait 500ms and try again (up to 5 times)
      if (!session && retryCount < maxRetries) {
        retryCount++;
        console.log(
          `Session not found. Attempt ${retryCount} of ${maxRetries}...`
        );
        setTimeout(resolvePath, 500);
        return;
      }

      // 3. If after 5 tries there's still no session, then go to login
      if (!session) {
        console.error('Auth Timeout: No session found.');
        router.replace('/login');
        return;
      }

      // 4. Session found! Now get the role and redirect
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (profile?.role === 'super_admin') {
        router.replace('/super-admin');
      } else if (profile?.role === 'org_manager') {
        router.replace('/org-manager');
      } else {
        router.replace('/staff');
      }
    };

    resolvePath();
  }, [router]);

  return (
    <div className="min-h-screen bg-[#020617] flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <h2 className="text-white font-black italic uppercase tracking-tighter">
          Verifying_<span className="text-emerald-500">Identity</span>
        </h2>
      </div>
    </div>
  );
}
