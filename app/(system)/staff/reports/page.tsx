'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Loader2,
  TrendingUp,
} from 'lucide-react';

export default function ReportsAuditPage() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [branch, setBranch] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);

  // Verification modal
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [actualRemittance, setActualRemittance] = useState<number>(0);
  const [savings, setSavings] = useState<number>(0);

  useEffect(() => {
    fetchData();
  }, [currentDate]);

  const fetchData = async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return router.push('/login');

    console.log('🔍 Current user ID:', user.id);

    // Fetch profile WITHOUT joining branches (to avoid ambiguity)
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*, active_branch_id')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('❌ Profile query error:', profileError);
    }

    if (!profileData) {
      console.error('🚨 No profile row found for this user!');
      setLoading(false);
      return;
    }

    setProfile(profileData);
    console.log('📋 Profile loaded successfully');

    let activeBranch: any = null;

    // Priority 1: localStorage
    const savedBranch = localStorage.getItem('active_branch');
    if (savedBranch) {
      try {
        activeBranch = JSON.parse(savedBranch);
        console.log(
          '✅ Using branch from localStorage:',
          activeBranch.branch_name
        );
      } catch (e) {}
    }

    // Priority 2: profiles.active_branch_id
    if (!activeBranch && profileData.active_branch_id) {
      const { data: branchData } = await supabase
        .from('branches')
        .select('*')
        .eq('id', profileData.active_branch_id)
        .single();

      if (branchData) {
        activeBranch = branchData;
        console.log('✅ Using branch from profiles.active_branch_id');
      }
    }

    // Priority 3: Fallback
    if (!activeBranch) {
      const { data: branchesData } = await supabase
        .from('branches')
        .select('*')
        .eq('org_id', profileData.org_id);

      if (branchesData && branchesData.length > 0) {
        activeBranch = branchesData[0];
        console.log('✅ Using first available branch as fallback');
      }
    }

    if (activeBranch?.id) {
      setBranch(activeBranch);
      console.log('✅ Active branch set:', activeBranch.branch_name);

      const start = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
      );
      const end = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        0
      );

      // ✅ PHT-FORCED formatter (Asia/Manila)
      const formatPHTDate = (date: Date): string => {
        return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      };

      const { data: reportsData } = await supabase
        .from('daily_reports')
        .select('*')
        .eq('branch_id', activeBranch.id)
        .gte('report_date', formatPHTDate(start))
        .lte('report_date', formatPHTDate(end))
        .order('report_date', { ascending: true });

      setReports(reportsData || []);
    } else {
      console.error('❌ Could not determine active branch');
    }

    setLoading(false);
  };

  // Toggle verification (OFF = no modal, ON = show modal)
  const toggleVerification = async (id: string, currentlyChecked: boolean) => {
    const userRole = profile?.role?.toLowerCase();
    if (userRole === 'staff') {
      alert(
        'Access Denied: Staff members are not authorized to verify reports.'
      );
      return;
    }

    if (currentlyChecked) {
      // Turn OFF
      const { error } = await supabase
        .from('daily_reports')
        .update({ is_checked: false, checked_by: null })
        .eq('id', id);

      if (!error) {
        setReports((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, is_checked: false, checked_by: null } : r
          )
        );
      }
    } else {
      // Turn ON → show modal
      setSelectedReportId(id);
      setActualRemittance(0);
      setSavings(0);
      setShowVerificationModal(true);
    }
  };

  const confirmVerification = async () => {
    if (!selectedReportId) return;

    const { error } = await supabase
      .from('daily_reports')
      .update({
        is_checked: true,
        checked_by: profile?.full_name || profile?.email || 'Checker',
        actual_remitted: actualRemittance, // ← SAVED TO actual_remitted
        savings: savings,
      })
      .eq('id', selectedReportId);

    if (!error) {
      setReports((prev) =>
        prev.map((r) =>
          r.id === selectedReportId
            ? {
                ...r,
                is_checked: true,
                checked_by: profile?.full_name || profile?.email || 'Checker',
                actual_remitted: actualRemittance,
                savings: savings,
              }
            : r
        )
      );
    }

    setShowVerificationModal(false);
    setSelectedReportId(null);
  };

  // Calendar logic (unchanged)
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calendarDays = [];
  const prevMonthLastDay = new Date(year, month, 0).getDate();

  for (let i = firstDayOfMonth - 1; i >= 0; i--) {
    calendarDays.push({
      day: prevMonthLastDay - i,
      current: false,
      date: new Date(year, month - 1, prevMonthLastDay - i),
    });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push({
      day: i,
      current: true,
      date: new Date(year, month, i),
    });
  }
  const remaining = 7 - (calendarDays.length % 7);
  if (remaining < 7) {
    for (let i = 1; i <= remaining; i++) {
      calendarDays.push({
        day: i,
        current: false,
        date: new Date(year, month + 1, i),
      });
    }
  }

  const weeks = [];
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7));
  }

  const dailyGenQuota = Number(branch?.daily_generic_quota || 0);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <div className="max-w-[1400px] mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-3 bg-slate-900 border border-white/5 rounded-xl hover:bg-slate-800 transition-all"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tighter">
                BRANCH_AUDIT
              </h1>
              <p className="text-[9px] font-bold text-slate-500 uppercase mt-1 tracking-widest">
                {branch?.branch_name} | {profile?.role || 'Staff'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 bg-slate-900/50 p-2 rounded-2xl border border-white/5">
            <button
              onClick={() => setCurrentDate(new Date(year, month - 1, 1))}
              className="p-2 hover:text-emerald-500"
            >
              <ChevronLeft />
            </button>
            <span className="text-sm font-black uppercase tracking-widest w-40 text-center">
              {currentDate.toLocaleString('default', {
                month: 'long',
                year: 'numeric',
              })}
            </span>
            <button
              onClick={() => setCurrentDate(new Date(year, month + 1, 1))}
              className="p-2 hover:text-emerald-500"
            >
              <ChevronRight />
            </button>
          </div>

          <button
            onClick={() => router.push('/staff/reports/weekly')}
            className="flex items-center gap-3 bg-indigo-600 hover:bg-indigo-500 px-6 py-3 rounded-2xl text-white font-black uppercase text-sm tracking-widest transition-all shadow-lg shadow-indigo-500/30"
          >
            <TrendingUp size={18} />
            Weekly Reconciliation
          </button>
        </div>

        {/* Calendar Header */}
        <div className="grid grid-cols-8 gap-2 mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div
              key={d}
              className="text-center text-[10px] font-black text-slate-500 uppercase tracking-widest py-2"
            >
              {d}
            </div>
          ))}
          <div className="text-center text-[10px] font-black text-emerald-500 uppercase tracking-widest py-2 bg-emerald-500/5 rounded-t-lg">
            Weekly_Quota
          </div>
        </div>

        {/* Calendar Content */}
        {loading ? (
          <div className="h-[60vh] flex flex-col items-center justify-center bg-slate-900/20 border border-white/5 rounded-3xl">
            <Loader2 className="animate-spin text-emerald-500 mb-4" size={40} />
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 animate-pulse">
              Synchronizing_Data...
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {weeks.map((week, wIdx) => {
              const rowActual = week.reduce((sum, day) => {
                const dStr = day.date.toLocaleDateString('en-CA');
                const r = reports.find((rep) => rep.report_date === dStr);

                const generic = Number(r?.generic_sales || 0);
                const discount = Number(r?.discount_total || 0);
                const actualGeneric = generic - discount;

                return sum + actualGeneric;
              }, 0);

              return (
                <div key={wIdx} className="grid grid-cols-8 gap-2">
                  {week.map((day, dIdx) => {
                    const dStr = day.date.toLocaleDateString('en-CA');
                    const report = reports.find((r) => r.report_date === dStr);
                    const isToday =
                      new Date().toLocaleDateString('en-CA') === dStr;
                    const isFuture = day.date > new Date();

                    return (
                      <div
                        key={dIdx}
                        className={`min-h-[140px] p-3 rounded-xl border transition-all flex flex-col ${
                          !day.current
                            ? 'opacity-10 bg-transparent border-white/5'
                            : isFuture
                            ? 'bg-slate-900/10 border-white/5 text-slate-700'
                            : report
                            ? 'bg-slate-900/60 border-white/10 shadow-lg'
                            : 'bg-red-500/5 border-red-500/20'
                        } ${
                          isToday
                            ? 'ring-1 ring-emerald-500/40 border-emerald-500/40'
                            : ''
                        }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <span
                            className={`text-[13px] font-black ${
                              day.current ? 'text-white' : 'text-slate-700'
                            }`}
                          >
                            {day.day}
                          </span>

                          {report && (
                            <button
                              onClick={() =>
                                toggleVerification(report.id, report.is_checked)
                              }
                              className={`${
                                report.is_checked
                                  ? 'text-emerald-500'
                                  : profile?.role?.toLowerCase() === 'staff'
                                  ? 'text-slate-800 opacity-30 cursor-not-allowed'
                                  : 'text-orange-500 animate-pulse cursor-pointer'
                              }`}
                            >
                              <CheckCircle2 size={14} />
                            </button>
                          )}
                        </div>

                        {report ? (
                          <div className="flex-1 text-[10px] space-y-1 font-mono">
                            {/* Gross Generic - now de-emphasized */}
                            <div className="flex justify-between px-2 py-1">
                              <span className="text-slate-400">
                                GENERIC (Gross)
                              </span>
                              <span className="font-medium text-slate-300">
                                ₱
                                {Number(
                                  report.generic_sales || 0
                                ).toLocaleString()}
                              </span>
                            </div>

                            {/* Discounts */}
                            <div className="flex justify-between px-2 py-1">
                              <span className="text-slate-400">Discounts</span>
                              <span className="font-medium text-orange-400">
                                ₱
                                {Number(
                                  report.discount_total || 0
                                ).toLocaleString()}
                              </span>
                            </div>

                            {/* ACTUAL GENERIC - NOW HIGHLIGHTED (this is what you wanted) */}
                            <div className="flex justify-between bg-emerald-500/10 px-2 py-1.5 rounded border border-emerald-500/30">
                              <span className="font-black text-emerald-400">
                                ACTUAL GENERIC
                              </span>
                              <span className="font-black text-white">
                                ₱
                                {(
                                  Number(report.generic_sales || 0) -
                                  Number(report.discount_total || 0)
                                ).toLocaleString()}
                              </span>
                            </div>

                            {/* Branded */}
                            <div className="flex justify-between px-2 py-1">
                              <span className="text-slate-400">BRANDED</span>
                              <span className="font-medium">
                                ₱
                                {Number(
                                  report.branded_sales || 0
                                ).toLocaleString()}
                              </span>
                            </div>

                            {/* Actual Sales */}
                            <div className="flex justify-between px-2 py-1 border-t border-white/10 pt-1">
                              <span className="font-black text-emerald-400">
                                ACTUAL SALES
                              </span>
                              <span className="font-black text-white">
                                ₱
                                {(
                                  Number(report.generic_sales || 0) -
                                  Number(report.discount_total || 0) +
                                  Number(report.branded_sales || 0)
                                ).toLocaleString()}
                              </span>
                            </div>

                            {/* Actual Cash */}
                            <div className="flex justify-between px-2 py-1">
                              <span className="text-slate-400">
                                Actual Cash
                              </span>
                              <span className="font-medium">
                                ₱
                                {Number(
                                  report.actual_cash || 0
                                ).toLocaleString()}
                              </span>
                            </div>

                            {/* Expenses */}
                            <div className="flex justify-between px-2 py-1">
                              <span className="text-slate-400">Expenses</span>
                              <span className="font-medium text-red-400">
                                ₱{Number(report.expenses || 0).toLocaleString()}
                              </span>
                            </div>

                            {/* Excess */}
                            <div className="flex justify-between px-2 py-1 border-t border-white/10 pt-1">
                              <span className="text-slate-400">Excess</span>
                              <span className="font-medium text-emerald-400">
                                ₱
                                {(
                                  Number(report.actual_cash || 0) -
                                  (Number(report.generic_sales || 0) -
                                    Number(report.discount_total || 0) +
                                    Number(report.branded_sales || 0))
                                ).toLocaleString()}
                              </span>
                            </div>

                            {/* Reported / Verified */}
                            <div className="pt-2 border-t border-white/10 text-[9px] text-slate-500 mt-auto">
                              <div>
                                Reported:{' '}
                                <span className="text-white">
                                  {report.reported_by || '-'}
                                </span>
                              </div>
                              {report.is_checked && report.checked_by && (
                                <div>
                                  Verified:{' '}
                                  <span className="text-emerald-400">
                                    {report.checked_by}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          day.current &&
                          !isFuture && (
                            <div className="flex flex-col items-center justify-center mt-6 opacity-40">
                              <AlertCircle
                                size={16}
                                className="text-red-500 mb-1"
                              />
                              <span className="text-[9px] font-black text-red-500 uppercase">
                                Missing Report
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    );
                  })}

                  {/* Weekly Quota Column */}
                  {/* Weekly Quota Column - Now based on Actual Generic */}
                  <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-3 flex flex-col justify-center items-center shadow-inner">
                    <p className="text-[9px] font-black text-emerald-500/40 uppercase mb-1 tracking-tighter">
                      WEEKLY ACTUAL GENERIC
                    </p>
                    <p className="text-xs font-black text-white">
                      ₱{rowActual.toLocaleString()}
                    </p>
                    <div className="w-full h-1 bg-black rounded-full mt-3 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                        style={{
                          width: `${Math.min(
                            (rowActual / (dailyGenQuota * 7)) * 100,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                    <p className="text-[8px] font-bold text-slate-600 mt-2">
                      Goal: ₱{(dailyGenQuota * 7).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* VERIFICATION MODAL */}
      {showVerificationModal && (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/30 rounded-3xl w-full max-w-md p-8">
            <h3 className="text-xl font-black uppercase text-white mb-6">
              Verify Report
            </h3>

            <div className="space-y-6">
              <div>
                <label className="block text-xs font-black text-emerald-400 mb-2">
                  Actual Remittance
                </label>
                <input
                  type="number"
                  value={actualRemittance}
                  onChange={(e) =>
                    setActualRemittance(Number(e.target.value) || 0)
                  }
                  className="w-full bg-slate-950 border border-white/10 rounded-2xl px-4 py-3 text-white font-mono text-lg focus:border-emerald-500 outline-none"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-emerald-400 mb-2">
                  Savings
                </label>
                <input
                  type="number"
                  value={savings}
                  onChange={(e) => setSavings(Number(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-white/10 rounded-2xl px-4 py-3 text-white font-mono text-lg focus:border-emerald-500 outline-none"
                  placeholder="0"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowVerificationModal(false)}
                  className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 rounded-2xl text-white font-black text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmVerification}
                  className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-500 rounded-2xl text-white font-black text-sm"
                >
                  Confirm Verification
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
