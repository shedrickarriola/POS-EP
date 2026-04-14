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
  const [canCreateNewSale, setCanCreateNewSale] = useState(true);
  const [blockingReason, setBlockingReason] = useState<string>('');
  const [missingDatesList, setMissingDatesList] = useState<string[]>([]);
  const [showReportModal, setShowReportModal] = useState(false);
  const [remittance, setRemittance] = useState({
    actual_cash: 0,
    expenses: 0,
    notes: '',
    report_date: new Date().toISOString().split('T')[0],
    generic_sales: 0,
    branded_sales: 0,
    total_sales: 0,
    discount_total: 0, // ← NEW
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
  // Locate near line 339
  const [updatePrices, setUpdatePrices] = useState({
    cost: 0,
    selling: 0,
    type: '',
  });
  const calculateMarkup = (
    type: string | null | undefined,
    name: string | null | undefined
  ): number => {
    const upperType = (type ?? 'GENERIC').toUpperCase();
    const lowerName = (name ?? '').toLowerCase();

    // Rule 1: Generic is always 50%
    if (upperType === 'GENERIC') return 50;

    // Rule 2: Branded Logic
    if (upperType === 'BRANDED') {
      const medicineKeywords = [
        'tab',
        'tablet',
        'cap',
        'capsule',
        'mg',
        'syr',
        'syrup',
        'suspension',
      ];

      const isMedicine = medicineKeywords.some((keyword) =>
        lowerName.includes(keyword)
      );

      return isMedicine ? 10 : 15;
    }

    // Fallback
    return 25;
  };
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
  // Check if staff can create new sale (all prior days must have remittance)
  const checkNewSalePermission = async (branchId: string) => {
    const role = (profile?.role || '').toString().toLowerCase().trim();

    // ✅ SUPER RELIABLE ADMIN BYPASS
    if (
      role === 'branch_admin' ||
      role === 'org_manager' ||
      role.includes('admin')
    ) {
      setCanCreateNewSale(true);
      setBlockingReason('');
      setMissingDatesList([]);
      return true;
    }

    // Regular staff - enforce remittance rules
    try {
      setBlockingReason('Checking previous remittance reports...');

      const { data: firstOrder } = await supabase
        .from('orders')
        .select('created_date_pht')
        .eq('branch_id', branchId)
        .order('created_date_pht', { ascending: true })
        .limit(1)
        .single();

      if (!firstOrder?.created_date_pht) {
        setCanCreateNewSale(true);
        setBlockingReason('');
        setMissingDatesList([]);
        return true;
      }

      const firstDate = firstOrder.created_date_pht;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const datesToCheck: string[] = [];
      let current = new Date(firstDate);

      while (current <= yesterday) {
        datesToCheck.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
      }

      if (datesToCheck.length === 0) {
        setCanCreateNewSale(true);
        setBlockingReason('');
        setMissingDatesList([]);
        return true;
      }

      const { data: reports } = await supabase
        .from('daily_reports')
        .select('report_date, actual_cash')
        .eq('branch_id', branchId)
        .in('report_date', datesToCheck);

      const reportMap = new Map(
        (reports || []).map((r: any) => [r.report_date, r])
      );

      const missingOrIncomplete: string[] = [];

      for (const dateStr of datesToCheck) {
        const report = reportMap.get(dateStr);
        if (!report || Number(report.actual_cash || 0) <= 0) {
          missingOrIncomplete.push(dateStr);
        }
      }

      if (missingOrIncomplete.length > 0) {
        setCanCreateNewSale(false);
        setBlockingReason(
          `Incomplete remittance for ${missingOrIncomplete.length} day(s)`
        );
        setMissingDatesList(missingOrIncomplete.sort());
        return false;
      }

      setCanCreateNewSale(true);
      setBlockingReason('');
      setMissingDatesList([]);
      return true;
    } catch (err) {
      console.error('Permission check failed:', err);
      setCanCreateNewSale(false);
      setBlockingReason('System error checking remittance');
      setMissingDatesList([]);
      return false;
    }
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
            await checkNewSalePermission(parsedBranch.id);
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
          .select(`id, stock, item_name, price, buy_cost, item_type`)
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
  // Update the logic near line 392
  const handleUpdatePrice = async () => {
    if (!selectedProduct) return;

    setLogStatus('PUSHING_CALIBRATION...');
    try {
      const finalType = updatePrices.type || selectedProduct.type;

      const { error } = await supabase
        .from('inventory')
        .update({
          price: updatePrices.selling,
          buy_cost: updatePrices.cost, // ← This is what we want to REMOVE
          item_type: finalType,
        })
        .eq('id', selectedProduct.id);

      if (error) throw error;

      triggerToast('Product Calibration Complete', 'success');

      setSelectedProduct(null);
      setUpdatePrices({ cost: 0, selling: 0, type: '' });
      setSearchTerm('');

      refreshInventoryState();
      setShowPriceModal(false);
    } catch (err: any) {
      triggerToast(err.message, 'error');
    }
  };
  async function fetchDailyReports(branchId: string) {
    setLogStatus('CHECKING_FOR_MISSING_DATA...');

    const { data: currentReports } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('branch_id', branchId)
      .order('report_date', { ascending: false })
      .limit(31);

    const last7Days = [...Array(7)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().split('T')[0];
    });

    // FORCE RECALCULATION of the last 7 days (this fixes stale values)
    setLogStatus(`RECALCULATING_${last7Days.length}_DAYS...`);

    for (const dateStr of last7Days) {
      const { data: orders } = await supabase
        .from('orders')
        .select('generic_amt, branded_amt, total_amount, discount_total')
        .eq('branch_id', branchId)
        .eq('created_date_pht', dateStr);

      const gen =
        orders?.reduce((s, o) => s + (Number(o.generic_amt) || 0), 0) || 0;
      const brd =
        orders?.reduce((s, o) => s + (Number(o.branded_amt) || 0), 0) || 0;
      const ttl =
        orders?.reduce((s, o) => s + (Number(o.total_amount) || 0), 0) || 0;
      const disc =
        orders?.reduce((s, o) => s + (Number(o.discount_total) || 0), 0) || 0;

      await supabase.from('daily_reports').upsert(
        {
          branch_id: branchId,
          report_date: dateStr,
          generic_sales: gen,
          branded_sales: brd,
          total_sales: ttl,
          discount_total: disc,
          branch_name: selectedBranch?.branch_name,
        },
        { onConflict: 'branch_id,report_date' }
      );
    }

    // Final load
    const { data: finalData } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('branch_id', branchId)
      .order('report_date', { ascending: false })
      .limit(31);

    setDailyReports(finalData || []);

    setLogStatus('SYSTEM_READY');
  }
  const handleBranchSelect = async (branch: any) => {
    setSelectedBranch(branch);
    localStorage.setItem('active_branch', JSON.stringify(branch));

    // Reset UI immediately
    setCanCreateNewSale(true); // ← Default to true
    setBlockingReason('');
    setMissingDatesList([]);

    await logSystemActivity(
      'BRANCH_CHANGE',
      branch.branch_name,
      profile?.email,
      profile?.full_name
    );

    setBranchModalOpen(false);

    // Refresh everything
    fetchStats(branch.id);
    updateQuotas(branch);
    fetchDailyReports(branch.id);
    syncDailyReportRealtime(branch.id);

    // Re-check permission (but admins will bypass instantly)
    await checkNewSalePermission(branch.id);
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
          item_type: newProduct.type, // ADD THIS LINE [cite: 338, 390]
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
    const todayPHT = new Date(new Date().getTime() + 8 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const targetDate = todayPHT;

    setLogStatus(`REFRESHING_SALES_FOR: ${targetDate}...`);

    const { data: existing } = await supabase
      .from('daily_reports')
      .select('is_checked')
      .eq('branch_id', selectedBranch.id)
      .eq('report_date', targetDate)
      .single();

    if (existing?.is_checked === true) {
      triggerToast(
        'This report has already been verified and cannot be edited.',
        'error'
      );
      return;
    }

    const { data: orders } = await supabase
      .from('orders')
      .select('generic_amt, branded_amt, total_amount, discount_total')
      .eq('branch_id', selectedBranch.id)
      .eq('created_date_pht', targetDate);

    const genTotal =
      orders?.reduce((s, o) => s + (Number(o.generic_amt) || 0), 0) || 0;
    const brdTotal =
      orders?.reduce((s, o) => s + (Number(o.branded_amt) || 0), 0) || 0;
    const ttlTotal =
      orders?.reduce((s, o) => s + (Number(o.total_amount) || 0), 0) || 0;
    const discTotal =
      orders?.reduce((s, o) => s + (Number(o.discount) || 0), 0) || 0;

    await supabase.from('daily_reports').upsert(
      {
        branch_id: selectedBranch.id,
        report_date: targetDate,
        generic_sales: genTotal,
        branded_sales: brdTotal,
        total_sales: ttlTotal,
        discount_total: discTotal,
        branch_name: selectedBranch.branch_name,
      },
      { onConflict: 'branch_id,report_date' }
    );

    setRemittance({
      ...remittance,
      report_date: targetDate,
      actual_cash: 0,
      expenses: 0,
      generic_sales: genTotal,
      branded_sales: brdTotal,
      total_sales: ttlTotal,
      discount_total: discTotal,
    });

    setLogStatus(`SYNC_COMPLETE: ${targetDate}`);
    setShowReportModal(true);
    fetchDailyReports(selectedBranch.id);
  };

  const handleSaveReport = async () => {
    if (!remittance.actual_cash) {
      return triggerToast('Actual Cash Required', 'error');
    }

    if (
      remittance.expenses > 0 &&
      (!remittance.notes || remittance.notes.trim() === '')
    ) {
      return triggerToast(
        'Notes/Discrepancies are required when there are expenses',
        'error'
      );
    }

    const { data: existingReport } = await supabase
      .from('daily_reports')
      .select('is_checked')
      .eq('branch_id', selectedBranch.id)
      .eq('report_date', remittance.report_date)
      .single();

    if (existingReport?.is_checked === true) {
      return triggerToast(
        'This daily report has already been verified by management and cannot be modified.',
        'error'
      );
    }

    const formatMoney = (val: any) => Number(Number(val || 0).toFixed(2));

    const excess = formatMoney(
      (remittance.actual_cash || 0) - (remittance.total_sales || 0)
    );

    const { error } = await supabase.from('daily_reports').upsert(
      [
        {
          branch_id: selectedBranch.id,
          branch_name: selectedBranch.branch_name,
          report_date: remittance.report_date,
          actual_cash: formatMoney(remittance.actual_cash),
          expenses: formatMoney(remittance.expenses),
          generic_sales: formatMoney(remittance.generic_sales),
          branded_sales: formatMoney(remittance.branded_sales),
          total_sales: formatMoney(remittance.total_sales),
          discount_total: formatMoney(remittance.discount_total),
          excess: excess,
          notes: remittance.notes?.trim() || '',
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
    const todayPHT = new Date(new Date().getTime() + 8 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    setLogStatus('REALTIME_SYNC_INITIATED...');

    const { data: orders } = await supabase
      .from('orders')
      .select('generic_amt, branded_amt, total_amount, discount_total')
      .eq('branch_id', branchId)
      .eq('created_date_pht', todayPHT);

    if (!orders || orders.length === 0) {
      setLogStatus('IDLE: NO_ORDERS_TODAY');
      return;
    }

    const genTotal = Number(
      orders.reduce((s, o) => s + (Number(o.generic_amt) || 0), 0).toFixed(2)
    );
    const brdTotal = Number(
      orders.reduce((s, o) => s + (Number(o.branded_amt) || 0), 0).toFixed(2)
    );
    const ttlTotal = Number(
      orders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0).toFixed(2)
    );
    const discTotal = Number(
      orders.reduce((s, o) => s + (Number(o.discount) || 0), 0).toFixed(2)
    );

    await supabase.from('daily_reports').upsert(
      {
        branch_id: branchId,
        report_date: todayPHT,
        generic_sales: genTotal,
        branded_sales: brdTotal,
        total_sales: ttlTotal,
        discount_total: discTotal,
        branch_name: selectedBranch?.branch_name,
      },
      { onConflict: 'branch_id,report_date' }
    );

    setLogStatus(`SYNC_SUCCESS: ${todayPHT} ₱${ttlTotal.toLocaleString()}`);
    fetchDailyReports(branchId);
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
        {/* 7-Day Report Audit */}
        <div className="mb-10">
          <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] px-1 italic mb-4 flex items-center gap-2">
            <History size={12} /> 7_Day_Report_Audit
          </h3>

          {(() => {
            const now = new Date();
            const todayStr = now.toISOString().split('T')[0];

            // Sunday to Saturday - exact same logic as your PROD file
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

            const dailyGen = Number(selectedBranch?.daily_generic_quota || 0);
            const weeklyQuo = dailyGen * 7;
            const monthlyQuo = dailyGen * daysInMonth;

            // ✅ GROSS GENERIC - DISCOUNTS (Net) for quotas
            let weeklyGenericNet = 0;
            let monthlyGenericNet = 0;

            dailyReports.forEach((r) => {
              const reportDateStr = r.report_date;
              const genGross = Number(r.generic_sales || 0);
              const disc = Number(r.discount_total || 0);
              const genNet = genGross - disc;

              const reportDate = new Date(reportDateStr + 'T00:00:00');

              if (reportDate >= sun && reportDate <= sat) {
                weeklyGenericNet += genNet;
              }
              if (reportDate >= firstDayMonth && reportDate <= now) {
                monthlyGenericNet += genNet;
              }
            });

            const getProg = (actual: number, quota: number) =>
              quota > 0 ? Math.min((actual / quota) * 100, 100) : 0;

            return (
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Weekly */}
                <div className="bg-slate-900/40 border border-white/5 p-4 rounded-2xl">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">
                        Weekly Generic (Net)
                      </p>
                      <p className="text-xl font-black text-white">
                        ₱{weeklyGenericNet.toLocaleString()}
                      </p>
                    </div>
                    <p className="text-xs font-black text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-lg">
                      {getProg(weeklyGenericNet, weeklyQuo).toFixed(0)}%
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-black rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{
                          width: `${getProg(weeklyGenericNet, weeklyQuo)}%`,
                        }}
                      />
                    </div>
                    <span className="text-[9px] font-bold text-slate-500">
                      Target: ₱{weeklyQuo.toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Monthly */}
                <div className="bg-slate-900/40 border border-white/5 p-4 rounded-2xl">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest">
                        Monthly Generic (Net)
                      </p>
                      <p className="text-xl font-black text-white">
                        ₱{monthlyGenericNet.toLocaleString()}
                      </p>
                    </div>
                    <p className="text-xs font-black text-blue-500 bg-blue-500/10 px-2 py-1 rounded-lg">
                      {getProg(monthlyGenericNet, monthlyQuo).toFixed(0)}%
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-black rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{
                          width: `${getProg(monthlyGenericNet, monthlyQuo)}%`,
                        }}
                      />
                    </div>
                    <span className="text-[9px] font-bold text-slate-500">
                      Target: ₱{monthlyQuo.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 7-Day Grid with correct TODAY */}
          {/* 7-Day Grid - EXACTLY like your PROD file (Sunday to Saturday, no shift) */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {(() => {
              const now = new Date();
              const todayStr = now.toISOString().split('T')[0];

              const sun = new Date(now);
              sun.setDate(now.getDate() - now.getDay());
              sun.setHours(0, 0, 0, 0);

              return Array.from({ length: 7 }).map((_, i) => {
                const date = new Date(sun);
                date.setDate(sun.getDate() + i);

                // EXACT same string construction as your PROD file
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;

                const report = dailyReports.find(
                  (r) => r.report_date === dateStr
                );

                const isFuture = date > now;
                const isToday = dateStr === todayStr;

                const netSales =
                  Number(report?.total_sales || 0) -
                  Number(report?.discount_total || 0);

                const genActual =
                  Number(report?.generic_sales || 0) -
                  Number(report?.discount_total || 0);

                return (
                  <div
                    key={dateStr}
                    className={`p-4 rounded-2xl border transition-all ${
                      isFuture
                        ? 'opacity-40 bg-slate-900/20 border-white/5'
                        : !report
                        ? 'bg-red-500/5 border-red-500/20'
                        : isToday
                        ? 'bg-emerald-500/20 border-emerald-400 ring-2 ring-emerald-400 shadow-2xl shadow-emerald-500/30 scale-[1.03]'
                        : 'bg-slate-900/40 border-white/5'
                    }`}
                  >
                    <span
                      className={`text-[8px] font-black uppercase block mb-1 ${
                        isToday ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {isToday
                        ? 'TODAY'
                        : date
                            .toLocaleDateString('en-US', {
                              weekday: 'short',
                              day: 'numeric',
                            })
                            .toUpperCase()}
                    </span>

                    <div className="space-y-1 mb-3 border-b border-white/5 pb-2 text-[9px] font-bold">
                      <div className="flex justify-between">
                        <span className="text-slate-200">GEN</span>
                        <span className="text-slate-500">
                          ₱{Number(report?.generic_sales || 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-orange-600">DISC</span>
                        <span className="text-orange-600">
                          ₱
                          {Number(report?.discount_total || 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-200">
                          {' '}
                          ---------------
                        </span>
                        <span className="text-slate-200 ">
                          ₱{genActual.toLocaleString()}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-slate-200">BRD</span>
                        <span className="text-white">
                          ₱{Number(report?.branded_sales || 0).toLocaleString()}
                        </span>
                      </div>

                      <div className="flex justify-between pt-1 border-t border-white/10 font-black">
                        <span className="text-emerald-500">TOTAL</span>
                        <span className="text-emerald-500">
                          ₱
                          {netSales.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                          })}
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
                onClick={() => {
                  if (canCreateNewSale) {
                    router.push('/staff/order/new');
                  } else {
                    triggerToast(
                      `${blockingReason}. Please complete remittance first.`,
                      'error'
                    );
                  }
                }}
                disabled={!canCreateNewSale}
                className={`flex items-center justify-between p-6 rounded-2xl transition-all shadow-xl w-full ${
                  canCreateNewSale
                    ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/20'
                    : 'bg-slate-800 border border-red-500/40 cursor-not-allowed'
                }`}
              >
                <div className="text-left">
                  <span
                    className={`text-sm font-black uppercase italic block ${
                      canCreateNewSale ? 'text-white' : 'text-slate-400'
                    }`}
                  >
                    New Sale
                  </span>

                  {!canCreateNewSale && blockingReason && (
                    <p className="text-[10px] text-red-400 mt-1 font-medium">
                      {blockingReason}
                    </p>
                  )}

                  {/* Show missing dates if any */}
                  {!canCreateNewSale && missingDatesList.length > 0 && (
                    <div className="mt-2 text-[9px] text-red-500/90 font-mono">
                      Missing: {missingDatesList.slice(0, 5).join(', ')}
                      {missingDatesList.length > 5 &&
                        ` +${missingDatesList.length - 5} more`}
                    </div>
                  )}
                </div>

                <Plus
                  size={18}
                  className={canCreateNewSale ? 'text-white' : 'text-slate-500'}
                />
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

        {/* Compact & Mobile-Friendly Price Calibration Modal */}
        {showPriceModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => {
                setShowPriceModal(false);
                refreshInventoryState();
              }}
            />
            <div className="relative bg-slate-900 border border-blue-500/30 w-full max-w-md rounded-3xl p-5 shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-base font-black italic text-white uppercase tracking-tight">
                  Price Calibration
                </h2>
                <button
                  onClick={() => {
                    setShowPriceModal(false);
                    refreshInventoryState();
                  }}
                  className="text-slate-500 hover:text-white p-1"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Search */}
                <div className="relative">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                    size={15}
                  />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-slate-950 border border-white/5 rounded-xl pl-10 pr-4 py-3 text-sm text-white outline-none"
                    placeholder="Search product..."
                  />
                </div>

                {/* Search Results */}
                {!selectedProduct && searchResults.length > 0 && (
                  <div className="bg-slate-950 border border-white/5 rounded-xl overflow-hidden max-h-44 overflow-y-auto">
                    {searchResults.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedProduct(p);
                          setUpdatePrices({
                            cost: Number(p.buy_cost || 0),
                            selling: Number(p.price || 0),
                            type: (
                              p.item_type ||
                              p.type ||
                              'GENERIC'
                            ).toUpperCase(),
                          });
                        }}
                        className="w-full px-4 py-3 text-left border-b border-white/5 hover:bg-blue-500/10 group"
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium text-slate-200 line-clamp-1">
                            {p.item_name}
                          </span>
                          <span className="text-xs text-emerald-400 whitespace-nowrap ml-2">
                            Stock: {p.stock}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Form */}
                {selectedProduct && (
                  <div className="space-y-4">
                    {/* Product Name */}
                    <div className="text-center">
                      <p className="font-semibold text-white text-base leading-tight">
                        {selectedProduct.item_name}
                      </p>
                    </div>

                    {/* Buy Cost - Locked */}
                    <div className="bg-slate-950 border border-amber-500/30 rounded-2xl p-4 text-center">
                      <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest">
                        BUY COST (LOCKED)
                      </p>
                      <p className="text-2xl font-black text-amber-400 mt-1">
                        ₱{Number(updatePrices.cost).toFixed(2)}
                      </p>
                    </div>

                    {/* Selling Price */}
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                        New Selling Price
                      </label>
                      <input
                        type="number"
                        value={updatePrices.selling}
                        onChange={(e) =>
                          setUpdatePrices({
                            ...updatePrices,
                            selling: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-lg font-semibold text-white outline-none focus:border-emerald-500"
                        placeholder="0.00"
                      />
                    </div>

                    {/* Classification */}
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                        Classification
                      </label>
                      <select
                        value={updatePrices.type}
                        onChange={(e) =>
                          setUpdatePrices({
                            ...updatePrices,
                            type: e.target.value,
                          })
                        }
                        className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm font-medium text-white outline-none focus:border-emerald-500"
                      >
                        <option value="GENERIC">GENERIC</option>
                        <option value="BRANDED">BRANDED</option>
                      </select>
                    </div>

                    {/* Suggested Markup + Warning - Matching NewPurchaseOrder Logic */}
                    <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-2xl p-4">
                      <p className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-1">
                        Suggested Markup
                      </p>

                      {(() => {
                        const suggestedMarkup = calculateMarkup(
                          updatePrices.type,
                          selectedProduct?.item_name
                        );
                        const suggestedPrice = Math.ceil(
                          updatePrices.cost * (1 + suggestedMarkup / 100)
                        );

                        return (
                          <>
                            <p className="text-xl font-black text-emerald-400">
                              {suggestedMarkup}%
                            </p>
                            <p className="text-xs text-slate-300 mt-1">
                              Suggested Price: ₱{suggestedPrice}
                            </p>

                            {updatePrices.selling > 0 && (
                              <div
                                className={`mt-3 p-3 rounded-xl text-xs border ${
                                  updatePrices.selling >= suggestedPrice
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                                }`}
                              >
                                {updatePrices.selling >= suggestedPrice
                                  ? '✓ Healthy margin'
                                  : '⚠️ Selling price is too low (below suggested markup)'}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    <button
                      onClick={handleUpdatePrice}
                      className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-2xl text-sm font-black uppercase tracking-widest text-white"
                    >
                      Update Selling Price Only
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
