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
  const isAdmin =
    profile?.role === 'branch_admin' || profile?.role === 'org_manager';
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sameDayPayments, setSameDayPayments] = useState<any[]>([]);
  const [logStatus, setLogStatus] = useState<string>('');
  const [selectedDay, setSelectedDay] = useState<any>(null);
  const [dayOrders, setDayOrders] = useState<any[]>([]); // Daily Sales Table
  const [dayPayments, setDayPayments] = useState<any[]>([]); // Remittances Table
  const [dayExpenses, setDayExpenses] = useState<any[]>([]); // Expenses Table
  // === NEW: Legacy / Standalone Payments (order_id = null) ===
  const [legacyPayments, setLegacyPayments] = useState<any[]>([]);
  // === NEW: Standalone / Legacy Payment Modal (for old POS) ===
  const [showAddStandalonePaymentModal, setShowAddStandalonePaymentModal] =
    useState(false);
  const [standalonePayment, setStandalonePayment] = useState({
    customer_name: '',
    amount: 0,
    payment_method: 'CASH' as 'CASH' | 'CHEQUE' | 'ONLINE',
    cheque_date: '',
    notes: '',
    pr_number: '',
  });
  const [last7DaysOrders, setLast7DaysOrders] = useState<any[]>([]); // ← NEW for calendar
  const [calendarWeekOffset, setCalendarWeekOffset] = useState(0); // 0 = current week, -1 = last week, etc.
  // === NEW: Print Options Modal ===
  const [showPrintOptionsModal, setShowPrintOptionsModal] = useState(false);
  const [pendingPrintOrder, setPendingPrintOrder] = useState<any>(null);
  // Office Workflow Filters
  const [prepFilter, setPrepFilter] = useState({
    date: '',
    client: '',
    agent: '',
  });
  const [deliveryFilter, setDeliveryFilter] = useState({
    date: '',
    client: '',
    agent: '',
  });
  const [collectionFilter, setCollectionFilter] = useState({
    date: '',
    client: '',
    agent: '',
  });
  // New: Overdue filter for Collections
  const [showOverdueCollection, setShowOverdueCollection] = useState(false);
  // Dropdown data for filters
  const [branchClients, setBranchClients] = useState<any[]>([]);
  const [branchAgents, setBranchAgents] = useState<any[]>([]);
  const [showDRModal, setShowDRModal] = useState(false);
  const [pendingDROrder, setPendingDROrder] = useState<any>(null);
  const [drNumberInput, setDrNumberInput] = useState('');
  const [dayTab, setDayTab] = useState<'overview' | 'sales-collection'>(
    'overview'
  );
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
  const [canCreateNewSale, setCanCreateNewSale] = useState(false);
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
  // === OFFICE USE - 3 TABLES ===
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [deliveryOrders, setDeliveryOrders] = useState<any[]>([]);
  const [collectionOrders, setCollectionOrders] = useState<any[]>([]);

  // === NEW: Collection Payment Modal ===
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [selectedCollectionOrder, setSelectedCollectionOrder] =
    useState<any>(null);

  // === REVERSE PAYMENT STATES (Day-wide - for header REVERSE PAYMENT button) ===
  const [showDayReverseModal, setShowDayReverseModal] = useState(false);
  const [dayPaymentsList, setDayPaymentsList] = useState<any[]>([]);
  const [selectedDayPayment, setSelectedDayPayment] = useState<any>(null);

  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  // === UPDATE CLIENTS MODAL ===
  const [showUpdateClientsModal, setShowUpdateClientsModal] = useState(false);
  const [clientsList, setClientsList] = useState<any[]>([]);
  const [editingClient, setEditingClient] = useState<any>(null);
  const [clientForm, setClientForm] = useState<any>({});
  const [isSavingClient, setIsSavingClient] = useState(false);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethodModal, setPaymentMethodModal] = useState<
    'CASH' | 'CHEQUE' | 'ONLINE'
  >('CASH');
  const [chequeDateModal, setChequeDateModal] = useState<string>('');
  const [collectionNotes, setCollectionNotes] = useState<string>('');
  const [prNumberInput, setPrNumberInput] = useState('');
  // === NEW: Add Expense Modal ===
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [newExpenseName, setNewExpenseName] = useState('');
  const [newExpenseAmount, setNewExpenseAmount] = useState(0);
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
  // ==================== WEEKLY DELIVERIES STATES ====================
  // ==================== MERGE PRODUCT STATES ====================
  // ==================== MERGE PRODUCT STATES ====================
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [sourceProduct, setSourceProduct] = useState<any>(null);
  const [targetProduct, setTargetProduct] = useState<any>(null);
  const [mergeSearchTermSource, setMergeSearchTermSource] = useState('');
  const [mergeSearchTermTarget, setMergeSearchTermTarget] = useState('');
  const [mergeSearchResultsSource, setMergeSearchResultsSource] = useState<
    any[]
  >([]);
  const [mergeSearchResultsTarget, setMergeSearchResultsTarget] = useState<
    any[]
  >([]);
  const [isMerging, setIsMerging] = useState(false);
  // ============================================================
  // ============================================================
  // ==================== WEEKLY DELIVERIES STATES ====================
  const [showWeeklyModal, setShowWeeklyModal] = useState(false);
  const [currentWeekStart, setCurrentWeekStart] = useState('');
  const [weeklyTargets, setWeeklyTargets] = useState<{ [key: string]: number }>(
    {}
  );
  const [weeklyPOData, setWeeklyPOData] = useState<{ [key: string]: number }>(
    {}
  );
  const [weeklyBypasses, setWeeklyBypasses] = useState<{
    [key: string]: boolean;
  }>({}); // ← CHANGED: per branch
  // ============================================================
  // ============================================================
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
        'pills',
        'pill',
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
  const getCurrentWeekStart = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day;
    const sunday = new Date(now);
    sunday.setDate(diff);
    sunday.setHours(0, 0, 0, 0);
    return sunday.toISOString().split('T')[0];
  };
  const loadWeeklyData = async () => {
    const weekStart = getCurrentWeekStart();
    setCurrentWeekStart(weekStart);

    const { data: targets } = await supabase
      .from('weekly_delivery_targets')
      .select('*')
      .eq('week_start_date', weekStart);

    const targetMap: { [key: string]: number } = {};
    const bypassMap: { [key: string]: boolean } = {};

    (targets || []).forEach((t: any) => {
      targetMap[t.branch_id] = Number(t.expected_amount || 0);
      bypassMap[t.branch_id] = t.bypass_enabled === true;
    });

    setWeeklyTargets(targetMap);
    setWeeklyBypasses(bypassMap);

    // Weekly PO totals (using your correct columns)
    const endDate = new Date(
      new Date(weekStart).getTime() + 6 * 24 * 60 * 60 * 1000
    )
      .toISOString()
      .split('T')[0];

    const poMap: { [key: string]: number } = {};
    for (const branch of branches) {
      const { data: pos } = await supabase
        .from('purchase_orders')
        .select('total_amount')
        .eq('branch_id', branch.id)
        .gte('created_date_pht', weekStart)
        .lte('created_date_pht', endDate);

      const total = (pos || []).reduce(
        (sum: number, po: any) => sum + Number(po.total_amount || 0),
        0
      );
      poMap[branch.id] = total;
    }
    setWeeklyPOData(poMap);
  };

  const handleSaveWeeklyTargets = async () => {
    if (!currentWeekStart) return;

    const updates = branches.map((branch: any) => ({
      week_start_date: currentWeekStart,
      branch_id: branch.id,
      expected_amount: Number(weeklyTargets[branch.id] || 0),
      bypass_enabled: weeklyBypasses[branch.id] || false,
      created_by: profile?.id,
    }));

    const { error } = await supabase
      .from('weekly_delivery_targets')
      .upsert(updates, { onConflict: 'week_start_date,branch_id' });

    if (error) {
      triggerToast('Failed to save weekly targets', 'error');
    } else {
      triggerToast('Weekly targets + bypass settings saved!', 'success');
      setShowWeeklyModal(false);
    }
  };

  // === NEW: Handle Standalone / Legacy Payment (no order linked) ===
  const handleAddStandalonePayment = async () => {
    if (standalonePayment.amount <= 0) {
      triggerToast('Amount is required', 'error');
      return;
    }
    if (
      standalonePayment.payment_method === 'ONLINE' &&
      (!standalonePayment.notes || standalonePayment.notes.trim() === '')
    ) {
      triggerToast(
        'Reference number / Notes is REQUIRED for ONLINE payments',
        'error'
      );
      return;
    }

    try {
      const today = new Date().toISOString().split('T')[0];

      const { error } = await supabase.from('daily_payments').insert([
        {
          branch_id: selectedBranch.id,
          report_date: today,
          customer_name:
            standalonePayment.customer_name.trim() || 'LEGACY PAYMENT',
          amount: standalonePayment.amount,
          payment_method: standalonePayment.payment_method,
          cheque_date:
            standalonePayment.payment_method === 'CHEQUE'
              ? standalonePayment.cheque_date || null
              : null,
          notes: standalonePayment.notes || '',
          pr_number: standalonePayment.pr_number.trim() || null,
          order_id: null, // ← No order linked
        },
      ]);

      if (error) throw error;

      triggerToast('Standalone payment recorded successfully', 'success');

      // Reset and close
      setShowAddStandalonePaymentModal(false);
      setStandalonePayment({
        customer_name: '',
        amount: 0,
        payment_method: 'CASH',
        cheque_date: '',
        notes: '',
        pr_number: '',
      });

      // Refresh view
      if (selectedBranch?.is_office_use)
        await fetchOfficeOrders(selectedBranch.id);
    } catch (err: any) {
      triggerToast(`Failed to record payment: ${err.message}`, 'error');
    }
  };
  const handleSaveSingleRow = async (branchId: string) => {
    if (!currentWeekStart) return;

    const branch = branches.find((b) => b.id === branchId);
    if (!branch) return;

    const updateData = {
      week_start_date: currentWeekStart,
      branch_id: branchId,
      expected_amount: Number(weeklyTargets[branchId] || 0),
      bypass_enabled: weeklyBypasses[branchId] || false,
      created_by: profile?.id,
    };

    const { error } = await supabase
      .from('weekly_delivery_targets')
      .upsert(updateData, { onConflict: 'week_start_date,branch_id' });

    if (error) {
      triggerToast(`Failed to save ${branch.branch_name}`, 'error');
    } else {
      triggerToast(`${branch.branch_name} saved successfully`, 'success');
    }
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
    console.log(
      `🔍 checkNewSalePermission started for branch: ${branchId} | Role: ${role}`
    );

    try {
      setBlockingReason('Checking remittance and weekly delivery...');

      // 1. Remittance check
      const { data: firstOrder } = await supabase
        .from('orders')
        .select('created_date_pht')
        .eq('branch_id', branchId)
        .order('created_date_pht', { ascending: true })
        .limit(1)
        .single();

      console.log('📦 First order found:', firstOrder);

      // (remittance logic remains the same - I kept it short for now)
      let hasRemittanceIssue = false;
      const missingOrIncomplete: string[] = [];

      if (firstOrder?.created_date_pht) {
        // ... your existing remittance code ...
        // (I left it unchanged so you don't lose anything)
        const firstDate = firstOrder.created_date_pht;
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        const datesToCheck: string[] = [];
        let current = new Date(firstDate);
        while (current <= yesterday) {
          datesToCheck.push(current.toISOString().split('T')[0]);
          current.setDate(current.getDate() + 1);
        }

        if (datesToCheck.length > 0) {
          const { data: reports } = await supabase
            .from('daily_reports')
            .select('report_date, actual_cash')
            .eq('branch_id', branchId)
            .in('report_date', datesToCheck);

          const reportMap = new Map(
            (reports || []).map((r: any) => [r.report_date, r])
          );

          for (const dateStr of datesToCheck) {
            const report = reportMap.get(dateStr);
            if (!report || Number(report.actual_cash || 0) <= 0) {
              missingOrIncomplete.push(dateStr);
            }
          }
          if (missingOrIncomplete.length > 0) hasRemittanceIssue = true;
        }
      }

      if (hasRemittanceIssue) {
        console.log('❌ Remittance failed');
        setCanCreateNewSale(false);
        setBlockingReason(
          `Incomplete remittance for ${missingOrIncomplete.length} day(s)`
        );
        setMissingDatesList(missingOrIncomplete.sort());
        return false;
      }

      // ==================== WEEKLY DELIVERY CHECK (THIS IS THE PART WE NEED TO DEBUG) ====================
      const weekStart = getCurrentWeekStart();
      console.log(`📅 Current week start: ${weekStart}`);

      const { data: targets } = await supabase
        .from('weekly_delivery_targets')
        .select('expected_amount, bypass_enabled')
        .eq('week_start_date', weekStart)
        .eq('branch_id', branchId);

      console.log('📊 weekly_delivery_targets result:', targets);

      const targetData = targets?.[0];
      console.log('📋 Target data for this branch:', targetData);

      if (targetData) {
        const expected = Number(targetData.expected_amount || 0);
        const bypassEnabled = targetData.bypass_enabled === true;

        console.log(
          `🎯 Expected: ₱${expected} | Bypass enabled: ${bypassEnabled}`
        );

        // Get current PO
        const endDate = new Date(
          new Date(weekStart).getTime() + 6 * 24 * 60 * 60 * 1000
        )
          .toISOString()
          .split('T')[0];

        const { data: pos } = await supabase
          .from('purchase_orders')
          .select('total_amount')
          .eq('branch_id', branchId)
          .gte('created_date_pht', weekStart)
          .lte('created_date_pht', endDate);

        const currentPO = (pos || []).reduce(
          (sum: number, po: any) => sum + Number(po.total_amount || 0),
          0
        );

        console.log(`💰 Current weekly PO: ₱${currentPO}`);

        const lowerBound = expected - 2500;
        const upperBound = expected + 2500;
        const isWithinRange =
          currentPO >= lowerBound && currentPO <= upperBound;

        console.log(
          `📏 Range check: ${lowerBound} — ${upperBound} | Within range? ${isWithinRange}`
        );

        if (!bypassEnabled && !isWithinRange) {
          console.log('❌ BLOCKING New Sale - outside range');
          setCanCreateNewSale(false);
          setBlockingReason(
            `EXPECTED WEEKLY PO: ₱${expected.toLocaleString()}. Input the Delivery to enable this button`
          );
          setMissingDatesList([]);
          return false;
        }
      } else {
        console.log(
          '⚠️ No target row found for this week/branch → allowing sale'
        );
      }

      // All checks passed
      console.log('✅ All checks passed → New Sale ENABLED');
      setCanCreateNewSale(true);
      setBlockingReason('');
      setMissingDatesList([]);
      return true;
    } catch (err) {
      console.error('Permission check failed:', err);
      setCanCreateNewSale(false);
      setBlockingReason('System error checking permissions');
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
          // ==================== BRANCH FILTERING BY USAGE_TYPE ====================
          let branchQuery = supabase
            .from('branches')
            .select('*')
            .eq('org_id', profileData.org_id);

          const usageType = (profileData.usage_type || 'DRUGSTORE')
            .toUpperCase()
            .trim();

          if (usageType === 'DRUGSTORE') {
            branchQuery = branchQuery.eq('is_office_use', false);
          } else if (usageType === 'OFFICE') {
            branchQuery = branchQuery.eq('is_office_use', true);
          }
          // 'BOTH' shows all

          const { data: branchData } = await branchQuery;

          // ==================== SORT ALPHABETICALLY ====================
          const sortedBranches = (branchData || []).sort((a: any, b: any) =>
            a.branch_name.localeCompare(b.branch_name)
          );

          setBranches(sortedBranches);

          // ==================== RESTORE SAVED BRANCH ====================
          const savedBranch = localStorage.getItem('active_branch');
          if (savedBranch) {
            const parsedBranch = JSON.parse(savedBranch);

            const isBranchAllowed =
              usageType === 'BOTH' ||
              (usageType === 'DRUGSTORE' && !parsedBranch.is_office_use) ||
              (usageType === 'OFFICE' && parsedBranch.is_office_use);

            if (isBranchAllowed) {
              setSelectedBranch(parsedBranch);

              setCanCreateNewSale(false);
              setBlockingReason('Checking permissions...');

              await checkNewSalePermission(parsedBranch.id);

              if (profileData?.id) {
                await supabase
                  .from('profiles')
                  .update({ active_branch_id: parsedBranch.id })
                  .eq('id', profileData.id);
              }

              logSystemActivity(
                'LOGIN',
                parsedBranch.branch_name,
                session.user.email,
                profileData?.full_name
              );

              fetchStats(parsedBranch.id);
              updateQuotas(parsedBranch);
              fetchDailyReports(parsedBranch.id);
              if (parsedBranch.is_office_use)
                await fetchOfficeOrders(parsedBranch.id);
              syncDailyReportRealtime(parsedBranch.id);
            } else {
              localStorage.removeItem('active_branch');
            }
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

  useEffect(() => {
    if (selectedDay?.dateStr) {
      fetchDayDetails(selectedDay.dateStr);
    }
  }, [selectedDay]);

  useEffect(() => {
    if (selectedBranch?.is_office_use && selectedBranch?.id) {
      loadBranchClientsAndAgents(selectedBranch.id);
    }
  }, [selectedBranch]);
  // Merge Product Search - Source
  // ==================== MERGE PRODUCT SEARCH - DEBUG VERSION ====================
  // Target Product Search
  // ==================== MERGE PRODUCT SEARCH (NOW FIXED) ====================
  // Target Search
  useEffect(() => {
    if (showMergeModal && selectedBranch && mergeSearchTermTarget.length > 1) {
      const delayDebounceFn = setTimeout(async () => {
        const { data } = await supabase
          .from('inventory')
          .select(
            `id, item_name, stock, price, buy_cost, item_type, sold_weekly, sold_monthly, sold_yearly`
          )
          .eq('branch_id', selectedBranch.id)
          .ilike('item_name', `%${mergeSearchTermTarget}%`)
          .limit(8);

        setMergeSearchResultsTarget(data || []);
      }, 250);
      return () => clearTimeout(delayDebounceFn);
    } else {
      setMergeSearchResultsTarget([]);
    }
  }, [mergeSearchTermTarget, showMergeModal, selectedBranch]);

  // Source Search
  useEffect(() => {
    if (showMergeModal && selectedBranch && mergeSearchTermSource.length > 1) {
      const delayDebounceFn = setTimeout(async () => {
        const { data } = await supabase
          .from('inventory')
          .select(
            `id, item_name, stock, price, buy_cost, item_type, sold_weekly, sold_monthly, sold_yearly`
          )
          .eq('branch_id', selectedBranch.id)
          .ilike('item_name', `%${mergeSearchTermSource}%`)
          .limit(8);

        setMergeSearchResultsSource(data || []);
      }, 250);
      return () => clearTimeout(delayDebounceFn);
    } else {
      setMergeSearchResultsSource([]);
    }
  }, [mergeSearchTermSource, showMergeModal, selectedBranch]);
  // =====================================================================

  // Clear when modal closes
  useEffect(() => {
    if (!showMergeModal) {
      setMergeSearchResultsSource([]);
      setMergeSearchResultsTarget([]);
    }
  }, [showMergeModal]);

  // Preload last 7 days orders + office account status for Calendar (safe version)
  useEffect(() => {
    if (!selectedBranch?.is_office_use || !selectedBranch?.id) return;

    const preloadCalendarData = async () => {
      const now = new Date();
      const sunday = new Date(now);
      sunday.setDate(now.getDate() - now.getDay() + calendarWeekOffset * 7);

      const dates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(sunday);
        d.setDate(sunday.getDate() + i);
        return d.toISOString().split('T')[0];
      });

      // Get orders for last 7 days
      const { data: ordersData } = await supabase
        .from('orders')
        .select(
          `
            id,
            total_amount,
            client_name,
            created_date_pht
          `
        )
        .eq('branch_id', selectedBranch.id)
        .in('created_date_pht', dates);

      if (!ordersData || ordersData.length === 0) {
        setLast7DaysOrders([]);
        return;
      }

      // Get unique client_names
      const clientNames = [
        ...new Set(ordersData.map((o: any) => o.client_name).filter(Boolean)),
      ];

      // Lookup which clients are office accounts
      const { data: clientsData } = await supabase
        .from('clients')
        .select('client_name, is_office_account')
        .in('client_name', clientNames);

      const officeMap: Record<string, boolean> = {};
      (clientsData || []).forEach((c: any) => {
        officeMap[c.client_name] = c.is_office_account === true;
      });

      // Enrich orders with is_office_account
      const enriched = ordersData.map((order: any) => ({
        ...order,
        clients: { is_office_account: officeMap[order.client_name] || false },
      }));

      setLast7DaysOrders(enriched);
    };

    preloadCalendarData();
  }, [selectedBranch?.id, calendarWeekOffset]);
  // ============================================================================
  // ============================================================================
  // ============================================================================
  // =================================================================================================
  // =====================================================================

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

  const resetMergeState = () => {
    setSourceProduct(null);
    setTargetProduct(null);
    setMergeSearchTermSource('');
    setMergeSearchTermTarget('');
    setMergeSearchResultsSource([]);
    setMergeSearchResultsTarget([]);
    setIsMerging(false);
  };

  const handleMergeProducts = async () => {
    if (
      !sourceProduct ||
      !targetProduct ||
      sourceProduct.id === targetProduct.id ||
      !selectedBranch
    ) {
      triggerToast('Please select two different products', 'error');
      return;
    }

    const confirmMsg =
      `⚠️ MERGE ${sourceProduct.item_name} (stock: ${sourceProduct.stock}) INTO ${targetProduct.item_name}?\n\n` +
      `This will:\n` +
      `• Reassign ALL historical sales, POs, and adjustments\n` +
      `• Update item_name in purchase_order_items\n` +
      `• Combine stock + sold metrics\n` +
      `• Permanently delete the source product\n\nContinue?`;

    if (!window.confirm(confirmMsg)) return;

    setIsMerging(true);
    setLogStatus('MERGING_PRODUCTS...');

    try {
      // 1. Update dependent tables (including item_name in purchase_order_items)
      await supabase
        .from('order_items')
        .update({ product_id: targetProduct.id })
        .eq('product_id', sourceProduct.id);

      // ← UPDATED: Now also updates item_name
      await supabase
        .from('purchase_order_items')
        .update({
          inventory_id: targetProduct.id,
          item_name: targetProduct.item_name,
        })
        .eq('inventory_id', sourceProduct.id);

      await supabase
        .from('inventory_adjustments')
        .update({ inventory_id: targetProduct.id })
        .eq('inventory_id', sourceProduct.id);

      // 2. Combine stock & sold metrics into target
      const newStock =
        Number(targetProduct.stock || 0) + Number(sourceProduct.stock || 0);
      const newSoldWeekly =
        Number(targetProduct.sold_weekly || 0) +
        Number(sourceProduct.sold_weekly || 0);
      const newSoldMonthly =
        Number(targetProduct.sold_monthly || 0) +
        Number(sourceProduct.sold_monthly || 0);
      const newSoldYearly =
        Number(targetProduct.sold_yearly || 0) +
        Number(sourceProduct.sold_yearly || 0);

      const { error: updateError } = await supabase
        .from('inventory')
        .update({
          stock: newStock,
          sold_weekly: newSoldWeekly,
          sold_monthly: newSoldMonthly,
          sold_yearly: newSoldYearly,
          updated_at: new Date().toISOString(),
          updated_by: profile?.id,
        })
        .eq('id', targetProduct.id);

      if (updateError) throw updateError;

      // 3. Delete source product
      const { error: deleteError } = await supabase
        .from('inventory')
        .delete()
        .eq('id', sourceProduct.id);

      if (deleteError) throw deleteError;

      triggerToast(
        `✅ Successfully merged ${sourceProduct.item_name} into ${targetProduct.item_name}`,
        'success'
      );

      setShowMergeModal(false);
      resetMergeState();
      refreshInventoryState(); // refresh inventory views if open
    } catch (err: any) {
      console.error('Merge failed:', err);
      triggerToast(`Merge failed: ${err.message}`, 'error');
    } finally {
      setIsMerging(false);
      setLogStatus('SYSTEM_READY');
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

    setLogStatus(`HEALING_${last7Days.length}_DAYS...`);

    for (const dateStr of last7Days) {
      // Step 1: Get only orders for THIS branch + date
      const { data: ordersForDate } = await supabase
        .from('orders')
        .select('id')
        .eq('branch_id', branchId)
        .eq('created_date_pht', dateStr);

      const orderIds = (ordersForDate || []).map((o: any) => o.id);

      if (orderIds.length === 0) continue;

      // Step 2: Get order_items ONLY for this branch's orders
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('type, subtotal, discount')
        .in('order_id', orderIds);

      let gen = 0;
      let brd = 0;
      let ttl = 0;
      let disc = 0;

      (orderItems || []).forEach((oi: any) => {
        const itemType = String(oi.type || '')
          .trim()
          .toLowerCase();
        const gross = Number(oi.subtotal || 0) + Number(oi.discount || 0);

        if (itemType === 'generic') gen += gross;
        else if (itemType === 'branded') brd += gross;

        ttl += gross;
        disc += Number(oi.discount || 0);
      });

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

    const { data: finalData } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('branch_id', branchId)
      .order('report_date', { ascending: false })
      .limit(31);

    setDailyReports(finalData || []);
    setLogStatus('SYSTEM_READY');
  }
  // Fetch data for the clicked day - SAFE + OFFICE ACCOUNT SUPPORT (using client_name)
  const fetchDayDetails = async (dateStr: string) => {
    if (!selectedBranch?.id) return;

    try {
      // 1. DAILY SALES TABLE - Orders created on this day (original query)
      const { data: ordersData } = await supabase
        .from('orders')
        .select(
          `
            id,
            order_number,
            client_name,
            dr_number,
            pr_number,
            total_amount,
            delivery_date,
            agent,
            created_date_pht
          `
        )
        .eq('branch_id', selectedBranch.id)
        .eq('created_date_pht', dateStr)
        .order('order_number', { ascending: true });

      // 2. ALL PAYMENTS made on this day
      const { data: paymentsData } = await supabase
        .from('daily_payments')
        .select(
          `
    id,
    customer_name,
    amount,
    payment_method,
    cheque_date,
    notes,
    order_id,
    pr_number,
    orders (
      order_number,
      dr_number,
      pr_number,
      client_name,      
      delivery_date,    
      created_date_pht,
      agent
    )
  `
        )
        .eq('branch_id', selectedBranch.id)
        .eq('report_date', dateStr)
        .order('created_at', { ascending: true });

      // === LEGACY / STANDALONE PAYMENTS (order_id IS NULL) ===
      const legacyPaymentsRaw =
        paymentsData?.filter((p: any) => !p.order_id || p.order_id === null) ||
        [];

      // Regular payments (exclude legacy)
      const sameDayPaymentsRaw =
        paymentsData?.filter((p: any) => {
          const orderDate = p.orders?.created_date_pht;
          return orderDate === dateStr && p.order_id;
        }) || [];

      const previousPaymentsRaw =
        paymentsData?.filter((p: any) => {
          const orderDate = p.orders?.created_date_pht;
          return orderDate && orderDate !== dateStr && p.order_id;
        }) || [];

      // 3. Collect all unique client_names for lookup
      const clientNames = new Set<string>();
      [
        ...(ordersData || []),
        ...sameDayPaymentsRaw,
        ...previousPaymentsRaw,
        ...legacyPaymentsRaw,
      ].forEach((item) => {
        const name =
          item.client_name || item.orders?.client_name || item.customer_name;
        if (name) clientNames.add(name);
      });

      // 4. Lookup which clients are office accounts
      let officeClients: Record<string, boolean> = {};
      if (clientNames.size > 0) {
        const { data: clientsData } = await supabase
          .from('clients')
          .select('client_name, is_office_account')
          .in('client_name', Array.from(clientNames));

        officeClients = (clientsData || []).reduce((acc: any, c: any) => {
          acc[c.client_name] = c.is_office_account === true;
          return acc;
        }, {});
      }

      // 5. Enrich orders
      const enrichedOrders = (ordersData || []).map((order: any) => ({
        ...order,
        clients: {
          is_office_account: officeClients[order.client_name] || false,
        },
      }));

      // 6. Enrich regular payments
      const enrichedSameDay = sameDayPaymentsRaw.map((p: any) => ({
        ...p,
        orders: p.orders
          ? {
              ...p.orders,
              clients: {
                is_office_account: officeClients[p.orders.client_name] || false,
              },
            }
          : null,
      }));

      const enrichedPrevious = previousPaymentsRaw.map((p: any) => ({
        ...p,
        orders: p.orders
          ? {
              ...p.orders,
              clients: {
                is_office_account: officeClients[p.orders.client_name] || false,
              },
            }
          : null,
      }));

      // === Enrich legacy payments ===
      const enrichedLegacy = legacyPaymentsRaw.map((p: any) => ({
        ...p,
        orders: null,
      }));

      // Final state updates
      setDayOrders(enrichedOrders);
      setSameDayPayments(enrichedSameDay);
      setDayPayments(enrichedPrevious);
      setLegacyPayments(enrichedLegacy); // ←←← IMPORTANT

      // 7. EXPENSES
      const { data: expensesData } = await supabase
        .from('daily_expenses')
        .select('*')
        .eq('branch_id', selectedBranch.id)
        .eq('report_date', dateStr)
        .order('created_at', { ascending: true });

      setDayExpenses(expensesData || []);
    } catch (err) {
      console.error('Failed to fetch day details:', err);
    }
  };
  // === OFFICE USE - FETCH 3 TABLES ===
  const fetchOfficeOrders = async (branchId: string) => {
    if (!branchId) return;

    // 1. PREPARATION
    const { data: pending } = await supabase
      .from('orders')
      .select(
        'id, order_number, created_date_pht, status, total_amount, agent, client_name, due_date'
      )
      .eq('branch_id', branchId)
      .eq('status', 'PENDING')
      .order('created_date_pht', { ascending: true });

    // 2. FOR DELIVERY
    const { data: delivery } = await supabase
      .from('orders')
      .select(
        'id, order_number, created_date_pht, status, total_amount, agent, client_name, due_date, delivery_date'
      )
      .eq('branch_id', branchId)
      .eq('status', 'FOR DELIVERY')
      .order('created_date_pht', { ascending: true });

    // 3. FOR COLLECTION
    const { data: collection } = await supabase
      .from('orders')
      .select(
        'id, order_number, created_date_pht, status, total_amount, agent, client_name, due_date, delivery_date, remaining_balance,notes'
      )
      .eq('branch_id', branchId)
      .eq('status', 'FOR COLLECTION')
      .order('created_date_pht', { ascending: true });

    setPendingOrders(pending || []);
    setDeliveryOrders(delivery || []);
    setCollectionOrders(collection || []);
  };
  // Load Clients and Agents for dropdown filters (Office Use only)
  const loadBranchClientsAndAgents = async (branchId: string) => {
    if (!branchId) return;

    console.log('🔄 Loading clients & agents for branch:', branchId);

    // 1. Clients for this branch
    const { data: clientsData, error: clientError } = await supabase
      .from('clients')
      .select('id, client_name')
      .eq('branch_id', branchId)
      .order('client_name', { ascending: true });

    if (clientError) console.error('Clients load error:', clientError);
    setBranchClients(clientsData || []);
    console.log(`📋 Loaded ${clientsData?.length || 0} clients`);

    // 2. Agents from profiles table
    const { data: agentsData, error: agentError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('is_agent', true)
      .order('full_name', { ascending: true });

    if (agentError) console.error('Agents load error:', agentError);
    setBranchAgents(agentsData || []);
    console.log(`👤 Loaded ${agentsData?.length || 0} agents`);
  };
  // === MARK AS FOR COLLECTION (DELIVERED button) ===
  // === DELIVERED BUTTON - Set to FOR COLLECTION + update delivery_date ===
  // === DELIVERED BUTTON - Move to FOR COLLECTION + set remaining_balance correctly ===
  // === DELIVERED BUTTON → Opens DR# Modal ===
  // === DELIVERED BUTTON → Opens DR# Modal ===
  const markAsForCollection = async (orderId: string, orderNumber: string) => {
    // Just open the modal (no need to fetch here)
    setPendingDROrder({ id: orderId, order_number: orderNumber });
    setDrNumberInput('');
    setShowDRModal(true);
  };
  // === CONFIRM DR# AND MOVE TO FOR COLLECTION ===
  // === CONFIRM DR# AND MOVE TO FOR COLLECTION ===
  const handleConfirmDR = async () => {
    if (!pendingDROrder) return;

    try {
      const today = new Date().toISOString().split('T')[0];

      // Fetch total_amount so we can set correct remaining_balance
      const { data: order } = await supabase
        .from('orders')
        .select('total_amount')
        .eq('id', pendingDROrder.id)
        .single();

      const { error } = await supabase
        .from('orders')
        .update({
          status: 'FOR COLLECTION',
          delivery_date: today,
          dr_number: drNumberInput.trim() || null,
          remaining_balance: Number(order?.total_amount || 0), // ← Now correct
        })
        .eq('id', pendingDROrder.id);

      if (error) throw error;

      triggerToast(
        `Order ${pendingDROrder.order_number} moved to FOR COLLECTION (DR# ${
          drNumberInput || '—'
        })`,
        'success'
      );

      setShowDRModal(false);
      setPendingDROrder(null);
      setDrNumberInput('');

      await fetchOfficeOrders(selectedBranch.id);
    } catch (err: any) {
      triggerToast('Failed to update: ' + err.message, 'error');
    }
  };
  // === COLLECT PAYMENT MODAL HANDLER ===
  // === COLLECT PAYMENT MODAL HANDLER (saves to orders + daily_payments) ===
  // === COLLECT PAYMENT MODAL HANDLER - Saves PR# to both orders and daily_payments ===
  // === COLLECT PAYMENT MODAL HANDLER - ROBUST PR# APPENDING ===
  // === UPDATE CLIENTS HANDLERS ===
  const fetchClients = async () => {
    if (!selectedBranch?.id) return;
    setClientsLoading(true);
    const { data, error } = await supabase
      .from('clients')
      .select(
        'id, client_name, owner, birthday, allowed_terms, average_order, monthly_order, agent, phone, address, email, notes, is_office_account, pending_collection, total_orders'
      )
      .eq('branch_id', selectedBranch.id)
      .order('client_name', { ascending: true });
    if (!error) setClientsList(data || []);
    setClientsLoading(false);
  };

  const handleSaveClient = async () => {
    if (!editingClient) return;
    setIsSavingClient(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({
          client_name:
            clientForm.client_name?.trim() || editingClient.client_name,
          owner: clientForm.owner?.trim() || null,
          birthday: clientForm.birthday || null,
          allowed_terms: clientForm.allowed_terms?.trim() || null,
          average_order: Number(clientForm.average_order) || 0,
          monthly_order: Number(clientForm.monthly_order) || 0,
          agent: clientForm.agent?.trim() || null,
          phone: clientForm.phone?.trim() || null,
          address: clientForm.address?.trim() || null,
          email: clientForm.email?.trim() || null,
          notes: clientForm.notes?.trim() || null,
          is_office_account: clientForm.is_office_account === true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingClient.id);
      if (error) throw error;
      triggerToast(
        `✅ ${clientForm.client_name} updated successfully`,
        'success'
      );
      setEditingClient(null);
      setClientForm({});
      await fetchClients();
    } catch (err: any) {
      triggerToast(`Failed to update client: ${err.message}`, 'error');
    } finally {
      setIsSavingClient(false);
    }
  };

  // === COLLECT PAYMENT MODAL HANDLER - NOW USING TOAST ===
  const handleCollectPayment = async () => {
    const remainingBalance = Number(
      selectedCollectionOrder?.remaining_balance || 0
    );
    if (!selectedCollectionOrder) return;
    if (paymentAmount <= 0 && remainingBalance > 0) return;

    // ←←← Guard: prevent double-submission if button is tapped twice
    if (isSubmittingPayment) return;

    // ←←← NEW: Require reference/notes for ONLINE payments
    if (
      paymentMethodModal === 'ONLINE' &&
      (!collectionNotes || collectionNotes.trim() === '')
    ) {
      triggerToast(
        'Reference number / Notes is REQUIRED for ONLINE payments',
        'error'
      );
      return;
    }

    setIsSubmittingPayment(true);

    try {
      const currentRemaining = Number(
        selectedCollectionOrder.remaining_balance || 0
      );
      const newRemaining = Math.max(0, currentRemaining - paymentAmount);
      const isFullyPaid = newRemaining <= 0;

      const today = new Date().toISOString().split('T')[0];

      const statusUpdate = isFullyPaid ? 'completed' : 'FOR COLLECTION';

      const paymentNote = `${paymentMethodModal} payment of P${paymentAmount} on ${new Date().toLocaleDateString(
        'en-US'
      )}${
        paymentMethodModal === 'CHEQUE'
          ? ` (Cheque Date: ${chequeDateModal})`
          : ''
      }. ${collectionNotes || ''}`;

      const existingNotes = selectedCollectionOrder.notes
        ? selectedCollectionOrder.notes.trim() + '\n\n'
        : '';
      const updatedNotes = existingNotes + paymentNote;

      // === ROBUST PR# APPENDING ===
      let finalPrNumber = prNumberInput.trim();

      if (finalPrNumber) {
        const { data: latestOrder } = await supabase
          .from('orders')
          .select('pr_number')
          .eq('id', selectedCollectionOrder.id)
          .single();

        const existingPr = latestOrder?.pr_number?.trim();

        if (existingPr) {
          if (!existingPr.includes(finalPrNumber)) {
            finalPrNumber = `${existingPr}, ${finalPrNumber}`;
          } else {
            finalPrNumber = existingPr;
          }
        }
      }

      // 1. Update orders table
      const { error: orderError } = await supabase
        .from('orders')
        .update({
          remaining_balance: newRemaining,
          status: statusUpdate,
          paid_date: isFullyPaid ? today : null,
          pr_number: finalPrNumber || null,
          notes: updatedNotes,
        })
        .eq('id', selectedCollectionOrder.id);

      if (orderError) throw orderError;

      // 2. Insert into daily_payments
      const { error: paymentError } = await supabase
        .from('daily_payments')
        .insert([
          {
            branch_id: selectedBranch.id,
            report_date: today,
            customer_name: selectedCollectionOrder.client_name || 'WALK-IN',
            amount: paymentAmount,
            payment_method: paymentMethodModal,
            cheque_date:
              paymentMethodModal === 'CHEQUE' ? chequeDateModal || null : null,
            notes: collectionNotes || '',
            order_id: selectedCollectionOrder.id,
            pr_number: prNumberInput.trim() || null,
          },
        ]);

      if (paymentError) console.warn('daily_payments warning:', paymentError);

      // ✅ SUCCESS TOAST
      triggerToast(
        isFullyPaid
          ? `✅ Full payment recorded. Order marked as COMPLETED.`
          : `✅ Payment recorded. New balance: ₱${newRemaining.toLocaleString()}`,
        'success'
      );

      setShowCollectionModal(false);

      // Reset form
      setPaymentAmount(0);
      setChequeDateModal('');
      setCollectionNotes('');
      setPrNumberInput('');

      await fetchOfficeOrders(selectedBranch.id);
    } catch (err: any) {
      triggerToast(`❌ Failed to record payment: ${err.message}`, 'error');
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  // === GLOBAL DAY PAYMENTS REVERSE (All today's payments) ===
  const openDayPaymentsReverseModal = async () => {
    if (!selectedBranch?.id) return;

    const today = new Date().toISOString().split('T')[0];

    try {
      const { data: payments, error } = await supabase
        .from('daily_payments')
        .select(
          `
          id,
          amount,
          payment_method,
          pr_number,
          customer_name,
          notes,
          created_at,
          order_id,
          orders (
            order_number,
            client_name,
            status,
            remaining_balance,
            total_amount
          )
        `
        )
        .eq('branch_id', selectedBranch.id)
        .eq('report_date', today)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setDayPaymentsList(payments || []);
      setSelectedDayPayment(null);
      setShowDayReverseModal(true);
    } catch (err: any) {
      triggerToast("Failed to load today's payments: " + err.message, 'error');
    }
  };

  const handleReverseDayPayment = async () => {
    if (!selectedDayPayment) return;

    const payment = selectedDayPayment;
    const amount = Number(payment.amount || 0);

    let confirmMsg = `Reverse payment of ₱${amount.toLocaleString()}?\n\n`;
    confirmMsg += `Customer: ${
      payment.customer_name || payment.orders?.client_name || 'N/A'
    }\n`;
    confirmMsg += `Method: ${payment.payment_method}\n`;
    if (payment.pr_number) confirmMsg += `PR#: ${payment.pr_number}\n`;
    confirmMsg += `\nThis will delete the payment record`;

    if (payment.order_id) {
      confirmMsg += ` and restore the balance on Order ${
        payment.orders?.order_number || ''
      }`;
    }

    if (!window.confirm(confirmMsg)) return;

    try {
      // 1. Delete the payment
      const { error: deleteErr } = await supabase
        .from('daily_payments')
        .delete()
        .eq('id', payment.id);
      if (deleteErr) throw deleteErr;

      // 2. Restore order balance + status (if linked to an order)
      if (payment.order_id && payment.orders) {
        const currentBalance = Number(payment.orders.remaining_balance || 0);
        const originalTotal = Number(payment.orders.total_amount || 0);

        // Add back the reversed amount (never exceed original total)
        const newBalance = Math.min(currentBalance + amount, originalTotal);

        // Simple and correct status logic
        const finalStatus = newBalance <= 0 ? 'completed' : 'FOR COLLECTION';

        const updatePayload: any = {
          remaining_balance: newBalance,
          status: finalStatus,
        };

        // Clear paid_date if order is no longer fully paid
        if (
          finalStatus === 'FOR COLLECTION' &&
          payment.orders.status === 'completed'
        ) {
          updatePayload.paid_date = null;
        }

        await supabase
          .from('orders')
          .update(updatePayload)
          .eq('id', payment.order_id);
      }

      triggerToast(
        `✅ Payment of ₱${amount.toLocaleString()} reversed successfully`,
        'success'
      );

      setShowDayReverseModal(false);
      setDayPaymentsList([]);
      setSelectedDayPayment(null);

      // Refresh views
      if (selectedBranch?.is_office_use) {
        await fetchOfficeOrders(selectedBranch.id);
      }
      if (selectedDay?.dateStr) {
        await fetchDayDetails(selectedDay.dateStr);
      }
    } catch (err: any) {
      console.error('Reverse payment error:', err);
      triggerToast('Failed to reverse: ' + err.message, 'error');
    }
  };

  // === ADD EXPENSE HANDLER ===
  const handleAddExpense = async () => {
    if (!newExpenseName || newExpenseAmount <= 0 || !selectedDay?.dateStr)
      return;

    try {
      const { error } = await supabase.from('daily_expenses').insert([
        {
          branch_id: selectedBranch.id,
          report_date: selectedDay.dateStr,
          expense_name: newExpenseName,
          amount: newExpenseAmount,
        },
      ]);

      if (error) throw error;

      triggerToast('Expense added successfully', 'success');

      // Reset and close
      setNewExpenseName('');
      setNewExpenseAmount(0);
      setShowAddExpenseModal(false);

      // Refresh the expenses list
      await fetchDayDetails(selectedDay.dateStr);
    } catch (err: any) {
      alert('Failed to add expense: ' + err.message);
    }
  };

  // === DELETE EXPENSE ===
  const handleDeleteExpense = async (
    expenseId: string,
    expenseName: string
  ) => {
    if (!confirm(`Delete expense "${expenseName}"?`)) return;

    try {
      const { error } = await supabase
        .from('daily_expenses')
        .delete()
        .eq('id', expenseId);

      if (error) throw error;

      triggerToast('Expense deleted', 'success');

      // Refresh the current day
      if (selectedDay?.dateStr) {
        await fetchDayDetails(selectedDay.dateStr);
      }
    } catch (err: any) {
      alert('Failed to delete expense: ' + err.message);
    }
  };
  const handlePrintOrder = async (
    orderId: string,
    orderNumber: string,
    withHeader: boolean = true
  ) => {
    try {
      await supabase
        .from('orders')
        .update({ status: 'FOR DELIVERY' })
        .eq('id', orderId);

      const { data: order } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

      let processedBy = order?.created_by || 'Staff';
      if (order?.created_by) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('email', order.created_by)
          .single();
        if (profile?.full_name) processedBy = profile.full_name;
      }

      const { data: itemsData } = await supabase
        .from('order_items')
        .select(
          `
          quantity,
          unit_price,
          subtotal,
          lot_number,
          expiry_date,
          inventory (item_name)
        `
        )
        .eq('order_id', orderId);

      const items = itemsData || [];
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF('p', 'mm', 'a4');

      const PAGE_HEIGHT = 278; // Safe bottom margin for A4

      let y = 18;

      if (withHeader) {
        // WITH HEADERS
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text('ECONO PHARMA TRADING', 105, y, { align: 'center' });
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(
          'Unit A-3 Regalena Bldg., 9049 National Highway, Brgy. Turbina, Calamba Laguna',
          105,
          y,
          { align: 'center' }
        );
        y += 5;
        doc.text('Frederick SJ Arriola - (Proprietor)', 105, y, {
          align: 'center',
        });
        y += 5;
        doc.text('NON VAT TIN# 110-194-523-000', 105, y, { align: 'center' });
        y += 12;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('DELIVERY RECEIPT', 105, y, { align: 'center' });
        y += 10;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(`SALES ORDER #: ${orderNumber}`, 20, y);
        doc.text(`DATE: ${new Date().toLocaleDateString('en-US')}`, 145, y);
        y += 7;
        doc.text(`CUSTOMER: ${order?.client_name || 'WALK-IN'}`, 20, y);
        y += 7;
        doc.text(`ADDRESS: ${order?.address || ''}`, 20, y);
        y += 10;
      } else {
        // WITHOUT HEADERS (for pre-printed DR forms)
        y = 45;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);

        doc.text(`${orderNumber}`, 20, y);
        doc.text(`${new Date().toLocaleDateString('en-US')}`, 165, y);
        y += 7;

        doc.text(`${order?.client_name || 'WALK-IN'}`, 45, y);
        y += 7;

        doc.text(`${order?.address || ''}`, 45, y);
        y += 14;
      }

      // Table header only for WITH HEADERS
      if (withHeader) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text('Qty', 18, y);
        doc.text('Unit', 25, y);
        doc.text('Lot No.', 33, y);
        doc.text('Expiry', 52, y);
        doc.text('Particulars', 78, y);
        doc.text('Amount', 160, y, { align: 'right' });
        doc.text('Discount', 177, y, { align: 'right' });
        doc.text('Total', 195, y, { align: 'right' });

        y += 4;
        doc.setLineWidth(0.3);
        doc.line(18, y, 195, y);
        y += 6;
      }

      // ==================== ITEM ROWS (WITH MULTI-PAGE SUPPORT) ====================
      let itemCount = 0;
      let grandTotal = 0;
      let currentY = y;

      // Helper function to add a new page when content overflows
      const addPageIfNeeded = (spaceNeeded: number = 12) => {
        if (currentY + spaceNeeded > PAGE_HEIGHT) {
          doc.addPage();
          currentY = 20;

          // Continuation header on new pages
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.text('DELIVERY RECEIPT (continued)', 105, currentY, {
            align: 'center',
          });
          currentY += 7;

          // Repeat compact column headers on continuation pages
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.text('Qty', 18, currentY);
          doc.text('Unit', 25, currentY);
          doc.text('Lot No.', 33, currentY);
          doc.text('Expiry', 52, currentY);
          doc.text('Particulars', 78, currentY);
          doc.text('Amount', 160, currentY, { align: 'right' });
          doc.text('Discount', 177, currentY, { align: 'right' });
          doc.text('Total', 195, currentY, { align: 'right' });

          currentY += 4;
          doc.setLineWidth(0.2);
          doc.line(18, currentY, 195, currentY);
          currentY += 5;
        }
      };

      // ==================== UPDATED: Expiry MM/YYYY + Uppercase LOT ====================
      const formatExpiryMMYYYY = (dateStr: string): string => {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length >= 2) {
          return `${parts[1]}/${parts[0]}`; // MM/YYYY
        }
        return dateStr;
      };

      items.forEach((item: any) => {
        const qty = Number(item.quantity || 1);
        const unitPrice = Number(item.unit_price || 0);
        const lineTotal = Number(item.subtotal || 0);
        const itemName = (item.inventory?.item_name || '').trim();
        const lotNumber = (item.lot_number || '').trim().toUpperCase(); // ← UPPERCASE
        const expiryDate = item.expiry_date || '';
        const expiryDisplay = formatExpiryMMYYYY(expiryDate); // ← MM/YYYY

        const lotMaxWidth = 32;
        const expiryMaxWidth = 38;
        const particularsMaxWidth = 68;

        const itemNameLines = itemName
          ? doc.splitTextToSize(itemName, particularsMaxWidth)
          : [''];
        const lotLines = lotNumber
          ? doc.splitTextToSize(lotNumber, lotMaxWidth)
          : [''];
        const expiryLines = expiryDisplay
          ? doc.splitTextToSize(expiryDisplay, expiryMaxWidth)
          : [''];

        const numLines = Math.max(
          itemNameLines.length,
          lotLines.length,
          expiryLines.length,
          1
        );
        const lineHeight = 6.5;
        const rowHeight = lineHeight * numLines + 3;

        // === KEY FIX: Check if we need a new page before drawing this row ===
        addPageIfNeeded(rowHeight + 8);

        let rowY = currentY;

        for (let i = 0; i < numLines; i++) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);

          if (i === 0) {
            doc.text(String(qty), 18, rowY);
            doc.text('1s', 25, rowY);
            if (expiryDisplay)
              doc.text(expiryLines[i] || expiryDisplay, 46, rowY);
          }
          if (lotLines[i]) doc.text(lotLines[i], 30, rowY);
          if (itemNameLines[i]) doc.text(itemNameLines[i], 67, rowY);

          rowY += lineHeight;
        }

        // Amounts aligned to the first line of the row
        doc.text(unitPrice.toFixed(2), 160, currentY, { align: 'right' });
        doc.text('0.00', 177, currentY, { align: 'right' });
        doc.text(lineTotal.toFixed(2), 195, currentY, { align: 'right' });

        grandTotal += lineTotal;
        itemCount += qty;
        currentY += rowHeight;
      });

      y = currentY;

      // Summary + Footer (also protected from overflow)
      addPageIfNeeded(55);

      y += 8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('ITEMS', 20, y);
      doc.text(String(itemCount), 48, y);
      doc.text('TOTAL', 160, y, { align: 'right' });
      doc.text(grandTotal.toFixed(2), 195, y, { align: 'right' });

      y += 12;
      doc.setFontSize(10);
      doc.text(`PROCESSED BY: ${processedBy}`, 20, y);

      y += 10;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(
        'WE ONLY ACCEPT RETURN ITEM WITHIN 30 DAYS FROM PURCHASE',
        105,
        y,
        { align: 'center' }
      );
      y += 5;
      doc.text('STORE AT TEMPERATURE NOT EXCEEDING 30°C', 105, y, {
        align: 'center',
      });

      const client = (order?.client_name || 'WALKIN').replace(
        /[^a-zA-Z0-9]/g,
        '_'
      );
      const fileName = `${new Date()
        .toISOString()
        .slice(0, 10)}_${orderNumber}_${client}_DR.pdf`;
      doc.save(fileName);

      triggerToast(`Delivery Receipt #${orderNumber} generated`, 'success');
      await fetchOfficeOrders(selectedBranch.id);
    } catch (err: any) {
      console.error(err);
      triggerToast('Failed to generate PDF: ' + err.message, 'error');
    }
  };

  const handleDownloadDayPDF = async () => {
    if (!selectedDay || !selectedBranch) return;

    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF('p', 'mm', 'a4');
    let y = 20;

    // ====================== HEADER ======================
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.text(`DAILY REPORT - ${selectedDay.dateStr}`, 105, y, {
      align: 'center',
    });
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.text(selectedBranch.branch_name.toUpperCase(), 105, y, {
      align: 'center',
    });
    y += 10;

    doc.setDrawColor(70, 70, 70);
    doc.setLineWidth(0.4);
    doc.line(22, y, 188, y);
    y += 14;

    // ====================== DAILY SALES SUMMARY ======================
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('DAILY SALES', 20, y);
    y += 6;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    const gen = Number(selectedDay.report?.generic_sales || 0);
    const brd = Number(selectedDay.report?.branded_sales || 0);
    const disc = Number(selectedDay.report?.discount_total || 0);
    const others = dayOrders
      .filter((o: any) => o.clients?.is_office_account === true)
      .reduce((sum: number, o: any) => sum + Number(o.total_amount || 0), 0);

    const netTotal = gen + brd - disc - others;

    doc.text(`Generic  : PHP ${gen.toLocaleString()}`, 20, y);
    doc.text(`Branded  : PHP ${brd.toLocaleString()}`, 115, y);
    y += 6;
    doc.text(`Others   : PHP ${others.toLocaleString()}`, 20, y);
    doc.text(`Discount : PHP ${disc.toLocaleString()}`, 115, y);
    y += 6;
    doc.text(`TOTAL SALES (NET) : PHP ${netTotal.toLocaleString()}`, 20, y);
    y += 14;

    // ====================== SUMMARY ======================
    const allDailyPayments = [...(sameDayPayments || [])];
    const allRemittances = [...(dayPayments || []), ...(legacyPayments || [])];

    const dailyCash = allDailyPayments
      .filter((p: any) => p.payment_method === 'CASH')
      .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
    const dailyCheque = allDailyPayments
      .filter((p: any) => p.payment_method === 'CHEQUE')
      .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);

    const remCash = allRemittances
      .filter((p: any) => p.payment_method === 'CASH')
      .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
    const remCheque = allRemittances
      .filter((p: any) => p.payment_method === 'CHEQUE')
      .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
    const remTotal = remCash + remCheque;

    let totalCash = dailyCash + remCash;
    const totalCheque = dailyCheque + remCheque;
    let totalPayments = totalCash + totalCheque;

    totalCash -= others;
    totalPayments -= others;

    const totalExpenses = (dayExpenses || []).reduce(
      (sum: number, exp: any) => sum + Number(exp.amount || 0),
      0
    );
    const actualCash = totalCash - totalExpenses;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('SUMMARY', 20, y);
    y += 7;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    doc.text(`Daily Sales Cash : PHP ${dailyCash.toLocaleString()}`, 20, y);
    doc.text(
      `Daily Sales Cheque : PHP ${dailyCheque.toLocaleString()}`,
      115,
      y
    );
    y += 7;

    doc.text(`Remittances : PHP ${remTotal.toLocaleString()}`, 20, y);
    doc.text(`Cash : PHP ${remCash.toLocaleString()}`, 20, y + 5.5);
    doc.text(`Cheque : PHP ${remCheque.toLocaleString()}`, 115, y + 5.5);
    y += 13;

    doc.text(`Total Payments : PHP ${totalPayments.toLocaleString()}`, 20, y);
    doc.text(`Cash : PHP ${totalCash.toLocaleString()}`, 20, y + 5.5);
    doc.text(`Cheque : PHP ${totalCheque.toLocaleString()}`, 115, y + 5.5);
    y += 13;

    doc.text(`Expenses : PHP ${totalExpenses.toLocaleString()}`, 20, y);
    y += 6;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Actual Cash : PHP ${actualCash.toLocaleString()}`, 20, y);
    y += 18;

    // ====================== DAILY SALES TABLE ======================
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('DAILY SALES TABLE', 20, y);
    y += 7;

    doc.setFontSize(5.8);
    doc.setFont('helvetica', 'normal');

    // Moved CLIENT much closer to ORDER DATE (X: 30)
    doc.text('ORDER DATE', 15, y);
    doc.text('CLIENT', 30, y);
    doc.text('SO#', 58, y);
    doc.text('DR#', 75, y);
    doc.text('PR#', 90, y);
    doc.text('CASH', 115, y, { align: 'right' });
    doc.text('CHECK', 135, y, { align: 'right' });
    doc.text('CHK DATE', 145, y);
    doc.text('DEL DATE', 165, y);
    doc.text('TOTAL', 195, y, { align: 'right' });
    y += 5;

    const groupedSales = dayOrders.reduce((acc: any, order: any) => {
      const clientKey = order.client_name || 'WALK-IN';
      if (!acc[clientKey])
        acc[clientKey] = {
          client_name: clientKey,
          order_dates: [],
          order_numbers: [],
          dr_numbers: [],
          pr_numbers: [],
          cash: 0,
          cheque: 0,
          cheque_dates: [],
          delivery_dates: [],
          total_amount: 0,
        };
      const g = acc[clientKey];

      if (order.created_date_pht) g.order_dates.push(order.created_date_pht);
      g.order_numbers.push(order.order_number || '');
      if (order.dr_number) g.dr_numbers.push(order.dr_number);
      if (order.pr_number) g.pr_numbers.push(order.pr_number);
      g.delivery_dates.push(order.delivery_date || '');

      const paymentsForOrder = sameDayPayments.filter(
        (p: any) => p.order_id === order.id
      );
      const orderCash = paymentsForOrder
        .filter((p: any) => p.payment_method === 'CASH')
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const orderCheque = paymentsForOrder
        .filter((p: any) => p.payment_method === 'CHEQUE')
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

      g.cash += orderCash;
      g.cheque += orderCheque;
      paymentsForOrder
        .filter((p: any) => p.payment_method === 'CHEQUE' && p.cheque_date)
        .forEach((p: any) => g.cheque_dates.push(p.cheque_date));

      g.total_amount += Number(order.total_amount || 0);

      return acc;
    }, {});

    Object.values(groupedSales)
      // Sorted by ORDER DATE first, then by CLIENT NAME
      .sort((a: any, b: any) => {
        const dateA = (a.order_dates?.filter(Boolean) || []).join(',');
        const dateB = (b.order_dates?.filter(Boolean) || []).join(',');
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return (a.client_name || '').localeCompare(b.client_name || '');
      })
      .forEach((group: any) => {
        // Strict text widths to ensure no overlapping into neighboring columns
        const dateLines = doc.splitTextToSize(
          [...new Set(group.order_dates.filter(Boolean))].join(', ') || '—',
          14
        );
        const clientLines = doc.splitTextToSize(
          group.client_name || 'WALK-IN',
          26
        );
        const soLines = doc.splitTextToSize(
          [...new Set(group.order_numbers)].join(', ') || '—',
          16
        );
        const drLines = doc.splitTextToSize(
          [...new Set(group.dr_numbers)].join(', ') || '—',
          14
        );
        const prLines = doc.splitTextToSize(
          [...new Set(group.pr_numbers)].join(', ') || '—',
          20
        );
        const delLines = doc.splitTextToSize(
          [...new Set(group.delivery_dates.filter(Boolean))].join(', ') || '—',
          18
        );
        const chequeDateLines = doc.splitTextToSize(
          [...new Set(group.cheque_dates)].join(', ') || '—',
          18
        );

        const maxLines = Math.max(
          clientLines.length,
          dateLines.length,
          soLines.length,
          drLines.length,
          prLines.length,
          delLines.length,
          chequeDateLines.length,
          1
        );

        const lineHeight = 5.2;
        let rowY = y;

        for (let i = 0; i < maxLines; i++) {
          if (dateLines[i]) doc.text(dateLines[i], 15, rowY);
          if (clientLines[i]) doc.text(clientLines[i], 30, rowY); // Rendered at X: 30
          if (soLines[i]) doc.text(soLines[i], 58, rowY);
          if (drLines[i]) doc.text(drLines[i], 75, rowY);
          if (prLines[i]) doc.text(prLines[i], 90, rowY);
          if (chequeDateLines[i]) doc.text(chequeDateLines[i], 145, rowY);
          if (delLines[i]) doc.text(delLines[i], 165, rowY);

          if (i === 0) {
            doc.text(`${group.cash.toLocaleString()}`, 115, rowY, {
              align: 'right',
            });
            doc.text(`${group.cheque.toLocaleString()}`, 135, rowY, {
              align: 'right',
            });
            doc.text(`${group.total_amount.toLocaleString()}`, 195, rowY, {
              align: 'right',
            });
          }

          rowY += lineHeight;
          if (rowY > 265) {
            doc.addPage();
            rowY = 20;
          }
        }

        y = rowY + 2;
        if (y > 265) {
          doc.addPage();
          y = 20;
        }
      });

    y += 15;

    // ====================== REMITTANCES / PAYMENTS TABLE ======================
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('REMITTANCES / PAYMENTS', 20, y);
    y += 7;

    doc.setFontSize(5.8);
    doc.setFont('helvetica', 'normal');

    // Matching Table Headers
    doc.text('ORDER DATE', 15, y);
    doc.text('CLIENT', 30, y);
    doc.text('SO#', 58, y);
    doc.text('DR#', 75, y);
    doc.text('PR#', 90, y);
    doc.text('CASH', 115, y, { align: 'right' });
    doc.text('CHECK', 135, y, { align: 'right' });
    doc.text('CHK DATE', 145, y);
    doc.text('DEL DATE', 165, y);
    doc.text('TOTAL', 195, y, { align: 'right' });
    y += 5;

    const groupedRem = dayPayments.reduce((acc: any, p: any) => {
      const clientKey = p.customer_name || 'WALK-IN';
      if (!acc[clientKey])
        acc[clientKey] = {
          client_name: clientKey,
          order_dates: [],
          order_numbers: [],
          dr_numbers: [],
          pr_numbers: [],
          cash: 0,
          cheque: 0,
          cheque_dates: [],
          delivery_dates: [],
          total: 0,
        };
      const g = acc[clientKey];

      if (p.orders?.created_date_pht)
        g.order_dates.push(p.orders.created_date_pht);
      if (p.orders?.order_number) g.order_numbers.push(p.orders.order_number);
      if (p.orders?.dr_number) g.dr_numbers.push(p.orders.dr_number);
      if (p.pr_number) g.pr_numbers.push(p.pr_number);
      if (p.orders?.delivery_date)
        g.delivery_dates.push(p.orders.delivery_date);
      if (p.cheque_date) g.cheque_dates.push(p.cheque_date);

      const amt = Number(p.amount || 0);
      if (p.payment_method === 'CASH') g.cash += amt;
      else if (p.payment_method === 'CHEQUE') g.cheque += amt;
      g.total += amt;

      return acc;
    }, {});

    Object.values(groupedRem)
      // Sorted by ORDER DATE first, then by CLIENT NAME
      .sort((a: any, b: any) => {
        const dateA = (a.order_dates?.filter(Boolean) || []).join(',');
        const dateB = (b.order_dates?.filter(Boolean) || []).join(',');
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return (a.client_name || '').localeCompare(b.client_name || '');
      })
      .forEach((group: any) => {
        // Strict text widths to match Daily Sales mapping
        const dateLines = doc.splitTextToSize(
          [...new Set(group.order_dates.filter(Boolean))].join(', ') || '—',
          14
        );
        const clientLines = doc.splitTextToSize(
          group.client_name || 'WALK-IN',
          26
        );
        const soLines = doc.splitTextToSize(
          [...new Set(group.order_numbers)].join(', ') || '—',
          16
        );
        const drLines = doc.splitTextToSize(
          [...new Set(group.dr_numbers)].join(', ') || '—',
          14
        );
        const prLines = doc.splitTextToSize(
          [...new Set(group.pr_numbers)].join(', ') || '—',
          20
        );
        const delLines = doc.splitTextToSize(
          [...new Set(group.delivery_dates.filter(Boolean))].join(', ') || '—',
          18
        );
        const chequeDateLines = doc.splitTextToSize(
          [...new Set(group.cheque_dates)].join(', ') || '—',
          18
        );

        const maxLines = Math.max(
          clientLines.length,
          dateLines.length,
          soLines.length,
          drLines.length,
          prLines.length,
          delLines.length,
          chequeDateLines.length,
          1
        );

        const lineHeight = 5.2;
        let rowY = y;

        for (let i = 0; i < maxLines; i++) {
          if (dateLines[i]) doc.text(dateLines[i], 15, rowY);
          if (clientLines[i]) doc.text(clientLines[i], 30, rowY); // Rendered at X: 30
          if (soLines[i]) doc.text(soLines[i], 58, rowY);
          if (drLines[i]) doc.text(drLines[i], 75, rowY);
          if (prLines[i]) doc.text(prLines[i], 90, rowY);
          if (chequeDateLines[i]) doc.text(chequeDateLines[i], 145, rowY);
          if (delLines[i]) doc.text(delLines[i], 165, rowY);

          if (i === 0) {
            doc.text(group.cash.toLocaleString(), 115, rowY, {
              align: 'right',
            });
            doc.text(group.cheque.toLocaleString(), 135, rowY, {
              align: 'right',
            });
            doc.text(group.total.toLocaleString(), 195, rowY, {
              align: 'right',
            });
          }

          rowY += lineHeight;
          if (rowY > 265) {
            doc.addPage();
            rowY = 20;
          }
        }

        y = rowY + 2;
        if (y > 265) {
          doc.addPage();
          y = 20;
        }
      });

    y += 15;

    // ====================== LEGACY / STANDALONE PAYMENTS ======================
    if (legacyPayments.length > 0) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('LEGACY / STANDALONE PAYMENTS (Old POS)', 20, y);
      y += 8;

      doc.setFontSize(9);
      doc.text('CUSTOMER', 20, y);
      doc.text('AMOUNT', 95, y, { align: 'right' });
      doc.text('METHOD', 125, y);
      doc.text('PR#', 150, y);
      doc.text('NOTES', 170, y);
      y += 7;

      [...legacyPayments]
        .sort((a: any, b: any) => {
          const dateA = a.payment_date || a.created_at || '';
          const dateB = b.payment_date || b.created_at || '';
          if (dateA !== dateB) return dateA.localeCompare(dateB);
          return (a.customer_name || '').localeCompare(b.customer_name || '');
        })
        .forEach((p: any) => {
          if (y > 275) {
            doc.addPage();
            y = 20;
          }
          doc.setFont('helvetica', 'normal');
          doc.text((p.customer_name || '—').substring(0, 35), 20, y);
          doc.text(`PHP ${Number(p.amount).toLocaleString()}`, 95, y, {
            align: 'right',
          });
          doc.text(p.payment_method, 125, y);
          doc.text(p.pr_number || '—', 150, y);
          doc.text((p.notes || '—').substring(0, 40), 170, y);
          y += 7;
        });
      y += 15;
    }

    // ====================== ONLINE PAYMENTS TABLE ======================
    const allOnline = [
      ...sameDayPayments.filter((p: any) => p.payment_method === 'ONLINE'),
      ...dayPayments.filter((p: any) => p.payment_method === 'ONLINE'),
    ];

    if (allOnline.length > 0) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('ONLINE PAYMENTS', 20, y);
      y += 8;

      doc.setFontSize(9);
      doc.text('CLIENT NAME', 20, y);
      doc.text('SO#', 68, y);
      doc.text('DR#', 88, y);
      doc.text('PR#', 108, y);
      doc.text('AMOUNT', 135, y, { align: 'right' });
      doc.text('METHOD', 140, y);
      doc.text('REFERENCE / NOTES', 160, y);
      y += 7;

      allOnline
        .sort((a: any, b: any) => {
          const dateA = a.orders?.created_date_pht || '';
          const dateB = b.orders?.created_date_pht || '';
          if (dateA !== dateB) return dateA.localeCompare(dateB);
          const nameA = a.customer_name || a.orders?.client_name || '';
          const nameB = b.customer_name || b.orders?.client_name || '';
          return nameA.localeCompare(nameB);
        })
        .forEach((payment: any) => {
          if (y > 275) {
            doc.addPage();
            y = 20;
          }
          const order = payment.orders || {};
          doc.setFont('helvetica', 'normal');
          doc.text(
            (payment.customer_name || order.client_name || '—').substring(
              0,
              28
            ),
            20,
            y
          );
          doc.text(order.order_number || '—', 68, y);
          doc.text(order.dr_number || '—', 88, y);
          doc.text(payment.pr_number || order.pr_number || '—', 108, y);
          doc.text(
            `PHP ${Number(payment.amount || 0).toLocaleString()}`,
            135,
            y,
            { align: 'right' }
          );
          doc.text('ONLINE', 140, y);
          doc.text((payment.notes || '—').substring(0, 35), 160, y);
          y += 7;
        });
      y += 15;
    }

    // ====================== EXPENSES ======================
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('EXPENSES', 20, y);
    y += 7;

    doc.setFontSize(8);
    dayExpenses.forEach((exp: any) => {
      if (y > 275) {
        doc.addPage();
        y = 20;
      }
      doc.text(exp.expense_name || '—', 20, y);
      doc.text(`PHP ${Number(exp.amount || 0).toLocaleString()}`, 195, y, {
        align: 'right',
      });
      y += 6;
    });

    // Save
    const fileName = `Daily_Report_${selectedDay.dateStr}_${
      selectedBranch.branch_name || 'Office'
    }.pdf`;
    doc.save(fileName);

    triggerToast('Modern daily report PDF downloaded', 'success');
  };

  const handleBranchSelect = async (branch: any) => {
    setSelectedBranch(branch);
    localStorage.setItem('active_branch', JSON.stringify(branch));
    if (branch.is_office_use) {
      await loadBranchClientsAndAgents(branch.id);
    }
    if (profile?.id) {
      await supabase
        .from('profiles')
        .update({ active_branch_id: branch.id })
        .eq('id', profile.id);
    }

    // FORCE DISABLE BUTTON IMMEDIATELY
    setCanCreateNewSale(false);
    setBlockingReason('Checking permissions...');
    setMissingDatesList([]);

    await logSystemActivity(
      'BRANCH_CHANGE',
      branch.branch_name,
      profile?.email,
      profile?.full_name
    );

    setBranchModalOpen(false);

    fetchStats(branch.id);
    updateQuotas(branch);

    // ←←← THIS IS THE IMPORTANT LINE
    await checkNewSalePermission(branch.id);

    fetchDailyReports(branch.id);
    if (branch.is_office_use) await fetchOfficeOrders(branch.id);
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
    const todayPHT = new Date().toISOString().split('T')[0];

    setLogStatus(`REFRESHING_SALES_FOR: ${todayPHT}...`);

    const { data: existing } = await supabase
      .from('daily_reports')
      .select('is_checked')
      .eq('branch_id', selectedBranch.id)
      .eq('report_date', todayPHT)
      .single();

    if (existing?.is_checked === true) {
      triggerToast('This report has already been verified.', 'error');
      return;
    }

    const { data: ordersForDate } = await supabase
      .from('orders')
      .select('id')
      .eq('branch_id', selectedBranch.id)
      .eq('created_date_pht', todayPHT);

    const orderIds = (ordersForDate || []).map((o: any) => o.id);

    let genTotal = 0;
    let brdTotal = 0;
    let ttlTotal = 0;
    let discTotal = 0;

    if (orderIds.length > 0) {
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('type, subtotal, discount')
        .in('order_id', orderIds);

      (orderItems || []).forEach((oi: any) => {
        const itemType = String(oi.type || '')
          .trim()
          .toLowerCase();
        const gross = Number(oi.subtotal || 0) + Number(oi.discount || 0);

        if (itemType === 'generic') genTotal += gross;
        else if (itemType === 'branded') brdTotal += gross;

        ttlTotal += gross;
        discTotal += Number(oi.discount || 0);
      });
    }

    await supabase.from('daily_reports').upsert(
      {
        branch_id: selectedBranch.id,
        report_date: todayPHT,
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
      report_date: todayPHT,
      actual_cash: 0,
      expenses: 0,
      generic_sales: genTotal,
      branded_sales: brdTotal,
      total_sales: ttlTotal,
      discount_total: discTotal,
    });

    setLogStatus(`SYNC_COMPLETE: ${todayPHT}`);
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
    const todayPHT = new Date().toISOString().split('T')[0];
    setLogStatus('REALTIME_SYNC...');

    const { data: ordersForDate } = await supabase
      .from('orders')
      .select('id')
      .eq('branch_id', branchId)
      .eq('created_date_pht', todayPHT);

    const orderIds = (ordersForDate || []).map((o: any) => o.id);

    if (orderIds.length === 0) {
      setLogStatus('IDLE: NO_ORDERS_TODAY');
      return;
    }

    const { data: orderItems } = await supabase
      .from('order_items')
      .select('type, subtotal, discount')
      .in('order_id', orderIds);

    let gen = 0;
    let brd = 0;
    let ttl = 0;
    let disc = 0;

    (orderItems || []).forEach((oi: any) => {
      const itemType = String(oi.type || '')
        .trim()
        .toLowerCase();
      const gross = Number(oi.subtotal || 0) + Number(oi.discount || 0);

      if (itemType === 'generic') gen += gross;
      else if (itemType === 'branded') brd += gross;

      ttl += gross;
      disc += Number(oi.discount || 0);
    });

    await supabase.from('daily_reports').upsert(
      {
        branch_id: branchId,
        report_date: todayPHT,
        generic_sales: gen,
        branded_sales: brd,
        total_sales: ttl,
        discount_total: disc,
        branch_name: selectedBranch?.branch_name,
      },
      { onConflict: 'branch_id,report_date' }
    );

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
  // ==================== PIE CHART COMPONENT (for Sales/Collection tab) ====================
  const PieChart = ({
    data,
    title,
    color,
  }: {
    data: { name: string; value: number }[];
    title: string;
    color: 'emerald' | 'purple';
  }) => {
    const total = data.reduce((sum, item) => sum + item.value, 0);
    if (total === 0) {
      return (
        <div className="text-slate-400 text-center py-12">
          No data for this day
        </div>
      );
    }

    // Rich color palette - different color for each agent
    const palette =
      color === 'emerald'
        ? ['#10b981', '#34d399', '#06b67f', '#14b8a6', '#0ea5e9'] // emerald/teal/cyan
        : ['#a855f7', '#c026d3', '#db2777', '#7e22ce', '#8b5cf6']; // purple/violet/pink

    // Build one single conic-gradient with multiple stops
    let start = 0;
    const stops = data.map((item, index) => {
      const percent = (item.value / total) * 360;
      const sliceColor = palette[index % palette.length];
      const stop = `${sliceColor} ${start}deg ${start + percent}deg`;
      start += percent;
      return stop;
    });

    const conicGradient = `conic-gradient(${stops.join(', ')})`;

    return (
      <div className="flex flex-col items-center">
        <div className="relative w-72 h-72 mx-auto">
          {/* Background ring */}
          <div className="absolute inset-0 bg-slate-950 rounded-full" />

          {/* Multi-color conic gradient */}
          <div
            className="absolute inset-0 rounded-full"
            style={{ background: conicGradient }}
          />

          {/* Inner white circle */}
          <div className="absolute inset-8 bg-slate-900 rounded-full flex items-center justify-center border-8 border-slate-950">
            <div className="text-center">
              <div className="text-5xl font-black text-white">
                {total.toLocaleString()}
              </div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                {title}
              </div>
            </div>
          </div>
        </div>

        {/* Legend with individual colors */}
        <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 justify-center">
          {data.map((item, i) => {
            const sliceColor = palette[i % palette.length];
            return (
              <div key={i} className="flex items-center gap-2 text-sm">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: sliceColor }}
                />
                <span className="font-medium">{item.name}</span>
                <span className="font-mono text-slate-400">
                  ₱{item.value.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
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
        <div className="w-full max-w-4xl">
          <div className="mb-10 text-center">
            <h1 className="text-4xl font-black italic text-white tracking-tighter uppercase">
              ASSIGN STATION
            </h1>
            <p className="text-slate-400 mt-2 text-sm">
              {profile?.usage_type
                ? `Logged in as ${profile.usage_type} User`
                : 'Select your station'}
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {branches.length === 0 && (
              <div className="col-span-full text-center py-12 text-slate-500">
                No accessible branches found for your usage type.
              </div>
            )}

            {branches.map((b: any) => (
              <button
                key={b.id}
                onClick={() => handleBranchSelect(b)}
                className="group p-6 bg-slate-900 border border-white/10 hover:border-emerald-500/60 rounded-3xl transition-all hover:scale-[1.02] active:scale-95 flex flex-col items-center text-center"
              >
                <div className="w-16 h-16 rounded-2xl bg-slate-800 group-hover:bg-emerald-500/10 flex items-center justify-center mb-4 transition-colors">
                  <MapPin size={32} className="text-emerald-500" />
                </div>

                <div className="font-black text-white text-lg tracking-tight mb-1">
                  {b.branch_name}
                </div>
                <div className="text-[10px] text-slate-500 font-medium uppercase tracking-widest">
                  {b.location || '—'}
                </div>

                {b.is_office_use && (
                  <div className="mt-3 text-[9px] px-3 py-1 bg-amber-500/10 text-amber-400 rounded-full font-bold">
                    OFFICE
                  </div>
                )}
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
                {selectedBranch?.is_office_use ? (
                  <>
                    ECONO_<span className="text-emerald-500">PHARMA</span>
                  </>
                ) : (
                  <>
                    ECONO_<span className="text-emerald-500">DRUGSTORE</span>
                  </>
                )}
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

            {/* WEEKLY DELIVERIES BUTTON (Auditor/Admin only) */}
            {/* WEEKLY DELIVERIES BUTTON — ONLY FOR AUDITORS (using auditor boolean) */}
            {profile?.auditor === true && (
              <button
                onClick={() => {
                  setShowWeeklyModal(true);
                  loadWeeklyData();
                }}
                className="flex-1 md:flex-none px-6 py-4 bg-slate-900 border border-amber-500/50 hover:border-amber-500 rounded-2xl text-sm font-black uppercase tracking-widest text-amber-400 flex items-center justify-center gap-3 transition-all"
              >
                <TrendingUp size={18} /> WEEKLY DELIVERIES
              </button>
            )}
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
        {/* ==================== OFFICE WORKFLOW - 3 TABLES (COMPACT) ==================== */}
        {/* ==================== OFFICE WORKFLOW - COMPACT FILTERS + SMALL BUTTONS ==================== */}
        {selectedBranch?.is_office_use && (
          <div className="mt-1 mb-10">
            <h3 className="text-[10px] font-black text-amber-400 uppercase tracking-[0.3em] px-1 italic mb-4">
              OFFICE WORKFLOW
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* ====================== 1. FOR PREPARATION ====================== */}
              <div className="bg-slate-900/40 border border-amber-500/30 rounded-3xl p-4 flex flex-col h-full">
                <h4 className="font-black text-amber-400 text-sm mb-3">
                  📋 FOR PREPARATION
                </h4>

                <div className="flex gap-2 mb-3">
                  <div className="grid grid-cols-3 gap-2 flex-1">
                    <input
                      type="date"
                      value={prepFilter.date}
                      onChange={(e) =>
                        setPrepFilter({ ...prepFilter, date: e.target.value })
                      }
                      className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none"
                    />
                    <select
                      value={prepFilter.client}
                      onChange={(e) =>
                        setPrepFilter({ ...prepFilter, client: e.target.value })
                      }
                      className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none"
                    >
                      <option value="">All Clients</option>
                      {branchClients
                        .sort((a, b) =>
                          (a.client_name || '').localeCompare(
                            b.client_name || ''
                          )
                        )
                        .map((c: any) => (
                          <option key={c.id} value={c.client_name}>
                            {c.client_name}
                          </option>
                        ))}
                    </select>
                    <select
                      value={prepFilter.agent}
                      onChange={(e) =>
                        setPrepFilter({ ...prepFilter, agent: e.target.value })
                      }
                      className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none"
                    >
                      <option value="">All Agents</option>
                      <option value="MAIN OFFICE">MAIN OFFICE</option>
                      {branchAgents
                        .sort((a, b) =>
                          (a.full_name || a.email || '').localeCompare(
                            b.full_name || b.email || ''
                          )
                        )
                        .map((a: any) => (
                          <option key={a.id} value={a.full_name || a.email}>
                            {a.full_name || a.email}
                          </option>
                        ))}
                    </select>
                  </div>
                  <button
                    onClick={() =>
                      setPrepFilter({ date: '', client: '', agent: '' })
                    }
                    className="px-3 py-1.5 text-xs font-black flex items-center gap-1 bg-slate-800 hover:bg-red-500/10 hover:text-red-400 text-slate-400 rounded-xl transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="flex-1 overflow-auto space-y-0.5 pr-1 max-h-[380px]">
                  {/* ... your pendingOrders filter + map (unchanged) ... */}
                  {pendingOrders
                    .filter((order: any) => {
                      const matchesDate =
                        !prepFilter.date ||
                        order.created_date_pht === prepFilter.date;
                      const matchesClient =
                        !prepFilter.client ||
                        (order.client_name || '').toLowerCase() ===
                          prepFilter.client.toLowerCase();
                      const matchesAgent =
                        !prepFilter.agent ||
                        (order.agent || 'MAIN OFFICE').toLowerCase() ===
                          prepFilter.agent.toLowerCase();
                      return matchesDate && matchesClient && matchesAgent;
                    })
                    .map((order: any) => (
                      <div
                        key={order.id}
                        className="bg-slate-950 rounded-xl p-2 flex items-center text-xs hover:bg-slate-900 transition-colors"
                      >
                        {/* existing card content */}
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[10px] text-slate-400 leading-none">
                            {order.created_date_pht}
                          </div>
                          <div className="font-bold text-white truncate leading-none">
                            {order.order_number}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0 px-3 text-[10px] leading-none">
                          <div className="font-bold text-slate-200 truncate">
                            {order.client_name}
                          </div>
                          <div className="font-bold text-slate-400">
                            {order.agent || 'MAIN OFFICE'}
                          </div>
                        </div>
                        <div className="text-right shrink-0 flex flex-col items-end">
                          <div className="text-emerald-400 text-sm font-bold">
                            ₱{Number(order.total_amount).toLocaleString()}
                          </div>
                          {/* Replace the old PRINT button with this */}
                          <button
                            onClick={() => {
                              setPendingPrintOrder({
                                id: order.id,
                                order_number: order.order_number,
                              });
                              setShowPrintOptionsModal(true);
                            }}
                            className="px-5 py-1 bg-amber-500 hover:bg-amber-400 text-white text-[10px] font-black rounded-lg whitespace-nowrap"
                          >
                            PRINT
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* ====================== 2. FOR DELIVERY ====================== */}
              <div className="bg-slate-900/40 border border-blue-500/30 rounded-3xl p-4 flex flex-col h-full">
                <h4 className="font-black text-blue-400 text-sm mb-3">
                  🚚 FOR DELIVERY
                </h4>

                <div className="flex gap-2 mb-3">
                  <div className="grid grid-cols-3 gap-2 flex-1">
                    <input
                      type="date"
                      value={deliveryFilter.date}
                      onChange={(e) =>
                        setDeliveryFilter({
                          ...deliveryFilter,
                          date: e.target.value,
                        })
                      }
                      className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none"
                    />
                    <select
                      value={deliveryFilter.client}
                      onChange={(e) =>
                        setDeliveryFilter({
                          ...deliveryFilter,
                          client: e.target.value,
                        })
                      }
                      className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none"
                    >
                      <option value="">All Clients</option>
                      {branchClients
                        .sort((a, b) =>
                          (a.client_name || '').localeCompare(
                            b.client_name || ''
                          )
                        )
                        .map((c: any) => (
                          <option key={c.id} value={c.client_name}>
                            {c.client_name}
                          </option>
                        ))}
                    </select>
                    <select
                      value={deliveryFilter.agent}
                      onChange={(e) =>
                        setDeliveryFilter({
                          ...deliveryFilter,
                          agent: e.target.value,
                        })
                      }
                      className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none"
                    >
                      <option value="">All Agents</option>
                      <option value="MAIN OFFICE">MAIN OFFICE</option>
                      {branchAgents
                        .sort((a, b) =>
                          (a.full_name || a.email || '').localeCompare(
                            b.full_name || b.email || ''
                          )
                        )
                        .map((a: any) => (
                          <option key={a.id} value={a.full_name || a.email}>
                            {a.full_name || a.email}
                          </option>
                        ))}
                    </select>
                  </div>
                  <button
                    onClick={() =>
                      setDeliveryFilter({ date: '', client: '', agent: '' })
                    }
                    className="px-3 py-1.5 text-xs font-black flex items-center gap-1 bg-slate-800 hover:bg-red-500/10 hover:text-red-400 text-slate-400 rounded-xl transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="flex-1 overflow-auto space-y-0.5 pr-1 max-h-[380px]">
                  {deliveryOrders
                    .filter((order: any) => {
                      const matchesDate =
                        !deliveryFilter.date ||
                        order.created_date_pht === deliveryFilter.date;
                      const matchesClient =
                        !deliveryFilter.client ||
                        (order.client_name || '').toLowerCase() ===
                          deliveryFilter.client.toLowerCase();
                      const matchesAgent =
                        !deliveryFilter.agent ||
                        (order.agent || 'MAIN OFFICE').toLowerCase() ===
                          deliveryFilter.agent.toLowerCase();
                      return matchesDate && matchesClient && matchesAgent;
                    })
                    .map((order: any) => (
                      <div
                        key={order.id}
                        className="bg-slate-950 rounded-xl p-2 flex items-center text-xs hover:bg-slate-900 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[10px] text-slate-400 leading-none">
                            {order.created_date_pht}
                          </div>
                          <div className="font-bold text-white truncate leading-none">
                            {order.order_number}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0 px-3 text-[10px] leading-none">
                          <div className="font-bold text-slate-200 truncate">
                            {order.client_name}
                          </div>
                          <div className="font-bold text-slate-400">
                            {order.agent || 'MAIN OFFICE'}
                          </div>
                        </div>
                        <div className="text-right shrink-0 flex flex-col items-end gap-2">
                          <div className="text-emerald-400 text-sm font-bold">
                            ₱{Number(order.total_amount).toLocaleString()}
                          </div>

                          {/* Two smaller buttons side-by-side */}
                          <div className="flex gap-1.5">
                            {/* Replace the old REPRINT button with this */}
                            <button
                              onClick={() => {
                                setPendingPrintOrder({
                                  id: order.id,
                                  order_number: order.order_number,
                                });
                                setShowPrintOptionsModal(true);
                              }}
                              className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-white text-[9px] font-black rounded-lg whitespace-nowrap transition-colors"
                            >
                              REPRINT
                            </button>

                            {/* DELIVERED - now half the size */}
                            <button
                              onClick={() =>
                                markAsForCollection(
                                  order.id,
                                  order.order_number
                                )
                              }
                              className="px-3 py-1 bg-blue-500 hover:bg-blue-400 text-white text-[9px] font-black rounded-lg whitespace-nowrap transition-colors"
                            >
                              DELIVERED
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* ====================== 3. FOR COLLECTION ====================== */}
              <div className="bg-slate-900/40 border border-purple-500/30 rounded-3xl p-4 flex flex-col h-full">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-black text-purple-400 text-sm">
                    💰 FOR COLLECTION
                  </h4>

                  {/* COMPACT ADD PAYMENT BUTTON */}
                  <button
                    onClick={() => setShowAddStandalonePaymentModal(true)}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-black bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors active:scale-95"
                  >
                    <Plus size={12} />
                    LEGACY
                  </button>

                  {/* REVERSE PAYMENT button - beside LEGACY PAYMENT, Office Use only */}
                  {selectedBranch?.is_office_use && (
                    <button
                      onClick={openDayPaymentsReverseModal}
                      className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-black bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors active:scale-95"
                    >
                      REVERSE
                    </button>
                  )}
                </div>

                <div className="flex gap-2 mb-3">
                  <div className="grid grid-cols-3 gap-2 flex-1">
                    <input
                      type="date"
                      value={collectionFilter.date}
                      onChange={(e) =>
                        setCollectionFilter({
                          ...collectionFilter,
                          date: e.target.value,
                        })
                      }
                      className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none"
                    />
                    <select
                      value={collectionFilter.client}
                      onChange={(e) =>
                        setCollectionFilter({
                          ...collectionFilter,
                          client: e.target.value,
                        })
                      }
                      className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none"
                    >
                      <option value="">All Clients</option>
                      {branchClients
                        .sort((a, b) =>
                          (a.client_name || '').localeCompare(
                            b.client_name || ''
                          )
                        )
                        .map((c: any) => (
                          <option key={c.id} value={c.client_name}>
                            {c.client_name}
                          </option>
                        ))}
                    </select>
                    <select
                      value={collectionFilter.agent}
                      onChange={(e) =>
                        setCollectionFilter({
                          ...collectionFilter,
                          agent: e.target.value,
                        })
                      }
                      className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none"
                    >
                      <option value="">All Agents</option>
                      <option value="MAIN OFFICE">MAIN OFFICE</option>
                      {branchAgents
                        .sort((a, b) =>
                          (a.full_name || a.email || '').localeCompare(
                            b.full_name || b.email || ''
                          )
                        )
                        .map((a: any) => (
                          <option key={a.id} value={a.full_name || a.email}>
                            {a.full_name || a.email}
                          </option>
                        ))}
                    </select>
                  </div>

                  <button
                    onClick={() =>
                      setShowOverdueCollection(!showOverdueCollection)
                    }
                    className={`px-4 py-1.5 text-xs font-black rounded-xl transition-all whitespace-nowrap ${
                      showOverdueCollection
                        ? 'bg-red-600 text-white'
                        : 'bg-slate-800 hover:bg-red-500/10 hover:text-red-400 text-slate-400'
                    }`}
                  >
                    PAST DUE
                  </button>

                  <button
                    onClick={() => {
                      setCollectionFilter({ date: '', client: '', agent: '' });
                      setShowOverdueCollection(false);
                    }}
                    className="px-3 py-1.5 text-xs font-black flex items-center gap-1 bg-slate-800 hover:bg-red-500/10 hover:text-red-400 text-slate-400 rounded-xl transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="flex-1 overflow-auto space-y-0.5 pr-1 max-h-[380px]">
                  {collectionOrders
                    .filter((order: any) => {
                      const today = new Date().toISOString().split('T')[0];
                      const isOverdue =
                        showOverdueCollection &&
                        order.due_date &&
                        order.due_date < today &&
                        Number(order.remaining_balance || 0) > 0;
                      if (showOverdueCollection && !isOverdue) return false;

                      const matchesDate =
                        !collectionFilter.date ||
                        order.created_date_pht === collectionFilter.date;
                      const matchesClient =
                        !collectionFilter.client ||
                        (order.client_name || '').toLowerCase() ===
                          collectionFilter.client.toLowerCase();
                      const matchesAgent =
                        !collectionFilter.agent ||
                        (order.agent || 'MAIN OFFICE').toLowerCase() ===
                          collectionFilter.agent.toLowerCase();
                      return matchesDate && matchesClient && matchesAgent;
                    })
                    .map((order: any) => (
                      <div
                        key={order.id}
                        className="bg-slate-950 rounded-xl p-2 flex items-center text-xs hover:bg-slate-900 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[10px] text-slate-400 leading-none">
                            {order.created_date_pht}
                          </div>
                          <div className="font-bold text-white truncate leading-none">
                            {order.order_number}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0 px-3 text-[10px] leading-none">
                          <div className="font-bold text-slate-200 truncate">
                            {order.client_name}
                          </div>
                          <div className="font-bold text-slate-400">
                            {order.agent || 'MAIN OFFICE'}
                          </div>
                        </div>
                        <div className="text-right shrink-0 flex flex-col items-end">
                          <div className="text-emerald-400 text-sm font-bold">
                            ₱{Number(order.total_amount).toLocaleString()}
                          </div>
                          <div className="text-[10px] text-red-400">
                            Bal: ₱
                            {Number(
                              order.remaining_balance || 0
                            ).toLocaleString()}
                          </div>
                          {order.due_date && (
                            <div
                              className={`text-[9px] ${
                                order.due_date <
                                new Date().toISOString().split('T')[0]
                                  ? 'text-red-500'
                                  : 'text-slate-400'
                              }`}
                            >
                              Due: {order.due_date}
                            </div>
                          )}

                          {/* Action buttons - REPRINT + COLLECT */}
                          <div className="flex flex-col items-end gap-1.5 mt-1">
                            {/* REPRINT button */}
                            <button
                              onClick={() => {
                                setPendingPrintOrder({
                                  id: order.id,
                                  order_number: order.order_number,
                                });
                                setShowPrintOptionsModal(true);
                              }}
                              className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-white text-[9px] font-black rounded-lg whitespace-nowrap"
                            >
                              REPRINT
                            </button>

                            {/* COLLECT button */}
                            <button
                              onClick={() => {
                                setSelectedCollectionOrder(order);
                                setPaymentAmount(0);
                                setPaymentMethodModal('CASH');
                                setChequeDateModal('');
                                setCollectionNotes('');
                                setPrNumberInput('');
                                setShowCollectionModal(true);
                              }}
                              className="px-3 py-1 bg-purple-500 hover:bg-purple-400 text-white text-[10px] font-black rounded-lg whitespace-nowrap"
                            >
                              COLLECT
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Previous 7 Day Report Audit */}
        {/* 7-Day Report Audit */}
        {/* 7-DAY REPORT AUDIT - ONLY FOR DRUGSTORE BRANCHES */}
        {!selectedBranch?.is_office_use && (
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

            {/* 7-Day Grid */}
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
                            ₱
                            {Number(
                              report?.generic_sales || 0
                            ).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-orange-600">DISC</span>
                          <span className="text-orange-600">
                            ₱
                            {Number(
                              report?.discount_total || 0
                            ).toLocaleString()}
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
                            ₱
                            {Number(
                              report?.branded_sales || 0
                            ).toLocaleString()}
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
                              !report.is_checked &&
                              handleVerifyReport(report.id)
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
        )}

        {/* ==================== OFFICE CALENDAR (Sun - Sat) - TODAY HIGHLIGHTED + OTHERS PRELOADED ==================== */}
        {selectedBranch?.is_office_use && (
          <div className="mt-8">
            <div className="flex items-center justify-between px-1 mb-5">
              <h3 className="text-[10px] font-black text-amber-400 uppercase tracking-[0.3em] italic flex items-center gap-2">
                📅 OFFICE CALENDAR (Sun - Sat)
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCalendarWeekOffset((o) => o - 1)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-black rounded-xl transition-all"
                >
                  ← PREV
                </button>
                {calendarWeekOffset !== 0 && (
                  <button
                    onClick={() => setCalendarWeekOffset(0)}
                    className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs font-black rounded-xl transition-all"
                  >
                    THIS WEEK
                  </button>
                )}
                <button
                  onClick={() =>
                    setCalendarWeekOffset((o) => Math.min(0, o + 1))
                  }
                  disabled={calendarWeekOffset >= 0}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-black rounded-xl transition-all"
                >
                  NEXT →
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-3">
              {(() => {
                const now = new Date();
                const sunday = new Date(now);
                sunday.setDate(
                  now.getDate() - now.getDay() + calendarWeekOffset * 7
                );

                return Array.from({ length: 7 }).map((_, i) => {
                  const date = new Date(sunday);
                  date.setDate(sunday.getDate() + i);

                  const year = date.getFullYear();
                  const month = String(date.getMonth() + 1).padStart(2, '0');
                  const day = String(date.getDate()).padStart(2, '0');
                  const dateStr = `${year}-${month}-${day}`;

                  const dayName = date.toLocaleDateString('en-US', {
                    weekday: 'short',
                  });
                  const isToday =
                    dateStr === new Date().toISOString().split('T')[0];

                  const report = dailyReports.find(
                    (r: any) => r.report_date === dateStr
                  );

                  // Calculate OTHERS from preloaded data
                  const othersAmount = last7DaysOrders
                    .filter(
                      (o: any) =>
                        o.created_date_pht === dateStr &&
                        o.clients?.is_office_account === true
                    )
                    .reduce(
                      (sum: number, o: any) =>
                        sum + Number(o.total_amount || 0),
                      0
                    );

                  // Calculate net total (deducts Others)
                  const gen = Number(report?.generic_sales || 0);
                  const brd = Number(report?.branded_sales || 0);
                  const disc = Number(report?.discount_total || 0);
                  const netTotal = gen + brd - disc - othersAmount;

                  return (
                    <button
                      key={dateStr}
                      onClick={() => setSelectedDay({ dateStr, report })}
                      className={`p-4 rounded-2xl border transition-all text-left relative ${
                        isToday
                          ? 'bg-emerald-500/20 border-emerald-400 ring-4 ring-emerald-400 shadow-lg shadow-emerald-500/30'
                          : 'bg-slate-900/40 border-white/10 hover:border-amber-400'
                      }`}
                    >
                      {isToday && (
                        <div className="absolute -top-1 -right-1 bg-emerald-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full">
                          TODAY
                        </div>
                      )}

                      <div className="text-[10px] font-black text-slate-400">
                        {dayName}
                      </div>
                      <div className="text-base font-bold text-white mt-1">
                        {date.getDate()}
                      </div>

                      {report ? (
                        <div className="mt-4 text-xs space-y-2">
                          <div className="flex justify-between">
                            <span className="text-emerald-400">GEN</span>
                            <span className="font-medium">
                              ₱{gen.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-purple-400">BRD</span>
                            <span className="font-medium">
                              ₱{brd.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-amber-400">OTHERS</span>
                            <span className="font-medium text-amber-400">
                              ₱{othersAmount.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-orange-600">DISC</span>
                            <span className="text-orange-600">
                              ₱{disc.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between border-t border-white/10 pt-2 font-bold text-emerald-400">
                            <span>TOTAL (NET)</span>
                            <span>₱{netTotal.toLocaleString()}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-8 text-[10px] text-slate-500 italic text-center">
                          No data
                        </div>
                      )}
                    </button>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* ==================== PRINT OPTIONS MODAL ==================== */}
        {showPrintOptionsModal && pendingPrintOrder && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-md p-6">
              <h2 className="text-lg font-black text-amber-400 uppercase mb-1">
                DELIVERY RECEIPT
              </h2>
              <p className="text-slate-400 mb-6">
                Order{' '}
                <span className="font-bold text-white">
                  {pendingPrintOrder.order_number}
                </span>
              </p>

              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={async () => {
                    setShowPrintOptionsModal(false);
                    await handlePrintOrder(
                      pendingPrintOrder.id,
                      pendingPrintOrder.order_number,
                      true
                    );
                    setPendingPrintOrder(null);
                  }}
                  className="py-4 bg-white text-slate-900 font-black uppercase rounded-2xl hover:bg-emerald-500 hover:text-white transition-all"
                >
                  WITH HEADERS
                </button>

                <button
                  onClick={async () => {
                    setShowPrintOptionsModal(false);
                    await handlePrintOrder(
                      pendingPrintOrder.id,
                      pendingPrintOrder.order_number,
                      false
                    );
                    setPendingPrintOrder(null);
                  }}
                  className="py-4 bg-slate-800 text-white font-black uppercase rounded-2xl hover:bg-slate-700 transition-all"
                >
                  WITHOUT HEADERS (for pre-printed DR)
                </button>
              </div>

              <button
                onClick={() => {
                  setShowPrintOptionsModal(false);
                  setPendingPrintOrder(null);
                }}
                className="mt-4 w-full py-3 text-slate-400 hover:text-white text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {/* DR# INPUT MODAL when clicking DELIVERED */}
        {showDRModal && pendingDROrder && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-md p-6">
              <h2 className="text-lg font-black text-blue-400 uppercase mb-1">
                DELIVERED
              </h2>
              <p className="text-slate-400 mb-6">
                Order{' '}
                <span className="font-bold text-white">
                  {pendingDROrder.order_number}
                </span>
              </p>

              <div className="mb-6">
                <label className="block text-xs font-black text-slate-400 mb-2">
                  DR# (Delivery Receipt Number)
                </label>
                <input
                  type="text"
                  value={drNumberInput}
                  onChange={(e) => setDrNumberInput(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 rounded-2xl px-5 py-4 text-xl font-mono outline-none focus:border-blue-400"
                  placeholder="Enter DR#"
                  autoFocus
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDRModal(false);
                    setPendingDROrder(null);
                  }}
                  className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-2xl"
                >
                  CANCEL
                </button>
                <button
                  onClick={handleConfirmDR}
                  className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl"
                >
                  SAVE DR# &amp; MARK DELIVERED
                </button>
              </div>
            </div>
          </div>
        )}
        {/* OFFICE DAY DETAIL MODAL - FULL LAYOUT WITH TABS + PIE CHARTS */}
        {selectedDay && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-6xl max-h-[94vh] overflow-hidden flex flex-col">
              {/* HEADER */}
              <div className="px-8 py-6 border-b border-white/10 flex items-center justify-between bg-slate-950">
                <h2 className="text-3xl font-black text-amber-400">
                  {new Date(selectedDay.dateStr).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </h2>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDownloadDayPDF}
                    className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black uppercase rounded-2xl transition-all shadow-lg"
                  >
                    <FileDown size={18} />
                    Download PDF
                  </button>

                  <button
                    onClick={() => setSelectedDay(null)}
                    className="text-4xl leading-none text-slate-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* ==================== TABS ==================== */}
              <div className="px-8 pt-6 border-b border-white/10 bg-slate-950">
                <div className="flex gap-2 border-b border-white/10">
                  <button
                    onClick={() => setDayTab('overview')}
                    className={`px-8 py-3 font-black uppercase tracking-widest text-sm transition-all rounded-t-2xl ${
                      dayTab === 'overview'
                        ? 'bg-emerald-500 text-white shadow-inner'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    OVERVIEW
                  </button>
                  <button
                    onClick={() => setDayTab('sales-collection')}
                    className={`px-8 py-3 font-black uppercase tracking-widest text-sm transition-all rounded-t-2xl ${
                      dayTab === 'sales-collection'
                        ? 'bg-emerald-500 text-white shadow-inner'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    SALES / COLLECTION
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-8 space-y-10">
                {/* ==================== OVERVIEW TAB ==================== */}
                {dayTab === 'overview' && (
                  <>
                    {/* 1. LARGE DAILY SALES CARDS */}
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-6">
                        DAILY SALES (totals exclude office accounts. It can be
                        seen under OTHERS)
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                        {/* GENERIC */}
                        <div className="bg-slate-950 rounded-3xl p-8 text-center border border-emerald-400/30">
                          <div className="text-emerald-400 text-sm font-black tracking-widest">
                            GENERIC
                          </div>
                          <div className="text-4xl md:text-[2.25rem] font-black font-mono tracking-tighter leading-none text-white mt-4">
                            ₱
                            {Number(
                              selectedDay.report?.generic_sales || 0
                            ).toLocaleString()}
                          </div>
                        </div>

                        {/* BRANDED */}
                        <div className="bg-slate-950 rounded-3xl p-8 text-center border border-purple-400/30">
                          <div className="text-purple-400 text-sm font-black tracking-widest">
                            BRANDED
                          </div>
                          <div className="text-4xl md:text-[2.25rem] font-black font-mono tracking-tighter leading-none text-white mt-4">
                            ₱
                            {Number(
                              selectedDay.report?.branded_sales || 0
                            ).toLocaleString()}
                          </div>
                        </div>

                        {/* OTHERS */}
                        <div className="bg-slate-950 rounded-3xl p-8 text-center border border-amber-400/30">
                          <div className="text-amber-400 text-sm font-black tracking-widest">
                            OTHERS
                          </div>
                          <div className="text-4xl md:text-[2.25rem] font-black font-mono tracking-tighter leading-none text-amber-400 mt-4">
                            ₱
                            {dayOrders
                              .filter(
                                (o: any) =>
                                  o.clients?.is_office_account === true
                              )
                              .reduce(
                                (sum, o) => sum + Number(o.total_amount || 0),
                                0
                              )
                              .toLocaleString()}
                          </div>
                        </div>

                        {/* DISCOUNT */}
                        <div className="bg-slate-950 rounded-3xl p-8 text-center border border-orange-400/30">
                          <div className="text-orange-400 text-sm font-black tracking-widest">
                            DISCOUNT
                          </div>
                          <div className="text-4xl md:text-[2.25rem] font-black font-mono tracking-tighter leading-none text-orange-400 mt-4">
                            ₱
                            {Number(
                              selectedDay.report?.discount_total || 0
                            ).toLocaleString()}
                          </div>
                        </div>

                        {/* TOTAL SALES (NET) */}
                        <div className="bg-emerald-500/10 border-2 border-emerald-400 rounded-3xl p-8 text-center">
                          <div className="text-emerald-400 text-sm font-black tracking-widest">
                            TOTAL SALES (NET)
                          </div>
                          <div className="text-4xl md:text-[2.25rem] font-black font-mono tracking-tighter leading-none text-emerald-400 mt-4">
                            ₱
                            {(
                              Number(selectedDay.report?.generic_sales || 0) +
                              Number(selectedDay.report?.branded_sales || 0) -
                              Number(selectedDay.report?.discount_total || 0) -
                              dayOrders
                                .filter(
                                  (o: any) =>
                                    o.clients?.is_office_account === true
                                )
                                .reduce(
                                  (sum, o) => sum + Number(o.total_amount || 0),
                                  0
                                )
                            ).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 2. SUMMARY ROW - Cash and Online SEPARATED */}
                    {/* Legacy payments now added to REMITTANCES (as requested) */}
                    {(() => {
                      const allDailyPayments = [...(sameDayPayments || [])]; // only linked today's orders
                      const allRemittances = [
                        ...(dayPayments || []),
                        ...(legacyPayments || []),
                      ]; // legacy + previous payments

                      const dailyCash = allDailyPayments
                        .filter((p: any) => p.payment_method === 'CASH')
                        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

                      const dailyOnline = allDailyPayments
                        .filter((p: any) => p.payment_method === 'ONLINE')
                        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

                      const dailyCheque = allDailyPayments
                        .filter((p: any) => p.payment_method === 'CHEQUE')
                        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

                      const remCash = allRemittances
                        .filter((p: any) => p.payment_method === 'CASH')
                        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

                      const remOnline = allRemittances
                        .filter((p: any) => p.payment_method === 'ONLINE')
                        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

                      const remCheque = allRemittances
                        .filter((p: any) => p.payment_method === 'CHEQUE')
                        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

                      return (
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                          {/* DAILY SALES - does NOT include legacy */}
                          <div className="bg-slate-950 rounded-3xl p-6 text-center border border-emerald-500/30">
                            <div className="text-emerald-400 text-xs font-black uppercase tracking-widest mb-2">
                              DAILY SALES
                            </div>
                            <div className="text-3xl md:text-4xl font-black font-mono tracking-tighter leading-none text-white mb-4">
                              ₱
                              {(dayOrders || [])
                                .filter(
                                  (o: any) => !o.clients?.is_office_account
                                )
                                .reduce(
                                  (sum, o) => sum + Number(o.total_amount || 0),
                                  0
                                )
                                .toLocaleString()}
                            </div>
                            <div className="text-xs space-y-1">
                              <div className="flex justify-between">
                                <span className="text-emerald-400">Cash</span>
                                <span>₱{dailyCash.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-sky-400">Online</span>
                                <span>₱{dailyOnline.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-purple-400">Cheque</span>
                                <span>₱{dailyCheque.toLocaleString()}</span>
                              </div>
                            </div>
                          </div>

                          {/* REMITTANCES - NOW INCLUDES LEGACY PAYMENTS */}
                          <div className="bg-slate-950 rounded-3xl p-6 text-center border border-cyan-500/30">
                            <div className="text-cyan-400 text-xs font-black uppercase tracking-widest mb-2">
                              REMITTANCES
                            </div>
                            <div className="text-3xl md:text-4xl font-black font-mono tracking-tighter leading-none text-white mb-4">
                              ₱
                              {allRemittances
                                .filter(
                                  (p: any) =>
                                    !p.orders?.clients?.is_office_account
                                )
                                .reduce(
                                  (sum, p) => sum + Number(p.amount || 0),
                                  0
                                )
                                .toLocaleString()}
                            </div>
                            <div className="text-xs space-y-1">
                              <div className="flex justify-between">
                                <span className="text-emerald-400">Cash</span>
                                <span>₱{remCash.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-sky-400">Online</span>
                                <span>₱{remOnline.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-purple-400">Cheque</span>
                                <span>₱{remCheque.toLocaleString()}</span>
                              </div>
                            </div>
                          </div>

                          {/* TOTAL PAYMENTS */}
                          <div className="bg-slate-950 rounded-3xl p-6 text-center border border-amber-500/50">
                            <div className="text-amber-400 text-xs font-black uppercase tracking-widest mb-2">
                              TOTAL PAYMENTS
                            </div>
                            <div className="text-3xl md:text-4xl font-black font-mono tracking-tighter leading-none text-white mb-4">
                              ₱
                              {[...allDailyPayments, ...allRemittances]
                                .filter(
                                  (p: any) =>
                                    !p.orders?.clients?.is_office_account
                                )
                                .reduce(
                                  (sum, p) => sum + Number(p.amount || 0),
                                  0
                                )
                                .toLocaleString()}
                            </div>
                            <div className="text-xs space-y-1">
                              <div className="flex justify-between">
                                <span className="text-emerald-400">Cash</span>
                                <span>
                                  ₱
                                  {[...allDailyPayments, ...allRemittances]
                                    .filter(
                                      (p: any) =>
                                        !p.orders?.clients?.is_office_account &&
                                        p.payment_method === 'CASH'
                                    )
                                    .reduce(
                                      (sum, p) => sum + Number(p.amount || 0),
                                      0
                                    )
                                    .toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-sky-400">Online</span>
                                <span>
                                  ₱
                                  {[...allDailyPayments, ...allRemittances]
                                    .filter(
                                      (p: any) =>
                                        !p.orders?.clients?.is_office_account &&
                                        p.payment_method === 'ONLINE'
                                    )
                                    .reduce(
                                      (sum, p) => sum + Number(p.amount || 0),
                                      0
                                    )
                                    .toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-purple-400">Cheque</span>
                                <span>
                                  ₱
                                  {[...allDailyPayments, ...allRemittances]
                                    .filter(
                                      (p: any) =>
                                        !p.orders?.clients?.is_office_account &&
                                        p.payment_method === 'CHEQUE'
                                    )
                                    .reduce(
                                      (sum, p) => sum + Number(p.amount || 0),
                                      0
                                    )
                                    .toLocaleString()}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* EXPENSES */}
                          <div className="bg-slate-950 rounded-3xl p-6 text-center border border-red-500/30">
                            <div className="text-red-400 text-xs font-black uppercase tracking-widest mb-2">
                              EXPENSES
                            </div>
                            <div className="text-3xl md:text-4xl font-black font-mono tracking-tighter leading-none text-red-400">
                              ₱
                              {(dayExpenses || [])
                                .reduce(
                                  (sum, exp) => sum + Number(exp.amount || 0),
                                  0
                                )
                                .toLocaleString()}
                            </div>
                          </div>

                          {/* ACTUAL CASH */}
                          <div className="bg-slate-950 rounded-3xl p-6 text-center border border-emerald-500">
                            <div className="text-emerald-400 text-xs font-black uppercase tracking-widest mb-2">
                              ACTUAL CASH
                            </div>
                            <div className="text-3xl md:text-4xl font-black font-mono tracking-tighter leading-none text-emerald-400">
                              ₱
                              {(
                                [...allDailyPayments, ...allRemittances]
                                  .filter(
                                    (p: any) =>
                                      !p.orders?.clients?.is_office_account &&
                                      p.payment_method === 'CASH'
                                  )
                                  .reduce(
                                    (sum, p) => sum + Number(p.amount || 0),
                                    0
                                  ) -
                                (dayExpenses || []).reduce(
                                  (sum, exp) => sum + Number(exp.amount || 0),
                                  0
                                )
                              ).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* 3. DAILY SALES TABLE */}
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">
                        DAILY SALES TABLE
                      </h3>
                      <div className="bg-slate-950 rounded-3xl overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-900 border-b border-white/10">
                            <tr>
                              <th className="text-left p-4 font-black text-slate-400">
                                CLIENT NAME
                              </th>
                              <th className="text-center p-4 font-black text-slate-400">
                                SO#
                              </th>
                              <th className="text-center p-4 font-black text-slate-400">
                                DR#
                              </th>
                              <th className="text-center p-4 font-black text-slate-400">
                                PR#
                              </th>
                              <th className="text-right p-4 font-black text-slate-400">
                                CASH / ONLINE
                              </th>
                              <th className="text-right p-4 font-black text-slate-400">
                                CHECK
                              </th>
                              <th className="text-center p-4 font-black text-slate-400">
                                CHECK DATE
                              </th>
                              <th className="text-center p-4 font-black text-slate-400">
                                DELIVERY DATE
                              </th>
                              <th className="text-right p-4 font-black text-slate-400">
                                OTHERS
                              </th>
                              <th className="text-right p-4 font-black text-slate-400">
                                TOTAL
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/10 text-slate-300">
                            {dayOrders.length > 0 ? (
                              (() => {
                                const clientMap: any = {};
                                for (const order of dayOrders) {
                                  const key = order.client_name || 'WALK-IN';
                                  if (!clientMap[key]) {
                                    clientMap[key] = {
                                      client_name: key,
                                      orders: [],
                                      isOfficeAccount:
                                        order.clients?.is_office_account ===
                                        true,
                                    };
                                  }
                                  clientMap[key].orders.push(order);
                                }
                                return Object.values(clientMap)
                                  .sort((a: any, b: any) =>
                                    a.client_name.localeCompare(b.client_name)
                                  )
                                  .map((group: any) => {
                                    const allPaymentsForGroup =
                                      group.orders.flatMap((o: any) =>
                                        sameDayPayments.filter(
                                          (p: any) => p.order_id === o.id
                                        )
                                      );
                                    const cashAmount = allPaymentsForGroup
                                      .filter(
                                        (p: any) => p.payment_method === 'CASH'
                                      )
                                      .reduce(
                                        (sum: number, p: any) =>
                                          sum + Number(p.amount || 0),
                                        0
                                      );
                                    const chequeAmount = allPaymentsForGroup
                                      .filter(
                                        (p: any) =>
                                          p.payment_method === 'CHEQUE'
                                      )
                                      .reduce(
                                        (sum: number, p: any) =>
                                          sum + Number(p.amount || 0),
                                        0
                                      );
                                    const soNumbers =
                                      [
                                        ...new Set(
                                          group.orders
                                            .map((o: any) => o.order_number)
                                            .filter(Boolean)
                                        ),
                                      ].join(', ') || '—';
                                    const drNumbers =
                                      [
                                        ...new Set(
                                          group.orders
                                            .map((o: any) => o.dr_number)
                                            .filter(Boolean)
                                        ),
                                      ].join(', ') || '—';
                                    const prNumbers =
                                      [
                                        ...new Set([
                                          ...allPaymentsForGroup
                                            .map((p: any) =>
                                              p.pr_number?.trim()
                                            )
                                            .filter(Boolean),
                                          ...group.orders
                                            .map((o: any) =>
                                              o.pr_number?.trim()
                                            )
                                            .filter(Boolean),
                                        ]),
                                      ].join(', ') || '—';
                                    const chequeDates =
                                      [
                                        ...new Set(
                                          allPaymentsForGroup
                                            .filter(
                                              (p: any) =>
                                                p.payment_method === 'CHEQUE' &&
                                                p.cheque_date
                                            )
                                            .map((p: any) => p.cheque_date)
                                        ),
                                      ].join(', ') || '—';
                                    const deliveryDates =
                                      [
                                        ...new Set(
                                          group.orders
                                            .map((o: any) => o.delivery_date)
                                            .filter(Boolean)
                                        ),
                                      ].join(', ') || '—';
                                    const orderTotal = group.orders.reduce(
                                      (sum: number, o: any) =>
                                        sum + Number(o.total_amount || 0),
                                      0
                                    );
                                    const isOfficeAccount =
                                      group.isOfficeAccount;
                                    return (
                                      <tr key={group.client_name}>
                                        <td className="p-4">
                                          {group.client_name}
                                        </td>
                                        <td className="p-4 text-center font-mono">
                                          {soNumbers}
                                        </td>
                                        <td className="p-4 text-center">
                                          {drNumbers}
                                        </td>
                                        <td className="p-4 text-center font-mono text-amber-300">
                                          {prNumbers}
                                        </td>
                                        <td className="p-4 text-right">
                                          ₱{cashAmount.toLocaleString()}
                                        </td>
                                        <td className="p-4 text-right">
                                          ₱{chequeAmount.toLocaleString()}
                                        </td>
                                        <td className="p-4 text-center font-mono text-purple-300">
                                          {chequeDates}
                                        </td>
                                        <td className="p-4 text-center">
                                          {deliveryDates}
                                        </td>
                                        <td className="p-4 text-right font-medium text-amber-400">
                                          ₱
                                          {isOfficeAccount
                                            ? orderTotal.toLocaleString()
                                            : '0'}
                                        </td>
                                        <td className="p-4 text-right font-bold">
                                          ₱
                                          {isOfficeAccount
                                            ? '0'
                                            : orderTotal.toLocaleString()}
                                        </td>
                                      </tr>
                                    );
                                  });
                              })()
                            ) : (
                              <tr className="text-slate-400">
                                <td className="p-4" colSpan={10}>
                                  No orders recorded for this day yet
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* 4. REMITTANCES / PAYMENTS TABLE - FIXED: Now shows standalone payments */}
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">
                        REMITTANCES / PAYMENTS
                      </h3>
                      <div className="bg-slate-950 rounded-3xl overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-900 border-b border-white/10">
                            <tr>
                              <th className="text-left p-4 font-black text-slate-400">
                                CLIENT NAME
                              </th>
                              <th className="text-center p-4 font-black text-slate-400">
                                SO#
                              </th>
                              <th className="text-center p-4 font-black text-slate-400">
                                DR#
                              </th>
                              <th className="text-center p-4 font-black text-slate-400">
                                PR#
                              </th>
                              <th className="text-right p-4 font-black text-slate-400">
                                CASH / ONLINE
                              </th>
                              <th className="text-right p-4 font-black text-slate-400">
                                CHECK
                              </th>
                              <th className="text-center p-4 font-black text-slate-400">
                                CHECK DATE
                              </th>
                              <th className="text-center p-4 font-black text-slate-400">
                                DELIVERY DATE
                              </th>
                              <th className="text-right p-4 font-black text-slate-400">
                                OTHERS
                              </th>
                              <th className="text-right p-4 font-black text-slate-400">
                                TOTAL
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/10 text-slate-300">
                            {(() => {
                              // Use all payments from dayPayments (includes standalone with order_id = null)
                              const allPayments = [...(dayPayments || [])];

                              const grouped = allPayments.reduce(
                                (acc: any, p: any) => {
                                  // Group by customer name so the same client's multiple orders merge
                                  const clientKey =
                                    p.customer_name?.trim() ||
                                    p.orders?.client_name?.trim() ||
                                    (p.order_id
                                      ? 'order-' + p.order_id
                                      : 'standalone-' + p.id);

                                  if (!acc[clientKey]) {
                                    acc[clientKey] = {
                                      clientName: clientKey,
                                      orders: [],
                                      payments: [],
                                      isOfficeAccount:
                                        p.orders?.clients?.is_office_account ===
                                        true,
                                    };
                                  }
                                  acc[clientKey].payments.push(p);
                                  if (
                                    p.orders &&
                                    !acc[clientKey].orders.find(
                                      (o: any) => o.id === p.orders.id
                                    )
                                  ) {
                                    acc[clientKey].orders.push(p.orders);
                                  }
                                  return acc;
                                },
                                {}
                              );

                              const rows = Object.values(grouped).map(
                                (group: any) => {
                                  const payments = group.payments;

                                  const cashAmount = payments
                                    .filter(
                                      (p: any) =>
                                        p.payment_method === 'CASH' ||
                                        p.payment_method === 'ONLINE'
                                    )
                                    .reduce(
                                      (sum: number, p: any) =>
                                        sum + Number(p.amount || 0),
                                      0
                                    );

                                  const chequeAmount = payments
                                    .filter(
                                      (p: any) => p.payment_method === 'CHEQUE'
                                    )
                                    .reduce(
                                      (sum: number, p: any) =>
                                        sum + Number(p.amount || 0),
                                      0
                                    );

                                  const soNumbers =
                                    [
                                      ...new Set(
                                        group.orders
                                          .map((o: any) => o.order_number)
                                          .filter(Boolean)
                                      ),
                                    ].join(', ') || '—';

                                  const drNumbers =
                                    [
                                      ...new Set(
                                        group.orders
                                          .map((o: any) => o.dr_number)
                                          .filter(Boolean)
                                      ),
                                    ].join(', ') || '—';

                                  const displayPrNumber =
                                    [
                                      ...new Set([
                                        ...payments
                                          .map((p: any) => p.pr_number?.trim())
                                          .filter(Boolean),
                                        ...group.orders
                                          .map((o: any) => o.pr_number?.trim())
                                          .filter(Boolean),
                                      ]),
                                    ].join(', ') || '—';

                                  const displayChequeDate =
                                    [
                                      ...new Set(
                                        payments
                                          .filter(
                                            (p: any) =>
                                              p.payment_method === 'CHEQUE' &&
                                              p.cheque_date
                                          )
                                          .map((p: any) => p.cheque_date)
                                      ),
                                    ].join(', ') || '—';

                                  const deliveryDates =
                                    [
                                      ...new Set(
                                        group.orders
                                          .map((o: any) => o.delivery_date)
                                          .filter(Boolean)
                                      ),
                                    ].join(', ') || '—';

                                  return {
                                    customer_name: group.clientName,
                                    cashAmount,
                                    chequeAmount,
                                    displayPrNumber,
                                    displayChequeDate,
                                    delivery_date: deliveryDates,
                                    order_number: soNumbers,
                                    dr_number: drNumbers,
                                    isOfficeAccount: group.isOfficeAccount,
                                  };
                                }
                              );

                              return rows.length > 0 ? (
                                [...rows]
                                  .sort((a: any, b: any) =>
                                    (a.customer_name || '').localeCompare(
                                      b.customer_name || ''
                                    )
                                  )
                                  .map((row: any, i: number) => {
                                    const isOfficeAccount = row.isOfficeAccount;
                                    const rowTotal =
                                      row.cashAmount + row.chequeAmount;

                                    return (
                                      <tr key={i}>
                                        <td className="p-4">
                                          {row.customer_name}
                                        </td>
                                        <td className="p-4 text-center font-mono">
                                          {row.order_number || '—'}
                                        </td>
                                        <td className="p-4 text-center">
                                          {row.dr_number || '—'}
                                        </td>
                                        <td className="p-4 text-center font-mono text-amber-300">
                                          {row.displayPrNumber}
                                        </td>
                                        <td className="p-4 text-right">
                                          ₱{row.cashAmount.toLocaleString()}
                                        </td>
                                        <td className="p-4 text-right">
                                          ₱{row.chequeAmount.toLocaleString()}
                                        </td>
                                        <td className="p-4 text-center font-mono text-purple-300">
                                          {row.displayChequeDate}
                                        </td>
                                        <td className="p-4 text-center">
                                          {row.delivery_date || '—'}
                                        </td>
                                        <td className="p-4 text-right font-medium text-amber-400">
                                          ₱
                                          {isOfficeAccount
                                            ? rowTotal.toLocaleString()
                                            : '0'}
                                        </td>
                                        <td className="p-4 text-right font-bold">
                                          ₱
                                          {isOfficeAccount
                                            ? '0'
                                            : rowTotal.toLocaleString()}
                                        </td>
                                      </tr>
                                    );
                                  })
                              ) : (
                                <tr className="text-slate-400">
                                  <td className="p-4" colSpan={10}>
                                    No remittances recorded for this day yet
                                  </td>
                                </tr>
                              );
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {/* 5. ONLINE PAYMENTS TABLE */}
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-widest text-sky-400 mb-4 flex items-center gap-2">
                        ONLINE PAYMENTS
                      </h3>
                      <div className="bg-slate-950 rounded-3xl overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-900 border-b border-white/10">
                            <tr>
                              <th className="text-left p-4 font-black text-slate-400">
                                CLIENT NAME
                              </th>
                              <th className="text-center p-4 font-black text-slate-400">
                                SO#
                              </th>
                              <th className="text-center p-4 font-black text-slate-400">
                                DR#
                              </th>
                              <th className="text-center p-4 font-black text-slate-400">
                                PR#
                              </th>
                              <th className="text-right p-4 font-black text-slate-400">
                                AMOUNT
                              </th>
                              <th className="text-center p-4 font-black text-slate-400">
                                METHOD
                              </th>
                              <th className="text-left p-4 font-black text-slate-400">
                                REFERENCE / NOTES
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/10 text-slate-300">
                            {(() => {
                              const allOnline = [
                                ...sameDayPayments.filter(
                                  (p: any) => p.payment_method === 'ONLINE'
                                ),
                                ...dayPayments.filter(
                                  (p: any) => p.payment_method === 'ONLINE'
                                ),
                              ];

                              if (allOnline.length === 0) {
                                return (
                                  <tr className="text-slate-400">
                                    <td className="p-4" colSpan={7}>
                                      No online payments recorded for this day
                                    </td>
                                  </tr>
                                );
                              }

                              return allOnline
                                .sort((a: any, b: any) => {
                                  const nameA =
                                    a.customer_name ||
                                    a.orders?.client_name ||
                                    '';
                                  const nameB =
                                    b.customer_name ||
                                    b.orders?.client_name ||
                                    '';
                                  return nameA.localeCompare(nameB);
                                })
                                .map((payment: any, index: number) => {
                                  const order = payment.orders || {};
                                  return (
                                    <tr key={payment.id || index}>
                                      <td className="p-4">
                                        {payment.customer_name ||
                                          order.client_name ||
                                          '—'}
                                      </td>
                                      <td className="p-4 text-center font-mono">
                                        {order.order_number || '—'}
                                      </td>
                                      <td className="p-4 text-center">
                                        {order.dr_number || '—'}
                                      </td>
                                      <td className="p-4 text-center font-mono text-amber-300">
                                        {payment.pr_number ||
                                          order.pr_number ||
                                          '—'}
                                      </td>
                                      <td className="p-4 text-right font-bold text-sky-400">
                                        ₱
                                        {Number(
                                          payment.amount || 0
                                        ).toLocaleString()}
                                      </td>
                                      <td className="p-4 text-center">
                                        <span className="px-3 py-1 bg-sky-500/10 text-sky-400 text-xs font-bold rounded-full">
                                          ONLINE
                                        </span>
                                      </td>
                                      <td className="p-4 text-sm text-sky-300 font-medium">
                                        {payment.notes?.trim() || '—'}
                                      </td>
                                    </tr>
                                  );
                                });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {/* LEGACY / STANDALONE PAYMENTS (Old POS) - Matching header style */}
                    {legacyPayments.length > 0 && (
                      <div className="mt-8">
                        <h3 className="text-xs font-black uppercase tracking-widest text-purple-400 mb-4 flex items-center gap-2">
                          LEGACY / STANDALONE PAYMENTS (Old POS)
                        </h3>

                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-900 border-b border-white/10">
                              <tr>
                                <th className="text-left p-4 font-black text-slate-400">
                                  CUSTOMER
                                </th>
                                <th className="text-right p-4 font-black text-slate-400">
                                  AMOUNT
                                </th>
                                <th className="text-center p-4 font-black text-slate-400">
                                  METHOD
                                </th>
                                <th className="text-center p-4 font-black text-slate-400">
                                  PR#
                                </th>
                                <th className="text-left p-4 font-black text-slate-400">
                                  NOTES
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10">
                              {legacyPayments.map((payment: any) => (
                                <tr
                                  key={payment.id}
                                  className="hover:bg-white/5"
                                >
                                  <td className="p-4 font-medium">
                                    {payment.customer_name}
                                  </td>
                                  <td className="p-4 text-right font-mono text-emerald-400">
                                    ₱{Number(payment.amount).toLocaleString()}
                                  </td>
                                  <td className="p-4 text-center">
                                    <span
                                      className={`inline-flex items-center px-3 py-1 text-xs font-bold rounded-2xl 
                  ${
                    payment.payment_method === 'CASH'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : payment.payment_method === 'CHEQUE'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-purple-500/20 text-purple-300'
                  }`}
                                    >
                                      {payment.payment_method}
                                    </span>
                                  </td>
                                  <td className="p-4 text-center font-mono text-amber-300">
                                    {payment.pr_number || '—'}
                                  </td>
                                  <td className="p-4 text-sm text-slate-400">
                                    {payment.notes || '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* 6. EXPENSES TABLE */}
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">
                        EXPENSES
                      </h3>
                      {isAdmin && (
                        <button
                          onClick={() => setShowAddExpenseModal(true)}
                          className="mb-4 flex items-center gap-2 text-xs font-black uppercase bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl transition-colors"
                        >
                          <Plus size={14} /> Add Expense
                        </button>
                      )}
                      <div className="bg-slate-950 rounded-3xl overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-900 border-b border-white/10">
                            <tr>
                              <th className="text-left p-4 font-black text-slate-400">
                                EXPENSE NAME
                              </th>
                              <th className="text-right p-4 font-black text-slate-400">
                                AMOUNT
                              </th>
                              {isAdmin && <th className="w-10"></th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/10 text-slate-300">
                            {dayExpenses.length > 0 ? (
                              dayExpenses.map((exp: any) => (
                                <tr key={exp.id}>
                                  <td className="p-4">{exp.expense_name}</td>
                                  <td className="p-4 text-right font-bold">
                                    ₱{Number(exp.amount || 0).toLocaleString()}
                                  </td>
                                  {isAdmin && (
                                    <td className="p-4 text-right w-10">
                                      <button
                                        onClick={() =>
                                          handleDeleteExpense(
                                            exp.id,
                                            exp.expense_name
                                          )
                                        }
                                        className="text-red-400 hover:text-red-500 transition-colors"
                                      >
                                        🗑
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              ))
                            ) : (
                              <tr className="text-slate-400">
                                <td className="p-4" colSpan={isAdmin ? 3 : 2}>
                                  No expenses recorded yet
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}

                {/* ==================== SALES / COLLECTION TAB (unchanged) ==================== */}
                {dayTab === 'sales-collection' && (
                  <>
                    {/* === COMPUTE PIE CHART DATA - EXCLUDE OFFICE ACCOUNTS ("OTHERS") === */}
                    {(() => {
                      // ALL payments today = same-day orders + previous-day orders + legacy
                      const allTodayPayments = [
                        ...sameDayPayments,
                        ...dayPayments,
                        ...legacyPayments,
                      ];

                      // SALES BY AGENT - exclude office accounts
                      const salesMap = new Map();
                      dayOrders
                        .filter(
                          (order: any) => !order.clients?.is_office_account
                        )
                        .forEach((order: any) => {
                          const agent = order.agent || 'Unknown Agent';
                          const amount = Number(order.total_amount || 0);
                          salesMap.set(
                            agent,
                            (salesMap.get(agent) || 0) + amount
                          );
                        });
                      const salesByAgentData = Array.from(
                        salesMap.entries()
                      ).map(([name, value]) => ({
                        name,
                        value,
                      }));

                      // COLLECTIONS BY AGENT - all payments today, exclude office accounts
                      const collMap = new Map();
                      allTodayPayments
                        .filter(
                          (p: any) => !p.orders?.clients?.is_office_account
                        )
                        .forEach((p: any) => {
                          const agent =
                            p.orders?.agent?.trim() ||
                            (p.order_id ? 'Unknown Agent' : 'MAIN OFFICE');
                          const amount = Number(p.amount || 0);
                          collMap.set(
                            agent,
                            (collMap.get(agent) || 0) + amount
                          );
                        });
                      const collectionsByAgentData = Array.from(
                        collMap.entries()
                      ).map(([name, value]) => ({
                        name,
                        value,
                      }));

                      // ── SALES: group by agent → client ──
                      // Map<agent, Map<client, total_amount>>
                      const salesGrouped = new Map<
                        string,
                        Map<string, number>
                      >();
                      dayOrders
                        .filter(
                          (order: any) => !order.clients?.is_office_account
                        )
                        .forEach((order: any) => {
                          const agent = order.agent || 'Unknown Agent';
                          const client = order.client_name || '—';
                          const amount = Number(order.total_amount || 0);
                          if (!salesGrouped.has(agent))
                            salesGrouped.set(agent, new Map());
                          const clientMap = salesGrouped.get(agent)!;
                          clientMap.set(
                            client,
                            (clientMap.get(client) || 0) + amount
                          );
                        });

                      // ── COLLECTIONS: group by agent → client, track per-method totals ──
                      // Map<agent, Map<client, { cash, cheque, online }>>
                      const collGrouped = new Map<
                        string,
                        Map<
                          string,
                          { cash: number; cheque: number; online: number }
                        >
                      >();
                      allTodayPayments
                        .filter(
                          (p: any) => !p.orders?.clients?.is_office_account
                        )
                        .forEach((p: any) => {
                          const agent =
                            p.orders?.agent?.trim() ||
                            (p.order_id ? 'Unknown Agent' : 'MAIN OFFICE');
                          const client =
                            p.orders?.client_name ||
                            p.customer_name ||
                            'LEGACY';
                          const amount = Number(p.amount || 0);
                          const method = (
                            p.payment_method || 'CASH'
                          ).toUpperCase();
                          if (!collGrouped.has(agent))
                            collGrouped.set(agent, new Map());
                          const clientMap = collGrouped.get(agent)!;
                          if (!clientMap.has(client))
                            clientMap.set(client, {
                              cash: 0,
                              cheque: 0,
                              online: 0,
                            });
                          const entry = clientMap.get(client)!;
                          if (method === 'CASH') entry.cash += amount;
                          else if (method === 'CHEQUE') entry.cheque += amount;
                          else entry.online += amount;
                        });

                      const grandSalesTotal = Array.from(
                        salesGrouped.values()
                      ).reduce(
                        (sum, clientMap) =>
                          sum +
                          Array.from(clientMap.values()).reduce(
                            (s, v) => s + v,
                            0
                          ),
                        0
                      );
                      const grandCollTotal = Array.from(
                        collGrouped.values()
                      ).reduce(
                        (sum, clientMap) =>
                          sum +
                          Array.from(clientMap.values()).reduce(
                            (s, e) => s + e.cash + e.cheque + e.online,
                            0
                          ),
                        0
                      );

                      return (
                        <div className="space-y-12">
                          {/* ── PIE CHARTS ── */}
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                            {/* SALES BY AGENT PIE */}
                            <div>
                              <h3 className="text-xs font-black uppercase tracking-widest text-emerald-400 mb-6 flex items-center gap-2">
                                📦 SALES BY AGENT
                              </h3>
                              <PieChart
                                data={salesByAgentData}
                                title="Sales"
                                color="emerald"
                              />
                            </div>

                            {/* COLLECTIONS BY AGENT PIE */}
                            <div>
                              <h3 className="text-xs font-black uppercase tracking-widest text-purple-400 mb-6 flex items-center gap-2">
                                💰 COLLECTIONS BY AGENT
                              </h3>
                              <PieChart
                                data={collectionsByAgentData}
                                title="Collections"
                                color="purple"
                              />
                            </div>
                          </div>

                          {/* ── SALES TABLE ── */}
                          <div>
                            <h3 className="text-xs font-black uppercase tracking-widest text-emerald-400 mb-4 flex items-center gap-2">
                              📦 SALES BREAKDOWN BY AGENT
                            </h3>
                            {salesGrouped.size === 0 ? (
                              <div className="text-center py-8 text-slate-500 text-sm bg-slate-900 rounded-2xl border border-white/5">
                                No sales recorded for this day.
                              </div>
                            ) : (
                              <div className="overflow-x-auto rounded-2xl border border-white/10">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-slate-800 text-left">
                                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-400">
                                        Agent
                                      </th>
                                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                        Client
                                      </th>
                                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">
                                        Amount
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {Array.from(salesGrouped.entries())
                                      .sort(([a], [b]) => a.localeCompare(b))
                                      .map(([agent, clientMap]) => {
                                        const agentTotal = Array.from(
                                          clientMap.values()
                                        ).reduce((s, v) => s + v, 0);
                                        const clients = Array.from(
                                          clientMap.entries()
                                        ).sort(([a], [b]) =>
                                          a.localeCompare(b)
                                        );
                                        return (
                                          <>
                                            {clients.map(
                                              ([client, amount], ci) => (
                                                <tr
                                                  key={`s-${agent}-${client}`}
                                                  className="border-t border-white/5 hover:bg-slate-800/50 transition-colors"
                                                >
                                                  <td className="px-4 py-3 font-bold text-white">
                                                    {ci === 0 ? agent : ''}
                                                  </td>
                                                  <td className="px-4 py-3 text-slate-300">
                                                    {client}
                                                  </td>
                                                  <td className="px-4 py-3 text-right font-mono text-emerald-400 font-bold">
                                                    ₱
                                                    {amount.toLocaleString(
                                                      undefined,
                                                      {
                                                        minimumFractionDigits: 2,
                                                        maximumFractionDigits: 2,
                                                      }
                                                    )}
                                                  </td>
                                                </tr>
                                              )
                                            )}
                                            <tr
                                              key={`s-sub-${agent}`}
                                              className="border-t border-emerald-500/20 bg-emerald-500/5"
                                            >
                                              <td
                                                colSpan={2}
                                                className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-500"
                                              >
                                                {agent} — Subtotal
                                              </td>
                                              <td className="px-4 py-2 text-right font-mono font-black text-emerald-400">
                                                ₱
                                                {agentTotal.toLocaleString(
                                                  undefined,
                                                  {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                  }
                                                )}
                                              </td>
                                            </tr>
                                          </>
                                        );
                                      })}
                                    <tr className="border-t-2 border-emerald-500/40 bg-emerald-900/20">
                                      <td
                                        colSpan={2}
                                        className="px-4 py-3 text-xs font-black uppercase tracking-widest text-emerald-300"
                                      >
                                        TOTAL SALES
                                      </td>
                                      <td className="px-4 py-3 text-right font-mono font-black text-emerald-300 text-base">
                                        ₱
                                        {grandSalesTotal.toLocaleString(
                                          undefined,
                                          {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                          }
                                        )}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>

                          {/* ── COLLECTIONS TABLE ── */}
                          <div>
                            <h3 className="text-xs font-black uppercase tracking-widest text-purple-400 mb-4 flex items-center gap-2">
                              💰 COLLECTIONS BREAKDOWN BY AGENT
                            </h3>
                            {collGrouped.size === 0 ? (
                              <div className="text-center py-8 text-slate-500 text-sm bg-slate-900 rounded-2xl border border-white/5">
                                No collections recorded for this day.
                              </div>
                            ) : (
                              <div className="overflow-x-auto rounded-2xl border border-white/10">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-slate-800 text-left">
                                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-purple-400">
                                        Agent
                                      </th>
                                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                        Client
                                      </th>
                                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-400 text-right">
                                        Cash
                                      </th>
                                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-amber-400 text-right">
                                        Cheque
                                      </th>
                                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-blue-400 text-right">
                                        Online
                                      </th>
                                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">
                                        Total
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {Array.from(collGrouped.entries())
                                      .sort(([a], [b]) => a.localeCompare(b))
                                      .map(([agent, clientMap]) => {
                                        const agentTotal = Array.from(
                                          clientMap.values()
                                        ).reduce(
                                          (s, e) =>
                                            s + e.cash + e.cheque + e.online,
                                          0
                                        );
                                        const agentCash = Array.from(
                                          clientMap.values()
                                        ).reduce((s, e) => s + e.cash, 0);
                                        const agentCheque = Array.from(
                                          clientMap.values()
                                        ).reduce((s, e) => s + e.cheque, 0);
                                        const agentOnline = Array.from(
                                          clientMap.values()
                                        ).reduce((s, e) => s + e.online, 0);
                                        const clients = Array.from(
                                          clientMap.entries()
                                        ).sort(([a], [b]) =>
                                          a.localeCompare(b)
                                        );
                                        const fmt = (n: number) =>
                                          n > 0 ? (
                                            `₱${n.toLocaleString(undefined, {
                                              minimumFractionDigits: 2,
                                              maximumFractionDigits: 2,
                                            })}`
                                          ) : (
                                            <span className="text-slate-700">
                                              —
                                            </span>
                                          );
                                        return (
                                          <>
                                            {clients.map(
                                              ([client, entry], ci) => (
                                                <tr
                                                  key={`c-${agent}-${client}`}
                                                  className="border-t border-white/5 hover:bg-slate-800/50 transition-colors"
                                                >
                                                  <td className="px-4 py-3 font-bold text-white">
                                                    {ci === 0 ? agent : ''}
                                                  </td>
                                                  <td className="px-4 py-3 text-slate-300">
                                                    {client}
                                                  </td>
                                                  <td className="px-4 py-3 text-right font-mono text-emerald-400">
                                                    {fmt(entry.cash)}
                                                  </td>
                                                  <td className="px-4 py-3 text-right font-mono text-amber-400">
                                                    {fmt(entry.cheque)}
                                                  </td>
                                                  <td className="px-4 py-3 text-right font-mono text-blue-400">
                                                    {fmt(entry.online)}
                                                  </td>
                                                  <td className="px-4 py-3 text-right font-mono text-purple-400 font-bold">
                                                    ₱
                                                    {(
                                                      entry.cash +
                                                      entry.cheque +
                                                      entry.online
                                                    ).toLocaleString(
                                                      undefined,
                                                      {
                                                        minimumFractionDigits: 2,
                                                        maximumFractionDigits: 2,
                                                      }
                                                    )}
                                                  </td>
                                                </tr>
                                              )
                                            )}
                                            <tr
                                              key={`c-sub-${agent}`}
                                              className="border-t border-purple-500/20 bg-purple-500/5"
                                            >
                                              <td
                                                colSpan={2}
                                                className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-purple-500"
                                              >
                                                {agent} — Subtotal
                                              </td>
                                              <td className="px-4 py-2 text-right font-mono font-black text-emerald-400 text-[11px]">
                                                {agentCash > 0
                                                  ? `₱${agentCash.toLocaleString(
                                                      undefined,
                                                      {
                                                        minimumFractionDigits: 2,
                                                        maximumFractionDigits: 2,
                                                      }
                                                    )}`
                                                  : '—'}
                                              </td>
                                              <td className="px-4 py-2 text-right font-mono font-black text-amber-400 text-[11px]">
                                                {agentCheque > 0
                                                  ? `₱${agentCheque.toLocaleString(
                                                      undefined,
                                                      {
                                                        minimumFractionDigits: 2,
                                                        maximumFractionDigits: 2,
                                                      }
                                                    )}`
                                                  : '—'}
                                              </td>
                                              <td className="px-4 py-2 text-right font-mono font-black text-blue-400 text-[11px]">
                                                {agentOnline > 0
                                                  ? `₱${agentOnline.toLocaleString(
                                                      undefined,
                                                      {
                                                        minimumFractionDigits: 2,
                                                        maximumFractionDigits: 2,
                                                      }
                                                    )}`
                                                  : '—'}
                                              </td>
                                              <td className="px-4 py-2 text-right font-mono font-black text-purple-400">
                                                ₱
                                                {agentTotal.toLocaleString(
                                                  undefined,
                                                  {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                  }
                                                )}
                                              </td>
                                            </tr>
                                          </>
                                        );
                                      })}
                                    <tr className="border-t-2 border-purple-500/40 bg-purple-900/20">
                                      <td
                                        colSpan={5}
                                        className="px-4 py-3 text-xs font-black uppercase tracking-widest text-purple-300"
                                      >
                                        TOTAL COLLECTIONS
                                      </td>
                                      <td className="px-4 py-3 text-right font-mono font-black text-purple-300 text-base">
                                        ₱
                                        {grandCollTotal.toLocaleString(
                                          undefined,
                                          {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                          }
                                        )}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

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
                  <button
                    onClick={() => {
                      setShowMergeModal(true);
                      resetMergeState();
                    }}
                    className="flex items-center justify-between p-6 bg-slate-900 border border-purple-500/30 rounded-2xl hover:border-purple-500 transition-all group"
                  >
                    <div className="flex items-center gap-4 text-left">
                      <Database size={20} className="text-purple-500" />
                      <div>
                        <span className="block text-sm font-black uppercase italic text-white leading-none">
                          Merge Products
                        </span>
                        <span className="text-[9px] text-slate-500 uppercase mt-1 block tracking-widest font-bold">
                          Combine Duplicates
                        </span>
                      </div>
                    </div>
                    <ArrowRight
                      size={18}
                      className="text-slate-700 group-hover:text-purple-500"
                    />
                  </button>
                  <button
                    onClick={() => {
                      setShowUpdateClientsModal(true);
                      fetchClients();
                    }}
                    className="flex items-center justify-between p-6 bg-slate-900 border border-amber-500/30 rounded-2xl hover:border-amber-500 transition-all group"
                  >
                    <div className="flex items-center gap-4 text-left">
                      <UserIcon size={20} className="text-amber-500" />
                      <div>
                        <span className="block text-sm font-black uppercase italic text-white leading-none">
                          Update Clients
                        </span>
                        <span className="text-[9px] text-slate-500 uppercase mt-1 block tracking-widest font-bold">
                          Client Directory
                        </span>
                      </div>
                    </div>
                    <ArrowRight
                      size={18}
                      className="text-slate-700 group-hover:text-amber-500"
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
        {/* ADD EXPENSE MODAL */}
        {showAddExpenseModal && (
          <div className="fixed inset-0 z-[3100] flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-md p-6">
              <h2 className="text-lg font-black text-emerald-400 mb-6">
                ADD EXPENSE
              </h2>

              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Expense name (e.g. Gas, Salary, etc)"
                  value={newExpenseName}
                  onChange={(e) => setNewExpenseName(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 rounded-2xl px-5 py-4 text-white outline-none"
                />

                <input
                  type="number"
                  placeholder="Amount"
                  value={newExpenseAmount}
                  onChange={(e) =>
                    setNewExpenseAmount(parseFloat(e.target.value) || 0)
                  }
                  className="w-full bg-slate-950 border border-white/10 rounded-2xl px-5 py-4 text-white outline-none text-2xl"
                />

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => {
                      setShowAddExpenseModal(false);
                      setNewExpenseName('');
                      setNewExpenseAmount(0);
                    }}
                    className="flex-1 py-4 bg-slate-800 text-white font-bold rounded-2xl"
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={handleAddExpense}
                    disabled={!newExpenseName || newExpenseAmount <= 0}
                    className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-bold rounded-2xl"
                  >
                    SAVE EXPENSE
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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
        {/* ==================== WEEKLY DELIVERIES MODAL (with Bypass) ==================== */}
        {/* ==================== WEEKLY DELIVERIES MODAL (Per-Row Bypass + Sorted) ==================== */}
        {/* ==================== WEEKLY DELIVERIES MODAL (Compact + Per-Row Save) ==================== */}
        {showWeeklyModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setShowWeeklyModal(false)}
            />
            <div className="relative bg-slate-900 border border-amber-500/30 w-full max-w-4xl rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex justify-between items-center mb-5">
                <div>
                  <h2 className="text-2xl font-black italic text-amber-400 uppercase tracking-tighter">
                    WEEKLY DELIVERIES
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    Week of {currentWeekStart} (Sun–Sat)
                  </p>
                </div>
                <button
                  onClick={() => setShowWeeklyModal(false)}
                  className="text-slate-500 hover:text-white"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <th className="text-left py-3 px-4">BRANCH</th>
                      <th className="text-right py-3 px-4">
                        EXPECTED DELIVERY
                      </th>
                      <th className="text-right py-3 px-4">
                        WEEKLY CURRENT (PO)
                      </th>
                      <th className="text-center py-3 px-4 w-20">BYPASS</th>
                      <th className="text-center py-3 px-4 w-24">ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...branches]
                      .sort((a, b) =>
                        a.branch_name.localeCompare(b.branch_name)
                      )
                      .map((branch: any) => {
                        const expected = weeklyTargets[branch.id] || 0;
                        const current = weeklyPOData[branch.id] || 0;
                        const isBypassed = weeklyBypasses[branch.id] || false;

                        return (
                          <tr
                            key={branch.id}
                            className="border-b border-white/5 hover:bg-slate-800/50 transition-colors"
                          >
                            <td className="px-4 py-2.5 font-medium text-white">
                              {branch.branch_name}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <input
                                type="number"
                                value={expected}
                                onChange={(e) =>
                                  setWeeklyTargets((prev) => ({
                                    ...prev,
                                    [branch.id]:
                                      parseFloat(e.target.value) || 0,
                                  }))
                                }
                                className="w-32 bg-slate-950 border border-white/10 rounded-xl px-3 py-1.5 text-right text-base font-semibold text-amber-400 focus:border-amber-400 outline-none"
                                placeholder="0.00"
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-emerald-400 text-base font-black">
                              ₱{current.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={isBypassed}
                                onChange={(e) =>
                                  setWeeklyBypasses((prev) => ({
                                    ...prev,
                                    [branch.id]: e.target.checked,
                                  }))
                                }
                                className="w-4 h-4 accent-amber-500 bg-slate-900 border border-white/30 rounded focus:ring-0"
                              />
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <button
                                onClick={() => handleSaveSingleRow(branch.id)}
                                className="px-4 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all"
                              >
                                Save
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              <div className="pt-4 border-t border-white/10 flex items-center justify-end">
                <button
                  onClick={() => setShowWeeklyModal(false)}
                  className="px-8 py-3 text-slate-400 hover:text-white font-black uppercase text-sm tracking-widest transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
        {/* ================================================================== */}
        {/* ================================================================== */}

        {/* ==================== STANDALONE / LEGACY ADD PAYMENT MODAL ==================== */}
        {showAddStandalonePaymentModal && (
          <div className="fixed inset-0 z-[3100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-black text-purple-400 uppercase tracking-tight">
                  ADD STANDALONE PAYMENT
                </h2>
                <button
                  onClick={() => setShowAddStandalonePaymentModal(false)}
                  className="text-slate-500 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Customer Name */}
                <div>
                  <label className="text-xs font-black text-slate-400 mb-2 block">
                    CUSTOMER NAME
                  </label>
                  <input
                    type="text"
                    value={standalonePayment.customer_name}
                    onChange={(e) =>
                      setStandalonePayment({
                        ...standalonePayment,
                        customer_name: e.target.value,
                      })
                    }
                    className="w-full bg-slate-950 border border-white/10 rounded-2xl px-5 py-4 text-white outline-none"
                    placeholder="Enter customer name"
                  />
                </div>

                {/* PR# (Payment Receipt Number) - Dedicated field */}
                <div>
                  <label className="text-xs font-black text-slate-400 mb-2 block">
                    PR# (Payment Receipt Number)
                  </label>
                  <input
                    type="text"
                    value={standalonePayment.pr_number}
                    onChange={(e) =>
                      setStandalonePayment({
                        ...standalonePayment,
                        pr_number: e.target.value,
                      })
                    }
                    className="w-full bg-slate-950 border border-white/10 rounded-2xl px-5 py-4 text-xl font-mono outline-none focus:border-purple-400"
                    placeholder="Enter PR#"
                  />
                </div>

                {/* Payment Method */}
                <div>
                  <label className="text-xs font-black text-slate-400 mb-2 block">
                    PAYMENT METHOD
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() =>
                        setStandalonePayment({
                          ...standalonePayment,
                          payment_method: 'CASH',
                        })
                      }
                      className={`py-3 rounded-xl font-bold text-sm ${
                        standalonePayment.payment_method === 'CASH'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      CASH
                    </button>
                    <button
                      onClick={() =>
                        setStandalonePayment({
                          ...standalonePayment,
                          payment_method: 'CHEQUE',
                        })
                      }
                      className={`py-3 rounded-xl font-bold text-sm ${
                        standalonePayment.payment_method === 'CHEQUE'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      CHEQUE
                    </button>
                    <button
                      onClick={() =>
                        setStandalonePayment({
                          ...standalonePayment,
                          payment_method: 'ONLINE',
                        })
                      }
                      className={`py-3 rounded-xl font-bold text-sm ${
                        standalonePayment.payment_method === 'ONLINE'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      ONLINE
                    </button>
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <label className="text-xs font-black text-slate-400 mb-2 block">
                    AMOUNT
                  </label>
                  <input
                    type="number"
                    value={standalonePayment.amount}
                    onChange={(e) =>
                      setStandalonePayment({
                        ...standalonePayment,
                        amount: parseFloat(e.target.value) || 0,
                      })
                    }
                    step="0.01"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-xl font-mono outline-none"
                    placeholder="0.00"
                  />
                </div>

                {/* Cheque Date */}
                {standalonePayment.payment_method === 'CHEQUE' && (
                  <div>
                    <label className="text-xs font-black text-slate-400 mb-2 block">
                      CHEQUE DATE
                    </label>
                    <input
                      type="date"
                      value={standalonePayment.cheque_date}
                      onChange={(e) =>
                        setStandalonePayment({
                          ...standalonePayment,
                          cheque_date: e.target.value,
                        })
                      }
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3"
                    />
                  </div>
                )}

                {/* Reference / Notes */}
                <div>
                  <label className="text-xs font-black text-slate-400 mb-2 block">
                    {standalonePayment.payment_method === 'ONLINE'
                      ? 'REFERENCE NUMBER / NOTES (required)'
                      : 'NOTES'}
                  </label>
                  <textarea
                    value={standalonePayment.notes}
                    onChange={(e) =>
                      setStandalonePayment({
                        ...standalonePayment,
                        notes: e.target.value,
                      })
                    }
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 h-24 resize-none"
                    placeholder={
                      standalonePayment.payment_method === 'ONLINE'
                        ? 'Enter reference / transaction ID...'
                        : 'Additional notes...'
                    }
                  />
                </div>

                <button
                  onClick={handleAddStandalonePayment}
                  disabled={standalonePayment.amount <= 0}
                  className="w-full py-4 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white font-black text-sm uppercase tracking-widest rounded-xl"
                >
                  RECORD STANDALONE PAYMENT
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

        {/* ==================== MERGE PRODUCT MODAL ==================== */}
        {showMergeModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => {
                setShowMergeModal(false);
                resetMergeState();
              }}
            />
            <div className="relative bg-slate-900 border border-purple-500/30 w-full max-w-4xl rounded-3xl p-8 shadow-2xl max-h-[95vh] overflow-auto">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h2 className="text-3xl font-black italic text-purple-400 uppercase tracking-tighter">
                    Merge Products
                  </h2>
                  <p className="text-slate-400 text-sm">
                    Combine duplicates • Transfer all history
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowMergeModal(false);
                    resetMergeState();
                  }}
                  className="text-slate-400 hover:text-white"
                >
                  <X size={28} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-8">
                {/* TARGET - KEEP THIS */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-emerald-400 font-black uppercase text-xs tracking-widest">
                    <CheckCircle2 size={16} /> KEEP THIS PRODUCT (Target)
                  </div>
                  <div className="relative">
                    <Search
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                      size={18}
                    />
                    <input
                      type="text"
                      value={mergeSearchTermTarget}
                      onChange={(e) => setMergeSearchTermTarget(e.target.value)}
                      className="w-full bg-slate-950 border border-emerald-500/30 rounded-3xl pl-12 py-4 text-white outline-none focus:border-emerald-400"
                      placeholder="Search target product..."
                    />
                  </div>

                  {mergeSearchResultsTarget.length > 0 && !targetProduct && (
                    <div className="max-h-64 overflow-auto bg-slate-950 border border-white/10 rounded-3xl">
                      {mergeSearchResultsTarget.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setTargetProduct(p)}
                          className="w-full text-left px-6 py-4 hover:bg-emerald-500/10 border-b border-white/5 flex justify-between items-center"
                        >
                          <span className="font-medium">{p.item_name}</span>
                          <span className="text-emerald-400 text-sm">
                            Stock: {p.stock}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {targetProduct && (
                    <div className="p-6 bg-emerald-950/60 border border-emerald-400/30 rounded-3xl">
                      <p className="font-bold text-lg">
                        {targetProduct.item_name}
                      </p>
                      <p className="text-emerald-400">
                        Stock:{' '}
                        <span className="font-mono">{targetProduct.stock}</span>
                      </p>
                      <button
                        onClick={() => setTargetProduct(null)}
                        className="text-xs text-red-400 mt-4 underline"
                      >
                        Change Target
                      </button>
                    </div>
                  )}
                </div>

                {/* SOURCE - MERGE AWAY */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-red-400 font-black uppercase text-xs tracking-widest">
                    <X size={16} /> MERGE THIS AWAY (Source)
                  </div>
                  {/* Mirror the target column but with red theme and source states */}
                  <div className="relative">
                    <Search
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                      size={18}
                    />
                    <input
                      type="text"
                      value={mergeSearchTermSource}
                      onChange={(e) => setMergeSearchTermSource(e.target.value)}
                      className="w-full bg-slate-950 border border-red-500/30 rounded-3xl pl-12 py-4 text-white outline-none focus:border-red-400"
                      placeholder="Search source product..."
                    />
                  </div>

                  {mergeSearchResultsSource.length > 0 && !sourceProduct && (
                    <div className="max-h-64 overflow-auto bg-slate-950 border border-white/10 rounded-3xl">
                      {mergeSearchResultsSource.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setSourceProduct(p)}
                          className="w-full text-left px-6 py-4 hover:bg-red-500/10 border-b border-white/5 flex justify-between items-center"
                        >
                          <span className="font-medium">{p.item_name}</span>
                          <span className="text-red-400 text-sm">
                            Stock: {p.stock}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {sourceProduct && (
                    <div className="p-6 bg-red-950/60 border border-red-400/30 rounded-3xl">
                      <p className="font-bold text-lg">
                        {sourceProduct.item_name}
                      </p>
                      <p className="text-red-400">
                        Stock:{' '}
                        <span className="font-mono">{sourceProduct.stock}</span>
                      </p>
                      <button
                        onClick={() => setSourceProduct(null)}
                        className="text-xs text-red-400 mt-4 underline"
                      >
                        Change Source
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Merge Confirmation */}
              {sourceProduct && targetProduct && (
                <div className="mt-10 p-8 border border-amber-400/30 bg-amber-500/5 rounded-3xl text-center">
                  <p className="text-amber-400 font-black text-lg mb-2">
                    FINAL STEP
                  </p>
                  <p className="text-slate-300">
                    Transfer{' '}
                    <span className="font-mono text-amber-400">
                      {sourceProduct.stock}
                    </span>{' '}
                    stock and reassign all history from
                    <span className="font-semibold text-red-400">
                      {' '}
                      {sourceProduct.item_name}
                    </span>{' '}
                    →{' '}
                    <span className="font-semibold text-emerald-400">
                      {targetProduct.item_name}
                    </span>
                  </p>
                  <button
                    onClick={handleMergeProducts}
                    disabled={isMerging}
                    className="mt-8 w-full py-6 bg-gradient-to-r from-red-600 to-purple-600 hover:from-red-500 hover:to-purple-500 text-white font-black text-xl rounded-3xl transition-all disabled:opacity-50"
                  >
                    {isMerging ? 'MERGING...' : 'CONFIRM PERMANENT MERGE'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {/* COLLECTION PAYMENT MODAL */}
        {showCollectionModal && selectedCollectionOrder && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-black text-white uppercase tracking-tight">
                  COLLECT PAYMENT
                </h2>
                <button
                  onClick={() => {
                    setShowCollectionModal(false);
                    setIsSubmittingPayment(false);
                  }}
                  className="text-slate-500 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="mb-6">
                <p className="text-sm font-bold">
                  {selectedCollectionOrder.order_number}
                </p>
                <p className="text-slate-400">
                  {selectedCollectionOrder.client_name}
                </p>
                <p className="text-emerald-400 font-bold mt-2">
                  Current Balance: ₱
                  {Number(
                    selectedCollectionOrder.remaining_balance || 0
                  ).toLocaleString()}
                </p>

                {/* PAY FULL BUTTON */}
                <button
                  onClick={() => {
                    const balance = Number(
                      selectedCollectionOrder.remaining_balance || 0
                    );
                    const rounded = parseFloat(balance.toFixed(2));
                    setPaymentAmount(rounded);
                  }}
                  className="mt-4 w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm uppercase tracking-widest rounded-xl shadow-lg transition-all active:scale-[0.98]"
                >
                  💰 PAY FULL BALANCE
                </button>
              </div>

              <div className="space-y-4">
                {/* PR# INPUT */}
                <div className="mb-6">
                  <label className="block text-xs font-black text-slate-400 mb-2">
                    PR# (Payment Receipt Number)
                  </label>
                  <input
                    type="text"
                    value={prNumberInput}
                    onChange={(e) => setPrNumberInput(e.target.value)}
                    className="w-full bg-slate-950 border border-white/10 rounded-2xl px-5 py-4 text-xl font-mono outline-none focus:border-purple-400"
                    placeholder="Enter PR#"
                    autoFocus
                  />
                </div>

                {/* Payment Method - 3 options */}
                <div>
                  <label className="text-xs font-black text-slate-500 block mb-2">
                    PAYMENT METHOD
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setPaymentMethodModal('CASH')}
                      className={`py-3 rounded-xl font-bold text-sm transition-all ${
                        paymentMethodModal === 'CASH'
                          ? 'bg-emerald-600 text-white shadow-inner'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      CASH
                    </button>
                    <button
                      onClick={() => setPaymentMethodModal('CHEQUE')}
                      className={`py-3 rounded-xl font-bold text-sm transition-all ${
                        paymentMethodModal === 'CHEQUE'
                          ? 'bg-emerald-600 text-white shadow-inner'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      CHEQUE
                    </button>
                    <button
                      onClick={() => setPaymentMethodModal('ONLINE')}
                      className={`py-3 rounded-xl font-bold text-sm transition-all ${
                        paymentMethodModal === 'ONLINE'
                          ? 'bg-emerald-600 text-white shadow-inner'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      ONLINE
                    </button>
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <label className="text-xs font-black text-slate-500 block mb-2">
                    PAYMENT AMOUNT
                  </label>
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(e) =>
                      setPaymentAmount(parseFloat(e.target.value) || 0)
                    }
                    step="0.01"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-xl font-mono outline-none"
                    placeholder="0.00"
                  />
                </div>

                {/* Cheque Date - only for CHEQUE */}
                {paymentMethodModal === 'CHEQUE' && (
                  <div>
                    <label className="text-xs font-black text-slate-500 block mb-2">
                      CHEQUE DATE
                    </label>
                    <input
                      type="date"
                      value={chequeDateModal}
                      onChange={(e) => setChequeDateModal(e.target.value)}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3"
                    />
                  </div>
                )}

                {/* REFERENCE / NOTES - now clearly labeled as Reference for ONLINE */}
                <div>
                  <label className="block text-xs font-black text-slate-400 mb-2">
                    {paymentMethodModal === 'ONLINE'
                      ? 'REFERENCE NUMBER / NOTES (required)'
                      : 'REFERENCE / NOTES'}
                  </label>
                  <textarea
                    value={collectionNotes}
                    onChange={(e) => setCollectionNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 h-24 resize-none"
                    placeholder={
                      paymentMethodModal === 'ONLINE'
                        ? 'Enter reference number, transaction ID, or notes...'
                        : 'Additional notes...'
                    }
                  />
                </div>

                <button
                  onClick={handleCollectPayment}
                  disabled={
                    (paymentAmount <= 0 &&
                      Number(selectedCollectionOrder?.remaining_balance || 0) >
                        0) ||
                    isSubmittingPayment
                  }
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-black text-sm uppercase tracking-widest rounded-xl"
                >
                  {isSubmittingPayment ? 'RECORDING...' : 'RECORD PAYMENT'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== UPDATE CLIENTS MODAL ==================== */}
        {showUpdateClientsModal && (
          <div className="fixed inset-0 z-[3200] flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-amber-500/20 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="flex justify-between items-center px-6 py-5 border-b border-white/10">
                <div>
                  <h2 className="text-xl font-black text-amber-400 uppercase tracking-tight">
                    Update Clients
                  </h2>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">
                    {selectedBranch?.branch_name} — {clientsList.length} client
                    {clientsList.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowUpdateClientsModal(false);
                    setEditingClient(null);
                    setClientForm({});
                  }}
                  className="text-slate-400 hover:text-white"
                >
                  <X size={22} />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-auto p-6">
                {clientsLoading ? (
                  <div className="text-center py-16 text-slate-500 text-sm">
                    Loading clients...
                  </div>
                ) : clientsList.length === 0 ? (
                  <div className="text-center py-16 text-slate-500 text-sm">
                    No clients found for this branch.
                  </div>
                ) : editingClient ? (
                  /* ── EDIT FORM ── */
                  <div className="space-y-6 max-w-2xl mx-auto">
                    <div className="flex items-center gap-3 mb-2">
                      <button
                        onClick={() => {
                          setEditingClient(null);
                          setClientForm({});
                        }}
                        className="text-slate-400 hover:text-white text-xs font-black uppercase tracking-widest"
                      >
                        ← Back
                      </button>
                      <span className="text-slate-600">|</span>
                      <span className="text-sm font-black text-white uppercase">
                        {editingClient.client_name}
                      </span>
                    </div>

                    {/* Read-only info strip */}
                    <div className="grid grid-cols-2 gap-3 p-4 bg-slate-950 rounded-2xl border border-white/5">
                      <div>
                        <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">
                          Pending Collection
                        </p>
                        <p className="text-sm font-mono text-amber-400 mt-0.5">
                          ₱
                          {Number(
                            editingClient.pending_collection || 0
                          ).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">
                          Total Orders
                        </p>
                        <p className="text-sm font-mono text-slate-300 mt-0.5">
                          {editingClient.total_orders || 0}
                        </p>
                      </div>
                    </div>

                    {/* Office Account Toggle */}
                    <div className="flex items-center justify-between p-4 bg-slate-950 rounded-2xl border border-white/10">
                      <div>
                        <p className="text-sm font-black text-white uppercase tracking-wide">
                          Office Account
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Orders from this client are tagged as OTHERS in
                          reports
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setClientForm({
                            ...clientForm,
                            is_office_account: !clientForm.is_office_account,
                          })
                        }
                        className={`relative w-14 h-7 rounded-full transition-all duration-200 ${
                          clientForm.is_office_account
                            ? 'bg-amber-500'
                            : 'bg-slate-700'
                        }`}
                      >
                        <span
                          className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-all duration-200 ${
                            clientForm.is_office_account ? 'left-8' : 'left-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Editable fields */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                          Client Name *
                        </label>
                        <input
                          type="text"
                          value={clientForm.client_name ?? ''}
                          onChange={(e) =>
                            setClientForm({
                              ...clientForm,
                              client_name: e.target.value,
                            })
                          }
                          className="w-full bg-slate-950 border border-white/10 focus:border-amber-500 rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                          Owner / Contact Person
                        </label>
                        <input
                          type="text"
                          value={clientForm.owner ?? ''}
                          onChange={(e) =>
                            setClientForm({
                              ...clientForm,
                              owner: e.target.value,
                            })
                          }
                          className="w-full bg-slate-950 border border-white/10 focus:border-amber-500 rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                          Birthday
                        </label>
                        <input
                          type="date"
                          value={clientForm.birthday ?? ''}
                          onChange={(e) =>
                            setClientForm({
                              ...clientForm,
                              birthday: e.target.value,
                            })
                          }
                          className="w-full bg-slate-950 border border-white/10 focus:border-amber-500 rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                          Phone
                        </label>
                        <input
                          type="text"
                          value={clientForm.phone ?? ''}
                          onChange={(e) =>
                            setClientForm({
                              ...clientForm,
                              phone: e.target.value,
                            })
                          }
                          className="w-full bg-slate-950 border border-white/10 focus:border-amber-500 rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                          placeholder="+63..."
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                          Email
                        </label>
                        <input
                          type="email"
                          value={clientForm.email ?? ''}
                          onChange={(e) =>
                            setClientForm({
                              ...clientForm,
                              email: e.target.value,
                            })
                          }
                          className="w-full bg-slate-950 border border-white/10 focus:border-amber-500 rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                          placeholder="email@example.com"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                          Allowed Terms
                        </label>
                        <input
                          type="text"
                          value={clientForm.allowed_terms ?? ''}
                          onChange={(e) =>
                            setClientForm({
                              ...clientForm,
                              allowed_terms: e.target.value,
                            })
                          }
                          className="w-full bg-slate-950 border border-white/10 focus:border-amber-500 rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                          placeholder="e.g. 30 days, COD"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                          Assigned Agent
                        </label>
                        <input
                          type="text"
                          value={clientForm.agent ?? ''}
                          onChange={(e) =>
                            setClientForm({
                              ...clientForm,
                              agent: e.target.value,
                            })
                          }
                          className="w-full bg-slate-950 border border-white/10 focus:border-amber-500 rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                          Average Order (₱)
                        </label>
                        <input
                          type="number"
                          value={clientForm.average_order ?? 0}
                          onChange={(e) =>
                            setClientForm({
                              ...clientForm,
                              average_order: e.target.value,
                            })
                          }
                          className="w-full bg-slate-950 border border-white/10 focus:border-amber-500 rounded-xl px-4 py-3 text-sm outline-none transition-colors font-mono"
                          min="0"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                          Monthly Order (₱)
                        </label>
                        <input
                          type="number"
                          value={clientForm.monthly_order ?? 0}
                          onChange={(e) =>
                            setClientForm({
                              ...clientForm,
                              monthly_order: e.target.value,
                            })
                          }
                          className="w-full bg-slate-950 border border-white/10 focus:border-amber-500 rounded-xl px-4 py-3 text-sm outline-none transition-colors font-mono"
                          min="0"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                          Address
                        </label>
                        <input
                          type="text"
                          value={clientForm.address ?? ''}
                          onChange={(e) =>
                            setClientForm({
                              ...clientForm,
                              address: e.target.value,
                            })
                          }
                          className="w-full bg-slate-950 border border-white/10 focus:border-amber-500 rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                          Notes
                        </label>
                        <textarea
                          value={clientForm.notes ?? ''}
                          onChange={(e) =>
                            setClientForm({
                              ...clientForm,
                              notes: e.target.value,
                            })
                          }
                          rows={3}
                          className="w-full bg-slate-950 border border-white/10 focus:border-amber-500 rounded-xl px-4 py-3 text-sm outline-none transition-colors resize-none"
                        />
                      </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={() => {
                          setEditingClient(null);
                          setClientForm({});
                        }}
                        className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-2xl text-sm"
                      >
                        CANCEL
                      </button>
                      <button
                        onClick={handleSaveClient}
                        disabled={
                          isSavingClient || !clientForm.client_name?.trim()
                        }
                        className="flex-1 py-4 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 text-black font-black rounded-2xl text-sm uppercase tracking-widest transition-all"
                      >
                        {isSavingClient ? 'SAVING...' : 'SAVE CHANGES'}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── CLIENT LIST ── */
                  <div className="space-y-2">
                    {clientsList.map((client: any) => (
                      <button
                        key={client.id}
                        onClick={() => {
                          setEditingClient(client);
                          setClientForm({
                            client_name: client.client_name || '',
                            owner: client.owner || '',
                            birthday: client.birthday || '',
                            allowed_terms: client.allowed_terms || '',
                            average_order: client.average_order || 0,
                            monthly_order: client.monthly_order || 0,
                            agent: client.agent || '',
                            phone: client.phone || '',
                            address: client.address || '',
                            email: client.email || '',
                            notes: client.notes || '',
                            is_office_account:
                              client.is_office_account || false,
                          });
                        }}
                        className="w-full flex items-center justify-between p-4 bg-slate-950 border border-white/5 hover:border-amber-500/40 rounded-2xl transition-all text-left group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 font-black text-sm">
                            {(client.client_name || '?')[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-black text-white">
                              {client.client_name}
                            </p>
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              {[client.owner, client.phone]
                                .filter(Boolean)
                                .join(' · ') || 'No contact info'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {client.is_office_account && (
                            <span className="text-[9px] font-black px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded-full uppercase">
                              Office
                            </span>
                          )}
                          {client.pending_collection > 0 && (
                            <span className="text-[9px] font-mono text-red-400">
                              ₱
                              {Number(
                                client.pending_collection
                              ).toLocaleString()}
                            </span>
                          )}
                          <ArrowRight
                            size={14}
                            className="text-slate-700 group-hover:text-amber-400 transition-colors"
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==================== DAY PAYMENTS REVERSE MODAL ==================== */}
        {showDayReverseModal && (
          <div className="fixed inset-0 z-[3200] flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-red-500/30 rounded-3xl w-full max-w-2xl p-6 max-h-[85vh] flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-black text-red-400 uppercase tracking-tight">
                  REVERSE PAYMENT - Today's Payments
                </h2>
                <button
                  onClick={() => {
                    setShowDayReverseModal(false);
                    setDayPaymentsList([]);
                    setSelectedDayPayment(null);
                  }}
                  className="text-slate-400 hover:text-white"
                >
                  <X size={22} />
                </button>
              </div>

              <p className="text-sm text-slate-400 mb-4">
                Select any payment made today to reverse (works for orders +
                legacy payments).
              </p>

              <div className="flex-1 overflow-auto space-y-2 pr-2 mb-4">
                {dayPaymentsList.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    No payments found today.
                  </div>
                ) : (
                  dayPaymentsList.map((payment) => (
                    <div
                      key={payment.id}
                      onClick={() => setSelectedDayPayment(payment)}
                      className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                        selectedDayPayment?.id === payment.id
                          ? 'bg-red-500/10 border-red-500'
                          : 'bg-slate-950 border-white/10 hover:border-white/30'
                      }`}
                    >
                      <div className="flex justify-between">
                        <div>
                          <div className="font-bold text-lg">
                            ₱{Number(payment.amount).toLocaleString()}
                          </div>
                          <div className="text-sm text-slate-300">
                            {payment.customer_name ||
                              payment.orders?.client_name ||
                              'LEGACY PAYMENT'}
                          </div>
                          {payment.orders?.order_number && (
                            <div className="text-xs font-mono text-amber-400 mt-0.5">
                              {payment.orders.order_number}
                            </div>
                          )}
                        </div>
                        <div className="text-right text-xs">
                          <div className="font-mono text-slate-400">
                            {new Date(payment.created_at).toLocaleTimeString(
                              [],
                              { hour: '2-digit', minute: '2-digit' }
                            )}
                          </div>
                          <div className="mt-1">{payment.payment_method}</div>
                          {payment.pr_number && (
                            <div className="text-amber-400 font-mono mt-1">
                              PR#: {payment.pr_number}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex gap-3 pt-4 border-t border-white/10">
                <button
                  onClick={() => {
                    setShowDayReverseModal(false);
                    setDayPaymentsList([]);
                    setSelectedDayPayment(null);
                  }}
                  className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-2xl"
                >
                  CANCEL
                </button>
                <button
                  onClick={handleReverseDayPayment}
                  disabled={!selectedDayPayment}
                  className="flex-1 py-4 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 text-white font-black rounded-2xl"
                >
                  CONFIRM REVERSE
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
