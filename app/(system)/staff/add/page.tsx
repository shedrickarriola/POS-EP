'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function AddStaffPage() {
  return (
    <Suspense
      fallback={
        <p className="p-10 text-white font-mono">INITIALIZING_AUTH...</p>
      }
    >
      <AddStaffForm />
    </Suspense>
  );
}

function AddStaffForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlBranchId = searchParams.get('branchId') || '';
  const urlOrgId = searchParams.get('orgId') || '';

  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('staff');
  const [branchId, setBranchId] = useState(urlBranchId);

  useEffect(() => {
    async function initPage() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push('/login');

      const { data } = await supabase
        .from('branches')
        .select('id, branch_name')
        .eq('org_id', urlOrgId);

      if (data) setBranches(data);
      if (urlBranchId) setBranchId(urlBranchId);
      setLoading(false);
    }
    initPage();
  }, [router, urlOrgId, urlBranchId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId) return alert('Please select a branch assignment.');

    setIsSubmitting(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) throw authError;

      const { error: profileError } = await supabase.from('profiles').upsert({
        id: authData.user?.id,
        email: email,
        full_name: fullName,
        role: role,
        org_id: urlOrgId,
        branch_id: branchId,
      });

      if (profileError) throw profileError;

      alert(
        `${role === 'branch_admin' ? 'Manager' : 'Staff'} account deployed!`
      );
      router.push('/staff');
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading)
    return (
      <p className="p-10 text-white font-mono animate-pulse">
        CONNECTING_TO_DATABASE...
      </p>
    );

  return (
    <div className="p-10 max-w-xl mx-auto">
      {/* TOP NAVIGATION / BACK BUTTON */}
      <button
        onClick={() => router.back()}
        className="group flex items-center gap-2 text-slate-500 hover:text-white mb-8 transition-colors"
      >
        <span className="text-lg group-hover:-translate-x-1 transition-transform">
          ←
        </span>
        <span className="text-[10px] font-black uppercase tracking-[0.2em]">
          Return_to_Hub
        </span>
      </button>

      <header className="mb-8">
        <h1 className="text-white text-3xl font-black italic mb-2 tracking-tighter uppercase leading-none">
          Node_<span className="text-emerald-500">Provisioning</span>
        </h1>
        <p className="text-slate-500 text-[10px] font-mono uppercase tracking-widest">
          Personnel Enrollment Interface
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 bg-slate-950 p-8 rounded-3xl border border-white/5 shadow-2xl"
      >
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-2 ml-1 tracking-widest">
              Full Name
            </label>
            <input
              type="text"
              placeholder="e.g. Dr. John Smith"
              required
              className="w-full p-4 rounded-xl bg-slate-900 text-white border border-white/10 outline-none focus:border-emerald-500 transition-all text-sm"
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-2 ml-1 tracking-widest">
                Email Address
              </label>
              <input
                type="email"
                required
                className="w-full p-4 rounded-xl bg-slate-900 text-white border border-white/10 outline-none focus:border-emerald-500 text-sm"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-2 ml-1 tracking-widest">
                Password
              </label>
              <input
                type="password"
                required
                className="w-full p-4 rounded-xl bg-slate-900 text-white border border-white/10 outline-none focus:border-emerald-500 text-sm"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="h-px bg-white/5 my-2" />

        {/* ROLE SELECTION */}
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-3 ml-1 tracking-widest">
            Access Rank
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setRole('staff')}
              className={`p-4 rounded-xl text-[10px] font-black uppercase italic transition-all border ${
                role === 'staff'
                  ? 'bg-emerald-500/10 border-emerald-500 text-emerald-500'
                  : 'bg-slate-900 border-white/5 text-slate-600'
              }`}
            >
              Standard Staff
            </button>
            <button
              type="button"
              onClick={() => setRole('branch_admin')}
              className={`p-4 rounded-xl text-[10px] font-black uppercase italic transition-all border ${
                role === 'branch_admin'
                  ? 'bg-indigo-500/10 border-indigo-500 text-indigo-500 shadow-lg shadow-indigo-900/20'
                  : 'bg-slate-900 border-white/5 text-slate-600'
              }`}
            >
              Branch Manager
            </button>
          </div>
        </div>

        {/* BRANCH ASSIGNMENT */}
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-2 ml-1 tracking-widest">
            Assigned Location
          </label>
          <div className="relative">
            <select
              className="w-full p-4 rounded-xl bg-slate-900 text-white border border-white/10 outline-none focus:border-emerald-500 text-sm appearance-none cursor-pointer"
              required
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">Choose Station...</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.branch_name}
                </option>
              ))}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-600">
              ▼
            </div>
          </div>
        </div>

        {/* ACTION BUTTONS */}
        <div className="flex gap-4 pt-6">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-emerald-600 p-4 rounded-xl font-black text-white text-[10px] uppercase italic tracking-widest shadow-lg shadow-emerald-900/20 hover:bg-emerald-500 transition-all disabled:opacity-50"
          >
            {isSubmitting ? 'SYNCING_DATA...' : 'Deploy Personnel'}
          </button>
        </div>
      </form>
    </div>
  );
}
