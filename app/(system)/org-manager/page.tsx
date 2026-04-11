'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  Search,
  Target,
  ShoppingCart,
  Activity,
  CalendarDays,
  BarChart3,
  Loader2,
  Plus,
  Zap,
  ShieldCheck,
  ListFilter,
  User,
  ChevronDown,
  UserPlus,
  Building2,
  LogOut,
  X,
  Database,
  CheckCircle2,
  TrendingUp,
  ShieldAlert,
  FileBarChart,
  Network,
} from 'lucide-react';

export default function ExecutiveTerminal() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [weekLabel, setWeekLabel] = useState('');

  const [daysInCurrentMonth, setDaysInCurrentMonth] = useState(30);
  const [toast, setToast] = useState<{ show: boolean; msg: string } | null>(
    null
  );

  const [modals, setModals] = useState({
    branch: false,
    staff: false,
    org: false,
    quota: false,
    status: false,
  });

  const [branchForm, setBranchForm] = useState({
    branch_name: '',
    org_id: '',
    location: '',
    daily_total_quota: 0,
    daily_generic_quota: 0,
  });

  const [orgForm, setOrgForm] = useState({ name: '' });

  const [staffForm, setStaffForm] = useState({
    full_name: '',
    email: '',
    role: 'staff',
    branch_id: '',
    org_id: '',
    password: '',
  });

  const [statusForm, setStatusForm] = useState({
    profile_id: '',
    new_status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  });

  const [selectedBranch, setSelectedBranch] = useState<any>(null);
  const [quotaInputs, setQuotaInputs] = useState({
    daily_generic_quota: 0,
    daily_total_quota: 0,
  });

  const getDaysInMonth = (year: number, month: number) =>
    new Date(year, month + 1, 0).getDate();

  useEffect(() => {
    const now = new Date();
    setDaysInCurrentMonth(getDaysInMonth(now.getFullYear(), now.getMonth()));
    const sun = new Date(now);
    sun.setDate(now.getDate() - now.getDay());
    const sat = new Date(sun);
    sat.setDate(sun.getDate() + 6);
    setWeekLabel(
      `${sun.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })} - ${sat.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })}`
    );
    fetchInitialData();
  }, []);

  const showSuccess = (msg: string) => {
    setToast({ show: true, msg });
    setTimeout(() => setToast(null), 3000);
  };

  async function fetchInitialData() {
    try {
      setLoading(true);
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      setUser(authUser);

      const now = new Date();
      const sun = new Date(now);
      sun.setHours(0, 0, 0, 0);
      sun.setDate(now.getDate() - now.getDay());
      const sat = new Date(sun);
      sat.setDate(sun.getDate() + 6);
      sat.setHours(23, 59, 59, 999);

      const [orgs, branches, sales, pos, profiles] = await Promise.all([
        supabase
          .from('organizations')
          .select('*')
          .order('name', { ascending: true }),
        supabase
          .from('branches')
          .select('*')
          .order('branch_name', { ascending: true }),
        supabase.from('orders').select('*'),
        supabase.from('purchase_orders').select('*'),
        supabase.from('profiles').select('*'),
      ]);

      const assembled =
        orgs.data?.map((org) => ({
          ...org,
          branches: branches.data
            ?.filter((b) => String(b.org_id) === String(org.id))
            .map((branch) => {
              const bSales =
                sales.data?.filter(
                  (s) =>
                    String(s.branch_id) === String(branch.id) &&
                    new Date(s.created_at) >= sun &&
                    new Date(s.created_at) <= sat
                ) || [];
              const saleGen = bSales.reduce(
                (acc, s) => acc + (Number(s.generic_amt) || 0),
                0
              );
              const saleTotal = bSales.reduce(
                (acc, s) =>
                  acc + (Number(s.total_price || s.total_amount) || 0),
                0
              );

              const bPos =
                pos.data?.filter(
                  (p) =>
                    String(p.branch_id) === String(branch.id) &&
                    new Date(p.created_at) >= sun &&
                    new Date(p.created_at) <= sat &&
                    p.supplier_name !== 'EXCEL_IMPORT'
                ) || [];

              const poGen = bPos.reduce(
                (acc, p) =>
                  acc + (Number(p.generic_amount || p.generic_amt) || 0),
                0
              );
              const poTotal = bPos.reduce(
                (acc, p) => acc + (Number(p.total_amount) || 0),
                0
              );

              const capacity =
                branch.weekly_total_avg > 0
                  ? (saleTotal / branch.weekly_total_avg) * 100
                  : 0;
              const staff =
                profiles.data?.filter(
                  (p) => String(p.branch_id) === String(branch.id)
                ) || [];

              let status = 'Stable';
              if (capacity >= 100) status = 'High Performance';
              else if (capacity > 0 && capacity < 60) status = 'Under Quota';
              else if (capacity === 0) status = 'Maintenance';

              return {
                ...branch,
                saleGen,
                saleTotal,
                poGen,
                poTotal,
                capacity,
                staff,
                status,
              };
            }),
        })) || [];

      setOrganizations(assembled);
    } finally {
      setLoading(false);
    }
  }

  // ====================== FIXED LOGOUT ======================
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  // ====================== CHANGE STATUS ======================
  const handleChangeStatus = async () => {
    if (!statusForm.profile_id) {
      return alert('Please select a user');
    }

    const { error } = await supabase
      .from('profiles')
      .update({ status: statusForm.new_status })
      .eq('id', statusForm.profile_id);

    if (error) {
      alert(`Error: ${error.message}`);
    } else {
      showSuccess(`Status updated to ${statusForm.new_status}`);
      setModals({ ...modals, status: false });
      setStatusForm({ profile_id: '', new_status: 'ACTIVE' });
      fetchInitialData();
    }
  };

  const handleAddOrg = async () => {
    const { error } = await supabase.from('organizations').insert([orgForm]);
    if (!error) {
      setModals({ ...modals, org: false });
      showSuccess('Organization Formed');
      fetchInitialData();
    }
  };

  const handleAddBranch = async () => {
    const { error } = await supabase.from('branches').insert([branchForm]);
    if (!error) {
      setModals({ ...modals, branch: false });
      showSuccess('Branch Deployed');
      fetchInitialData();
    }
  };

  const handleAddStaff = async () => {
    if (!staffForm.email || !staffForm.password || !staffForm.branch_id) {
      return alert('Email, Password, and Branch are required.');
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: staffForm.email,
        password: staffForm.password,
        options: {
          data: {
            full_name: staffForm.full_name,
          },
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('Auth creation failed.');

      const { error: profileError } = await supabase.from('profiles').insert([
        {
          id: authData.user.id,
          email: staffForm.email,
          full_name: staffForm.full_name,
          role: staffForm.role,
          branch_id: staffForm.branch_id,
          org_id: staffForm.org_id,
          status: 'ACTIVE',
        },
      ]);

      if (profileError) throw profileError;

      alert('Staff member authorized successfully!');
      setModals({ ...modals, staff: false });
      setStaffForm({
        email: '',
        full_name: '',
        role: 'staff',
        branch_id: '',
        org_id: '',
        password: '',
      });
      fetchInitialData();
    } catch (err: any) {
      alert(`Deployment Error: ${err.message}`);
    }
  };

  const saveQuota = async () => {
    const dailyGen = quotaInputs.daily_generic_quota;
    const dailyTotal = quotaInputs.daily_total_quota;
    const { error } = await supabase
      .from('branches')
      .update({
        daily_generic_quota: dailyGen,
        daily_total_quota: dailyTotal,
        weekly_generic_avg: dailyGen * 7,
        weekly_total_avg: dailyTotal * 7,
        monthly_generic_quota: dailyGen * daysInCurrentMonth,
        monthly_total_quota: dailyTotal * daysInCurrentMonth,
      })
      .eq('id', selectedBranch.id);
    if (!error) {
      setModals({ ...modals, quota: false });
      showSuccess('Quotas Synced');
      fetchInitialData();
    }
  };

  const allStaff = organizations.flatMap(
    (org) =>
      org.branches?.flatMap(
        (branch: any) =>
          branch.staff?.filter((s: any) => s.role !== 'org_manager') || []
      ) || []
  );

  const filteredOrgs = organizations
    .map((org) => ({
      ...org,
      branches: org.branches?.filter((branch) => {
        const matchesSearch = branch.branch_name
          .toLowerCase()
          .includes(searchTerm.toLowerCase());
        const matchesFilter =
          activeFilter === 'All' || branch.status === activeFilter;
        return matchesSearch && matchesFilter;
      }),
    }))
    .filter((org) => org.branches?.length > 0);

  if (loading)
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500" />
      </div>
    );

  return (
    <div className="min-h-screen bg-[#020617] text-slate-300 p-6 md:p-10 font-sans relative overflow-x-hidden">
      {/* TOAST SYSTEM */}
      {toast?.show && (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[200] bg-emerald-500 text-white px-6 py-3 rounded-2xl flex items-center gap-3 shadow-2xl">
          <CheckCircle2 size={18} />
          <span className="text-[10px] font-black uppercase tracking-widest">
            {toast.msg}
          </span>
        </div>
      )}

      {/* HEADER */}
      <nav className="max-w-7xl mx-auto flex justify-between items-center mb-10 border-b border-slate-800 pb-6">
        <h1 className="text-xl font-black text-white italic uppercase tracking-tighter">
          ECONO<span className="text-emerald-500">_DRUGSTORE</span>
        </h1>
        <div className="flex items-center gap-6">
          <div className="bg-slate-900/50 py-1.5 px-4 rounded-full flex items-center gap-3 border border-white/5">
            <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-[10px] text-white font-black">
              {user?.email?.[0].toUpperCase()}
            </div>
            <p className="text-[9px] font-black text-white">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-slate-500 hover:text-red-500 transition-all"
          >
            <LogOut size={18} />
          </button>
        </div>
      </nav>

      {/* ACTION DASHBOARD */}
      <main className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-12">
          <div className="space-y-1">
            <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter leading-none">
              Operational Nodes
            </h2>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              {weekLabel}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setModals({ ...modals, org: true })}
              className="bg-slate-900 px-5 py-3 rounded-2xl text-[9px] font-black uppercase text-slate-300 border border-white/5 hover:border-emerald-500/50 transition-all"
            >
              <Network size={14} className="inline mr-2 text-emerald-500" /> Add
              Org
            </button>
            <button
              onClick={() => setModals({ ...modals, branch: true })}
              className="bg-slate-900 px-5 py-3 rounded-2xl text-[9px] font-black uppercase text-slate-300 border border-white/5 hover:border-blue-500/50 transition-all"
            >
              <Building2 size={14} className="inline mr-2 text-blue-500" /> Add
              Branch
            </button>
            <button
              onClick={() => setModals({ ...modals, staff: true })}
              className="bg-slate-900 px-5 py-3 rounded-2xl text-[9px] font-black uppercase text-slate-300 border border-white/5 hover:border-purple-500/50 transition-all"
            >
              <UserPlus size={14} className="inline mr-2 text-purple-500" /> Add
              Staff
            </button>

            <button
              onClick={() => setModals({ ...modals, status: true })}
              className="bg-slate-900 px-5 py-3 rounded-2xl text-[9px] font-black uppercase text-slate-300 border border-white/5 hover:border-orange-500/50 transition-all flex items-center gap-2"
            >
              <ShieldAlert size={14} className="text-orange-500" />
              Change Status
            </button>

            <button
              onClick={() => router.push('/org-manager/reports')}
              className="bg-emerald-600 px-5 py-3 rounded-2xl text-[9px] font-black uppercase text-white shadow-lg hover:bg-emerald-500 transition-all"
            >
              <FileBarChart size={14} className="inline mr-2" /> Reports
            </button>
          </div>
        </div>

        {/* SEARCH AND FILTERS */}
        <div className="mb-12 flex flex-col md:flex-row gap-6 bg-slate-900/20 p-6 rounded-3xl border border-white/5">
          <div className="relative flex-1">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600"
              size={18}
            />
            <input
              type="text"
              placeholder="Search Infrastructure..."
              className="w-full bg-slate-950/50 border border-slate-800 rounded-2xl py-3.5 pl-12 text-xs text-white outline-none focus:border-emerald-500/50"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {['All', 'High Performance', 'Under Quota'].map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`px-5 py-3 rounded-xl text-[9px] font-black uppercase border transition-all whitespace-nowrap ${
                  activeFilter === f
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg'
                    : 'bg-slate-950 text-slate-500 border-slate-800'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* BRANCH CARDS */}
        <div className="space-y-24">
          {filteredOrgs.map((org) => (
            <section key={org.id}>
              <h3 className="text-3xl font-black text-white uppercase italic tracking-tighter mb-8 border-l-4 border-emerald-500 pl-8">
                {org.name}
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                {org.branches?.map((branch: any) => (
                  <div
                    key={branch.id}
                    className="bg-slate-900/40 border border-white/5 p-8 rounded-[3rem] shadow-2xl relative transition-all hover:border-emerald-500/30"
                  >
                    <div className="flex justify-between items-start mb-8">
                      <div>
                        <h4 className="text-2xl font-black text-white uppercase italic tracking-tight">
                          {branch.branch_name}
                        </h4>
                        <p
                          className={`text-[8px] font-black uppercase mt-1 ${
                            branch.status === 'High Performance'
                              ? 'text-emerald-500'
                              : 'text-blue-500'
                          }`}
                        >
                          {branch.status}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedBranch(branch);
                          setQuotaInputs({
                            daily_generic_quota:
                              branch.daily_generic_quota || 0,
                            daily_total_quota: branch.daily_total_quota || 0,
                          });
                          setModals({ ...modals, quota: true });
                        }}
                        className="p-3 bg-slate-950 rounded-2xl text-emerald-500 border border-white/5 hover:bg-emerald-500 hover:text-white transition-all"
                      >
                        <Target size={16} />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                          <Zap size={12} /> Revenue
                        </p>
                        <div className="bg-black/40 p-4 rounded-2xl border border-white/5 space-y-2 text-[10px]">
                          <div className="flex justify-between font-bold text-slate-500 uppercase">
                            <span>Generic</span>
                            <span className="text-white font-mono font-black">
                              ₱{branch.saleGen.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between font-bold text-slate-500 uppercase">
                            <span>Branded</span>
                            <span className="text-white font-mono font-black">
                              ₱
                              {(
                                branch.saleTotal - branch.saleGen
                              ).toLocaleString()}
                            </span>
                          </div>
                          <div className="pt-2 border-t border-white/10 flex justify-between font-black">
                            <span className="text-emerald-500 uppercase">
                              Total
                            </span>
                            <span className="text-lg font-mono text-white">
                              ₱{branch.saleTotal.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <p className="text-[9px] font-black text-orange-400 uppercase tracking-widest flex items-center gap-2">
                          <ShoppingCart size={12} /> Expenses
                        </p>
                        <div className="bg-black/40 p-4 rounded-2xl border border-white/5 space-y-2 text-[10px]">
                          <div className="flex justify-between font-bold text-slate-500 uppercase">
                            <span>Generic</span>
                            <span className="text-slate-300 font-mono font-black">
                              ₱{branch.poGen.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between font-bold text-slate-500 uppercase">
                            <span>Branded</span>
                            <span className="text-slate-300 font-mono font-black">
                              ₱
                              {(branch.poTotal - branch.poGen).toLocaleString()}
                            </span>
                          </div>
                          <div className="pt-2 border-t border-white/10 flex justify-between font-black">
                            <span className="text-orange-500 uppercase">
                              Total
                            </span>
                            <span className="text-lg font-mono text-white">
                              ₱{branch.poTotal.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between">
                      <div className="flex -space-x-2">
                        {branch.staff?.map((s: any, i: number) => (
                          <div
                            key={i}
                            className={`w-6 h-6 rounded-full border-2 border-slate-900 flex items-center justify-center text-[8px] font-black uppercase ${
                              s.role === 'branch_admin'
                                ? 'bg-purple-500 text-white'
                                : 'bg-slate-800 text-emerald-500'
                            }`}
                            title={`${s.full_name} (${s.role})`}
                          >
                            {s.full_name[0]}
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black font-mono text-white">
                            {branch.capacity.toFixed(1)}%
                          </span>
                          <div className="w-16 h-1 bg-slate-950 rounded-full overflow-hidden border border-white/5">
                            <div
                              className={`h-full ${
                                branch.capacity >= 100
                                  ? 'bg-emerald-500'
                                  : 'bg-blue-600'
                              }`}
                              style={{
                                width: `${Math.min(branch.capacity, 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                        <span className="text-[7px] font-black text-slate-600 uppercase tracking-widest">
                          Target: ₱{branch.weekly_total_avg?.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      {/* MODAL: ADD ORGANIZATION */}
      {modals.org && (
        <div className="fixed inset-0 z-[150] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/20 p-8 rounded-[2.5rem] w-full max-w-sm">
            <h3 className="text-xl font-black text-white uppercase italic mb-6 tracking-tighter">
              Form_Organization
            </h3>
            <div className="space-y-4">
              <input
                className="w-full bg-black/50 border border-slate-800 p-4 rounded-2xl text-white outline-none text-xs font-bold"
                placeholder="Organization Name"
                onChange={(e) =>
                  setOrgForm({ ...orgForm, name: e.target.value })
                }
              />
              <button
                onClick={handleAddOrg}
                className="w-full bg-emerald-600 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest text-white"
              >
                Create Organization
              </button>
              <button
                onClick={() => setModals({ ...modals, org: false })}
                className="w-full text-[10px] font-black uppercase text-slate-500 mt-2 text-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: QUOTA UI */}
      {modals.quota && (
        <div className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/20 p-10 rounded-[3rem] w-full max-w-sm shadow-2xl">
            <h2 className="text-2xl font-black text-white italic uppercase tracking-tighter mb-8 leading-none">
              Node_Sync
              <br />
              <span className="text-emerald-500 text-sm">
                Target Period: {daysInCurrentMonth} Days
              </span>
            </h2>
            <div className="space-y-6">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase mb-2 block tracking-widest">
                  Daily Generic (₱)
                </label>
                <input
                  type="number"
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 px-5 text-white font-mono focus:border-emerald-500/50 outline-none"
                  value={quotaInputs.daily_generic_quota}
                  onChange={(e) =>
                    setQuotaInputs({
                      ...quotaInputs,
                      daily_generic_quota: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase mb-2 block tracking-widest">
                  Daily Total (₱)
                </label>
                <input
                  type="number"
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 px-5 text-white font-mono focus:border-emerald-500/50 outline-none"
                  value={quotaInputs.daily_total_quota}
                  onChange={(e) =>
                    setQuotaInputs({
                      ...quotaInputs,
                      daily_total_quota: Number(e.target.value),
                    })
                  }
                />
              </div>

              <div className="bg-emerald-500/5 p-5 rounded-2xl border border-emerald-500/10 space-y-3">
                <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-1 italic underline">
                  Live Multiplier Preview
                </p>
                <div className="flex justify-between text-[10px] font-bold">
                  <span className="text-slate-600 uppercase">
                    Weekly (7 Days):
                  </span>
                  <span className="text-white font-mono">
                    ₱{(quotaInputs.daily_total_quota * 7).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-[10px] font-bold border-t border-emerald-500/10 pt-2">
                  <span className="text-slate-600 uppercase">
                    Monthly ({daysInCurrentMonth} Days):
                  </span>
                  <span className="text-white font-mono italic underline">
                    ₱
                    {(
                      quotaInputs.daily_total_quota * daysInCurrentMonth
                    ).toLocaleString()}
                  </span>
                </div>
              </div>

              <button
                onClick={saveQuota}
                className="w-full bg-emerald-600 hover:bg-emerald-500 py-5 rounded-2xl text-white font-black uppercase text-xs tracking-widest transition-all shadow-lg flex items-center justify-center gap-3"
              >
                <CheckCircle2 size={18} /> Update & Sync
              </button>
              <button
                onClick={() => setModals({ ...modals, quota: false })}
                className="w-full text-[10px] font-black uppercase text-slate-500 mt-2 text-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: BRANCH */}
      {modals.branch && (
        <div className="fixed inset-0 z-[150] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-blue-500/20 p-8 rounded-[2.5rem] w-full max-w-sm">
            <h3 className="text-xl font-black text-white uppercase italic mb-6 tracking-tighter">
              Deploy_Branch
            </h3>
            <div className="space-y-4">
              <input
                className="w-full bg-black/50 border border-slate-800 p-4 rounded-2xl text-white outline-none text-xs font-bold"
                placeholder="Branch Name"
                onChange={(e) =>
                  setBranchForm({ ...branchForm, branch_name: e.target.value })
                }
              />
              <select
                className="w-full bg-black/50 border border-slate-800 p-4 rounded-2xl text-white outline-none text-xs font-bold"
                onChange={(e) =>
                  setBranchForm({ ...branchForm, org_id: e.target.value })
                }
              >
                <option value="">Select Organization</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAddBranch}
                className="w-full bg-blue-600 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest text-white"
              >
                Confirm Deployment
              </button>
              <button
                onClick={() => setModals({ ...modals, branch: false })}
                className="w-full text-[10px] font-black uppercase text-slate-500 mt-2 text-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: STAFF */}
      {modals.staff && (
        <div className="fixed inset-0 z-[150] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-purple-500/20 p-8 rounded-[2.5rem] w-full max-w-sm">
            <h3 className="text-xl font-black text-white uppercase italic mb-6 tracking-tighter">
              Authorize_User
            </h3>
            <div className="space-y-4">
              <input
                className="w-full bg-black/50 border border-slate-800 p-4 rounded-2xl text-white outline-none text-xs font-bold"
                placeholder="Full Name"
                onChange={(e) =>
                  setStaffForm({ ...staffForm, full_name: e.target.value })
                }
              />
              <input
                type="password"
                placeholder="Security Password"
                className="w-full bg-slate-900 border border-white/5 rounded-2xl px-6 py-4 text-xs font-mono outline-none focus:border-purple-500"
                value={staffForm.password}
                onChange={(e) =>
                  setStaffForm({ ...staffForm, password: e.target.value })
                }
              />
              <input
                className="w-full bg-black/50 border border-slate-800 p-4 rounded-2xl text-white outline-none text-xs font-bold"
                placeholder="Email"
                onChange={(e) =>
                  setStaffForm({ ...staffForm, email: e.target.value })
                }
              />
              <select
                className="w-full bg-black/50 border border-slate-800 p-4 rounded-2xl text-white outline-none text-xs font-bold"
                value={staffForm.role}
                onChange={(e) =>
                  setStaffForm({ ...staffForm, role: e.target.value })
                }
              >
                <option value="staff">Staff</option>
                <option value="branch_admin">Branch Admin</option>
              </select>
              <select
                className="w-full bg-black/50 border border-slate-800 p-4 rounded-2xl text-white outline-none text-xs font-bold"
                onChange={(e) => {
                  const bId = e.target.value;
                  const b = organizations
                    .flatMap((o) => o.branches)
                    .find((x: any) => String(x.id) === String(bId));
                  setStaffForm({
                    ...staffForm,
                    branch_id: bId,
                    org_id: b?.org_id || '',
                  });
                }}
              >
                <option value="">Assign Node</option>
                {organizations
                  .flatMap((o) => o.branches)
                  .map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.branch_name}
                    </option>
                  ))}
              </select>
              <button
                onClick={handleAddStaff}
                className="w-full bg-purple-600 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest text-white flex items-center justify-center gap-2"
              >
                {staffForm.role === 'branch_admin' ? (
                  <ShieldAlert size={14} />
                ) : (
                  <User size={14} />
                )}{' '}
                Authorize
              </button>
              <button
                onClick={() => setModals({ ...modals, staff: false })}
                className="w-full text-[10px] font-black uppercase text-slate-500 mt-2 text-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHANGE STATUS MODAL */}
      {modals.status && (
        <div className="fixed inset-0 z-[150] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-orange-500/20 p-8 rounded-[2.5rem] w-full max-w-md">
            <h3 className="text-xl font-black text-white uppercase italic mb-6 tracking-tighter">
              Change User Status
            </h3>

            <div className="space-y-6">
              <select
                className="w-full bg-black/50 border border-slate-800 p-4 rounded-2xl text-white outline-none text-xs font-bold"
                value={statusForm.profile_id}
                onChange={(e) =>
                  setStatusForm({ ...statusForm, profile_id: e.target.value })
                }
              >
                <option value="">Select user...</option>
                {allStaff.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name} — {s.email} ({s.role})
                  </option>
                ))}
              </select>

              <div className="flex gap-3">
                <button
                  onClick={() =>
                    setStatusForm({ ...statusForm, new_status: 'ACTIVE' })
                  }
                  className={`flex-1 py-4 rounded-2xl font-black text-xs tracking-widest transition-all ${
                    statusForm.new_status === 'ACTIVE'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  ACTIVE
                </button>
                <button
                  onClick={() =>
                    setStatusForm({ ...statusForm, new_status: 'INACTIVE' })
                  }
                  className={`flex-1 py-4 rounded-2xl font-black text-xs tracking-widest transition-all ${
                    statusForm.new_status === 'INACTIVE'
                      ? 'bg-red-600 text-white'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  INACTIVE
                </button>
              </div>

              <button
                onClick={handleChangeStatus}
                className="w-full bg-orange-600 hover:bg-orange-500 py-5 rounded-2xl text-white font-black uppercase text-xs tracking-widest transition-all"
              >
                Update Status
              </button>

              <button
                onClick={() => setModals({ ...modals, status: false })}
                className="w-full text-[10px] font-black uppercase text-slate-500 mt-2 text-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
