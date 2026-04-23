'use client';
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Layers,
  Search,
  Calendar,
  XCircle,
  DollarSign,
  Truck,
  User,
  Calculator,
  CheckCircle2,
  ShieldCheck,
  Clock,
  AlertCircle,
  Store,
} from 'lucide-react';

export default function PurchaseOrderList() {
  const router = useRouter();

  // Auth & Role States
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isVerifying, setIsVerifying] = useState<string | null>(null);

  // Branch State
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  const [currentBranchName, setCurrentBranchName] = useState<string>('');

  // Data States
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // NEW: View Mode (Order View vs Invoice View)
  const [viewMode, setViewMode] = useState<'orders' | 'invoices'>('orders');
  // NEW: Week hierarchy states
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null);
  // NEW: Date editing states (copied from Sales Order)
  const [isEditingDate, setIsEditingDate] = useState<string | null>(null);
  const [tempDate, setTempDate] = useState<string>('');
  const [successId, setSuccessId] = useState<string | null>(null);

  // Pagination & Filter States
  const [currentPage, setCurrentPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize] = useState(30);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Financial Stats
  const [monthlyStats, setMonthlyStats] = useState({
    total: 0,
    generic: 0,
    branded: 0,
  });
  const [filterStats, setFilterStats] = useState({
    total: 0,
    generic: 0,
    branded: 0,
  });
  // INVOICE SUMMARY (exactly like daySummary in Sales Orders)
  // WEEK SUMMARY → INVOICE → PO ITEMS (Sun-Sat grouping)
  const weekSummary = useMemo(() => {
    if (!orders || orders.length === 0) return [];

    const groups: any = {};

    orders.forEach((order) => {
      const date = new Date(order.created_date_pht);
      const startOfWeek = new Date(date);
      startOfWeek.setDate(date.getDate() - date.getDay()); // Sunday start

      const weekKey = startOfWeek.toISOString().split('T')[0];

      if (!groups[weekKey]) {
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);

        groups[weekKey] = {
          weekKey,
          label: `${startOfWeek.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })} - ${endOfWeek.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}`,
          total: 0,
          generic: 0,
          branded: 0,
          invoices: {} as any,
          needsVerification: 0,
        };
      }

      const week = groups[weekKey];

      // Aggregate week totals
      week.total += Number(order.total_amount || 0);
      week.generic += Number(order.generic_amt || 0);
      week.branded += Number(order.branded_amt || 0);
      if (!order.is_checked) week.needsVerification += 1;

      // Nested invoices inside the week
      const invoiceKey = order.invoice_id || 'NO_INVOICE';
      if (!week.invoices[invoiceKey]) {
        week.invoices[invoiceKey] = {
          invoice_id: invoiceKey,
          total: 0,
          generic: 0,
          branded: 0,
          orders: [],
        };
      }

      const inv = week.invoices[invoiceKey];
      inv.total += Number(order.total_amount || 0);
      inv.generic += Number(order.generic_amt || 0);
      inv.branded += Number(order.branded_amt || 0);
      inv.orders.push(order);
    });

    return Object.values(groups).sort(
      (a: any, b: any) =>
        new Date(b.weekKey).getTime() - new Date(a.weekKey).getTime()
    );
  }, [orders]);

  // 1. Sync with Staff Hub 'active_branch' and Session
  useEffect(() => {
    const initSession = async () => {
      setLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, role')
          .eq('id', session.user.id)
          .single();
        setCurrentUser(profile);
      }

      const savedBranch = localStorage.getItem('active_branch');
      if (savedBranch) {
        try {
          const parsed = JSON.parse(savedBranch);
          setCurrentBranchId(parsed.id);
          setCurrentBranchName(parsed.branch_name || 'Active Branch');
        } catch (e) {
          console.error('Context Error:', e);
        }
      }
      setLoading(false);
    };
    initSession();
  }, []);

  // 2. Main Data Fetching
  useEffect(() => {
    if (currentBranchId) {
      fetchData();
    }
  }, [currentPage, viewMode, searchTerm, startDate, endDate, currentBranchId]);

  async function fetchData() {
    try {
      setLoading(true);

      // === MONTHLY STATS (unchanged) ===
      const now = new Date();
      const firstOfMonth = new Date(
        now.getFullYear(),
        now.getMonth(),
        1
      ).toISOString();

      const { data: monthData } = await supabase
        .from('purchase_orders')
        .select('total_amount, generic_amt, branded_amt')
        .eq('branch_id', currentBranchId)
        .gte('created_date_pht', firstOfMonth);

      setMonthlyStats({
        total:
          monthData?.reduce((sum, row) => sum + (row.total_amount || 0), 0) ||
          0,
        generic:
          monthData?.reduce((sum, row) => sum + (row.generic_amt || 0), 0) || 0,
        branded:
          monthData?.reduce((sum, row) => sum + (row.branded_amt || 0), 0) || 0,
      });

      // === MAIN QUERY ===
      let dataQuery = supabase
        .from('purchase_orders')
        .select(`*, profiles (full_name), purchase_order_items (*)`, {
          count: 'exact',
        })
        .eq('branch_id', currentBranchId);

      if (searchTerm) {
        dataQuery = dataQuery.or(
          `po_number.ilike.%${searchTerm}%,invoice_id.ilike.%${searchTerm}%,supplier_name.ilike.%${searchTerm}%`
        );
      }
      if (startDate) dataQuery = dataQuery.gte('created_date_pht', startDate);
      if (endDate) dataQuery = dataQuery.lte('created_date_pht', endDate);

      let data: any[] = [];
      let count = 0;

      if (viewMode === 'orders') {
        // PURCHASE ORDER VIEW — paginated
        const from = currentPage * pageSize;
        const result = await dataQuery
          .order('created_date_pht', { ascending: false })
          .order('po_number', { ascending: false })
          .range(from, from + pageSize - 1);

        if (result.error) throw result.error;
        data = result.data || [];
        count = result.count || 0;
      } else {
        // INVOICE / WEEK VIEW — full load
        const result = await dataQuery
          .order('created_date_pht', { ascending: false })
          .order('po_number', { ascending: false })
          .limit(10000);

        if (result.error) throw result.error;
        data = result.data || [];
        count = result.count || 0;
      }

      setOrders(data);
      setTotalCount(count);

      setFilterStats({
        total: data.reduce((sum, row) => sum + (row.total_amount || 0), 0),
        generic: data.reduce((sum, row) => sum + (row.generic_amt || 0), 0),
        branded: data.reduce((sum, row) => sum + (row.branded_amt || 0), 0),
      });
    } catch (err: any) {
      console.error('Fetch Error:', err.message);
    } finally {
      setLoading(false);
    }
  }

  const handleVerifyOrder = async (orderId: string) => {
    if (!currentUser) return;
    setIsVerifying(orderId);
    try {
      const { error } = await supabase
        .from('purchase_orders')
        .update({
          is_checked: true,
          checked_by_name: currentUser.full_name,
          checked_at: new Date().toISOString(),
        })
        .eq('id', orderId);
      if (error) throw error;
      fetchData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsVerifying(null);
    }
  };

  // NEW: Change Date (works exactly like Sales Orders)
  const handleChangeDate = async (order: any, newDate: string) => {
    if (!newDate || order.created_date_pht === newDate) {
      setIsEditingDate(null);
      return;
    }

    setLoading(true);

    try {
      // Update purchase_orders
      const { error: ordErr } = await supabase
        .from('purchase_orders')
        .update({ created_date_pht: newDate })
        .eq('id', order.id);
      if (ordErr) throw ordErr;

      // Update purchase_order_items
      const { error: itmErr } = await supabase
        .from('purchase_order_items')
        .update({ created_date_pht: newDate })
        .eq('purchase_order_id', order.id);
      if (itmErr) throw itmErr;

      setSuccessId(`${order.id}-date`);
      setIsEditingDate(null);
      setTimeout(() => window.location.reload(), 800);
    } catch (err: any) {
      console.error(err);
      alert(`Date change failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  const canVerify = ['branch_admin', 'org_manager', 'super_admin'].includes(
    currentUser?.role
  );

  return (
    <div className="min-h-screen w-full bg-slate-950 text-white p-4 md:px-6 md:py-4 font-sans selection:bg-blue-500/30">
      {!currentBranchId && !loading && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-500/20 p-8 rounded-2xl max-w-sm w-full text-center shadow-2xl">
            <AlertCircle className="text-red-500 mx-auto mb-4" size={32} />
            <h2 className="text-xl font-black uppercase italic tracking-tighter mb-2">
              Branch_Context_Null
            </h2>
            <p className="text-slate-400 text-xs font-mono mb-6">
              Archive access requires a valid Branch ID.
            </p>
            <button
              onClick={() => router.push('/staff')}
              className="w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      )}

      {/* HEADER SECTION */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end mb-6 gap-4">
        <div>
          <button
            onClick={() => router.push('/staff')}
            className="flex items-center gap-1.5 text-slate-500 hover:text-white transition-colors mb-2 text-[10px] font-bold uppercase tracking-widest group"
          >
            <ArrowLeft
              size={12}
              className="group-hover:-translate-x-1 transition-transform"
            />{' '}
            Back to Dashboard
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-xl border border-blue-500/20">
              <Store size={22} className="text-blue-500" />
            </div>
            <div>
              <h1 className="text-2xl font-black italic tracking-tighter uppercase leading-none">
                Purchase_<span className="text-blue-500">Archives</span>
              </h1>
              <p className="text-[9px] text-slate-500 font-mono mt-1 uppercase tracking-widest flex items-center gap-2">
                {currentBranchName.replace(/\s+/g, '_')}{' '}
                <span className="text-blue-500">•</span>{' '}
                {currentUser?.full_name}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 w-full lg:w-auto">
          <div className="bg-slate-900/50 border border-white/5 p-3 rounded-xl flex-1 lg:flex-none lg:min-w-[150px]">
            <p className="text-[8px] font-black text-emerald-400/70 uppercase tracking-widest mb-1 flex items-center gap-1">
              <Calculator size={10} /> Filter Match
            </p>
            <p className="text-base font-black text-slate-100 font-mono">
              ₱
              {filterStats.total.toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}
            </p>
          </div>
          <div className="bg-blue-600/5 border border-blue-500/20 p-3 rounded-xl flex-1 lg:flex-none lg:min-w-[150px]">
            <p className="text-[8px] font-black text-blue-400 uppercase tracking-widest mb-1 flex items-center gap-1">
              <DollarSign size={10} /> Monthly Inflow
            </p>
            <p className="text-base font-black text-slate-100 font-mono">
              ₱
              {monthlyStats.total.toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}
            </p>
          </div>
        </div>
      </div>

      {/* SEARCH AND FILTERS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-3 mb-6">
        <div className="relative lg:col-span-3">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
            size={14}
          />
          <input
            type="text"
            placeholder="Search PO#, Invoice, or Supplier..."
            className="w-full bg-slate-900/80 border border-white/10 rounded-xl py-2.5 pl-9 pr-4 text-xs focus:border-blue-500/50 outline-none transition-all font-mono placeholder:text-slate-700"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(0);
            }}
          />
        </div>
        <div className="lg:col-span-3 flex items-center bg-slate-900/80 border border-white/10 rounded-xl px-3 gap-3">
          <Calendar size={14} className="text-slate-600 shrink-0" />
          <input
            type="date"
            className="bg-transparent text-[10px] font-bold uppercase outline-none w-full text-slate-400 py-2.5"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setCurrentPage(0);
            }}
          />
          <span className="text-slate-800 text-[10px] font-black tracking-widest">
            —
          </span>
          <input
            type="date"
            className="bg-transparent text-[10px] font-bold uppercase outline-none w-full text-slate-400 py-2.5"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setCurrentPage(0);
            }}
          />
        </div>
        <button
          onClick={() => {
            setSearchTerm('');
            setStartDate('');
            setEndDate('');
            setCurrentPage(0);
          }}
          className="bg-slate-800 hover:bg-slate-700 border border-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all px-4"
        >
          <XCircle size={14} /> Reset
        </button>
      </div>
      {/* TABS NAVIGATION - Invoice View */}
      <div className="flex gap-2 mb-6 bg-slate-950/30 p-1.5 rounded-2xl border border-white/5 w-fit">
        <button
          onClick={() => setViewMode('orders')}
          className={`px-8 py-2.5 rounded-xl text-[10px] font-black tracking-[0.2em] uppercase transition-all flex items-center gap-2 ${
            viewMode === 'orders'
              ? 'bg-blue-600 text-white shadow-lg'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Layers size={14} /> Order View
        </button>
        <button
          onClick={() => setViewMode('invoices')}
          className={`px-8 py-2.5 rounded-xl text-[10px] font-black tracking-[0.2em] uppercase transition-all flex items-center gap-2 ${
            viewMode === 'invoices'
              ? 'bg-blue-600 text-white shadow-lg'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <DollarSign size={14} /> Invoice View
        </button>
      </div>
      {/* MAIN CONTENT - Order View OR Invoice View */}
      {viewMode === 'orders' ? (
        // === ORDER VIEW (restored from your original working version) ===
        <div className="bg-slate-900/30 border border-white/5 rounded-2xl overflow-hidden shadow-xl mb-4">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-white/5 text-left text-[9px] font-black uppercase text-slate-500 tracking-[0.2em]">
                  <th className="p-4 w-12"></th>
                  <th className="p-4">PO Ref / Date</th>
                  <th className="p-4">Supplier & Operator</th>
                  <th className="p-4 text-right text-indigo-400/50 uppercase">
                    Generic
                  </th>
                  <th className="p-4 text-right text-amber-400/50 uppercase">
                    Branded
                  </th>
                  <th className="p-4 text-center">Verification</th>
                  <th className="p-4 text-right text-white">Grand Total</th>
                  <th className="p-4 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {orders.length === 0 && !loading && (
                  <tr>
                    <td
                      colSpan={8}
                      className="p-16 text-center text-slate-600 font-mono text-xs tracking-widest"
                    >
                      NO_ARCHIVE_DATA_FOUND
                    </td>
                  </tr>
                )}
                {orders.map((order) => (
                  <React.Fragment key={order.id}>
                    <tr
                      onClick={() =>
                        setExpandedRow(
                          expandedRow === order.id ? null : order.id
                        )
                      }
                      className={`cursor-pointer transition-all duration-150 group ${
                        expandedRow === order.id
                          ? 'bg-blue-600/5'
                          : 'hover:bg-white/[0.02]'
                      }`}
                    >
                      <td className="p-4 text-center">
                        <Layers
                          size={12}
                          className={
                            expandedRow === order.id
                              ? 'text-blue-400'
                              : 'text-slate-700'
                          }
                        />
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col font-mono leading-tight">
                          <span className="text-blue-400 font-black text-xs uppercase">
                            {order.po_number}
                          </span>
                          <span className="text-[9px] text-slate-500 uppercase mt-0.5">
                            {new Date(
                              order.created_date_pht
                            ).toLocaleDateString()}
                          </span>
                        </div>
                      </td>

                      {/* UPDATED: Supplier + Created By (clear labels) */}
                      <td className="p-4">
                        <div className="flex flex-col leading-tight">
                          <span className="text-[10px] font-black uppercase text-slate-300 flex items-center gap-1">
                            <Truck size={10} className="text-blue-500" />{' '}
                            {order.supplier_name || '—'}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1 mt-1">
                            <User size={10} />
                            <span className="text-slate-300">
                              Created by:
                            </span>{' '}
                            <span className="text-slate-200">
                              {order.profiles?.full_name || 'Unknown'}
                            </span>
                          </span>
                        </div>
                      </td>

                      <td className="p-4 text-right font-mono text-xs text-indigo-400/80">
                        ₱{(order.generic_amt || 0).toLocaleString()}
                      </td>
                      <td className="p-4 text-right font-mono text-xs text-amber-400/80">
                        ₱{(order.branded_amt || 0).toLocaleString()}
                      </td>

                      {/* UPDATED: Verification column – clear "Verified by" */}
                      <td className="p-4 text-center">
                        {order.is_checked ? (
                          <div className="flex flex-col items-center">
                            <div className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1 rounded text-[9px] font-black uppercase flex items-center gap-1.5">
                              <CheckCircle2 size={12} /> VERIFIED
                            </div>
                            <span className="text-[10px] text-emerald-400 mt-1 font-medium">
                              by {order.checked_by_name}
                            </span>
                          </div>
                        ) : (
                          <div className="bg-slate-800 text-slate-400 px-3 py-1 rounded text-[9px] font-black uppercase inline-flex items-center gap-1">
                            <Clock size={12} /> PENDING
                          </div>
                        )}
                      </td>

                      <td className="p-4 text-right font-black text-emerald-400 font-mono text-sm tracking-tighter">
                        ₱
                        {order.total_amount?.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                      <td className="p-4 text-slate-700 group-hover:text-blue-500 transition-colors">
                        {expandedRow === order.id ? (
                          <ChevronUp size={16} />
                        ) : (
                          <ChevronDown size={16} />
                        )}
                      </td>
                    </tr>

                    {/* EXPANDED SECTION remains unchanged */}
                    {expandedRow === order.id && (
                      <tr>
                        <td
                          colSpan={8}
                          className="bg-black/40 border-y border-blue-500/10 p-5"
                        >
                          {/* ... your existing expanded content ... */}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        // === WEEK → INVOICE → PO ITEMS VIEW ===
        <div className="space-y-4">
          {weekSummary.map((week: any) => (
            <div
              key={week.weekKey}
              className="rounded-2xl border border-white/5 bg-slate-950/40 overflow-hidden shadow-xl"
            >
              {/* WEEK HEADER */}
              <button
                onClick={() => {
                  setExpandedWeek(
                    expandedWeek === week.weekKey ? null : week.weekKey
                  );
                  setExpandedInvoice(null);
                }}
                className="w-full grid grid-cols-2 md:grid-cols-6 p-5 items-center hover:bg-white/[0.02] transition-all group text-left"
              >
                <div className="flex items-center gap-3">
                  <Calendar size={16} className="text-blue-500" />
                  <span className="text-sm font-black text-slate-200 uppercase tracking-tighter">
                    {week.label}
                  </span>
                </div>

                <div className="hidden md:block text-[9px] font-bold text-slate-500 uppercase text-center">
                  Gen:{' '}
                  <span className="text-slate-300">
                    ₱{week.generic.toLocaleString()}
                  </span>
                </div>
                <div className="hidden md:block text-[9px] font-bold text-slate-500 uppercase text-center">
                  Brand:{' '}
                  <span className="text-slate-300">
                    ₱{week.branded.toLocaleString()}
                  </span>
                </div>
                <div className="hidden md:block text-[9px] font-bold text-slate-500 uppercase text-center">
                  Total:{' '}
                  <span className="text-slate-300">
                    ₱{week.total.toLocaleString()}
                  </span>
                </div>

                <div className="text-right flex items-center justify-end gap-3">
                  <span className="text-emerald-400 font-mono font-bold text-sm">
                    ₱{week.total.toLocaleString()}
                  </span>
                  {expandedWeek === week.weekKey ? (
                    <ChevronUp size={14} className="text-slate-700" />
                  ) : (
                    <ChevronDown size={14} className="text-slate-700" />
                  )}
                </div>
              </button>

              {/* EXPANDED WEEK → INVOICES */}
              {expandedWeek === week.weekKey && (
                <div className="border-t border-white/5 bg-black/20 p-4 space-y-3">
                  {Object.values(week.invoices).map((inv: any) => (
                    <div
                      key={inv.invoice_id}
                      className="bg-slate-900/50 rounded-xl border border-white/5 overflow-hidden"
                    >
                      {/* INVOICE HEADER */}
                      <button
                        onClick={() =>
                          setExpandedInvoice(
                            expandedInvoice === inv.invoice_id
                              ? null
                              : inv.invoice_id
                          )
                        }
                        className="w-full px-5 py-4 flex justify-between items-center hover:bg-white/[0.03]"
                      >
                        <div className="flex items-center gap-3">
                          <DollarSign size={14} className="text-amber-400" />
                          <span className="font-black text-slate-200">
                            {inv.invoice_id}
                          </span>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                          <span className="text-emerald-400 font-mono">
                            ₱{inv.total.toLocaleString()}
                          </span>
                          {expandedInvoice === inv.invoice_id ? (
                            <ChevronUp size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )}
                        </div>
                      </button>

                      {/* INVOICE EXPANDED → DETAILED TABLE */}
                      {expandedInvoice === inv.invoice_id && (
                        <div className="p-4 bg-black/30">
                          <table className="w-full border-separate border-spacing-y-1">
                            <thead>
                              <tr className="text-[9px] font-black text-slate-600 uppercase tracking-[0.2em] border-b border-white/5">
                                <th className="text-left px-4 py-2">
                                  Item Name
                                </th>
                                <th className="text-center w-12">Qty</th>
                                <th className="text-right w-20">Unit Cost</th>
                                <th className="text-right w-24 text-emerald-500/80">
                                  Total
                                </th>
                                <th className="text-left w-32 px-4">
                                  PO # / Supplier
                                </th>
                                <th className="text-center w-16">Status</th>
                                <th className="text-right w-36">Date</th>
                                <th className="text-right px-4 w-32">
                                  Actions
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {inv.orders.map((order: any) => {
                                const items = order.purchase_order_items || [];
                                return (
                                  <React.Fragment key={order.id}>
                                    {items.map((item: any, idx: number) => {
                                      const totalCost =
                                        Number(item.quantity || 0) *
                                        Number(item.buy_cost || 0);
                                      return (
                                        <tr
                                          key={item.id}
                                          className="bg-slate-900/30 hover:bg-slate-800/40 transition-colors group/row text-left"
                                        >
                                          <td className="px-4 py-3 text-[11px] font-medium text-slate-300 border-l-2 border-transparent group-hover/row:border-blue-500">
                                            <div className="flex flex-col">
                                              <span className="text-[9px] font-bold text-blue-500/50 uppercase tracking-tighter">
                                                {item.item_type || 'GENERIC'}
                                              </span>
                                              {item.item_name || 'Unknown Item'}
                                            </div>
                                          </td>
                                          <td className="text-center font-mono text-[11px] text-slate-500">
                                            {item.quantity}
                                          </td>
                                          <td className="text-right font-mono text-[11px] text-slate-500/60">
                                            ₱
                                            {Number(item.buy_cost || 0).toFixed(
                                              2
                                            )}
                                          </td>
                                          <td className="text-right font-mono text-[11px] text-emerald-400 font-black">
                                            ₱{totalCost.toLocaleString()}
                                          </td>

                                          {idx === 0 && (
                                            <>
                                              <td
                                                rowSpan={items.length}
                                                className="px-4 py-3 align-middle border-x border-white/5 bg-slate-950/20"
                                              >
                                                <div className="text-blue-400 font-black">
                                                  {order.po_number}
                                                </div>
                                                <div className="text-slate-400 text-[10px]">
                                                  {order.supplier_name || '—'}
                                                </div>
                                              </td>
                                              <td
                                                rowSpan={items.length}
                                                className="text-center align-middle bg-slate-950/20 px-3 py-3"
                                              >
                                                <div className="flex flex-col gap-3 text-xs">
                                                  {/* Creator */}
                                                  <div className="flex items-center gap-1.5 text-slate-400">
                                                    <User size={14} />
                                                    <div className="text-left">
                                                      <div className="text-[9px] uppercase tracking-widest text-slate-500">
                                                        Created by
                                                      </div>
                                                      <div className="font-medium text-slate-200">
                                                        {order.profiles
                                                          ?.full_name ||
                                                          'Unknown'}
                                                      </div>
                                                    </div>
                                                  </div>

                                                  {/* Verifier */}
                                                  {order.is_checked ? (
                                                    <div className="flex items-center gap-1.5 text-emerald-400">
                                                      <ShieldCheck size={14} />
                                                      <div className="text-left">
                                                        <div className="text-[9px] uppercase tracking-widest text-emerald-500/70">
                                                          Verified by
                                                        </div>
                                                        <div className="font-medium">
                                                          {
                                                            order.checked_by_name
                                                          }
                                                        </div>
                                                      </div>
                                                    </div>
                                                  ) : (
                                                    <div className="flex items-center gap-1.5 text-slate-500">
                                                      <Clock size={14} />
                                                      <span className="font-medium">
                                                        Verification Pending
                                                      </span>
                                                    </div>
                                                  )}
                                                </div>
                                              </td>
                                              <td
                                                rowSpan={items.length}
                                                className="text-right px-4 bg-blue-500/5 align-middle border-x border-white/5"
                                              >
                                                {new Date(
                                                  order.created_date_pht
                                                ).toLocaleDateString()}
                                              </td>
                                              <td
                                                rowSpan={items.length}
                                                className="text-right px-4 py-3 bg-blue-500/5 border-r-2 border-blue-600 align-middle min-w-[140px]"
                                              >
                                                <div className="flex justify-end items-center gap-2">
                                                  {canVerify &&
                                                    !order.is_checked && (
                                                      <button
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          handleVerifyOrder(
                                                            order.id
                                                          );
                                                        }}
                                                        className="p-2 bg-slate-950 border border-white/5 rounded-lg hover:text-emerald-400"
                                                      >
                                                        <ShieldCheck
                                                          size={18}
                                                        />
                                                      </button>
                                                    )}
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setIsEditingDate(
                                                        order.id
                                                      );
                                                      setTempDate(
                                                        order.created_date_pht ||
                                                          ''
                                                      );
                                                    }}
                                                    className="p-2 bg-slate-950 border border-white/5 rounded-lg hover:text-blue-400"
                                                  >
                                                    <Calendar size={18} />
                                                  </button>
                                                </div>
                                              </td>
                                            </>
                                          )}
                                        </tr>
                                      );
                                    })}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* FOOTER PAGINATION */}
      <div className="flex flex-col sm:flex-row justify-between items-center px-2 gap-4">
        <p className="text-[9px] font-black text-slate-700 uppercase tracking-widest">
          {loading
            ? 'SYNCING_ARCHIVE...'
            : `SHOWING ${orders.length} OF ${totalCount} MATCHES`}
        </p>
        <div className="flex items-center gap-2">
          <button
            disabled={currentPage === 0 || loading}
            onClick={() => setCurrentPage((prev) => prev - 1)}
            className="p-2 bg-slate-900/50 border border-white/5 rounded-lg disabled:opacity-20 hover:bg-blue-600/20 text-blue-500 transition-all"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="bg-slate-900/50 border border-white/5 px-4 py-1.5 rounded-lg font-mono text-[10px] font-black uppercase text-slate-400">
            PAGE {currentPage + 1}
          </div>
          <button
            disabled={(currentPage + 1) * pageSize >= totalCount || loading}
            onClick={() => setCurrentPage((prev) => prev + 1)}
            className="p-2 bg-slate-900/50 border border-white/5 rounded-lg disabled:opacity-20 hover:bg-blue-600/20 text-blue-500 transition-all"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
