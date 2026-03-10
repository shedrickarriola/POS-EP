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
  History,
  Target,
  Loader2,
} from 'lucide-react';

export default function ReportsAuditPage() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // FIXED: State moved inside the component body
  const [branch, setBranch] = useState<any>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('active_branch');
      return saved ? JSON.parse(saved) : null;
    }
    return null;
  });

  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    fetchData();
  }, [currentDate]);

  const fetchData = async () => {
    setLoading(true);

    // 1. Get User
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return router.push('/login');

    // 2. Get Profile AND Branch in one go
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*, branches(*)')
      .eq('id', user.id)
      .single();

    if (profileData) {
      setProfile(profileData);

      // Prioritize the branch linked to the profile
      const activeBranch = profileData.branches;
      if (activeBranch) {
        setBranch(activeBranch);

        // 3. Fetch Reports using the confirmed branch ID
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

        const { data: reportsData } = await supabase
          .from('daily_reports')
          .select('*')
          .eq('branch_id', activeBranch.id) // Using the ID directly from the fetch
          .gte('report_date', start.toISOString().split('T')[0])
          .lte('report_date', end.toISOString().split('T')[0]);

        setReports(reportsData || []);
      }
    }
    setLoading(false);
  };

  const handleVerify = async (id: string) => {
    // Convert to lowercase to prevent "staff" vs "Staff" bypass
    const userRole = profile?.role?.toLowerCase();

    if (userRole === 'staff') {
      alert(
        'Access Denied: Staff members are not authorized to verify reports.'
      );
      return;
    }

    const { error } = await supabase
      .from('daily_reports')
      .update({ is_checked: true })
      .eq('id', id);

    if (!error) {
      setReports((prev) =>
        prev.map((r) => (r.id === id ? { ...r, is_checked: true } : r))
      );
    }
  };

  // CALENDAR GENERATION LOGIC
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
                {'Branch_Audit'}
              </h1>
              {/* FIXED: Specific styling for branch and role as requested */}
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
        </div>

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
                return sum + Number(r?.generic_sales || 0);
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
                        className={`min-h-[110px] p-3 rounded-xl border transition-all ${
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
                            className={`text-[10px] font-black ${
                              day.current ? 'text-white' : 'text-slate-700'
                            }`}
                          >
                            {day.day}
                          </span>
                          {report && (
                            <button
                              onClick={() => {
                                const isStaff =
                                  profile?.role?.toLowerCase() === 'staff';
                                if (isStaff || report.is_checked) return;
                                handleVerify(report.id);
                              }}
                              className={`${
                                report.is_checked
                                  ? 'text-emerald-500'
                                  : profile?.role?.toLowerCase() === 'staff'
                                  ? 'text-slate-800 opacity-30 cursor-not-allowed' // Make it very dim for staff
                                  : 'text-orange-500 animate-pulse cursor-pointer'
                              }`}
                              title={
                                profile?.role?.toLowerCase() === 'staff'
                                  ? 'Admin only'
                                  : ''
                              }
                            >
                              <CheckCircle2 size={14} />
                            </button>
                          )}
                        </div>
                        {report ? (
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold text-emerald-400">
                              ₱{Number(report.generic_sales).toLocaleString()}
                            </p>
                            <p className="text-[8px] text-slate-500 font-bold uppercase">
                              Total: ₱
                              {Number(report.total_sales).toLocaleString()}
                            </p>
                          </div>
                        ) : (
                          day.current &&
                          !isFuture && (
                            <div className="flex flex-col items-center justify-center mt-2 opacity-40">
                              <AlertCircle
                                size={12}
                                className="text-red-500 mb-1"
                              />
                              <span className="text-[7px] font-black text-red-500 uppercase">
                                Missing
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    );
                  })}

                  <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-3 flex flex-col justify-center items-center shadow-inner">
                    <p className="text-[9px] font-black text-emerald-500/40 uppercase mb-1 tracking-tighter">
                      Weekly_Total
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
    </div>
  );
}
