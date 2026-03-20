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
  Search,
  Calendar,
  XCircle,
  Calculator,
  ShoppingCart,
  Hash,
  UserCheck,
  ShieldCheck,
  AlertCircle,
  Store,
  CheckCircle2,
  Clock,
  Loader2,
} from 'lucide-react';

export default function SalesOrderList() {
  const router = useRouter();

  // Data States
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Auth & Verification States (From Purchase Order Logic)
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isVerifying, setIsVerifying] = useState<string | null>(null);

  // Branch State
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  const [currentBranchName, setCurrentBranchName] = useState<string>('');

  // Pagination & Filter States
  const [currentPage, setCurrentPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize] = useState(12);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [staffList, setStaffList] = useState<string[]>([]);
  const [selectedStaff, setSelectedStaff] = useState('');

  // 1. INITIALIZATION & BRANCH RECOVERY (Retained from ol3526.txt)
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push('/login');

      // Fetch profile for role-based verification
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', session.user.id)
        .single();
      setCurrentUser(profile);

      const savedBranch = localStorage.getItem('active_branch');
      let id = null;
      let name = null;

      if (savedBranch) {
        try {
          const parsedBranch = JSON.parse(savedBranch);
          id = parsedBranch.id;
          name = parsedBranch.branch_name;
        } catch (err) {
          console.error('Error parsing branch:', err);
        }
      }

      if (!id && session.user?.user_metadata?.branch_id) {
        id = session.user.user_metadata.branch_id;
        name = session.user.user_metadata.branch_name || 'Assigned Branch';
      }

      if (id) {
        setCurrentBranchId(id);
        setCurrentBranchName(name || 'Active Branch');
      }
      setLoading(false);
    };
    init();
  }, [router]);

  // 2. FETCH STAFF LIST
  useEffect(() => {
    async function getStaff() {
      if (!currentBranchId) return;
      const { data } = await supabase
        .from('orders')
        .select('created_by')
        .eq('branch_id', currentBranchId);

      if (data) {
        const uniqueStaff = Array.from(
          new Set(data.map((item) => item.created_by).filter(Boolean))
        );
        setStaffList(uniqueStaff as string[]);
      }
    }
    getStaff();
  }, [currentBranchId]);

  // 3. FETCH DATA (Retained original query logic + is_checked support)
  const fetchData = async () => {
    if (!currentBranchId) return;
    try {
      setLoading(true);
      const from = currentPage * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from('orders')
        .select(`*, order_items (*, inventory!product_id (item_name))`, {
          count: 'exact',
        });

      query = query.eq('branch_id', currentBranchId);

      if (searchTerm) {
        query = query.or(
          `order_number.ilike.%${searchTerm}%,client_name.ilike.%${searchTerm}%`
        );
      }

      // 1. USE created_date_pht FOR START DATE
      if (startDate) query = query.gte('created_date_pht', startDate);

      // 2. USE created_date_pht FOR END DATE (No timestamp needed)
      if (endDate) query = query.lte('created_date_pht', endDate);

      if (selectedStaff) query = query.eq('created_by', selectedStaff);

      // 3. ORDER BY THE DATE STRING
      const { data, error, count } = await query
        .order('created_date_pht', { ascending: false })
        .range(from, to);

      if (!error) {
        setOrders(data || []);
        setTotalCount(count || 0);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentBranchId) fetchData();
  }, [
    currentPage,
    searchTerm,
    startDate,
    endDate,
    selectedStaff,
    currentBranchId,
  ]);

  // 4. VERIFICATION LOGIC (Mirrored from Purchase Order pol3525.txt)
  const handleVerifyOrder = async (orderId: string) => {
    if (!currentUser) return;
    setIsVerifying(orderId);
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          is_checked: true,
          checked_by_name: currentUser.full_name,
          checked_at: new Date().toISOString(),
        })
        .eq('id', orderId);

      if (error) throw error;
      await fetchData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsVerifying(null);
    }
  };

  const canVerify = ['branch_admin', 'org_manager', 'super_admin'].includes(
    currentUser?.role
  );

  // 5. METRICS CALCULATION (Retained from ol3526.txt)
  const pageMetrics = useMemo(() => {
    return orders.reduce(
      (acc, o) => ({
        total: acc.total + (o.total_amount || 0),
        generic: acc.generic + (o.generic_amt || 0),
        branded: acc.branded + (o.branded_amt || 0),
      }),
      { total: 0, generic: 0, branded: 0 }
    );
  }, [orders]);

  return (
    <div className="min-h-screen w-full bg-slate-950 text-white p-4 md:px-6 md:py-4 font-sans selection:bg-blue-500/30">
      {/* BRANCH ERROR OVERLAY */}
      {!currentBranchId && !loading && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-500/20 p-8 rounded-2xl max-w-sm w-full text-center shadow-2xl">
            <AlertCircle className="text-red-500 mx-auto mb-4" size={32} />
            <h2 className="text-xl font-black uppercase italic tracking-tighter mb-2">
              Branch_ID_Missing
            </h2>
            <button
              onClick={() => router.push('/staff')}
              className="w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      )}

      {/* HEADER & METRIC CARDS (Exact UI from ol3526.txt) */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end mb-6 gap-4">
        <div>
          <button
            onClick={() => router.push('/staff')}
            className="flex items-center gap-1.5 text-slate-500 hover:text-white transition-colors mb-2 text-[10px] font-bold uppercase tracking-widest"
          >
            <ArrowLeft size={12} /> Back to POS
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-xl border border-blue-500/20">
              <Store size={22} className="text-blue-500" />
            </div>
            <div>
              <h1 className="text-2xl font-black italic tracking-tighter uppercase leading-none">
                {currentBranchName.replace(/\s+/g, '_')}_
                <span className="text-blue-500">Archives</span>
              </h1>
              <p className="text-[9px] text-slate-500 font-mono mt-1 uppercase tracking-widest">
                SYS_ACTIVE // BRANCH_REF:{' '}
                <span className="text-blue-400">
                  {currentBranchId || '---'}
                </span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 w-full lg:w-auto">
          <div className="bg-slate-900/50 border border-white/5 p-3 rounded-xl flex-1 lg:flex-none lg:min-w-[150px]">
            <p className="text-[8px] font-black text-blue-500/70 uppercase tracking-widest mb-1">
              Generic
            </p>
            <p className="text-base font-black text-slate-100 font-mono">
              ₱{pageMetrics.generic.toLocaleString()}
            </p>
          </div>
          <div className="bg-slate-900/50 border border-white/5 p-3 rounded-xl flex-1 lg:flex-none lg:min-w-[150px]">
            <p className="text-[8px] font-black text-purple-500/70 uppercase tracking-widest mb-1">
              Branded
            </p>
            <p className="text-base font-black text-slate-100 font-mono">
              ₱{pageMetrics.branded.toLocaleString()}
            </p>
          </div>
          <div className="bg-emerald-500/5 border border-emerald-500/20 p-3 rounded-xl flex-1 lg:flex-none lg:min-w-[180px]">
            <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-1 flex items-center gap-1.5">
              <Calculator size={10} /> Grand Total
            </p>
            <p className="text-base font-black text-emerald-400 font-mono">
              ₱{pageMetrics.total.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* SEARCH & FILTERS (Exact UI from ol3526.txt) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-3 mb-6">
        <div className="relative lg:col-span-2">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
            size={14}
          />
          <input
            type="text"
            placeholder="Search Reference or Client..."
            className="w-full bg-slate-900/80 border border-white/5 rounded-xl py-2.5 pl-9 pr-4 text-xs focus:border-blue-500/50 outline-none transition-all font-mono placeholder:text-slate-700"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(0);
            }}
          />
        </div>
        <div className="relative lg:col-span-1">
          <UserCheck
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
            size={14}
          />
          <select
            className="w-full bg-slate-900/80 border border-white/5 rounded-xl py-2.5 pl-9 pr-4 text-[10px] font-black uppercase outline-none focus:border-blue-500/50 appearance-none text-slate-400 cursor-pointer"
            value={selectedStaff}
            onChange={(e) => {
              setSelectedStaff(e.target.value);
              setCurrentPage(0);
            }}
          >
            <option value="">All Staff</option>
            {staffList.map((email) => (
              <option key={email} value={email}>
                {email.split('@')[0]}
              </option>
            ))}
          </select>
        </div>
        <div className="lg:col-span-3 flex items-center bg-slate-900/80 border border-white/5 rounded-xl px-3 gap-3">
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
            setSelectedStaff('');
            setCurrentPage(0);
          }}
          className="bg-slate-800 hover:bg-slate-700 border border-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all px-4"
        >
          <XCircle size={14} /> Reset
        </button>
      </div>

      {/* MAIN TABLE */}
      <div className="bg-slate-900/30 border border-white/5 rounded-2xl overflow-hidden shadow-xl mb-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-white/5 text-left text-[9px] font-black uppercase text-slate-500 tracking-[0.2em]">
                <th className="p-4 w-12">#</th>
                <th className="p-4">Reference / Date</th>
                <th className="p-4">Client Name</th>
                <th className="p-4 text-center">Staff</th>
                <th className="p-4 text-right">Total Amount</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 w-12 text-center">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {orders.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={7}
                    className="p-16 text-center text-slate-600 font-mono text-xs tracking-widest"
                  >
                    EMPTY_QUERY_RESULT
                  </td>
                </tr>
              )}
              {orders.map((order) => (
                <React.Fragment key={order.id}>
                  <tr
                    onClick={() =>
                      setExpandedRow(expandedRow === order.id ? null : order.id)
                    }
                    className={`cursor-pointer transition-all duration-150 group ${
                      expandedRow === order.id
                        ? 'bg-blue-600/5'
                        : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <td className="p-4 text-center">
                      <Hash
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
                        <span className="text-blue-400 font-black text-xs">
                          {order.order_number}
                        </span>
                        <span className="text-[9px] text-slate-500 uppercase mt-0.5">
                          {new Date(order.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </td>
                    <td className="p-4 font-black uppercase text-[10px] text-slate-300 tracking-tight">
                      {order.client_name || 'Walk-in'}
                    </td>
                    <td className="p-4 text-center">
                      <span className="bg-slate-800 text-slate-500 px-2 py-1 rounded text-[8px] font-black uppercase">
                        {order.created_by?.split('@')[0] || 'SYS'}
                      </span>
                    </td>
                    <td className="p-4 text-right font-black text-slate-100 font-mono text-sm tracking-tighter">
                      ₱
                      {order.total_amount?.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </td>

                    {/* VERIFICATION STATUS CELL (Mirrored from pol3525.txt) */}
                    <td className="p-4 text-center">
                      {order.is_checked ? (
                        <div className="flex flex-col items-center">
                          <div className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[8px] font-black uppercase flex items-center gap-1">
                            <CheckCircle2 size={10} /> Checked
                          </div>
                          <span className="text-[7px] text-slate-600 uppercase mt-1 italic">
                            {order.checked_by_name}
                          </span>
                        </div>
                      ) : (
                        <div className="bg-slate-800 text-slate-500 px-2 py-0.5 rounded text-[8px] font-black uppercase inline-flex items-center gap-1">
                          <Clock size={10} /> Pending
                        </div>
                      )}
                    </td>

                    <td className="p-4 text-slate-700 group-hover:text-blue-500 transition-colors text-center">
                      {expandedRow === order.id ? (
                        <ChevronUp size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                    </td>
                  </tr>

                  {/* EXPANDED SECTION WITH VERIFY BUTTON */}
                  {expandedRow === order.id && (
                    <tr>
                      <td
                        colSpan={7}
                        className="bg-black/40 border-y border-blue-500/10 p-5"
                      >
                        <div className="flex flex-col gap-4">
                          <div className="flex justify-between items-center border-b border-white/5 pb-2">
                            <h3 className="text-[9px] font-black text-blue-500 uppercase tracking-widest flex items-center gap-2">
                              <ShoppingCart size={12} /> Transaction Itemization
                            </h3>

                            {/* VERIFY BUTTON (Only shows if permitted and not checked) */}
                            {canVerify && !order.is_checked && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleVerifyOrder(order.id);
                                }}
                                disabled={isVerifying === order.id}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center gap-2 transition-all shadow-lg shadow-emerald-900/20 disabled:opacity-50"
                              >
                                {isVerifying === order.id ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <ShieldCheck size={12} />
                                )}
                                Verify Transaction
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {order.order_items?.map((item: any) => (
                              <div
                                key={item.id}
                                className="flex justify-between items-center bg-white/[0.02] p-3 rounded-lg border border-white/5"
                              >
                                <div className="flex flex-col text-left">
                                  <span className="text-[10px] font-black text-slate-300 uppercase leading-tight">
                                    {item.inventory?.item_name ||
                                      'Unknown Item'}
                                  </span>
                                  <span
                                    className={`text-[8px] font-black uppercase ${
                                      item.type === 'branded'
                                        ? 'text-purple-500/60'
                                        : 'text-blue-500/60'
                                    }`}
                                  >
                                    {item.type || 'generic'}
                                  </span>
                                </div>
                                <div className="text-right">
                                  <span className="text-[9px] text-slate-600 font-mono block uppercase">
                                    {item.quantity} PCS
                                  </span>
                                  <span className="text-xs font-black text-emerald-500/80 font-mono">
                                    ₱
                                    {(
                                      item.quantity * item.unit_price
                                    ).toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* FOOTER PAGINATION */}
      <div className="flex flex-col sm:flex-row justify-between items-center px-2 gap-4">
        <p className="text-[9px] font-black text-slate-700 uppercase tracking-widest leading-none">
          {loading ? 'SYNCING...' : `REC_COUNT: ${totalCount}`}
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
            PAGE {currentPage + 1}{' '}
            <span className="text-slate-800 mx-1">/</span>{' '}
            {Math.ceil(totalCount / pageSize)}
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
