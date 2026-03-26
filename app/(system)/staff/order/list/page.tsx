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
  MapPin,
  Plus,
  PlusCircle,
  Sparkles,
  Check,
} from 'lucide-react';

export default function SalesOrderList() {
  const router = useRouter();

  // Data States
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [confirmingCreate, setConfirmingCreate] = useState<string | null>(null);
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
  // Add this near your other useState hooks (like loading, orders, etc.)
  const [justMappedId, setJustMappedId] = useState<string | null>(null);
  // Near your other states (orders, loading, etc.)
  const [mappingSuggestions, setMappingSuggestions] = useState<{
    [key: string]: any[];
  }>({});
  const [isSearchingSuggestions, setIsSearchingSuggestions] = useState<
    string | null
  >(null);
  // Add these to your state declarations

  const [isEditingBranch, setIsEditingBranch] = useState<string | null>(null);

  const [tempBranch, setTempBranch] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [justMapped, setJustMapped] = useState<string | null>(null);
  // Get today's date in PHT for validation
  const todayPHT = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Manila',
  });
  // This stores the list of branches from the DB
  const [availableBranches, setAvailableBranches] = useState<any[]>([]);
  // This stores the branch ID while you are clicking the dropdown
  const [tempBranchId, setTempBranchId] = useState<string>('');

  useEffect(() => {
    const fetchBranches = async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('id, branch_name')
        .order('branch_name', { ascending: true });

      if (error) {
        console.error('Error loading branches:', error);
      } else {
        // This is the function that was "not defined" before
        setAvailableBranches(data || []);
      }
    };

    fetchBranches();
  }, []);
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
  const fetchSuggestions = async (item: any, branchId: string) => {
    setIsSearchingSuggestions(item.id);

    try {
      const { data, error } = await supabase.rpc(
        'find_similar_inventory_items',
        {
          p_branch_id: branchId,
          p_search_name: item.inventory?.item_name || '',
          p_threshold: 12, // Adjusts the "fuzziness" of the match
        }
      );

      if (error) throw error;

      if (data) {
        setMappingSuggestions((prev) => ({ ...prev, [item.id]: data }));
      }
    } catch (err: any) {
      console.error('Fuzzy search failed:', err.message);
    } finally {
      setIsSearchingSuggestions(null);
    }
  };

  const handleMapToDifferentId = async (
    orderId: string,
    item: any,
    newInventoryId: string
  ) => {
    setLoading(true);
    try {
      const currentOrder = orders.find((o) => o.id === orderId);
      if (!currentOrder) throw new Error('Order context not found.');

      // 1. Deduct from the NEW matched inventory ID
      const { error: stockErr } = await supabase.rpc(
        'decrement_inventory_stock',
        {
          p_branch_id: currentOrder.branch_id,
          p_product_id: newInventoryId,
          p_quantity: Number(item.quantity),
        }
      );
      if (stockErr) throw stockErr;

      // 2. Update the specific order_item
      const { error: itemErr } = await supabase
        .from('order_items')
        .update({
          product_id: newInventoryId,
          isTransferred: 'NO',
        })
        .eq('id', item.id);
      if (itemErr) throw itemErr;

      // --- STEP 3: CHECK IF ALL ITEMS ARE NOW MAPPED ---
      // Check if there are any OTHER items in this order that still have isTransferred === 'YES'
      const stillNeedsMapping = currentOrder.order_items.some(
        (oi: any) => oi.id !== item.id && oi.isTransferred === 'YES'
      );

      // If no other items need mapping, update the main order flag
      if (!stillNeedsMapping) {
        await supabase
          .from('orders')
          .update({ isTransferred: 'NO' })
          .eq('id', orderId);
      }
      // ------------------------------------------------

      // --- MODERN SUCCESS SIGNAL (NO POPUPS) ---
      setJustMapped(item.id); // Triggers the green glow in your UI

      // Give the user 1.5 seconds to see the "READY ✓" success state before refreshing
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err: any) {
      alert(`Mapping failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAndMapItem = async (orderId: string, item: any) => {
    setLoading(true);
    try {
      const currentOrder = orders.find((o) => o.id === orderId);
      if (!currentOrder) throw new Error('Order context not found.');

      const { data: newProd, error: invErr } = await supabase
        .from('inventory')
        .insert([
          {
            branch_id: currentOrder.branch_id,
            item_name: item.inventory?.item_name || 'New Transferred Item',
            price: item.unit_price,
            item_type: item.type || 'GENERIC',
            stock: -Number(item.quantity),
            stock_quantity: 0,
            sold_weekly: 0,
            sold_monthly: 0,
            sold_yearly: 0,
          },
        ])
        .select()
        .single();

      if (invErr) throw invErr;

      const { error: itemErr } = await supabase
        .from('order_items')
        .update({ product_id: newProd.id, isTransferred: 'NO' })
        .eq('id', item.id);

      if (itemErr) throw itemErr;

      const stillNeeds = currentOrder.order_items.some(
        (oi: any) => oi.id !== item.id && oi.isTransferred === 'YES'
      );

      if (!stillNeeds) {
        await supabase
          .from('orders')
          .update({ isTransferred: 'NO' })
          .eq('id', orderId);
      }

      // --- SUCCESS LOGIC WITHOUT POPUPS ---
      setConfirmingCreate(null);
      setJustMappedId(item.id); // Triggers the green UI state

      // Optional: Only reload after 1.5 seconds so the user sees the success
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err: any) {
      console.error(err);
      // For errors, a toast is better, but alert is fine for now
      alert(`Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
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
        .order('created_date_pht', { ascending: false }) // 1. Primary: Group by Day
        .order('created_at', { ascending: false }) // 2. Secondary: Most recent time first
        .order('order_number', { ascending: false })
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
  // 1. UPDATED CHANGE DATE LOGIC
  // Inside SalesOrderList component, add these states:
  const [isEditingDate, setIsEditingDate] = useState<string | null>(null);
  const [tempDate, setTempDate] = useState<string>('');
  const [successId, setSuccessId] = useState<string | null>(null);

  // Add the modernization logic:
  const handleChangeDate = async (order: any, newDate: string) => {
    console.log('1. Function Started', { orderId: order.id, newDate });

    if (!newDate || order.created_date_pht === newDate) {
      console.log('2. No change detected, exiting.');
      setIsEditingDate(null);
      return;
    }

    setLoading(true);

    // Safety Timeout: If it takes > 10 seconds, force stop the loading state
    const timeout = setTimeout(() => {
      if (loading) {
        console.error('STUCK: Operation timed out after 10s');
        setLoading(false);
        setIsEditingDate(null);
        alert('The request is taking too long. Please refresh and try again.');
      }
    }, 10000);

    try {
      console.log('3. Updating Orders table...');
      const { error: ordErr } = await supabase
        .from('orders')
        .update({ created_date_pht: newDate })
        .eq('id', order.id);
      if (ordErr) throw ordErr;

      console.log('4. Updating Order Items...');
      const { error: itmErr } = await supabase
        .from('order_items')
        .update({ created_date_pht: newDate })
        .eq('order_id', order.id);
      if (itmErr) throw itmErr;

      console.log('5. Running RPC: Subtract Old Totals...');
      const { error: rpc1 } = await supabase.rpc('sync_daily_sales', {
        p_branch_id: order.branch_id,
        p_date: order.created_date_pht,
        p_gen_amt: -Number(order.generic_amt || 0),
        p_bran_amt: -Number(order.branded_amt || 0),
      });
      if (rpc1) throw rpc1;

      console.log('6. Running RPC: Add New Totals...');
      const { error: rpc2 } = await supabase.rpc('sync_daily_sales', {
        p_branch_id: order.branch_id,
        p_date: newDate,
        p_gen_amt: Number(order.generic_amt || 0),
        p_bran_amt: Number(order.branded_amt || 0),
      });
      if (rpc2) throw rpc2;

      console.log('7. Success! Cleaning up UI...');
      clearTimeout(timeout);
      setSuccessId(`${order.id}-date`);
      setIsEditingDate(null);
      setLoading(false);

      // Give it 1 second to show the "Updated!" checkmark
      setTimeout(() => window.location.reload(), 1000);
    } catch (err: any) {
      clearTimeout(timeout);
      console.error('CRITICAL ERROR CAPTURED:', err);
      setLoading(false);
      setIsEditingDate(null);
      alert(`Error: ${err.message || 'Check database permissions (RLS)'}`);
    }
  };

  // 2. UPDATED CHANGE BRANCH LOGIC
  const handleChangeBranch = async (order: any, newBranchId: string) => {
    if (!newBranchId || order.branch_id === newBranchId) {
      setIsEditingBranch(null);
      return;
    }

    setLoading(true);

    try {
      // --- STEP 1: RETURN STOCK TO OLD BRANCH ---
      if (order.order_items && order.order_items.length > 0) {
        console.log(`Returning stock to branch: ${order.branch_id}`);

        for (const item of order.order_items) {
          // Ensure product_id is the UUID linked to inventory.id
          const pId = item.product_id;
          const qty = Number(item.quantity);

          if (pId) {
            const { error: stockErr } = await supabase.rpc(
              'increment_inventory_stock',
              {
                p_branch_id: order.branch_id, // OLD Branch
                p_product_id: pId, // This is the 'id' in inventory table
                p_quantity: qty,
              }
            );

            if (stockErr) {
              console.error(`Stock update failed for ${pId}:`, stockErr);
            } else {
              console.log(`✅ Returned ${qty} units to inventory id: ${pId}`);
            }
          }
        }
      }

      // --- STEP 2: Update the Order (Move Branch + Flag) ---
      const { error: ordErr } = await supabase
        .from('orders')
        .update({
          branch_id: newBranchId,
          isTransferred: 'YES',
        })
        .eq('id', order.id);

      if (ordErr) throw ordErr;

      // --- STEP 3: Update Order Items (Flag Only) ---
      await supabase
        .from('order_items')
        .update({ isTransferred: 'YES' })
        .eq('order_id', order.id);

      // --- STEP 4: Move Sales Totals (Accounting) ---
      // Subtract from old branch
      await supabase.rpc('sync_daily_sales', {
        p_branch_id: order.branch_id,
        p_date: order.created_date_pht,
        p_gen_amt: -Number(order.generic_amt || 0),
        p_bran_amt: -Number(order.branded_amt || 0),
      });

      // Add to new branch
      await supabase.rpc('sync_daily_sales', {
        p_branch_id: newBranchId,
        p_date: order.created_date_pht,
        p_gen_amt: Number(order.generic_amt || 0),
        p_bran_amt: Number(order.branded_amt || 0),
      });

      setSuccessId(`${order.id}-branch`);
      setIsEditingBranch(null);
      setLoading(false);

      // Reload to reflect changes
      setTimeout(() => window.location.reload(), 1200);
    } catch (err: any) {
      console.error('Transfer Failed:', err);
      setLoading(false);
      alert(`Error: ${err.message}`);
    }
  };

  const [suggestions, setSuggestions] = useState<{ [key: string]: any[] }>({});

  const getSuggestions = async (item: any, branchId: string) => {
    const { data, error } = await supabase.rpc('find_similar_inventory_items', {
      p_branch_id: branchId,
      p_search_name: item.product_name, // The name from the old branch
      p_threshold: 10, // Adjust sensitivity here
    });

    if (!error) {
      setSuggestions((prev) => ({ ...prev, [item.id]: data }));
    }
  };
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
                          {new Date(
                            order.created_date_pht
                          ).toLocaleDateString()}
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

                            {/* TRANSACTION ACTIONS CONTAINER */}
                            <div className="flex items-center gap-3 flex-wrap mt-2 pt-2 border-t border-white/5">
                              {/* VERIFY BUTTON RETAINED FROM ORIGINAL */}
                              {canVerify &&
                                !order.is_checked &&
                                !isEditingDate &&
                                !isEditingBranch && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleVerifyOrder(order.id);
                                    }}
                                    disabled={isVerifying === order.id}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center gap-2 transition-all shadow-lg shadow-emerald-900/20"
                                  >
                                    {isVerifying === order.id ? (
                                      <Loader2
                                        size={12}
                                        className="animate-spin"
                                      />
                                    ) : (
                                      <ShieldCheck size={12} />
                                    )}
                                    Verify Transaction
                                  </button>
                                )}

                              {currentUser?.role === 'branch_admin' && (
                                <>
                                  {/* MODERN DATE PICKER INLINE */}
                                  <div className="flex items-center gap-2">
                                    {isEditingDate === order.id ? (
                                      <div className="flex items-center gap-2 bg-slate-900 border border-blue-500/50 p-1 rounded-xl shadow-[0_0_15px_rgba(59,130,246,0.2)] animate-in fade-in zoom-in duration-200">
                                        <input
                                          type="date"
                                          max={todayPHT}
                                          value={tempDate}
                                          autoFocus
                                          disabled={loading}
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={(e) =>
                                            setTempDate(e.target.value)
                                          }
                                          className="bg-transparent text-[10px] font-bold uppercase outline-none px-2 py-1 text-blue-400 disabled:opacity-50"
                                        />
                                        <button
                                          disabled={loading}
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            await handleChangeDate(
                                              order,
                                              tempDate
                                            );
                                          }}
                                          className="p-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all active:scale-90 disabled:bg-slate-700"
                                        >
                                          {loading ? (
                                            <Loader2
                                              size={14}
                                              className="animate-spin"
                                            />
                                          ) : (
                                            <CheckCircle2 size={14} />
                                          )}
                                        </button>
                                        {!loading && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setIsEditingDate(null);
                                            }}
                                            className="p-1 text-red-500 hover:bg-red-500/10 rounded-lg"
                                          >
                                            <XCircle size={14} />
                                          </button>
                                        )}
                                      </div>
                                    ) : (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setIsEditingDate(order.id);
                                          setTempDate(order.created_date_pht);
                                        }}
                                        className={`group flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-500 border 
        ${
          successId === `${order.id}-date`
            ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
            : 'bg-slate-800/50 border-white/5 text-slate-400 hover:border-blue-500/30 hover:text-white'
        }`}
                                      >
                                        {successId === `${order.id}-date` ? (
                                          <>
                                            <CheckCircle2
                                              size={12}
                                              className="animate-bounce"
                                            />
                                            <span className="text-[9px] font-black uppercase tracking-tighter">
                                              Updated!
                                            </span>
                                          </>
                                        ) : (
                                          <>
                                            <Calendar
                                              size={12}
                                              className="text-blue-500 group-hover:scale-110 transition-transform"
                                            />
                                            <span className="text-[9px] font-black uppercase tracking-widest">
                                              Change Date
                                            </span>
                                          </>
                                        )}
                                      </button>
                                    )}
                                  </div>

                                  {/* MODERN BRANCH SELECT INLINE */}
                                  <div className="flex items-center gap-2">
                                    {isEditingBranch === order.id ? (
                                      <div className="flex items-center gap-2 bg-slate-900 border border-blue-500/50 p-1 rounded-xl shadow-[0_0_15px_rgba(59,130,246,0.2)] animate-in fade-in zoom-in duration-200">
                                        <select
                                          value={tempBranchId}
                                          disabled={loading}
                                          onChange={(e) =>
                                            setTempBranchId(e.target.value)
                                          }
                                          className="bg-transparent text-[10px] font-bold uppercase outline-none px-2 py-1 text-blue-400"
                                        >
                                          <option
                                            value=""
                                            disabled
                                            className="bg-slate-900 text-slate-500"
                                          >
                                            Select Branch
                                          </option>
                                          {/* Changed 'branches' to 'availableBranches' */}
                                          {availableBranches.map((b) => (
                                            <option
                                              key={b.id}
                                              value={b.id}
                                              className="bg-slate-900 text-white"
                                            >
                                              {/* Changed 'b.name' to 'b.branch_name' to match your DB query */}
                                              {b.branch_name}
                                            </option>
                                          ))}
                                        </select>
                                        <button
                                          disabled={loading}
                                          onClick={() =>
                                            handleChangeBranch(
                                              order,
                                              tempBranchId
                                            )
                                          }
                                          className="p-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all active:scale-90"
                                        >
                                          {loading ? (
                                            <Loader2
                                              size={14}
                                              className="animate-spin"
                                            />
                                          ) : (
                                            <CheckCircle2 size={14} />
                                          )}
                                        </button>
                                        <button
                                          onClick={() =>
                                            setIsEditingBranch(null)
                                          }
                                          className="p-1 text-red-500"
                                        >
                                          <XCircle size={14} />
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          setIsEditingBranch(order.id);
                                          setTempBranchId(order.branch_id);
                                        }}
                                        className={`group flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-500 border 
        ${
          successId === `${order.id}-branch`
            ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
            : 'bg-slate-800/50 border-white/5 text-slate-400 hover:border-blue-500/30 hover:text-white'
        }`}
                                      >
                                        {successId === `${order.id}-branch` ? (
                                          <>
                                            <CheckCircle2
                                              size={12}
                                              className="animate-bounce"
                                            />
                                            <span className="text-[9px] font-black uppercase tracking-tighter">
                                              Updated!
                                            </span>
                                          </>
                                        ) : (
                                          <>
                                            <MapPin
                                              size={12}
                                              className="text-blue-500"
                                            />
                                            <span className="text-[9px] font-black uppercase tracking-widest">
                                              {order.branch_name ||
                                                'Change Branch'}
                                            </span>
                                          </>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {order.order_items?.map((item: any) => (
                              <div
                                key={item.id}
                                className="flex flex-col gap-2"
                              >
                                <div
                                  className={`flex justify-between items-center p-3 rounded-lg border transition-all duration-500 ${
                                    justMappedId === item.id
                                      ? 'bg-emerald-500/20 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)] scale-[1.01]'
                                      : item.isTransferred === 'YES'
                                      ? 'bg-red-500/10 border-red-500/40 shadow-[0_0_10px_rgba(239,68,68,0.1)]'
                                      : 'bg-white/[0.02] border-white/5'
                                  }`}
                                >
                                  <div className="flex flex-col text-left">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] font-black text-slate-300 uppercase leading-tight">
                                        {item.inventory?.item_name ||
                                          'Unknown Item'}
                                      </span>

                                      {/* DYNAMIC STATUS BADGE */}
                                      {justMappedId === item.id ? (
                                        <span className="bg-emerald-600 text-[7px] px-1.5 py-0.5 rounded text-white font-black animate-in fade-in zoom-in tracking-tighter">
                                          READY ✓
                                        </span>
                                      ) : (
                                        item.isTransferred === 'YES' && (
                                          <span className="bg-red-600 text-[7px] px-1 rounded text-white font-black animate-pulse tracking-tighter">
                                            NEEDS MAPPING
                                          </span>
                                        )
                                      )}
                                    </div>
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

                                  <div className="flex items-center gap-3">
                                    <div className="text-right">
                                      <span className="text-[9px] text-slate-600 font-mono block uppercase">
                                        {item.quantity} PCS
                                      </span>
                                      <span className="text-xs font-black text-emerald-500/80 font-mono">
                                        ₱{' '}
                                        {(
                                          item.quantity * item.unit_price
                                        ).toLocaleString()}
                                      </span>
                                    </div>

                                    {/* NEW: Explicit Success Feedback replacing the button */}
                                    {justMappedId === item.id ? (
                                      <div className="flex items-center gap-1.5 bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/50 animate-bounce shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                                        <Check size={12} strokeWidth={3} />
                                        <span className="text-[10px] font-black uppercase tracking-tighter">
                                          Mapped
                                        </span>
                                      </div>
                                    ) : (
                                      item.isTransferred === 'YES' && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!mappingSuggestions[item.id]) {
                                              fetchSuggestions(
                                                item,
                                                order.branch_id
                                              );
                                            } else {
                                              setMappingSuggestions((prev) => {
                                                const next = { ...prev };
                                                delete next[item.id];
                                                return next;
                                              });
                                            }
                                          }}
                                          className="p-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-all active:scale-90"
                                        >
                                          {isSearchingSuggestions ===
                                          item.id ? (
                                            <Loader2
                                              size={12}
                                              className="animate-spin"
                                            />
                                          ) : (
                                            <Search size={12} />
                                          )}
                                        </button>
                                      )
                                    )}
                                  </div>
                                </div>

                                {/* SUGGESTIONS PANEL */}
                                {item.isTransferred === 'YES' &&
                                  justMappedId !== item.id &&
                                  mappingSuggestions[item.id] && (
                                    <div className="mx-2 p-2 bg-slate-900 border border-white/10 rounded-b-lg shadow-xl animate-in slide-in-from-top-2">
                                      <p className="text-[8px] font-black text-slate-500 uppercase mb-2">
                                        Similar Items in this Branch:
                                      </p>
                                      <div className="flex flex-col gap-1">
                                        {mappingSuggestions[item.id].length >
                                        0 ? (
                                          mappingSuggestions[item.id].map(
                                            (sug: any) => (
                                              <button
                                                key={sug.id}
                                                disabled={loading}
                                                onClick={() =>
                                                  handleMapToDifferentId(
                                                    order.id,
                                                    item,
                                                    sug.id
                                                  )
                                                }
                                                className="flex justify-between items-center p-2 rounded hover:bg-emerald-500/20 border border-transparent hover:border-emerald-500/30 group transition-all"
                                              >
                                                <div className="text-left">
                                                  <p className="text-[10px] font-bold text-slate-200">
                                                    {sug.item_name}
                                                  </p>
                                                  <p className="text-[8px] text-slate-500 uppercase">
                                                    Stock: {sug.stock}
                                                  </p>
                                                </div>
                                                <span className="text-[9px] font-black text-emerald-500 opacity-0 group-hover:opacity-100 uppercase transition-opacity">
                                                  {loading ? (
                                                    <Loader2
                                                      size={10}
                                                      className="animate-spin"
                                                    />
                                                  ) : (
                                                    'Map Item'
                                                  )}
                                                </span>
                                              </button>
                                            )
                                          )
                                        ) : (
                                          <p className="text-[9px] text-slate-600 italic p-2 text-center">
                                            No similar items found
                                          </p>
                                        )}

                                        {/* QUICK REGISTER ACTION */}
                                        <div className="mt-3 pt-3 border-t border-white/5">
                                          <div className="bg-blue-500/5 rounded-xl border border-blue-500/20 p-3 overflow-hidden transition-all duration-300">
                                            {confirmingCreate === item.id ? (
                                              <div className="flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-200">
                                                <div className="text-center space-y-1">
                                                  <p className="text-[10px] font-black text-blue-300 uppercase tracking-tighter">
                                                    Confirm Registration?
                                                  </p>
                                                  <p className="text-[9px] text-slate-400 italic">
                                                    Adding to this branch
                                                  </p>
                                                </div>
                                                <div className="flex gap-2 mt-1">
                                                  <button
                                                    onClick={() =>
                                                      setConfirmingCreate(null)
                                                    }
                                                    className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 text-[9px] font-black uppercase transition-colors"
                                                  >
                                                    Cancel
                                                  </button>
                                                  <button
                                                    onClick={() =>
                                                      handleCreateAndMapItem(
                                                        order.id,
                                                        item
                                                      )
                                                    }
                                                    disabled={loading}
                                                    className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[9px] font-black uppercase shadow-lg transition-all active:scale-95 flex items-center justify-center"
                                                  >
                                                    {loading ? (
                                                      <Loader2
                                                        size={10}
                                                        className="animate-spin"
                                                      />
                                                    ) : (
                                                      'Confirm'
                                                    )}
                                                  </button>
                                                </div>
                                              </div>
                                            ) : (
                                              <button
                                                onClick={() =>
                                                  setConfirmingCreate(item.id)
                                                }
                                                className="w-full py-2.5 px-3 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded-lg text-[9px] font-black uppercase tracking-widest border border-blue-500/30 transition-all flex items-center justify-center gap-2 group"
                                              >
                                                <Sparkles
                                                  size={12}
                                                  className="group-hover:rotate-12 transition-transform"
                                                />
                                                <span>
                                                  Quick Register & Map
                                                </span>
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )}
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
