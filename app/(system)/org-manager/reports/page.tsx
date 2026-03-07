'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  ArrowLeft,
  Loader2,
  Trophy,
  Target,
  BarChart3,
  Zap,
  TrendingUp,
  Users,
  Building2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

type ViewMode = 'generic' | 'total';

export default function MasterIntelligenceHub() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('generic');
  const [currentDate, setCurrentDate] = useState(new Date());

  const [reportData, setReportData] = useState<{
    sales: any[];
    branches: any[];
    staff: any[];
  }>({ sales: [], branches: [], staff: [] });

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  useEffect(() => {
    fetchOrgs();
  }, []);

  useEffect(() => {
    if (selectedOrg) fetchReportData();
  }, [selectedOrg, currentDate]);

  async function fetchOrgs() {
    const { data } = await supabase
      .from('organizations')
      .select('*')
      .order('name');
    if (data) setOrganizations(data);
    setLoading(false);
  }

  async function fetchReportData() {
    setDataLoading(true);
    // Adjusted range to include overflow days for full weekly rows
    const start = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      -7
    ).toISOString();
    const end = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() + 1,
      7
    ).toISOString();

    try {
      const { data: branches } = await supabase
        .from('branches')
        .select('*')
        .eq('org_id', selectedOrg);
      const branchIds = branches?.map((b) => b.id) || [];

      const [salesRes, staffRes] = await Promise.all([
        supabase
          .from('orders')
          .select('*')
          .in('branch_id', branchIds)
          .gte('created_at', start)
          .lte('created_at', end),
        supabase.from('profiles').select('*').in('branch_id', branchIds),
      ]);

      setReportData({
        branches: branches || [],
        sales: salesRes.data || [],
        staff: staffRes.data || [],
      });
    } finally {
      setDataLoading(false);
    }
  }

  // MONTHLY QUOTA DIAGNOSTICS
  const monthlyMetrics = useMemo(() => {
    return reportData.branches.map((branch) => {
      // Filter sales ONLY for the active month
      const mSales = reportData.sales.filter(
        (s) =>
          String(s.branch_id) === String(branch.id) &&
          new Date(s.created_at).getMonth() === currentDate.getMonth()
      );

      const genActual = mSales.reduce(
        (acc, s) => acc + (Number(s.generic_amt) || 0),
        0
      );
      const totalActual = mSales.reduce(
        (acc, s) => acc + (Number(s.total_price || s.total_amount) || 0),
        0
      );

      return {
        name: branch.branch_name,
        genActual,
        genQuota: branch.monthly_generic_quota || 0,
        totalActual,
        totalQuota: branch.monthly_total_quota || 0,
        genReached: genActual >= (branch.monthly_generic_quota || 0),
        totalReached: totalActual >= (branch.monthly_total_quota || 0),
      };
    });
  }, [reportData, currentDate]);

  // LEADERBOARD LOGIC
  const topPerformers = useMemo(() => {
    if (!monthlyMetrics.length) return { branch: null, staff: null };
    const bestBranch = [...monthlyMetrics].sort(
      (a, b) => b.totalActual - a.totalActual
    )[0];

    const staffRank = reportData.staff
      .map((s) => {
        const total = reportData.sales
          .filter(
            (sale) =>
              (sale.staff_id === s.id || sale.created_by === s.id) &&
              new Date(sale.created_at).getMonth() === currentDate.getMonth()
          )
          .reduce(
            (acc, sale) =>
              acc + (Number(sale.total_price || sale.total_amount) || 0),
            0
          );
        return { name: s.full_name, total };
      })
      .sort((a, b) => b.total - a.total)[0];

    return { branch: bestBranch, staff: staffRank };
  }, [monthlyMetrics, reportData, currentDate]);

  const weeks = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const startDay = new Date(year, month, 1);
    startDay.setDate(startDay.getDate() - startDay.getDay());
    const endDay = new Date(year, month + 1, 0);
    endDay.setDate(endDay.getDate() + (6 - endDay.getDay()));

    const w = [];
    let currentIter = new Date(startDay);
    while (currentIter <= endDay) {
      const days = [];
      for (let i = 0; i < 7; i++) {
        days.push(new Date(currentIter));
        currentIter.setDate(currentIter.getDate() + 1);
      }
      w.push(days);
    }
    return w;
  }, [currentDate]);

  if (loading)
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500" />
      </div>
    );

  return (
    <div className="min-h-screen bg-[#020617] text-slate-300 p-4 md:p-8 font-sans">
      {/* HUD HEADER */}
      <header className="max-w-[1800px] mx-auto mb-10 space-y-6">
        <div className="flex flex-col xl:flex-row justify-between items-stretch gap-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="p-3 bg-slate-900 rounded-2xl border border-white/5 text-emerald-500"
              >
                <ArrowLeft size={20} />
              </button>
              <h1 className="text-3xl font-black text-white uppercase italic tracking-tighter leading-none">
                Intelligence_Reports
              </h1>
            </div>
            <select
              className="bg-slate-900 border border-emerald-500/30 px-5 py-3 rounded-xl text-[10px] font-black uppercase text-white outline-none w-full xl:w-64"
              value={selectedOrg}
              onChange={(e) => setSelectedOrg(e.target.value)}
            >
              <option value="">Select Organization</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>

          {selectedOrg && !dataLoading && (
            <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
              <div className="min-w-[250px] flex-1 bg-emerald-600/10 border border-emerald-500/20 p-5 rounded-[2rem] flex items-center gap-5">
                <Trophy className="text-emerald-500" size={32} />
                <div>
                  <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">
                    Top Branch (MTD)
                  </p>
                  <p className="text-lg font-black text-white uppercase italic truncate">
                    {topPerformers.branch?.name || '---'}
                  </p>
                </div>
              </div>
              <div className="min-w-[250px] flex-1 bg-purple-600/10 border border-purple-500/20 p-5 rounded-[2rem] flex items-center gap-5">
                <Users className="text-purple-500" size={32} />
                <div>
                  <p className="text-[8px] font-black text-purple-400 uppercase tracking-widest">
                    Top Staff (MTD)
                  </p>
                  <p className="text-lg font-black text-white uppercase italic truncate">
                    {topPerformers.staff?.name || '---'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* MONTHLY QUOTA DIAGNOSTIC TABLE */}
        {selectedOrg && !dataLoading && (
          <div className="bg-slate-900/40 border border-white/5 rounded-[2rem] p-6 overflow-x-auto">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.4em] mb-4 flex items-center gap-2">
              <Target size={14} className="text-emerald-500" /> Monthly Quota
              Diagnostic
            </h3>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="pb-3 text-[9px] font-black text-slate-600 uppercase">
                    Branch Node
                  </th>
                  <th className="pb-3 text-[9px] font-black text-slate-600 uppercase">
                    Generic Status
                  </th>
                  <th className="pb-3 text-[9px] font-black text-slate-600 uppercase">
                    Gross Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {monthlyMetrics.map((m, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0">
                    <td className="py-3 text-xs font-black text-white uppercase italic">
                      {m.name}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        {m.genReached ? (
                          <CheckCircle2
                            size={14}
                            className="text-emerald-500"
                          />
                        ) : (
                          <XCircle size={14} className="text-red-500" />
                        )}
                        <span
                          className={`text-[10px] font-mono ${
                            m.genReached ? 'text-emerald-400' : 'text-slate-500'
                          }`}
                        >
                          ₱{m.genActual.toLocaleString()} / ₱
                          {m.genQuota.toLocaleString()}
                        </span>
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        {m.totalReached ? (
                          <CheckCircle2
                            size={14}
                            className="text-emerald-500"
                          />
                        ) : (
                          <XCircle size={14} className="text-red-500" />
                        )}
                        <span
                          className={`text-[10px] font-mono ${
                            m.totalReached
                              ? 'text-emerald-400'
                              : 'text-slate-500'
                          }`}
                        >
                          ₱{m.totalActual.toLocaleString()} / ₱
                          {m.totalQuota.toLocaleString()}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-6 bg-slate-900/40 p-4 rounded-3xl border border-white/5">
          <div className="flex bg-slate-950 p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setViewMode('generic')}
              className={`px-5 py-2.5 rounded-lg text-[9px] font-black uppercase transition-all ${
                viewMode === 'generic'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-slate-500'
              }`}
            >
              Generic View
            </button>
            <button
              onClick={() => setViewMode('total')}
              className={`px-5 py-2.5 rounded-lg text-[9px] font-black uppercase transition-all ${
                viewMode === 'total'
                  ? 'bg-emerald-600 text-white shadow-lg'
                  : 'text-slate-500'
              }`}
            >
              Totals View
            </button>
          </div>
          <div className="flex items-center gap-6">
            <button
              onClick={() =>
                setCurrentDate(
                  new Date(currentDate.setMonth(currentDate.getMonth() - 1))
                )
              }
              className="p-2 hover:text-emerald-500"
            >
              <ChevronLeft size={20} />
            </button>
            <h2 className="text-xs font-black text-white uppercase tracking-widest">
              {currentDate.toLocaleDateString(undefined, {
                month: 'long',
                year: 'numeric',
              })}
            </h2>
            <button
              onClick={() =>
                setCurrentDate(
                  new Date(currentDate.setMonth(currentDate.getMonth() + 1))
                )
              }
              className="p-2 hover:text-emerald-500"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* MASTER GRID SECTION */}
      {selectedOrg && !dataLoading && (
        <main className="max-w-[1800px] mx-auto space-y-16">
          {weeks.map((week, wIdx) => (
            <div
              key={wIdx}
              className="animate-in fade-in slide-in-from-bottom-4 duration-500"
            >
              <div className="grid grid-cols-8 gap-3 mb-4 px-2">
                {weekdays.map((day, dIdx) => (
                  <div key={dIdx} className="text-center">
                    <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">
                      {day}
                    </span>
                    <p
                      className={`text-[10px] font-black ${
                        week[dIdx].getMonth() === currentDate.getMonth()
                          ? 'text-white'
                          : 'text-slate-800'
                      }`}
                    >
                      {week[dIdx].getDate()}
                    </p>
                  </div>
                ))}
                <div className="text-center">
                  <span className="text-[8px] font-black text-emerald-500 uppercase">
                    Week Var
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {reportData.branches.map((branch) => {
                  let weekGen = 0;
                  let weekTot = 0;
                  return (
                    <div
                      key={branch.id}
                      className="grid grid-cols-8 gap-3 items-center"
                    >
                      {week.map((date, dIdx) => {
                        const daySales = reportData.sales.filter(
                          (s) =>
                            String(s.branch_id) === String(branch.id) &&
                            new Date(s.created_at).toDateString() ===
                              date.toDateString()
                        );
                        const gen = daySales.reduce(
                          (acc, s) => acc + (Number(s.generic_amt) || 0),
                          0
                        );
                        const tot = daySales.reduce(
                          (acc, s) =>
                            acc +
                            (Number(s.total_price || s.total_amount) || 0),
                          0
                        );
                        weekGen += gen;
                        weekTot += tot;

                        const val = viewMode === 'generic' ? gen : tot;
                        const quota =
                          viewMode === 'generic'
                            ? branch.daily_generic_quota || 0
                            : branch.daily_total_quota || 0;
                        const success = val >= quota && quota > 0;

                        return (
                          <div
                            key={dIdx}
                            className={`h-14 rounded-xl border flex flex-col justify-center px-3 ${
                              success
                                ? 'bg-emerald-500/10 border-emerald-500/20'
                                : 'bg-slate-900/30 border-white/5'
                            }`}
                          >
                            <span className="text-[6px] font-black text-slate-500 uppercase truncate mb-0.5">
                              {branch.branch_name}
                            </span>
                            <span
                              className={`text-[9px] font-mono font-black ${
                                success
                                  ? 'text-emerald-400'
                                  : val > 0
                                  ? 'text-red-400'
                                  : 'text-slate-700'
                              }`}
                            >
                              ₱{val.toLocaleString()}
                            </span>
                          </div>
                        );
                      })}
                      <div className="h-14 rounded-xl bg-slate-950 border border-emerald-500/20 px-3 flex flex-col justify-center text-right">
                        <span className="text-[9px] font-mono font-black text-white">
                          ₱
                          {(viewMode === 'generic'
                            ? weekGen
                            : weekTot
                          ).toLocaleString()}
                        </span>
                        <span
                          className={`text-[7px] font-black font-mono ${
                            (
                              viewMode === 'generic'
                                ? weekGen >= branch.weekly_generic_avg
                                : weekTot >= branch.weekly_total_avg
                            )
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }`}
                        >
                          {(viewMode === 'generic'
                            ? weekGen - branch.weekly_generic_avg
                            : weekTot - branch.weekly_total_avg
                          ).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </main>
      )}
    </div>
  );
}
