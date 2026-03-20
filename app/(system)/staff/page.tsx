'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import {
  Package,
  Activity,
  ArrowRight,
  MapPin,
  ClipboardList,
  Plus,
  LayoutGrid,
  LogOut,
  Terminal,
  Database,
  Tag,
  X,
  Search,
  CheckCircle2,
  AlertCircle,
  FileDown,
  FileUp,
  RefreshCw,
  History,
  User as UserIcon,
  Calendar,
  File,
  TrendingUp,
} from 'lucide-react';

export default function StaffDashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [logStatus, setLogStatus] = useState<string>('');
  const [stats, setStats] = useState({
    poCount: 0,
    salesCount: 0,
    daily_generic_quota: 0,
    daily_total_quota: 0,
    weekly_quota: 0,
    monthly_quota: 0,
  });
  const [canReportingProceed, setCanReportingProceed] = useState(true);
  const [missingDate, setMissingDate] = useState<string | null>(null);
  const [branchModalOpen, setBranchModalOpen] = useState(false);

  // Daily Reports State
  const [dailyReports, setDailyReports] = useState<any[]>([]);
  const [showReportModal, setShowReportModal] = useState(false);
  const [remittance, setRemittance] = useState({
    actual_cash: 0,
    expenses: 0,
    notes: '',
    report_date: new Date().toISOString().split('T')[0],
  });

  const [toast, setToast] = useState<{
    show: boolean;
    msg: string;
    type: 'success' | 'error';
  }>({
    show: false,
    msg: '',
    type: 'success',
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [showResetAuth, setShowResetAuth] = useState(false);
  const [authDetails, setAuthDetails] = useState({ email: '', password: '' });
  const [isWiping, setIsWiping] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: '',
    cost: 0,
    selling: 0,
    type: '',
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [updatePrices, setUpdatePrices] = useState({ cost: 0, selling: 0 });

  const triggerToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast((prev) => ({ ...prev, show: false })), 3000);
  };

  const refreshInventoryState = () => {
    setSearchTerm('');
    setSearchResults([]);
    setSelectedProduct(null);
  };
  // Helper to get days in the current month
  const getDaysInCurrentMonth = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  };

  const updateQuotas = (branch: any) => {
    if (!branch) return;

    const dailyGen = parseFloat(branch.daily_generic_quota) || 0;
    const dailyTotal = parseFloat(branch.daily_total_quota) || 0;
    const daysInMonth = getDaysInCurrentMonth();

    setStats({
      ...stats,
      // We update the stats object with the calculated quotas
      daily_generic_quota: dailyGen,
      daily_total_quota: dailyTotal,
      weekly_quota: dailyTotal * 7,
      monthly_quota: dailyTotal * daysInMonth,
    });
  };

  const createSystemLog = async (
    type: 'LOGIN' | 'BRANCH_CHANGE',
    branchName: string
  ) => {
    if (!profile?.email) return;

    await supabase.from('system_logs').insert([
      {
        event_type: type,
        user_email: profile.email,
        branch_name: branchName,
        log_message:
          type === 'LOGIN'
            ? `User initiated session at ${branchName}`
            : `User switched active branch to ${branchName}`,
        created_at: new Date().toISOString(),
      },
    ]);
  };

  const logSystemActivity = async (
    type: 'LOGIN' | 'BRANCH_CHANGE',
    branchName: string | undefined,
    email: string | undefined,
    fullName: string | undefined // Add this parameter
  ) => {
    if (!email || !branchName) return;

    await supabase.from('system_logs').insert([
      {
        event_type: type,
        user_email: email,
        user_name: fullName || email.split('@')[0].toUpperCase(), // Fallback to email prefix if name is missing
        branch_name: branchName,
        log_message:
          type === 'LOGIN'
            ? `System session initiated by ${
                fullName || email
              } at ${branchName}`
            : `Branch changed to ${branchName} by ${fullName || email}`,
        created_at: new Date().toISOString(),
      },
    ]);
  };

  useEffect(() => {
    async function getInitialData() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return router.push('/login');

        const { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        setProfile(profileData);

        if (profileData?.org_id) {
          const { data: branchData } = await supabase
            .from('branches')
            .select('*')
            .eq('org_id', profileData.org_id);

          setBranches(branchData || []);

          const savedBranch = localStorage.getItem('active_branch');
          if (savedBranch) {
            const parsedBranch = JSON.parse(savedBranch);
            setSelectedBranch(parsedBranch);

            // --- TRIGGER INITIAL LOGIN LOG ---
            logSystemActivity(
              'LOGIN',
              parsedBranch.branch_name,
              session.user.email,
              profileData?.full_name
            );

            fetchStats(parsedBranch.id);
            updateQuotas(parsedBranch.id);
            fetchDailyReports(parsedBranch.id);
            syncDailyReportRealtime(parsedBranch.id);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    getInitialData();
  }, [router]);

  useEffect(() => {
    if (showPriceModal && selectedBranch && searchTerm.length > 1) {
      const delayDebounceFn = setTimeout(async () => {
        const { data } = await supabase
          .from('inventory')
          .select(`id, stock, item_name, price, buy_cost`)
          .eq('branch_id', selectedBranch.id)
          .ilike('item_name', `%${searchTerm}%`)
          .limit(5);
        setSearchResults(data || []);
      }, 300);
      return () => clearTimeout(delayDebounceFn);
    } else {
      setSearchResults([]);
    }
  }, [searchTerm, showPriceModal, selectedBranch]);

  async function fetchStats(branchId: string) {
    const [poRes, orderRes] = await Promise.all([
      supabase
        .from('purchase_orders')
        .select('id', { count: 'exact', head: true })
        .eq('branch_id', branchId),
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('branch_id', branchId),
    ]);
    setStats({ poCount: poRes.count || 0, salesCount: orderRes.count || 0 });
  }

  async function fetchDailyReports(branchId: string) {
    setLogStatus('CHECKING_FOR_MISSING_DATA...');

    // 1. Fetch current summary table
    const { data: currentReports, error: fetchError } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('branch_id', branchId)
      .order('report_date', { ascending: false })
      .limit(31);

    if (fetchError) return;

    // 2. Identify dates to fix (Fixing the .split('T') here)
    const last7Days = [...Array(7)].map((_, i) => {
      const d = new Date(new Date().getTime() + 8 * 60 * 60 * 1000);
      d.setDate(d.getDate() - i);
      return d.toISOString().split('T'); // Added to get the string
    });

    const todayStr = last7Days;

    const datesToFix = last7Days.filter((dateStr) => {
      // ALWAYS include today so it updates as orders come in
      if (dateStr === todayStr) return true;

      const report = currentReports?.find((r) => r.report_date === dateStr);
      // Only fix previous days if they are missing or still 0
      return !report || Number(report.total_sales) === 0;
    });

    // 3. Repair the dates
    if (datesToFix.length > 0) {
      setLogStatus(`SYNCING_${datesToFix.length}_DAYS...`);

      for (const dateStr of datesToFix) {
        const { data: orders } = await supabase
          .from('orders')
          .select('generic_amt, branded_amt, total_amount')
          .eq('branch_id', branchId)
          .eq('created_date_pht', dateStr);

        // Even if orders are 0, we upsert to keep the report accurate
        const gen =
          orders?.reduce((s, o) => s + (Number(o.generic_amt) || 0), 0) || 0;
        const brd =
          orders?.reduce((s, o) => s + (Number(o.branded_amt) || 0), 0) || 0;
        const ttl =
          orders?.reduce((s, o) => s + (Number(o.total_amount) || 0), 0) || 0;

        await supabase.from('daily_reports').upsert(
          {
            branch_id: branchId,
            report_date: dateStr,
            generic_sales: gen,
            branded_sales: brd,
            total_sales: ttl,
            branch_name: selectedBranch?.branch_name,
          },
          { onConflict: 'branch_id,report_date' }
        );
      }

      // 4. Final fetch to show the new numbers
      const { data: finalData } = await supabase
        .from('daily_reports')
        .select('*')
        .eq('branch_id', branchId)
        .order('report_date', { ascending: false })
        .limit(31);

      setDailyReports(finalData || []);
    } else {
      setDailyReports(currentReports || []);
    }

    setLogStatus('SYSTEM_READY');
  }

  const handleBranchSelect = async (branch: any) => {
    setSelectedBranch(branch);
    localStorage.setItem('active_branch', JSON.stringify(branch));

    // --- TRIGGER BRANCH CHANGE LOG ---
    await logSystemActivity(
      'BRANCH_CHANGE',
      branch.branch_name,
      profile?.email,
      profile?.full_name
    );

    // Use the correct setter from your file
    setBranchModalOpen(false);

    // Load the dashboard data for the new branch
    fetchStats(branch.id);
    updateQuotas(branch.id);
    fetchDailyReports(branch.id);
    syncDailyReportRealtime(branch.id);
  };

  const handleLogout = async () => {
    localStorage.removeItem('active_branch');
    await supabase.auth.signOut();
    router.push('/login');
  };

  const handleExportInventory = async () => {
    setLogStatus('QUERYING_DATABASE_FOR_EXPORT...');
    try {
      const { data, error } = await supabase
        .from('inventory')
        .select('item_name, stock, buy_cost, price')
        .eq('branch_id', selectedBranch.id);
      if (error) throw error;
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
      XLSX.writeFile(wb, `${selectedBranch.branch_name}_Inventory.xlsx`);
      setLogStatus('EXPORT_SUCCESSFUL');
      triggerToast('Inventory Exported');
    } catch (err: any) {
      setLogStatus(`EXPORT_ERR: ${err.message}`);
      triggerToast('Export Failed', 'error');
    }
  };

  const handleImportExcel = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogStatus('PARSING_EXCEL_DATA...');
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data: any[] = XLSX.utils.sheet_to_json(ws);
        const formattedData = data.map((item) => ({
          item_name: item.item_name,
          stock: item.stock || 0,
          buy_cost: item.buy_cost || 0,
          price: item.price || 0,
          branch_id: selectedBranch.id,
        }));
        const { error } = await supabase
          .from('inventory')
          .insert(formattedData);
        if (error) throw error;
        setLogStatus(`BULK_IMPORT_SUCCESS: ${data.length} ITEMS`);
        triggerToast(`Imported ${data.length} items`);
        fetchStats(selectedBranch.id);
      } catch (err: any) {
        setLogStatus(`IMPORT_ERR: ${err.message}`);
        triggerToast('Import Failed', 'error');
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleSecureReset = async () => {
    if (!selectedBranch) return;
    setIsWiping(true);
    setLogStatus('VERIFYING_MANAGEMENT_IDENTITY...');
    try {
      const ghostSupabase = createClient(
        (supabase as any).supabaseUrl,
        (supabase as any).supabaseKey,
        { auth: { persistSession: false } }
      );
      const { data: authData, error: authError } =
        await ghostSupabase.auth.signInWithPassword({
          email: authDetails.email,
          password: authDetails.password,
        });
      if (authError || !authData.user) throw new Error('AUTH_FAILED');
      const { data: mProf } = await ghostSupabase
        .from('profiles')
        .select('role')
        .eq('id', authData.user.id)
        .single();
      if (mProf?.role !== 'org_manager') throw new Error('NOT_A_MANAGER');

      setLogStatus(
        `IDENTITY_CONFIRMED: WIPING_${selectedBranch.branch_name.toUpperCase()}...`
      );
      const targetId = selectedBranch.id;
      const { data: poRows } = await ghostSupabase
        .from('purchase_orders')
        .select('id')
        .eq('branch_id', targetId);
      const poIds = poRows?.map((r) => r.id) || [];
      const { data: saleRows } = await ghostSupabase
        .from('orders')
        .select('id')
        .eq('branch_id', targetId);
      const saleIds = saleRows?.map((r) => r.id) || [];

      if (poIds.length > 0)
        await ghostSupabase
          .from('purchase_order_items')
          .delete()
          .in('purchase_order_id', poIds);
      if (saleIds.length > 0)
        await ghostSupabase
          .from('order_items')
          .delete()
          .in('order_id', saleIds);
      await ghostSupabase
        .from('purchase_orders')
        .delete()
        .eq('branch_id', targetId);
      await ghostSupabase.from('orders').delete().eq('branch_id', targetId);
      await ghostSupabase.from('inventory').delete().eq('branch_id', targetId);

      setLogStatus('WIPE_COMPLETE: NODE_PURGED');
      triggerToast('Branch Data Reset Successful');
      setShowResetAuth(false);
      setAuthDetails({ email: '', password: '' });
      window.location.reload();
    } catch (err: any) {
      setLogStatus(`ERROR: ${err.message}`);
      triggerToast(
        err.message === 'AUTH_FAILED' ? 'Invalid Credentials' : err.message,
        'error'
      );
    } finally {
      setIsWiping(false);
    }
  };

  const handleRegisterProduct = async () => {
    if (!newProduct.name) return triggerToast('Product Name Required', 'error');
    setLogStatus('EXECUTING_DB_INSERT...');
    try {
      const { error } = await supabase.from('inventory').insert([
        {
          item_name: newProduct.name,
          buy_cost: Number(newProduct.cost),
          price: Number(newProduct.selling),
          stock: 0,
          branch_id: selectedBranch.id,
        },
      ]);
      if (error) throw error;
      triggerToast(`${newProduct.name} Registered!`, 'success');
      setNewProduct({ name: '', cost: 0, selling: 0, type: '' });
      setShowAddModal(false);
    } catch (err: any) {
      triggerToast(err.message, 'error');
    }
  };

  const handleUpdatePrice = async () => {
    if (!selectedProduct) return;
    setLogStatus('PUSHING_CALIBRATION...');
    try {
      const { error } = await supabase
        .from('inventory')
        .update({ price: updatePrices.selling, buy_cost: updatePrices.cost })
        .eq('id', selectedProduct.id);
      if (error) throw error;
      triggerToast('Price Calibration Complete', 'success');
      refreshInventoryState();
      setShowPriceModal(false);
    } catch (err: any) {
      triggerToast(err.message, 'error');
    }
  };

  const calculateQuotas = (branch: any) => {
    if (!branch) return { weekly: 0, monthly: 0 };

    const now = new Date();
    // Get total days in the current month
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0
    ).getDate();

    const dailyGeneric = parseFloat(branch.daily_generic_quota) || 0;
    const dailyTotal = parseFloat(branch.daily_total_quota) || 0;

    return {
      dailyGeneric,
      dailyTotal,
      weeklyTotal: dailyTotal * 7,
      monthlyTotal: dailyTotal * daysInMonth,
    };
  };

  const handleOpenReport = async () => {
    // 1. Determine target date - Ensure it is a STRING "YYYY-MM-DD"
    const todayPHT = new Date(new Date().getTime() + 8 * 60 * 60 * 1000)
      .toISOString()
      .split('T'); // The is critical!

    const targetDate = selectedDate || todayPHT;

    setLogStatus(`REFRESHING_SALES_FOR: ${targetDate}...`);

    try {
      // 2. Fetch RAW ORDERS using the new PHT column
      const { data: orders, error: orderError } = await supabase
        .from('orders')
        .select('generic_amt, branded_amt, total_amount')
        .eq('branch_id', selectedBranch.id)
        .eq('created_date_pht', targetDate);

      if (orderError) throw orderError;

      let genTotal = 0;
      let brdTotal = 0;
      let ttlTotal = 0;

      if (orders && orders.length > 0) {
        genTotal = orders.reduce(
          (sum, o) => sum + (Number(o.generic_amt) || 0),
          0
        );
        brdTotal = orders.reduce(
          (sum, o) => sum + (Number(o.branded_amt) || 0),
          0
        );
        ttlTotal = orders.reduce(
          (sum, o) => sum + (Number(o.total_amount) || 0),
          0
        );

        // 3. REPAIR THE CALENDAR: Update the daily_reports table
        const { error: upsertError } = await supabase
          .from('daily_reports')
          .upsert(
            {
              branch_id: selectedBranch.id,
              report_date: targetDate,
              generic_sales: genTotal,
              branded_sales: brdTotal,
              total_sales: ttlTotal,
              branch_name: selectedBranch.branch_name,
            },
            { onConflict: 'branch_id,report_date' }
          );

        if (upsertError) console.error('Upsert Error:', upsertError);

        // 4. Update the Dashboard Grid immediately
        fetchDailyReports(selectedBranch.id);
      }

      // 5. Populate Remittance State for the Modal
      setRemittance({
        ...remittance,
        report_date: targetDate,
        actual_cash: 0,
        expenses: 0,
        generic_sales: genTotal,
        branded_sales: brdTotal,
        total_sales: ttlTotal,
      });

      setLogStatus(`SYNC_COMPLETE: ${targetDate}`);
      setShowReportModal(true);
    } catch (err) {
      console.error('HandleOpenReport Error:', err);
      setLogStatus('ERROR_FETCHING_SALES');
      triggerToast('Failed to sync sales data', 'error');
    }
  };

  const handleSaveReport = async () => {
    if (!remittance.actual_cash)
      return triggerToast('Actual Cash Required', 'error');

    // Helper to ensure 2 decimal precision
    const formatMoney = (val: any) => Number(Number(val || 0).toFixed(2));

    const { error } = await supabase.from('daily_reports').upsert(
      [
        {
          branch_id: selectedBranch.id,
          branch_name: selectedBranch.branch_name,
          report_date: remittance.report_date,
          // Formatting inputs to 2 decimal places
          actual_cash: formatMoney(remittance.actual_cash),
          expenses: formatMoney(remittance.expenses),
          // Saving real-time calculated sales with 2 decimal precision
          generic_sales: formatMoney(remittance.generic_sales),
          branded_sales: formatMoney(remittance.branded_sales),
          total_sales: formatMoney(remittance.total_sales),
          reported_by: profile?.full_name,
          is_checked: false,
        },
      ],
      {
        onConflict: 'branch_id,report_date',
      }
    );

    if (!error) {
      triggerToast('Audit Synchronized');
      setShowReportModal(false);
      fetchDailyReports(selectedBranch.id);
      syncDailyReportRealtime(selectedBranch.id);
    } else {
      console.error('Save Error:', error.message);
      triggerToast(error.message, 'error');
    }
  };
  const syncDailyReportRealtime = async (branchId: string) => {
    // 1. Get Today's Date in PHT (YYYY-MM-DD)
    const todayPHT = new Date(new Date().getTime() + 8 * 60 * 60 * 1000)
      .toISOString()
      .split('T'); // Added to get the string, not an array

    setLogStatus('REALTIME_SYNC_INITIATED...');

    // 2. Fetch Orders using the NEW column
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select('generic_amt, branded_amt, total_amount')
      .eq('branch_id', branchId)
      .eq('created_date_pht', todayPHT); // Direct match!

    if (orderError || !orders || orders.length === 0) {
      setLogStatus('IDLE: NO_ORDERS_TODAY');
      return;
    }

    // 3. Simple Aggregation
    const genTotal = Number(
      orders
        .reduce((sum, o) => sum + (parseFloat(o.generic_amt) || 0), 0)
        .toFixed(2)
    );
    const brdTotal = Number(
      orders
        .reduce((sum, o) => sum + (parseFloat(o.branded_amt) || 0), 0)
        .toFixed(2)
    );
    const ttlTotal = Number(
      orders
        .reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0)
        .toFixed(2)
    );

    // 4. UPSERT to daily_reports
    const { error: upsertError } = await supabase.from('daily_reports').upsert(
      {
        branch_id: branchId,
        report_date: todayPHT, // Use the PHT date directly
        generic_sales: genTotal,
        branded_sales: brdTotal,
        total_sales: ttlTotal,
        branch_name: selectedBranch?.branch_name,
      },
      {
        onConflict: 'branch_id,report_date',
      }
    );

    if (!upsertError) {
      setLogStatus(`SYNC_SUCCESS: ${todayPHT} ₱${ttlTotal.toLocaleString()}`);
      fetchDailyReports(branchId);
    } else {
      console.error('Upsert Error:', upsertError);
      setLogStatus('SYNC_ERROR_DATABASE');
    }
  };

  const handleVerifyReport = async (reportId: string) => {
    if (profile?.role !== 'branch_admin' && profile?.role !== 'org_manager') {
      return triggerToast('Admin Privileges Required', 'error');
    }
    setLogStatus('VERIFYING_REMITTANCE_NODE...');
    const { error } = await supabase
      .from('daily_reports')
      .update({ is_checked: true, checked_by: profile.full_name })
      .eq('id', reportId);

    if (!error) {
      triggerToast('Report Verified');
      fetchDailyReports(selectedBranch.id);
      syncDailyReportRealtime(selectedBranch.id);
    }
  };

  if (loading)
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center font-mono text-emerald-500 text-[10px] tracking-[.4em]">
        AUTHENTICATING...
      </div>
    );

  if (!selectedBranch) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-10 text-center">
            <h1 className="text-3xl font-black italic text-white tracking-tighter uppercase">
              Assign Station
            </h1>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {branches.map((b) => (
              <button
                key={b.id}
                onClick={() => handleBranchSelect(b)}
                className="group p-6 bg-slate-900 border border-white/5 rounded-2xl flex items-center justify-between hover:border-emerald-500/50 transition-all"
              >
                <div className="flex items-center gap-4 text-left">
                  <div className="bg-slate-800 p-3 rounded-xl group-hover:bg-emerald-500 group-hover:text-black transition-all">
                    <MapPin size={20} />
                  </div>
                  <div>
                    <span className="block text-sm font-black text-white uppercase tracking-tight">
                      {b.branch_name}
                    </span>
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest block mt-1">
                      {b.location || 'Primary Node'}
                    </span>
                  </div>
                </div>
                <ArrowRight
                  size={18}
                  className="text-slate-700 group-hover:text-emerald-500 transition-all"
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {toast.show && (
        <div
          className={`fixed top-10 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-6 py-4 rounded-2xl border backdrop-blur-xl shadow-2xl transition-all animate-in fade-in zoom-in slide-in-from-top-4 ${
            toast.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400'
              : 'bg-red-500/10 border-red-500/50 text-red-400'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 size={18} />
          ) : (
            <AlertCircle size={18} />
          )}
          <span className="text-xs font-black uppercase tracking-widest">
            {toast.msg}
          </span>
        </div>
      )}

      <nav className="border-b border-white/5 bg-slate-900/40 backdrop-blur-md px-6 py-4 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-6">
            <div>
              <h1 className="text-lg font-black italic tracking-tighter text-white uppercase leading-none">
                ECONO_<span className="text-emerald-500">DRUGSTORE</span>
              </h1>
              <p className="text-[9px] font-bold text-slate-500 uppercase mt-1 tracking-widest">
                {selectedBranch.branch_name} | {profile?.role}
              </p>
            </div>
            <div className="hidden md:flex gap-4 border-l border-white/10 pl-6">
              <div>
                <span className="block text-[8px] font-black text-slate-500 uppercase">
                  Orders
                </span>
                <span className="text-xs font-black text-emerald-500">
                  {stats.salesCount}
                </span>
              </div>
              <div>
                <span className="block text-[8px] font-black text-slate-500 uppercase">
                  PO
                </span>
                <span className="text-xs font-black text-blue-400">
                  {stats.poCount}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* USER DETAILS - MOVED TO THE RIGHT SIDE */}
            <div className="hidden sm:flex items-center gap-3 px-4 border-r border-white/10">
              <div className="text-right">
                <span className="block text-[8px] font-black text-slate-500 uppercase leading-none tracking-widest">
                  Operator_Active
                </span>
                <span className="text-[10px] font-bold text-white uppercase">
                  {profile?.full_name || 'System User'}
                </span>
              </div>
              <div className="bg-emerald-500/10 p-2 rounded-lg text-emerald-500">
                <UserIcon size={16} />
              </div>
            </div>
            <button
              onClick={() => router.push('/staff/reports')}
              className="flex-1 md:flex-none px-6 py-4 bg-slate-900 border border-white/10 hover:border-emerald-500/50 rounded-2xl text-sm font-black uppercase tracking-widest text-white flex items-center justify-center gap-3 transition-all"
            >
              <Calendar size={18} /> Reports_Audit
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => setShowReportModal(true)}
                className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg text-emerald-500 transition-colors"
                title="Daily Report"
              >
                <ClipboardList size={18} />
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem('active_branch');
                  setSelectedBranch(null);
                }}
                className="p-2 hover:bg-white/5 rounded-lg text-slate-500 transition-colors"
                title="Change Branch"
              >
                <LayoutGrid size={18} />
              </button>
              <button
                onClick={handleLogout}
                className="p-2 hover:bg-red-500/10 rounded-lg text-slate-500 hover:text-red-500 transition-colors"
                title="Logout"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-6 lg:p-10 pb-24">
        {/* Previous 7 Day Report Audit */}
        <div className="mb-10">
          <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] px-1 italic mb-4 flex items-center gap-2">
            <History size={12} /> 7_Day_Report_Audit
          </h3>

          {(() => {
            const now = new Date();

            // Date Bounds
            const sun = new Date(now);
            sun.setDate(now.getDate() - now.getDay());
            sun.setHours(0, 0, 0, 0);
            const sat = new Date(sun);
            sat.setDate(sun.getDate() + 6);

            const firstDayMonth = new Date(
              now.getFullYear(),
              now.getMonth(),
              1
            );
            const daysInMonth = new Date(
              now.getFullYear(),
              now.getMonth() + 1,
              0
            ).getDate();

            // Quotas & Actuals
            const dailyGen = Number(selectedBranch?.daily_generic_quota || 0);
            const weeklyQuo = dailyGen * 7;
            const monthlyQuo = dailyGen * daysInMonth;

            const totals = dailyReports.reduce(
              (acc, r) => {
                const rDate = new Date(r.report_date);
                const gen = Number(r.generic_sales || 0);
                if (rDate >= sun && rDate <= sat) acc.w += gen;
                if (rDate >= firstDayMonth && rDate <= now) acc.m += gen;
                return acc;
              },
              { w: 0, m: 0 }
            );

            const getProg = (a: number, q: number) =>
              q > 0 ? Math.min((a / q) * 100, 100) : 0;

            return (
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Weekly Generic */}
                <div className="bg-slate-900/40 border border-white/5 p-4 rounded-2xl">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">
                        Weekly_Generic
                      </p>
                      <p className="text-xl font-black text-white">
                        ₱{totals.w.toLocaleString()}
                      </p>
                    </div>
                    <p className="text-xs font-black text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-lg">
                      {getProg(totals.w, weeklyQuo).toFixed(0)}%
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-black rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${getProg(totals.w, weeklyQuo)}%` }}
                      />
                    </div>
                    <span className="text-[9px] font-bold text-slate-500 whitespace-nowrap">
                      Target: ₱{weeklyQuo.toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Monthly Generic */}
                <div className="bg-slate-900/40 border border-white/5 p-4 rounded-2xl">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest">
                        Monthly_Generic
                      </p>
                      <p className="text-xl font-black text-white">
                        ₱{totals.m.toLocaleString()}
                      </p>
                    </div>
                    <p className="text-xs font-black text-blue-500 bg-blue-500/10 px-2 py-1 rounded-lg">
                      {getProg(totals.m, monthlyQuo).toFixed(0)}%
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-black rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${getProg(totals.m, monthlyQuo)}%` }}
                      />
                    </div>
                    <span className="text-[9px] font-bold text-slate-500 whitespace-nowrap">
                      Target: ₱{monthlyQuo.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 7-Day Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {(() => {
              const now = new Date();
              const sun = new Date(now);
              sun.setDate(now.getDate() - now.getDay());
              sun.setHours(0, 0, 0, 0);

              return Array.from({ length: 7 }).map((_, i) => {
                const date = new Date(sun);
                date.setDate(sun.getDate() + i);

                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;

                const report = dailyReports.find(
                  (r) => r.report_date === dateStr
                );
                const isFuture = date > now;
                const isToday = dateStr === now.toLocaleDateString('en-CA');

                return (
                  <div
                    key={i}
                    className={`p-4 rounded-2xl border transition-all ${
                      isFuture
                        ? 'opacity-40 bg-slate-900/20 border-white/5'
                        : !report
                        ? 'bg-red-500/5 border-red-500/20'
                        : 'bg-slate-900/40 border-white/5'
                    }`}
                  >
                    <span className="text-[8px] font-black text-slate-500 uppercase block mb-1">
                      {isToday
                        ? 'TODAY'
                        : date
                            .toLocaleDateString('en-US', {
                              weekday: 'short',
                              day: 'numeric',
                            })
                            .toUpperCase()}
                    </span>

                    <div className="space-y-1 mb-3 border-b border-white/5 pb-2">
                      <div className="flex justify-between text-[9px] font-bold">
                        <span className="text-slate-500">GEN</span>
                        <span className="text-white">
                          ₱
                          {Number(report?.generic_sales || 0).toLocaleString(
                            undefined,
                            { minimumFractionDigits: 2 }
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between text-[9px] font-bold">
                        <span className="text-slate-500">BRD</span>
                        <span className="text-white">
                          ₱
                          {Number(report?.branded_sales || 0).toLocaleString(
                            undefined,
                            { minimumFractionDigits: 2 }
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] font-black pt-1">
                        <span className="text-emerald-500">TTL</span>
                        <span className="text-emerald-500">
                          ₱
                          {Number(report?.total_sales || 0).toLocaleString(
                            undefined,
                            { minimumFractionDigits: 2 }
                          )}
                        </span>
                      </div>
                    </div>

                    {report ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[8px] text-slate-500 uppercase font-bold">
                            Cash
                          </p>
                          <p className="text-[10px] font-black text-white">
                            ₱
                            {Number(report.actual_cash || 0).toLocaleString(
                              undefined,
                              { minimumFractionDigits: 2 }
                            )}
                          </p>
                        </div>
                        <button
                          onClick={() =>
                            !report.is_checked && handleVerifyReport(report.id)
                          }
                          className={
                            report.is_checked
                              ? 'text-emerald-500'
                              : 'text-orange-500 hover:scale-110'
                          }
                        >
                          {report.is_checked ? (
                            <CheckCircle2 size={14} />
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                          )}
                        </button>
                      </div>
                    ) : (
                      <p className="text-[10px] font-black text-red-500 italic">
                        {isFuture ? 'FUTURE' : 'MISSING'}
                      </p>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] px-1 italic">
              Retail_Ops
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => router.push('/staff/order/new')}
                className="flex items-center justify-between p-6 bg-emerald-600 hover:bg-emerald-500 rounded-2xl transition-all shadow-xl shadow-emerald-950/20"
              >
                <span className="text-sm font-black uppercase italic text-white">
                  New Sale
                </span>
                <Plus size={18} />
              </button>
              <button
                onClick={() => router.push('/staff/order/list')}
                className="flex items-center justify-between p-6 bg-slate-900 border border-white/5 rounded-2xl hover:bg-slate-800 transition-all"
              >
                <span className="text-sm font-black uppercase italic text-slate-300">
                  Order List
                </span>
                <ClipboardList size={18} className="text-slate-500" />
              </button>
              <button
                onClick={() => router.push('/staff/order/return')}
                className="flex items-center justify-between p-6 bg-slate-900 border border-white/5 rounded-2xl hover:bg-slate-800 transition-all"
              >
                <span className="text-sm font-black uppercase italic text-slate-300">
                  Return Item
                </span>
                <ClipboardList size={18} className="text-slate-500" />
              </button>
              <button
                onClick={() => router.push('/staff/inventory/view')}
                className="flex items-center justify-between p-6 bg-slate-900 border border-white/5 rounded-2xl hover:bg-slate-800 transition-all"
              >
                <span className="text-sm font-black uppercase italic text-slate-300">
                  Inventory
                </span>
                <ClipboardList size={18} className="text-slate-500" />
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] px-1 italic">
              Supply_Chain
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() =>
                  router.push(
                    `/staff/purchase/new?branchName=${selectedBranch.branch_name}`
                  )
                }
                className="flex items-center justify-between p-6 bg-blue-600 hover:bg-blue-500 rounded-2xl transition-all shadow-xl shadow-blue-950/20"
              >
                <span className="text-sm font-black uppercase italic text-white">
                  New Purchase Order
                </span>
                <Package size={18} />
              </button>
              <button
                onClick={() => router.push('/staff/purchase/list')}
                className="flex items-center justify-between p-6 bg-slate-900 border border-white/5 rounded-2xl hover:bg-slate-800 transition-all"
              >
                <span className="text-sm font-black uppercase italic text-slate-300">
                  Purchase List
                </span>
                <Activity size={18} className="text-slate-500" />
              </button>
              <button
                onClick={() =>
                  router.push(
                    `/staff/purchase/update?branchName=${selectedBranch.branch_name}`
                  )
                }
                className="flex items-center justify-between p-6 bg-slate-900 border border-white/5 rounded-2xl hover:bg-slate-800 transition-all"
              >
                <span className="text-sm font-black uppercase italic text-slate-300">
                  Update PO
                </span>
                <Activity size={18} className="text-slate-500" />
              </button>
            </div>
          </div>

          {profile?.role === 'branch_admin' && (
            <>
              <div className="space-y-4 md:col-span-2 pt-6 border-t border-white/5 mt-6">
                <h3 className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.3em] px-1 italic">
                  Catalog_Authority
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center justify-between p-6 bg-slate-900 border border-emerald-500/30 rounded-2xl hover:border-emerald-500 transition-all group"
                  >
                    <div className="flex items-center gap-4 text-left">
                      <Database size={20} className="text-emerald-500" />
                      <div>
                        <span className="block text-sm font-black uppercase italic text-white leading-none">
                          Register Product
                        </span>
                        <span className="text-[9px] text-slate-500 uppercase mt-1 block tracking-widest font-bold">
                          New Inventory Entry
                        </span>
                      </div>
                    </div>
                    <Plus
                      size={18}
                      className="text-slate-700 group-hover:text-emerald-500"
                    />
                  </button>
                  <button
                    onClick={() => setShowPriceModal(true)}
                    className="flex items-center justify-between p-6 bg-slate-900 border border-blue-500/30 rounded-2xl hover:border-blue-500 transition-all group"
                  >
                    <div className="flex items-center gap-4 text-left">
                      <Tag size={20} className="text-blue-500" />
                      <div>
                        <span className="block text-sm font-black uppercase italic text-white leading-none">
                          Update Stock Price
                        </span>
                        <span className="text-[9px] text-slate-500 uppercase mt-1 block tracking-widest font-bold">
                          Price Calibration
                        </span>
                      </div>
                    </div>
                    <ArrowRight
                      size={18}
                      className="text-slate-700 group-hover:text-blue-500"
                    />
                  </button>
                </div>
              </div>

              <div className="space-y-4 md:col-span-2 pt-6 border-t border-white/5 mt-6">
                <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.3em] px-1 italic">
                  Data_Management_Authority
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <button
                    onClick={handleExportInventory}
                    className="flex items-center gap-4 p-4 bg-slate-900 border border-white/5 rounded-2xl hover:border-blue-500/50 transition-all text-left group"
                  >
                    <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400 group-hover:bg-blue-500 group-hover:text-black transition-all">
                      <FileDown size={18} />
                    </div>
                    <div>
                      <span className="block text-xs font-black uppercase text-white leading-none">
                        Export Excel
                      </span>
                      <span className="text-[9px] text-slate-500 uppercase mt-1 block">
                        Inventory Data
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={() => router.push('/staff/data-management')}
                    className="flex items-center gap-4 p-4 bg-slate-900 border border-white/5 rounded-2xl hover:border-emerald-500/50 transition-all text-left group"
                  >
                    <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400 group-hover:bg-emerald-500 group-hover:text-black transition-all">
                      <FileUp size={18} />
                    </div>
                    <div>
                      <span className="block text-xs font-black uppercase text-white leading-none">
                        Import Excel
                      </span>
                      <span className="text-[9px] text-slate-500 uppercase mt-1 block">
                        Bulk Injection
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={() => setShowResetAuth(true)}
                    className="flex items-center gap-4 p-4 bg-slate-900 border border-red-500/20 rounded-2xl hover:bg-red-500/10 hover:border-red-500 transition-all text-left group"
                  >
                    <div className="p-2 bg-red-500/10 rounded-lg text-red-500 group-hover:bg-red-500 group-hover:text-black transition-all">
                      <RefreshCw
                        size={18}
                        className={isWiping ? 'animate-spin' : ''}
                      />
                    </div>
                    <div>
                      <span className="block text-xs font-black uppercase text-white leading-none text-red-500">
                        Reset Node
                      </span>
                      <span className="text-[9px] text-slate-500 uppercase mt-1 block">
                        Wipe Current Node
                      </span>
                    </div>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* DAILY REPORT MODAL */}
        {showReportModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setShowReportModal(false)}
            />
            <div className="relative bg-slate-900 border border-emerald-500/30 w-full max-w-md rounded-3xl p-8 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black italic text-white uppercase tracking-tighter">
                  Daily_Remittance
                </h2>
                <button
                  onClick={() => setShowReportModal(false)}
                  className="text-slate-500 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2 flex items-center gap-2">
                    <Calendar size={10} /> Report Date (For Missing Entries)
                  </label>
                  <input
                    type="date"
                    value={remittance.report_date}
                    onChange={(e) =>
                      setRemittance({
                        ...remittance,
                        report_date: e.target.value,
                      })
                    }
                    className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">
                    Actual Cash On Hand
                  </label>
                  <input
                    type="number"
                    value={remittance.actual_cash}
                    onChange={(e) =>
                      setRemittance({
                        ...remittance,
                        actual_cash: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-emerald-500/50"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">
                    Total Expenses
                  </label>
                  <input
                    type="number"
                    value={remittance.expenses}
                    onChange={(e) =>
                      setRemittance({
                        ...remittance,
                        expenses: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-emerald-500/50"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">
                    Notes / Discrepancies
                  </label>
                  <textarea
                    value={remittance.notes}
                    onChange={(e) =>
                      setRemittance({ ...remittance, notes: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-emerald-500/50 h-24 resize-none"
                    placeholder="Enter details..."
                  />
                </div>
                <button
                  onClick={handleSaveReport}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-black uppercase tracking-widest text-white mt-4 transition-all"
                >
                  Submit Final Report
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Product Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z- flex items-center justify-center p-6">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setShowAddModal(false)}
            />
            <div className="relative bg-slate-900 border border-emerald-500/30 w-full max-w-md rounded-3xl p-8 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black italic text-white uppercase tracking-tighter">
                  New_Product_Entry
                </h2>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-slate-500 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Product Name */}
                <input
                  type="text"
                  value={newProduct.name}
                  onChange={(e) =>
                    setNewProduct({ ...newProduct, name: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-emerald-500/50 transition-colors"
                  placeholder="Product Name"
                />

                {/* Pricing Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <input
                    type="number"
                    value={newProduct.cost || ''}
                    onChange={(e) =>
                      setNewProduct({
                        ...newProduct,
                        cost: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none"
                    placeholder="Cost Price"
                  />
                  <input
                    type="number"
                    value={newProduct.selling || ''}
                    onChange={(e) =>
                      setNewProduct({
                        ...newProduct,
                        selling: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none"
                    placeholder="Selling Price"
                  />
                </div>

                {/* MANDATORY TYPE SELECTION */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                      Classification_Required
                    </label>
                    {!newProduct.type && (
                      <span className="text-[9px] text-red-500 font-bold animate-pulse">
                        * SELECT TYPE
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-xl border border-white/5">
                    {['GENERIC', 'BRANDED'].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() =>
                          setNewProduct({ ...newProduct, type: t })
                        }
                        className={`py-3 rounded-lg text-[10px] font-black transition-all ${
                          newProduct.type === t
                            ? t === 'GENERIC'
                              ? 'bg-blue-600 text-white shadow-lg'
                              : 'bg-amber-600 text-white shadow-lg'
                            : 'text-slate-600 hover:text-slate-400'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* SUBMIT BUTTON - Disabled if no name or no type */}
                <button
                  disabled={!newProduct.name || !newProduct.type}
                  onClick={handleRegisterProduct}
                  className={`w-full py-4 rounded-xl text-sm font-black uppercase tracking-widest mt-4 transition-all ${
                    newProduct.name && newProduct.type
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-xl shadow-emerald-500/20'
                      : 'bg-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                  }`}
                >
                  {newProduct.type
                    ? 'Execute Registration'
                    : 'Complete Form to Register'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Update Price Modal */}
        {showPriceModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => {
                setShowPriceModal(false);
                refreshInventoryState();
              }}
            />
            <div className="relative bg-slate-900 border border-blue-500/30 w-full max-w-md rounded-3xl p-8 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black italic text-white uppercase tracking-tighter">
                  Price_Calibration
                </h2>
                <button
                  onClick={() => {
                    setShowPriceModal(false);
                    refreshInventoryState();
                  }}
                  className="text-slate-500 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4">
                <div className="relative">
                  <Search
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
                    size={16}
                  />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-slate-950 border border-white/5 rounded-xl pl-12 pr-4 py-3 text-sm text-white outline-none"
                    placeholder="Search branch inventory..."
                  />
                </div>
                {!selectedProduct && searchResults.length > 0 && (
                  <div className="bg-slate-950 border border-white/5 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
                    {searchResults.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedProduct(p);
                          setUpdatePrices({
                            cost: p.buy_cost,
                            selling: p.price,
                          });
                        }}
                        className="w-full px-4 py-3 text-left border-b border-white/5 hover:bg-blue-500/10 group"
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-300 group-hover:text-white uppercase">
                            {p.item_name}
                          </span>
                          <span className="text-[10px] font-black text-emerald-500">
                            {p.stock} UNIT
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {selectedProduct && (
                  <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-2xl space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black text-white uppercase italic">
                        {selectedProduct.item_name}
                      </span>
                      <button
                        onClick={() => setSelectedProduct(null)}
                        className="text-[9px] text-slate-500 uppercase font-black"
                      >
                        Change
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="number"
                        value={updatePrices.cost}
                        onChange={(e) =>
                          setUpdatePrices({
                            ...updatePrices,
                            cost: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none"
                        placeholder="Cost"
                      />
                      <input
                        type="number"
                        value={updatePrices.selling}
                        onChange={(e) =>
                          setUpdatePrices({
                            ...updatePrices,
                            selling: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none"
                        placeholder="Price"
                      />
                    </div>
                    <button
                      onClick={handleUpdatePrice}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-black uppercase text-white transition-all"
                    >
                      Commit Adjustments
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Secure Reset Modal */}
        {showResetAuth && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-6">
            <div
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
              onClick={() => setShowResetAuth(false)}
            />
            <div className="relative bg-slate-900 border border-red-500/30 w-full max-w-md rounded-3xl p-8 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black italic text-red-500 uppercase tracking-tighter">
                  Manager_Auth_Required
                </h2>
                <button
                  onClick={() => setShowResetAuth(false)}
                  className="text-slate-500 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>
              <p className="text-[10px] text-slate-400 uppercase font-bold mb-6">
                Wiping Data for:{' '}
                <span className="text-white">{selectedBranch.branch_name}</span>
              </p>
              <div className="space-y-4">
                <input
                  type="email"
                  placeholder="MANAGER EMAIL"
                  value={authDetails.email}
                  onChange={(e) =>
                    setAuthDetails({ ...authDetails, email: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none"
                />
                <input
                  type="password"
                  placeholder="MANAGER PASSWORD"
                  value={authDetails.password}
                  onChange={(e) =>
                    setAuthDetails({ ...authDetails, password: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none"
                />
                <button
                  onClick={handleSecureReset}
                  disabled={isWiping}
                  className="w-full py-4 bg-red-600 hover:bg-red-500 rounded-xl text-sm font-black uppercase text-white mt-4"
                >
                  {isWiping ? 'Wiping Node...' : 'Confirm Node Reset'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer Terminal Log */}
        <div className="fixed bottom-6 left-6 right-6 max-w-6xl mx-auto">
          <div className="bg-black/80 backdrop-blur-xl border border-emerald-500/20 p-4 rounded-2xl flex items-center gap-4 shadow-2xl">
            <div className="bg-emerald-500/20 p-2 rounded-lg text-emerald-500">
              <Terminal size={16} />
            </div>
            <div>
              <p className="text-[8px] font-black text-emerald-500/50 uppercase tracking-[0.2em]">
                System_Log_Activity
              </p>
              <p className="text-[10px] font-bold text-emerald-100 uppercase tracking-wide">
                {logStatus || 'Ready for command...'}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
