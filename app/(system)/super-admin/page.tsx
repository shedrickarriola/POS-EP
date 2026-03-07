'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function SuperAdminPage() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);

  // --- STEP 4: THE BOUNCER ---
  useEffect(() => {
    const verifyAndLoad = async () => {
      // 1. Check if user is logged in
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      // 2. Check if user is a SUPER_ADMIN in the profiles table
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (profile?.role !== 'super_admin') {
        alert('DENIED: You do not have Super Admin clearance.');
        router.push('/login');
        return;
      }

      // 3. If they passed the test, show the page and load data
      setIsAuthorized(true);
      setCurrentUser(user);
      fetchAllData();
    };

    verifyAndLoad();
  }, [router]);

  async function fetchAllData() {
    try {
      setLoading(true);
      const { data: orgs } = await supabase.from('organizations').select('*');
      const { data: branches } = await supabase.from('branches').select('*');
      const { data: profiles } = await supabase.from('profiles').select('*');
      const { data: pos } = await supabase.from('purchase_orders').select('*');
      const { data: sales } = await supabase.from('orders').select('*');

      const assembled = orgs?.map((org) => ({
        ...org,
        all_staff: profiles?.filter((p) => p.org_id === org.id) || [],
        branches:
          branches
            ?.filter((b) => b.org_id === org.id)
            .map((branch) => ({
              ...branch,
              branch_staff:
                profiles?.filter((p) => p.branch_id === branch.id) || [],
              purchase_orders:
                pos?.filter((p) => p.branch_id === branch.id) || [],
              orders: sales?.filter((s) => s.branch_id === branch.id) || [],
            })) || [],
      }));

      setOrganizations(assembled || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  // Prevent "Flicker": Don't show the UI until we know they are authorized
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center">
        <p className="text-emerald-500 font-black animate-pulse uppercase tracking-widest text-xs">
          Verifying Clearance...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020617] text-slate-300 p-8">
      <header className="max-w-6xl mx-auto flex justify-between items-center mb-12 border-b border-slate-800 pb-8">
        <div className="flex items-center gap-6">
          <div>
            <h1 className="text-3xl font-black text-white italic tracking-tighter">
              PHARMA<span className="text-emerald-500">_CORE</span>
            </h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
              Global Monitoring
            </p>
          </div>

          <div className="hidden md:flex items-center gap-3 pl-6 border-l border-slate-800">
            <div className="h-10 w-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 font-bold text-xs">
              {currentUser?.email?.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-white text-xs font-bold leading-none mb-1">
                {currentUser?.email}
              </p>
              <p className="text-[9px] text-emerald-500 font-mono font-bold uppercase">
                Super Admin
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="text-slate-400 hover:text-red-400 text-[10px] font-black uppercase transition-colors px-4 py-2 border border-slate-800 rounded-xl"
        >
          Logout
        </button>
      </header>

      <main className="max-w-6xl mx-auto">
        {loading ? (
          <p className="text-center py-20 text-slate-500 uppercase text-xs font-bold animate-pulse">
            Syncing System Data...
          </p>
        ) : (
          <div className="space-y-12">
            {organizations.map((org) => (
              <div
                key={org.id}
                className="bg-slate-900/20 border border-slate-800 p-8 rounded-[3rem]"
              >
                <h2 className="text-2xl font-black text-white uppercase mb-6">
                  {org.name}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {org.branches?.map((branch: any) => (
                    <div
                      key={branch.id}
                      className="bg-slate-950 border border-slate-800 p-6 rounded-3xl"
                    >
                      <h3 className="font-bold text-emerald-400 mb-4 uppercase text-sm tracking-tight">
                        {branch.branch_name}
                      </h3>
                      <div className="flex gap-4">
                        <div className="bg-slate-900 px-4 py-2 rounded-xl border border-white/5">
                          <p className="text-[8px] text-slate-500 uppercase font-black">
                            Sales
                          </p>
                          <p className="text-lg font-black text-white">
                            {branch.orders?.length || 0}
                          </p>
                        </div>
                        <div className="bg-slate-900 px-4 py-2 rounded-xl border border-white/5">
                          <p className="text-[8px] text-slate-500 uppercase font-black">
                            Staff
                          </p>
                          <p className="text-lg font-black text-white">
                            {branch.branch_staff?.length || 0}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
