'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Package,
  DollarSign,
  ShoppingCart,
  CreditCard,
  AlertCircle,
  RefreshCw,
  Trash2,
} from 'lucide-react';

export default function WeeklyReport() {
  const router = useRouter();
  const [selectedBranch, setSelectedBranch] = useState<any>(null);
  const [weeks, setWeeks] = useState<any[]>([]);
  const [overallSummary, setOverallSummary] = useState({
    totalSales: 0,
    genericSales: 0,
    brandedSales: 0,
    discountSales: 0,
    totalPurchase: 0,
    genericPurchase: 0,
    brandedPurchase: 0,
    totalAdjustmentsValue: 0,
    expectedCash: 0,
    actualRemitted: 0,
    cashVariance: 0,
    expenses: 0,
  });

  const [loading, setLoading] = useState(true);
  const [rawData, setRawData] = useState<any>(null);
  const [isOwner, setIsOwner] = useState(false);

  // Original modals state
  const [showBreakdown, setShowBreakdown] = useState<
    'sales' | 'purchase' | null
  >(null);
  const [showRemittance, setShowRemittance] = useState(false);
  const [modalView, setModalView] = useState<'daily' | 'full'>('daily');
  const [modalPeriod, setModalPeriod] = useState<{
    start: string;
    end: string;
  } | null>(null);

  const [currentResponsibleStaff, setCurrentResponsibleStaff] = useState<any[]>(
    []
  );
  // Per-week modal
  const [selectedWeek, setSelectedWeek] = useState<any>(null);
  const [weekItems, setWeekItems] = useState<any[]>([]);
  const [weekSummary, setWeekSummary] = useState<any>(null);
  const [showWeekDetail, setShowWeekDetail] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);

  // Adjustments modal
  const [showAdjustmentsModal, setShowAdjustmentsModal] = useState(false);

  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [adjustmentsList, setAdjustmentsList] = useState<any[]>([]);
  const [adjustmentsModalTitle, setAdjustmentsModalTitle] = useState('');
  // Iteration modal
  const [selectedIteration, setSelectedIteration] = useState<any>(null);
  const [showIterationModal, setShowIterationModal] = useState(false);
  // NEW: Iteration system
  const [iterations, setIterations] = useState<any[]>([]);
  const [nextIterationNumber, setNextIterationNumber] = useState(0);
  useEffect(() => {
    const saved = localStorage.getItem('active_branch');
    if (saved) setSelectedBranch(JSON.parse(saved));
  }, []);

  const fetchWeeklyReport = async () => {
    setLoading(true);

    const [{ data: orderFirst }, { data: poFirst }, { data: adjFirst }] =
      await Promise.all([
        supabase
          .from('orders')
          .select('created_date_pht')
          .eq('branch_id', selectedBranch.id)
          .order('created_date_pht', { ascending: true })
          .limit(1),
        supabase
          .from('purchase_orders')
          .select('created_date_pht')
          .eq('branch_id', selectedBranch.id)
          .order('created_date_pht', { ascending: true })
          .limit(1),
        supabase
          .from('inventory_adjustments')
          .select('created_date_pht')
          .eq('branch_id', selectedBranch.id)
          .order('created_date_pht', { ascending: true })
          .limit(1),
      ]);

    let firstDateStr = '2020-01-01';
    [
      orderFirst?.[0]?.created_date_pht,
      poFirst?.[0]?.created_date_pht,
      adjFirst?.[0]?.created_date_pht,
    ]
      .filter(Boolean)
      .forEach((date) => {
        if (date && date < firstDateStr) firstDateStr = date;
      });

    const todayStr = new Date().toISOString().split('T')[0];
    const weekEndNext = new Date(todayStr);
    weekEndNext.setDate(weekEndNext.getDate() + 1);
    const endStr = weekEndNext.toISOString().split('T')[0];

    const fetchAll = async (table: string, select: string) => {
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      while (true) {
        const query = supabase.from(table).select(select);
        if (table === 'inventory_adjustments') {
          query
            .eq('branch_id', selectedBranch.id)
            .gte('created_date_pht', firstDateStr)
            .lt('created_date_pht', endStr);
        } else if (table !== 'inventory') {
          query
            .gte('created_date_pht', firstDateStr)
            .lt('created_date_pht', endStr);
        }
        const { data, error } = await query.range(from, from + batchSize - 1);
        if (error || !data?.length) break;
        allData = allData.concat(data);
        from += batchSize;
      }
      return allData;
    };

    const [
      inventoryData,
      purchaseDataRaw,
      salesDataRaw,
      adjustmentDataRaw,
      ordersRes,
      purchaseRes,
      remittanceRes,
    ] = await Promise.all([
      fetchAll('inventory', 'id, item_name, stock_quantity, branch_id'),
      fetchAll(
        'purchase_order_items',
        'quantity, inventory_id, created_date_pht'
      ),
      fetchAll(
        'order_items',
        'quantity, subtotal, product_id, created_date_pht'
      ),
      fetchAll(
        'inventory_adjustments',
        '*, inventory:inventory_id(id, item_name)'
      ),
      supabase
        .from('orders')
        .select(
          'created_date_pht, order_number, generic_amt, branded_amt, discount_total, created_by, is_checked'
        )
        .eq('branch_id', selectedBranch.id)
        .gte('created_date_pht', firstDateStr)
        .lt('created_date_pht', endStr),
      supabase
        .from('purchase_orders')
        .select(
          'created_date_pht, po_number, invoice_id, generic_amt, branded_amt, created_by, is_checked, profiles:created_by(full_name)'
        )
        .eq('branch_id', selectedBranch.id)
        .gte('created_date_pht', firstDateStr)
        .lt('created_date_pht', endStr),
      supabase
        .from('daily_reports')
        .select(
          'report_date, generic_sales, branded_sales, discount_total, total_sales, actual_cash, expenses, notes, reported_by, is_checked'
        )
        .eq('branch_id', selectedBranch.id)
        .gte('report_date', firstDateStr)
        .lt('report_date', endStr),
    ]);

    const branchInventory = inventoryData.filter(
      (i: any) => i.branch_id === selectedBranch.id
    );
    const branchProductIds = new Set(branchInventory.map((i: any) => i.id));

    const purchaseData = purchaseDataRaw.filter((p: any) =>
      branchProductIds.has(p.inventory_id)
    );
    const salesData = salesDataRaw.filter((s: any) =>
      branchProductIds.has(s.product_id)
    );
    const adjustments = adjustmentDataRaw;

    // Overall summary — using daily_reports as the source of truth
    const genericSales =
      ordersRes.data?.reduce(
        (sum: number, o: any) => sum + (o.generic_amt || 0),
        0
      ) || 0;
    const brandedSales =
      ordersRes.data?.reduce(
        (sum: number, o: any) => sum + (o.branded_amt || 0),
        0
      ) || 0;
    const discountSales =
      ordersRes.data?.reduce(
        (sum: number, o: any) => sum + (o.discount_total || 0),
        0
      ) || 0;

    const reportedTotalSales =
      remittanceRes.data?.reduce(
        (sum: number, r: any) => sum + (r.total_sales || 0),
        0
      ) || 0;

    const genericPurchase =
      purchaseRes.data?.reduce(
        (sum: number, po: any) => sum + (po.generic_amt || 0),
        0
      ) || 0;
    const brandedPurchase =
      purchaseRes.data?.reduce(
        (sum: number, po: any) => sum + (po.branded_amt || 0),
        0
      ) || 0;
    const totalPurchase = genericPurchase + brandedPurchase;

    const actualRemitted =
      remittanceRes.data?.reduce(
        (sum: number, r: any) => sum + (r.actual_cash || 0),
        0
      ) || 0;
    const expenses =
      remittanceRes.data?.reduce(
        (sum: number, r: any) => sum + (r.expenses || 0),
        0
      ) || 0;

    const cashVariance = actualRemitted - reportedTotalSales + expenses;

    const totalAdjustmentsValue = adjustments.reduce((sum: number, a: any) => {
      const qty = a.quantity || 0;
      const price = a.unit_price || 0;
      return sum + qty * price;
    }, 0);

    setOverallSummary({
      totalSales: reportedTotalSales,
      genericSales,
      brandedSales,
      discountSales,
      totalPurchase,
      genericPurchase,
      brandedPurchase,
      totalAdjustmentsValue,
      expectedCash: reportedTotalSales - expenses, // ← CHANGED
      actualRemitted,
      cashVariance,
      expenses,
    });

    // Generate weeks (item-by-item reconciliation)
    const generatedWeeks: any[] = [];
    let current = new Date(todayStr);
    current.setDate(current.getDate() - current.getDay());

    while (current.toISOString().split('T')[0] >= firstDateStr) {
      const weekStart = current.toISOString().split('T')[0];
      const weekEndDate = new Date(current);
      weekEndDate.setDate(weekEndDate.getDate() + 6);
      const weekEnd =
        weekEndDate > new Date(todayStr)
          ? todayStr
          : weekEndDate.toISOString().split('T')[0];

      const weekEndNext = new Date(weekEnd);
      weekEndNext.setDate(weekEndNext.getDate() + 1);
      const weekEndNextStr = weekEndNext.toISOString().split('T')[0];

      const purchaseWeek = purchaseData.filter(
        (p: any) =>
          p.created_date_pht >= weekStart && p.created_date_pht < weekEndNextStr
      );
      const salesWeek = salesData.filter(
        (s: any) =>
          s.created_date_pht >= weekStart && s.created_date_pht < weekEndNextStr
      );
      const adjustmentsWeek = adjustments.filter((a: any) => {
        const dateStr = a.created_date_pht || '';
        return dateStr >= weekStart && dateStr <= weekEnd;
      });

      const ordersWeek =
        ordersRes.data?.filter(
          (o: any) =>
            o.created_date_pht >= weekStart &&
            o.created_date_pht < weekEndNextStr
        ) || [];
      const purchaseOrdersWeek =
        purchaseRes.data?.filter(
          (po: any) =>
            po.created_date_pht >= weekStart &&
            po.created_date_pht < weekEndNextStr
        ) || [];
      const remittanceWeek =
        remittanceRes.data?.filter(
          (r: any) => r.report_date >= weekStart && r.report_date <= weekEnd
        ) || [];

      const genericSalesW = ordersWeek.reduce(
        (sum: number, o: any) => sum + (o.generic_amt || 0),
        0
      );
      const brandedSalesW = ordersWeek.reduce(
        (sum: number, o: any) => sum + (o.branded_amt || 0),
        0
      );
      const discountSalesW = ordersWeek.reduce(
        (sum: number, o: any) => sum + (o.discount_total || 0),
        0
      );
      const totalSalesW = genericSalesW + brandedSalesW - discountSalesW;

      const genericPurchaseW = purchaseOrdersWeek.reduce(
        (sum: number, po: any) => sum + (po.generic_amt || 0),
        0
      );
      const brandedPurchaseW = purchaseOrdersWeek.reduce(
        (sum: number, po: any) => sum + (po.branded_amt || 0),
        0
      );
      const totalPurchaseW = genericPurchaseW + brandedPurchaseW;

      const totalAdjustmentsW = adjustmentsWeek.reduce(
        (sum: number, a: any) => {
          const qty = a.quantity || 0;
          const price = a.unit_price || 0;
          return sum + qty * price;
        },
        0
      );

      let stockVarW = 0;
      const processed = branchInventory.map((item: any) => {
        const pQty = purchaseWeek
          .filter((p: any) => p.inventory_id === item.id)
          .reduce((sum: number, p: any) => sum + (p.quantity || 0), 0);
        const sQty = salesWeek
          .filter((s: any) => s.product_id === item.id)
          .reduce((sum: number, s: any) => sum + (s.quantity || 0), 0);
        const aQty = adjustmentsWeek
          .filter((a: any) => a.inventory_id === item.id)
          .reduce((sum: number, a: any) => sum + (a.quantity || 0), 0);
        const actual = item.stock_quantity || 0;
        const beginning = actual - pQty - aQty + sQty;
        return actual - (beginning + pQty + aQty - sQty);
      });
      stockVarW = processed.reduce((sum: number, v: number) => sum + v, 0);

      generatedWeeks.unshift({
        start: weekStart,
        end: weekEnd,
        label: `${new Date(weekStart).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })} – ${new Date(weekEnd).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })}`,
        totalSales: totalSalesW,
        totalPurchase: totalPurchaseW,
        totalAdjustmentsValue: totalAdjustmentsW,
        stockVariance: stockVarW,
      });

      current.setDate(current.getDate() - 7);
    }

    setWeeks(generatedWeeks);

    setRawData({
      branchInventory,
      purchaseData,
      salesData,
      adjustments,
      ordersFull: ordersRes.data || [],
      purchaseOrdersFull: purchaseRes.data || [],
      remittanceFullData: remittanceRes.data || [],
      firstDateStr,
      todayStr,
    });

    setLoading(false);
  };

  const saveCurrentIteration = async () => {
    if (!selectedBranch?.id || !rawData) return;

    const saved = getSavedTotals(iterations);

    // Calculate CURRENT open period values
    const currentSales = overallSummary.totalSales - saved.totalSales;
    const currentGenericSales =
      overallSummary.genericSales - saved.genericSales;
    const currentBrandedSales =
      overallSummary.brandedSales - saved.brandedSales;
    const currentDiscountSales =
      overallSummary.discountSales - saved.discountSales;

    const currentPurchase = overallSummary.totalPurchase - saved.totalPurchase;
    const currentGenericPurchase =
      overallSummary.genericPurchase - saved.genericPurchase;
    const currentBrandedPurchase =
      overallSummary.brandedPurchase - saved.brandedPurchase;

    const currentAdjustments =
      overallSummary.totalAdjustmentsValue - saved.totalAdjustmentsValue;
    const currentExpenses = overallSummary.expenses - saved.expenses;
    const currentActualRemitted =
      overallSummary.actualRemitted - saved.actualRemitted;
    const currentCashVariance =
      overallSummary.cashVariance - saved.cashVariance;

    const currentChargeToStaff = -(currentCashVariance + currentAdjustments);

    // === Date logic (already fixed) ===
    let currentStartDate = rawData.firstDateStr;
    if (iterations.length > 0) {
      const lastIteration = iterations[0];
      const lastEnd = new Date(lastIteration.end_date);
      lastEnd.setDate(lastEnd.getDate() + 1);
      currentStartDate = lastEnd.toISOString().split('T')[0];
    }
    const todayStr = new Date().toISOString().split('T')[0];

    if (new Date(currentStartDate) > new Date(todayStr)) {
      currentStartDate = todayStr;
    }

    const startFormatted = new Date(currentStartDate).toLocaleDateString(
      'en-US',
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }
    );
    const endFormatted = new Date(todayStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    // === NEW: Fetch responsible staff for THIS iteration ===
    const responsibleStaff = await fetchResponsibleStaff(
      currentStartDate,
      todayStr
    );

    const iterationData = {
      branch_id: selectedBranch.id,
      iteration_number: nextIterationNumber,
      start_date: currentStartDate,
      end_date: todayStr,
      label: `Iteration ${nextIterationNumber} — ${startFormatted} – ${endFormatted}`,

      // Current open period values
      total_sales: currentSales,
      generic_sales: currentGenericSales,
      branded_sales: currentBrandedSales,
      discount_sales: currentDiscountSales,

      total_purchase: currentPurchase,
      generic_purchase: currentGenericPurchase,
      branded_purchase: currentBrandedPurchase,

      total_adjustments_value: currentAdjustments,
      expenses: currentExpenses,
      actual_remitted: currentActualRemitted,
      cash_variance: currentCashVariance,

      stock_variance: 0,
      charge_to_staff: currentChargeToStaff,

      // ← NEW: Save staff names permanently
      responsible_staff: responsibleStaff,
    };

    const { error } = await supabase
      .from('weekly_iterations')
      .insert(iterationData);

    if (error) {
      console.error(error);
      alert('❌ Failed to save iteration');
      return;
    }

    // Refresh list
    const { data } = await supabase
      .from('weekly_iterations')
      .select('*')
      .eq('branch_id', selectedBranch.id)
      .order('iteration_number', { ascending: false });

    setIterations(data || []);
    setNextIterationNumber(calculateNextIterationNumber(data || []));

    alert(`✅ Iteration ${nextIterationNumber} saved successfully!`);
  };

  const deleteIteration = async (iterationId: string) => {
    if (!selectedBranch?.id || !iterationId) return;

    if (
      !confirm(
        '🗑️ Delete this iteration permanently?\n\nThis cannot be undone.'
      )
    ) {
      return;
    }

    // Optimistic UI update
    setIterations((prev) => prev.filter((item) => item.id !== iterationId));

    const { error } = await supabase
      .from('weekly_iterations')
      .delete()
      .eq('id', iterationId)
      .eq('branch_id', selectedBranch.id);

    if (error) {
      console.error('Delete error:', error);
      alert('❌ Failed to delete iteration');
      return;
    }

    // Refresh list + recalculate next number
    const { data } = await supabase
      .from('weekly_iterations')
      .select('*')
      .eq('branch_id', selectedBranch.id)
      .order('iteration_number', { ascending: false });

    setIterations(data || []);
    setNextIterationNumber(calculateNextIterationNumber(data || [])); // ← THIS IS THE KEY FIX

    alert('✅ Iteration deleted successfully');
  };
  const viewIteration = (iteration: any) => {
    setSelectedIteration(iteration);
    setShowIterationModal(true);
  };

  const closeIterationModal = () => {
    setShowIterationModal(false);
    setSelectedIteration(null);
  };
  useEffect(() => {
    if (selectedBranch?.id) fetchWeeklyReport();
  }, [selectedBranch]);

  // ← ADD THIS NEW useEffect
  useEffect(() => {
    const loadIterations = async () => {
      if (!selectedBranch?.id) return;
      const { data, error } = await supabase
        .from('weekly_iterations')
        .select('*')
        .eq('branch_id', selectedBranch.id)
        .order('iteration_number', { ascending: false });

      if (error) {
        console.error('Failed to load iterations:', error);
        return;
      }
      setIterations(data || []);
      setNextIterationNumber(calculateNextIterationNumber(data || [])); // ← UPDATED
    };

    loadIterations();
  }, [selectedBranch]);

  // Load responsible staff for current open period
  useEffect(() => {
    const loadResponsibleStaff = async () => {
      if (!rawData?.firstDateStr || !selectedBranch?.id) return;

      const saved = getSavedTotals(iterations);

      // Calculate current open period date range
      let startDate = rawData.firstDateStr;
      if (iterations.length > 0) {
        const lastEnd = new Date(iterations[0].end_date);
        lastEnd.setDate(lastEnd.getDate() + 1);
        startDate = lastEnd.toISOString().split('T')[0];
      }
      const endDate = new Date().toISOString().split('T')[0];

      const staff = await fetchResponsibleStaff(startDate, endDate);
      setCurrentResponsibleStaff(staff);
    };

    loadResponsibleStaff();
  }, [rawData, iterations, selectedBranch]); // ← safe now

  useEffect(() => {
    const checkOwnerStatus = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('owner')
        .eq('id', user.id)
        .single();

      setIsOwner(!!profile?.owner); // true only if owner = true
    };

    checkOwnerStatus();
  }, []);

  const loadWeekDetails = async (week: any) => {
    setSelectedWeek(week);
    setModalLoading(true);
    setShowWeekDetail(true);

    const raw = rawData;
    if (!raw) return;

    const weekEndNext = new Date(week.end);
    weekEndNext.setDate(weekEndNext.getDate() + 1);
    const endStr = weekEndNext.toISOString().split('T')[0];

    const purchaseWeek = raw.purchaseData.filter(
      (p: any) =>
        p.created_date_pht >= week.start && p.created_date_pht < endStr
    );
    const salesWeek = raw.salesData.filter(
      (s: any) =>
        s.created_date_pht >= week.start && s.created_date_pht < endStr
    );
    const adjustmentsWeek = raw.adjustments.filter((a: any) => {
      const dateStr = a.created_date_pht
        ? new Date(a.created_date_pht).toISOString().split('T')[0]
        : '';
      return dateStr >= week.start && dateStr <= week.end;
    });

    const ordersWeek = raw.ordersFull.filter(
      (o: any) =>
        o.created_date_pht >= week.start && o.created_date_pht < endStr
    );
    const purchaseOrdersWeek = raw.purchaseOrdersFull.filter(
      (po: any) =>
        po.created_date_pht >= week.start && po.created_date_pht < endStr
    );
    const remittanceWeek = raw.remittanceFullData.filter(
      (r: any) => r.report_date >= week.start && r.report_date <= week.end
    );

    const genericSalesW = ordersWeek.reduce(
      (sum: number, o: any) => sum + (o.generic_amt || 0),
      0
    );
    const brandedSalesW = ordersWeek.reduce(
      (sum: number, o: any) => sum + (o.branded_amt || 0),
      0
    );
    const discountSalesW = ordersWeek.reduce(
      (sum: number, o: any) => sum + (o.discount_total || 0),
      0
    );
    const totalSalesW = genericSalesW + brandedSalesW - discountSalesW;

    const genericPurchaseW = purchaseOrdersWeek.reduce(
      (sum: number, po: any) => sum + (po.generic_amt || 0),
      0
    );
    const brandedPurchaseW = purchaseOrdersWeek.reduce(
      (sum: number, po: any) => sum + (po.branded_amt || 0),
      0
    );
    const totalPurchaseW = genericPurchaseW + brandedPurchaseW;

    const actualRemittedW = remittanceWeek.reduce(
      (sum: number, r: any) => sum + (r.actual_cash || 0),
      0
    );
    const expensesW = remittanceWeek.reduce(
      (sum: number, r: any) => sum + (r.expenses || 0),
      0
    );
    const totalAdjustmentsW = adjustmentsWeek.reduce((sum: number, a: any) => {
      const qty = a.quantity || 0;
      const price = a.unit_price || 0;
      return sum + qty * price;
    }, 0);

    setWeekSummary({
      totalSales: totalSalesW,
      genericSales: genericSalesW,
      brandedSales: brandedSalesW,
      discountSales: discountSalesW,
      totalPurchase: totalPurchaseW,
      genericPurchase: genericPurchaseW,
      brandedPurchase: brandedPurchaseW,
      totalAdjustmentsValue: totalAdjustmentsW,
      expectedCash: totalSalesW,
      actualRemitted: actualRemittedW,
      cashVariance: actualRemittedW - totalSalesW,
      expenses: expensesW,
    });

    let processedItems = raw.branchInventory.map((item: any) => {
      const purchasesQty = purchaseWeek
        .filter((p: any) => p.inventory_id === item.id)
        .reduce((sum: number, p: any) => sum + (p.quantity || 0), 0);
      const salesQty = salesWeek
        .filter((s: any) => s.product_id === item.id)
        .reduce((sum: number, s: any) => sum + (s.quantity || 0), 0);
      const adjustmentQty = adjustmentsWeek
        .filter((a: any) => a.inventory_id === item.id)
        .reduce((sum: number, a: any) => sum + (a.quantity || 0), 0);

      const actualEndingStock = item.stock_quantity || 0;
      const beginningStock =
        actualEndingStock - purchasesQty - adjustmentQty + salesQty;

      return {
        id: item.id,
        item_name: item.item_name,
        beginning_stock: Math.max(0, beginningStock),
        purchases_qty: purchasesQty,
        adjustments_qty: adjustmentQty,
        sales_qty: salesQty,
        net_movement: purchasesQty + adjustmentQty - salesQty,
        expected_ending_stock:
          beginningStock + purchasesQty + adjustmentQty - salesQty,
        actual_ending_stock: actualEndingStock,
        stock_variance:
          actualEndingStock -
          (beginningStock + purchasesQty + adjustmentQty - salesQty),
      };
    });

    processedItems.sort((a, b) => a.item_name.localeCompare(b.item_name));
    setWeekItems(processedItems);
    setModalLoading(false);
  };

  const openAdjustmentsModal = (
    period: { start: string; end: string } | null,
    title: string
  ) => {
    const raw = rawData;
    if (!raw) return;
    let filtered = raw.adjustments || [];
    if (period) {
      filtered = filtered.filter((a: any) => {
        const dateStr = a.created_date_pht
          ? new Date(a.created_date_pht).toISOString().split('T')[0]
          : '';
        return dateStr >= period.start && dateStr <= period.end;
      });
    }
    setAdjustmentsList(filtered);
    setAdjustmentsModalTitle(title);
    setShowAdjustmentsModal(true);
  };

  const formatCurrency = (amount: number) =>
    `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

  const getSavedTotals = (iters: any[]) => {
    if (!iters || iters.length === 0)
      return {
        totalSales: 0,
        genericSales: 0,
        brandedSales: 0,
        discountSales: 0,
        totalPurchase: 0,
        genericPurchase: 0,
        brandedPurchase: 0,
        totalAdjustmentsValue: 0,
        expenses: 0,
        actualRemitted: 0,
        cashVariance: 0,
      };

    return {
      totalSales: iters.reduce((sum, i) => sum + (i.total_sales || 0), 0),
      genericSales: iters.reduce((sum, i) => sum + (i.generic_sales || 0), 0),
      brandedSales: iters.reduce((sum, i) => sum + (i.branded_sales || 0), 0),
      discountSales: iters.reduce((sum, i) => sum + (i.discount_sales || 0), 0),
      totalPurchase: iters.reduce((sum, i) => sum + (i.total_purchase || 0), 0),
      genericPurchase: iters.reduce(
        (sum, i) => sum + (i.generic_purchase || 0),
        0
      ),
      brandedPurchase: iters.reduce(
        (sum, i) => sum + (i.branded_purchase || 0),
        0
      ),
      totalAdjustmentsValue: iters.reduce(
        (sum, i) => sum + (i.total_adjustments_value || 0),
        0
      ),
      expenses: iters.reduce((sum, i) => sum + (i.expenses || 0), 0),
      actualRemitted: iters.reduce(
        (sum, i) => sum + (i.actual_remitted || 0),
        0
      ),
      cashVariance: iters.reduce((sum, i) => sum + (i.cash_variance || 0), 0),
    };
  };
  const fetchResponsibleStaff = async (startDate: string, endDate: string) => {
    if (!selectedBranch?.id) return [];

    console.log(
      '🔍 [fetchResponsibleStaff] START → Period:',
      startDate,
      '→',
      endDate
    );

    // Get order creators (emails)
    const { data: orderCreators } = await supabase
      .from('orders')
      .select('created_by')
      .eq('branch_id', selectedBranch.id)
      .gte('created_date_pht', startDate)
      .lt('created_date_pht', endDate + 'T23:59:59');

    if (!orderCreators || orderCreators.length === 0) {
      console.log('⚠️ No orders in current period');
      return [];
    }

    const uniqueEmails = [
      ...new Set(orderCreators.map((o: any) => o.created_by)),
    ];
    console.log('👥 Unique emails:', uniqueEmails);

    // Query profiles by EMAIL ONLY (no branch_id filter)
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, auditor, email')
      .in('email', uniqueEmails);

    if (error) console.error('❌ Profiles query error:', error);

    console.log('👤 Profiles found:', profiles?.length || 0);

    if (!profiles || profiles.length === 0) {
      console.log('❌ No profiles found for these emails');
      return [];
    }

    // Prioritize staff, then non-auditor branch_admin
    let staffList = profiles
      .filter((p: any) => p.role?.toLowerCase() === 'staff')
      .map((p: any) => ({
        id: p.id,
        name: p.full_name || p.email || 'Unknown Staff',
      }));

    if (staffList.length === 0) {
      staffList = profiles
        .filter(
          (p: any) =>
            (p.role?.toLowerCase() === 'branch_admin' ||
              p.role?.toLowerCase() === 'admin') &&
            p.auditor !== true
        )
        .map((p: any) => ({
          id: p.id,
          name: p.full_name || p.email || 'Branch Admin',
        }));
    }

    console.log('🎯 FINAL staff to display:', staffList);
    return staffList;
  };

  const calculateNextIterationNumber = (iters: any[]) => {
    if (!iters || iters.length === 0) return 0; // ← Now starts at 0
    const maxNum = Math.max(...iters.map((i: any) => i.iteration_number || 0));
    return maxNum + 1;
  };
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <RefreshCw className="animate-spin text-emerald-400 mr-3" size={24} />
        LOADING WEEKLY REPORT...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      {/* HEADER */}
      <div className="sticky top-0 bg-slate-900 border-b border-white/10 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => router.push('/staff')}
            className="flex items-center gap-2 text-slate-400 hover:text-white"
          >
            <ArrowLeft size={20} />
            <span className="font-black uppercase text-sm">Back to Hub</span>
          </button>
          <div className="text-center">
            <h1 className="text-2xl font-black italic tracking-tighter uppercase">
              WEEKLY RECONCILIATION
            </h1>
            <p className="text-emerald-400 text-sm font-mono">
              {selectedBranch?.branch_name} • First Transaction to Today
            </p>
          </div>
          <button
            onClick={fetchWeeklyReport}
            className="flex items-center gap-2 text-xs font-black uppercase text-slate-400 hover:text-white"
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* OVERALL SUMMARY CARDS */}
      {/* OVERALL SUMMARY CARDS */}
      {/* OVERALL SUMMARY CARDS - VISIBLE ONLY TO OWNERS */}
      {isOwner && (
        <div className="max-w-7xl mx-auto px-6 pt-8">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {/* Total Sales card */}
            <div
              onClick={() => {
                setModalPeriod(null);
                setShowBreakdown('sales');
                setModalView('daily');
              }}
              className="bg-slate-900 rounded-3xl p-6 border border-white/10 cursor-pointer hover:border-emerald-400 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                    Total Sales
                  </p>
                  <p className="text-3xl font-black mt-2">
                    {formatCurrency(overallSummary.totalSales)}
                  </p>
                  <div className="mt-4 space-y-1 text-sm font-medium">
                    <div className="flex justify-between">
                      <span className="text-emerald-400">Generic</span>
                      <span>{formatCurrency(overallSummary.genericSales)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-amber-400">Branded</span>
                      <span>{formatCurrency(overallSummary.brandedSales)}</span>
                    </div>
                    <div className="flex justify-between text-red-400">
                      <span>Discount</span>
                      <span>
                        -{formatCurrency(overallSummary.discountSales)}
                      </span>
                    </div>
                  </div>
                </div>
                <ShoppingCart size={28} className="text-emerald-400" />
              </div>
            </div>

            {/* Total Purchase card */}
            <div
              onClick={() => {
                setModalPeriod(null);
                setShowBreakdown('purchase');
                setModalView('daily');
              }}
              className="bg-slate-900 rounded-3xl p-6 border border-white/10 cursor-pointer hover:border-blue-400 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                    Total Purchase
                  </p>
                  <p className="text-3xl font-black mt-2">
                    {formatCurrency(overallSummary.totalPurchase)}
                  </p>
                  <div className="mt-4 space-y-1 text-sm font-medium">
                    <div className="flex justify-between">
                      <span className="text-blue-400">Generic</span>
                      <span>
                        {formatCurrency(overallSummary.genericPurchase)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-purple-400">Branded</span>
                      <span>
                        {formatCurrency(overallSummary.brandedPurchase)}
                      </span>
                    </div>
                  </div>
                </div>
                <Package size={28} className="text-blue-400" />
              </div>
            </div>

            {/* Expected Cash card */}
            <div
              onClick={() => {
                setModalPeriod(null);
                setShowRemittance(true);
              }}
              className="bg-slate-900 rounded-3xl p-6 border border-white/10 cursor-pointer hover:border-amber-400 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                    Expected Cash
                  </p>
                  <p className="text-3xl font-black mt-2">
                    {formatCurrency(overallSummary.expectedCash)}
                  </p>
                  <div className="mt-4 space-y-1 text-sm font-medium">
                    <div className="flex justify-between">
                      <span className="text-emerald-400">Total Sales</span>
                      <span>{formatCurrency(overallSummary.totalSales)}</span>
                    </div>
                    <div className="flex justify-between text-orange-400">
                      <span>Expenses</span>
                      <span>-{formatCurrency(overallSummary.expenses)}</span>
                    </div>
                  </div>
                </div>
                <DollarSign size={28} className="text-amber-400" />
              </div>
            </div>

            {/* Actual Remitted card */}
            <div
              onClick={() => {
                setModalPeriod(null);
                setShowRemittance(true);
              }}
              className="bg-slate-900 rounded-3xl p-6 border border-white/10 cursor-pointer hover:border-emerald-400 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                    Actual Remitted
                  </p>
                  <p className="text-3xl font-black mt-2">
                    {formatCurrency(overallSummary.actualRemitted)}
                  </p>
                </div>
                <CreditCard size={28} className="text-emerald-400" />
              </div>
            </div>

            {/* Cash Variance card */}
            <div
              className={`rounded-3xl p-6 border ${
                overallSummary.cashVariance >= 0
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-red-500/10 border-red-500/30'
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                    Cash Variance
                  </p>
                  <p
                    className={`text-3xl font-black mt-2 ${
                      overallSummary.cashVariance >= 0
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }`}
                  >
                    {overallSummary.cashVariance >= 0 ? '+' : ''}
                    {formatCurrency(overallSummary.cashVariance)}
                  </p>
                </div>
                {overallSummary.cashVariance >= 0 ? (
                  <TrendingUp size={28} className="text-emerald-400" />
                ) : (
                  <TrendingDown size={28} className="text-red-400" />
                )}
              </div>
            </div>

            {/* Total Adjustments card */}
            <div
              onClick={() => openAdjustmentsModal(null, 'All Adjustments')}
              className="bg-slate-900 rounded-3xl p-6 border border-white/10 cursor-pointer hover:border-amber-400 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                    Total Adjustments
                  </p>
                  <p className="text-3xl font-black mt-2 text-amber-400">
                    {formatCurrency(overallSummary.totalAdjustmentsValue)}
                  </p>
                </div>
                <AlertCircle size={28} className="text-amber-400" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CURRENT OPEN PERIOD - Grand Total minus total of all saved iterations */}
      {/* CURRENT OPEN PERIOD (UNRECONCILED) - Exact same structure as Grand Total */}
      <div className="max-w-7xl mx-auto px-6 mt-10">
        <div className="flex items-center justify-between mb-4 px-1">
          <h2 className="text-xs font-black uppercase tracking-widest text-emerald-400">
            CURRENT OPEN PERIOD (UNRECONCILED)
          </h2>
          <p className="text-sm text-slate-400">
            Grand Total − Sum of all saved iterations • What to charge staff now
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {/* Current Sales - EXACT same style as top card */}
          <div className="bg-slate-900 rounded-3xl p-6 border border-white/10">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                  Current Sales
                </p>
                <p className="text-3xl font-black mt-2 text-emerald-400">
                  {formatCurrency(
                    overallSummary.totalSales -
                      getSavedTotals(iterations).totalSales
                  )}
                </p>
                <div className="mt-4 space-y-1 text-sm font-medium">
                  <div className="flex justify-between">
                    <span className="text-emerald-400">Generic</span>
                    <span>
                      {formatCurrency(
                        overallSummary.genericSales -
                          getSavedTotals(iterations).genericSales
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-amber-400">Branded</span>
                    <span>
                      {formatCurrency(
                        overallSummary.brandedSales -
                          getSavedTotals(iterations).brandedSales
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-red-400">
                    <span>Discount</span>
                    <span>
                      -
                      {formatCurrency(
                        overallSummary.discountSales -
                          getSavedTotals(iterations).discountSales
                      )}
                    </span>
                  </div>
                </div>
              </div>
              <ShoppingCart size={28} className="text-emerald-400" />
            </div>
          </div>

          {/* Current Purchase - same style */}
          <div className="bg-slate-900 rounded-3xl p-6 border border-white/10">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                  Current Purchase
                </p>
                <p className="text-3xl font-black mt-2 text-blue-400">
                  {formatCurrency(
                    overallSummary.totalPurchase -
                      getSavedTotals(iterations).totalPurchase
                  )}
                </p>
                <div className="mt-4 space-y-1 text-sm font-medium">
                  <div className="flex justify-between">
                    <span className="text-blue-400">Generic</span>
                    <span>
                      {formatCurrency(
                        overallSummary.genericPurchase -
                          getSavedTotals(iterations).genericPurchase
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-purple-400">Branded</span>
                    <span>
                      {formatCurrency(
                        overallSummary.brandedPurchase -
                          getSavedTotals(iterations).brandedPurchase
                      )}
                    </span>
                  </div>
                </div>
              </div>
              <Package size={28} className="text-blue-400" />
            </div>
          </div>

          {/* Current Expected Cash */}
          {/* Current Expected Cash - NOW WITH BREAKDOWN (exactly like the top card) */}
          <div className="bg-slate-900 rounded-3xl p-6 border border-white/10">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                  Current Expected Cash
                </p>
                <p className="text-3xl font-black mt-2 text-amber-400">
                  {formatCurrency(
                    overallSummary.totalSales -
                      getSavedTotals(iterations).totalSales -
                      (overallSummary.expenses -
                        getSavedTotals(iterations).expenses)
                  )}
                </p>
                <div className="mt-4 space-y-1 text-sm font-medium">
                  <div className="flex justify-between">
                    <span className="text-emerald-400">Total Sales</span>
                    <span>
                      {formatCurrency(
                        overallSummary.totalSales -
                          getSavedTotals(iterations).totalSales
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-orange-400">
                    <span>Expenses</span>
                    <span>
                      -
                      {formatCurrency(
                        overallSummary.expenses -
                          getSavedTotals(iterations).expenses
                      )}
                    </span>
                  </div>
                </div>
              </div>
              <DollarSign size={28} className="text-amber-400" />
            </div>
          </div>

          {/* Current Actual Remitted */}
          <div className="bg-slate-900 rounded-3xl p-6 border border-white/10">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                  Current Actual Remitted
                </p>
                <p className="text-3xl font-black mt-2 text-emerald-400">
                  {formatCurrency(
                    overallSummary.actualRemitted -
                      getSavedTotals(iterations).actualRemitted
                  )}
                </p>
              </div>
              <CreditCard size={28} className="text-emerald-400" />
            </div>
          </div>

          {/* Current Cash Variance */}
          <div
            className={`rounded-3xl p-6 border ${
              overallSummary.cashVariance -
                getSavedTotals(iterations).cashVariance >=
              0
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-red-500/10 border-red-500/30'
            }`}
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                  Current Cash Variance
                </p>
                <p
                  className={`text-3xl font-black mt-2 ${
                    overallSummary.cashVariance -
                      getSavedTotals(iterations).cashVariance >=
                    0
                      ? 'text-emerald-400'
                      : 'text-red-400'
                  }`}
                >
                  {overallSummary.cashVariance -
                    getSavedTotals(iterations).cashVariance >=
                  0
                    ? '+'
                    : ''}
                  {formatCurrency(
                    overallSummary.cashVariance -
                      getSavedTotals(iterations).cashVariance
                  )}
                </p>
              </div>
              {overallSummary.cashVariance -
                getSavedTotals(iterations).cashVariance >=
              0 ? (
                <TrendingUp size={28} className="text-emerald-400" />
              ) : (
                <TrendingDown size={28} className="text-red-400" />
              )}
            </div>
          </div>

          {/* Current Adjustments + Charge to Staff */}
          <div className="bg-slate-900 rounded-3xl p-6 border border-white/10">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                  Current Adjustments
                </p>
                <p className="text-3xl font-black mt-2 text-amber-400">
                  {formatCurrency(
                    overallSummary.totalAdjustmentsValue -
                      getSavedTotals(iterations).totalAdjustmentsValue
                  )}
                </p>
              </div>
              <AlertCircle size={28} className="text-amber-400" />
            </div>
          </div>

          {/* Charge to Staff (Current) */}
          {/* CHARGE TO STAFF (CURRENT) - NEW FORMULA: Cash Variance - Adjustments */}
          {/* CHARGE TO STAFF (CURRENT) - Corrected Formula */}
          {/* CHARGE TO STAFF (CURRENT) - with responsible staff names */}
          {/* CHARGE TO STAFF (CURRENT) - with staff names */}
          {/* CHARGE TO STAFF (CURRENT) */}
          {/* CHARGE TO STAFF (CURRENT) */}
          <div className="bg-slate-900 rounded-3xl p-6 border border-red-400/30">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                  Charge to Staff (Current)
                </p>
                <p className="text-3xl font-black mt-2 text-red-400">
                  {formatCurrency(
                    -(
                      overallSummary.cashVariance -
                      getSavedTotals(iterations).cashVariance +
                      (overallSummary.totalAdjustmentsValue -
                        getSavedTotals(iterations).totalAdjustmentsValue)
                    )
                  )}
                </p>

                {currentResponsibleStaff &&
                  currentResponsibleStaff.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs text-red-400/70 mb-2">
                        Responsible:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {currentResponsibleStaff.map((staff: any) => (
                          <span
                            key={staff.id}
                            className="bg-red-500/10 text-red-400 text-xs px-3 py-1 rounded-2xl"
                          >
                            {staff.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
              <AlertCircle size={28} className="text-red-400 mt-1" />
            </div>
          </div>
        </div>
      </div>
      {/* ITERATIONS TABLE */}
      <div className="max-w-7xl mx-auto px-6 mt-10">
        <div className="flex items-center justify-between mb-4 px-1">
          <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">
            ITERATIONS (Latest First)
          </h2>
          <button
            onClick={saveCurrentIteration}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-black font-black uppercase text-sm px-6 py-3 rounded-2xl transition-colors"
          >
            <RefreshCw size={18} />
            SAVE AS ITERATION {nextIterationNumber} (CURRENT PERIOD)
          </button>
        </div>

        <div className="bg-slate-900 rounded-3xl overflow-hidden border border-white/10">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-950 text-xs font-black uppercase text-slate-400">
                <th className="text-left p-5">Iteration</th>
                <th className="text-left p-5">Period</th>
                <th className="text-right p-5">Sales</th>
                <th className="text-right p-5">Purchase</th>
                <th className="text-right p-5">Adj. Value</th>
                <th className="text-right p-5">Stock Var</th>
                <th className="text-right p-5">Cash Var</th>
                <th className="text-right p-5 bg-amber-500/10">
                  Charge to Staff
                </th>
                <th className="text-center p-5 w-12">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {iterations.map((iter) => (
                <tr
                  key={iter.id}
                  onClick={() => viewIteration(iter)}
                  className="hover:bg-amber-500/10 cursor-pointer transition-colors"
                >
                  <td className="p-5 font-medium">
                    Iteration {iter.iteration_number}
                  </td>
                  <td className="p-5 font-medium">
                    {new Date(iter.start_date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}{' '}
                    –{' '}
                    {new Date(iter.end_date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="p-5 text-right font-mono text-emerald-400">
                    {formatCurrency(iter.total_sales || 0)}
                  </td>
                  <td className="p-5 text-right font-mono text-blue-400">
                    {formatCurrency(iter.total_purchase || 0)}
                  </td>
                  <td className="p-5 text-right font-mono text-amber-400">
                    {formatCurrency(
                      Math.abs(iter.total_adjustments_value || 0)
                    )}
                  </td>
                  <td className="p-5 text-right font-mono">
                    {(iter.stock_variance || 0) >= 0 ? '+' : ''}
                    {iter.stock_variance || 0}
                  </td>
                  <td className="p-5 text-right font-mono">
                    {(iter.cash_variance || 0) >= 0 ? '+' : ''}
                    {formatCurrency(iter.cash_variance || 0)}
                  </td>

                  {/* CHARGE TO STAFF + RESPONSIBLE STAFF NAMES */}
                  <td className="p-5 text-right">
                    <div className="font-mono font-black text-red-400">
                      {formatCurrency(iter.charge_to_staff || 0)}
                    </div>
                    {iter.responsible_staff &&
                      iter.responsible_staff.length > 0 && (
                        <div className="flex flex-wrap gap-1 justify-end mt-2">
                          {iter.responsible_staff.map(
                            (staff: any, idx: number) => (
                              <span
                                key={idx}
                                className="text-[10px] bg-red-500/10 text-red-400 px-2 py-px rounded-lg"
                              >
                                {staff.name}
                              </span>
                            )
                          )}
                        </div>
                      )}
                  </td>

                  {/* DELETE BUTTON */}
                  <td className="p-5 text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteIteration(iter.id);
                      }}
                      className="text-red-400 hover:text-red-500 transition-colors p-2 rounded-xl hover:bg-red-500/10"
                      title="Delete iteration"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SALES / PURCHASE MODAL - EXACT ORIGINAL FROM YOUR FILE */}
      {/* SALES / PURCHASE BREAKDOWN MODAL - NOW SORTED BY DATE (NEWEST FIRST) */}
      {/* SALES / PURCHASE BREAKDOWN MODAL - CORRECT NET TOTAL SALES (discount deducted) */}
      {/* SALES BREAKDOWN MODAL - FIXED: Generic & Branded are raw (discount only affects Total) */}
      {/* SALES BREAKDOWN MODAL - RAW GENERIC/BRANDED + DEBUG */}
      {/* SALES / PURCHASE BREAKDOWN MODAL - NOW CONSISTENT WITH REMITTANCE MODAL */}
      {showBreakdown && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-[120]"
          onClick={() => setShowBreakdown(null)}
        >
          <div
            className="bg-slate-900 rounded-3xl max-w-6xl w-full mx-4 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-white/10 flex justify-between items-center">
              <h2 className="text-xl font-black uppercase">
                {showBreakdown === 'sales' ? 'Sales' : 'Purchase'} Breakdown
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setModalView('daily')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium ${
                    modalView === 'daily'
                      ? 'bg-emerald-400 text-black'
                      : 'bg-white/10'
                  }`}
                >
                  Daily Totals
                </button>
                <button
                  onClick={() => setModalView('full')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium ${
                    modalView === 'full'
                      ? 'bg-emerald-400 text-black'
                      : 'bg-white/10'
                  }`}
                >
                  Full Transactions
                </button>
              </div>
              <button
                onClick={() => setShowBreakdown(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {modalView === 'daily' ? (
                // ✅ Daily Totals now uses daily_reports (matches Remittance modal)
                <table className="w-full text-sm">
                  <thead className="bg-slate-950 sticky top-0">
                    <tr>
                      <th className="text-left p-3">Date</th>
                      <th className="text-right p-3">Generic</th>
                      <th className="text-right p-3">Branded</th>
                      {showBreakdown === 'sales' && (
                        <th className="text-right p-3">Discount</th>
                      )}
                      <th className="text-right p-3">Total Sales (Net)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {(() => {
                      const dataSource = modalPeriod
                        ? rawData.remittanceFullData.filter(
                            (r: any) =>
                              r.report_date >= modalPeriod.start &&
                              r.report_date <= modalPeriod.end
                          )
                        : rawData.remittanceFullData;

                      const sorted = [...dataSource].sort((a, b) =>
                        b.report_date.localeCompare(a.report_date)
                      );

                      return sorted.map((row: any, i: number) => (
                        <tr key={i} className="hover:bg-white/5">
                          <td className="p-3 font-mono">{row.report_date}</td>
                          <td className="p-3 text-right">
                            {formatCurrency(row.generic_sales || 0)}
                          </td>
                          <td className="p-3 text-right">
                            {formatCurrency(row.branded_sales || 0)}
                          </td>
                          {showBreakdown === 'sales' && (
                            <td className="p-3 text-right text-red-400">
                              -
                              {formatCurrency(
                                Math.abs(row.discount_total || 0)
                              )}
                            </td>
                          )}
                          <td className="p-3 text-right font-medium">
                            {formatCurrency(row.total_sales || 0)}
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              ) : (
                // Full Transactions tab still uses raw orders data (for detailed view)
                <table className="w-full text-sm">
                  <thead className="bg-slate-950 sticky top-0">
                    <tr>
                      <th className="text-left p-3">Date</th>
                      <th className="text-left p-3">
                        {showBreakdown === 'sales' ? 'SO Number' : 'PO Number'}
                      </th>
                      {showBreakdown === 'purchase' && (
                        <th className="text-left p-3">Invoice ID</th>
                      )}
                      <th className="text-right p-3">Generic</th>
                      <th className="text-right p-3">Branded</th>
                      {showBreakdown === 'sales' && (
                        <th className="text-right p-3">Discount</th>
                      )}
                      <th className="text-right p-3">Total Sales (Net)</th>
                      <th className="text-left p-3">Created By</th>
                      <th className="text-center p-3">Verified</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {(modalPeriod
                      ? (showBreakdown === 'sales'
                          ? rawData.ordersFull
                          : rawData.purchaseOrdersFull
                        ).filter(
                          (row: any) =>
                            row.created_date_pht >= modalPeriod.start &&
                            row.created_date_pht <= modalPeriod.end
                        )
                      : showBreakdown === 'sales'
                      ? rawData.ordersFull
                      : rawData.purchaseOrdersFull
                    )
                      .sort(
                        (a: any, b: any) =>
                          new Date(b.created_date_pht).getTime() -
                          new Date(a.created_date_pht).getTime()
                      )
                      .map((row: any, i: number) => {
                        const discount =
                          showBreakdown === 'sales'
                            ? Math.abs(row.discount_total || 0)
                            : 0;
                        const netTotal =
                          (row.generic_amt || 0) +
                          (row.branded_amt || 0) -
                          discount;

                        return (
                          <tr key={i} className="hover:bg-white/5">
                            <td className="p-3 font-mono">
                              {row.created_date_pht}
                            </td>
                            <td className="p-3 font-mono">
                              {showBreakdown === 'sales'
                                ? row.order_number
                                : row.po_number}
                            </td>
                            {showBreakdown === 'purchase' && (
                              <td className="p-3 font-mono">
                                {row.invoice_id || '-'}
                              </td>
                            )}
                            <td className="p-3 text-right">
                              {formatCurrency(row.generic_amt || 0)}
                            </td>
                            <td className="p-3 text-right">
                              {formatCurrency(row.branded_amt || 0)}
                            </td>
                            {showBreakdown === 'sales' && (
                              <td className="p-3 text-right text-red-400">
                                -{formatCurrency(discount)}
                              </td>
                            )}
                            <td className="p-3 text-right font-medium">
                              {formatCurrency(netTotal)}
                            </td>
                            <td className="p-3">
                              {showBreakdown === 'sales'
                                ? row.created_by
                                : row.profiles?.full_name || row.created_by}
                            </td>
                            <td className="p-3 text-center">
                              {row.is_checked ? '✅' : '❌'}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="p-6 border-t border-white/10">
              <button
                onClick={() => setShowBreakdown(null)}
                className="w-full py-4 bg-white/10 hover:bg-white/20 rounded-2xl font-black uppercase text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* REMITTANCE MODAL - EXACT ORIGINAL FROM YOUR FILE */}
      {/* REMITTANCE MODAL - CLEAN TOP SUMMARY + CORRECT EXCESS FORMULA */}
      {/* REMITTANCE MODAL - CORRECT NET SALES (no double discount deduction) */}
      {showRemittance && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-[120]"
          onClick={() => setShowRemittance(false)}
        >
          <div
            className="bg-slate-900 rounded-3xl max-w-7xl w-full mx-4 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-white/10 flex justify-between items-center">
              <h2 className="text-xl font-black uppercase">
                Daily Reports &amp; Remittance Details
              </h2>
              <button
                onClick={() => setShowRemittance(false)}
                className="text-slate-400 hover:text-white text-3xl"
              >
                ✕
              </button>
            </div>

            {/* Top Summary Bar - Uses official total_sales from daily_reports */}
            <div className="px-6 py-5 bg-slate-950 border-b border-white/10">
              {(() => {
                const filteredData = modalPeriod
                  ? rawData.remittanceFullData.filter(
                      (r: any) =>
                        r.report_date >= modalPeriod.start &&
                        r.report_date <= modalPeriod.end
                    )
                  : rawData.remittanceFullData;

                const netTotalSales = filteredData.reduce(
                  (sum: number, r: any) => sum + (r.total_sales || 0),
                  0
                );
                const totalActualCash = filteredData.reduce(
                  (sum: number, r: any) => sum + (r.actual_cash || 0),
                  0
                );
                const totalExpenses = filteredData.reduce(
                  (sum: number, r: any) => sum + (r.expenses || 0),
                  0
                );

                const totalExcess =
                  totalActualCash - netTotalSales + totalExpenses;

                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
                    <div>
                      <p className="text-xs font-black uppercase text-slate-400">
                        Total Sales (Net)
                      </p>
                      <p className="text-3xl font-black text-emerald-400">
                        {formatCurrency(netTotalSales)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase text-slate-400">
                        Actual Cash
                      </p>
                      <p className="text-3xl font-black text-white">
                        {formatCurrency(totalActualCash)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase text-slate-400">
                        Cash Excess / Shortage
                      </p>
                      <p
                        className={`text-3xl font-black ${
                          totalExcess >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {totalExcess >= 0 ? '+' : ''}
                        {formatCurrency(totalExcess)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase text-slate-400">
                        Total Expenses
                      </p>
                      <p className="text-3xl font-black text-orange-400">
                        {formatCurrency(totalExpenses)}
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="flex-1 overflow-auto p-6">
              <table className="w-full text-sm">
                <thead className="bg-slate-950 sticky top-0">
                  <tr>
                    <th className="text-left p-3">Date</th>
                    <th className="text-right p-3">Generic Sales</th>
                    <th className="text-right p-3">Branded Sales</th>
                    <th className="text-right p-3">Discount</th>
                    <th className="text-right p-3">Total Sales (Net)</th>
                    <th className="text-right p-3">Actual Cash</th>
                    <th className="text-right p-3">Cash Excess / Shortage</th>
                    <th className="text-right p-3">Expenses</th>
                    <th className="text-left p-3">Notes</th>
                    <th className="text-left p-3">Reported By</th>
                    <th className="text-center p-3">Verified</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {(() => {
                    let data = modalPeriod
                      ? rawData.remittanceFullData.filter(
                          (r: any) =>
                            r.report_date >= modalPeriod.start &&
                            r.report_date <= modalPeriod.end
                        )
                      : rawData.remittanceFullData;

                    data = [...data].sort((a, b) =>
                      b.report_date.localeCompare(a.report_date)
                    );

                    return data.map((row: any, i: number) => {
                      const excess =
                        (row.actual_cash || 0) -
                        (row.total_sales || 0) +
                        (row.expenses || 0);

                      return (
                        <tr key={i} className="hover:bg-white/5">
                          <td className="p-3 font-mono">{row.report_date}</td>
                          <td className="p-3 text-right">
                            {formatCurrency(row.generic_sales || 0)}
                          </td>
                          <td className="p-3 text-right">
                            {formatCurrency(row.branded_sales || 0)}
                          </td>
                          <td className="p-3 text-right text-red-400">
                            -{formatCurrency(Math.abs(row.discount_total || 0))}
                          </td>
                          {/* ✅ Use official total_sales directly (no double deduction) */}
                          <td className="p-3 text-right font-medium">
                            {formatCurrency(row.total_sales || 0)}
                          </td>
                          <td className="p-3 text-right">
                            {formatCurrency(row.actual_cash || 0)}
                          </td>
                          <td
                            className={`p-3 text-right font-medium font-semibold ${
                              excess >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {excess >= 0 ? '+' : ''}
                            {formatCurrency(excess)}
                          </td>
                          <td className="p-3 text-right">
                            {formatCurrency(row.expenses || 0)}
                          </td>
                          <td className="p-3">{row.notes || '-'}</td>
                          <td className="p-3">{row.reported_by}</td>
                          <td className="p-3 text-center">
                            {row.is_checked ? '✅' : '❌'}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>

            <div className="p-6 border-t border-white/10">
              <button
                onClick={() => setShowRemittance(false)}
                className="w-full py-4 bg-white/10 hover:bg-white/20 rounded-2xl font-black uppercase text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* DETAILED ADJUSTMENTS MODAL */}
      {/* DETAILED ADJUSTMENTS MODAL - IMPROVED WITH POSITIVE/NEGATIVE BREAKDOWN */}
      {/* DETAILED ADJUSTMENTS MODAL - NOW FULLY MONETARY (VALUE-BASED) */}
      {showAdjustmentsModal && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-[130]"
          onClick={() => setShowAdjustmentsModal(false)}
        >
          <div
            className="bg-slate-900 rounded-3xl max-w-7xl w-full mx-4 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-white/10 flex justify-between items-center">
              <h2 className="text-xl font-black uppercase">
                {adjustmentsModalTitle}
              </h2>
              <button
                onClick={() => setShowAdjustmentsModal(false)}
                className="text-slate-400 hover:text-white text-3xl"
              >
                ✕
              </button>
            </div>

            {/* MONETARY SUMMARY - Positive / Negative / Gross / Net Value */}
            <div className="px-6 pt-6 pb-4 border-b border-white/10 bg-slate-950/50">
              {(() => {
                const positiveValue = adjustmentsList.reduce(
                  (sum: number, a: any) =>
                    sum + Math.max(0, a.quantity || 0) * (a.unit_price || 0),
                  0
                );
                const negativeValue = adjustmentsList.reduce(
                  (sum: number, a: any) =>
                    sum + Math.max(0, -(a.quantity || 0)) * (a.unit_price || 0),
                  0
                );
                const netValue = adjustmentsList.reduce(
                  (sum: number, a: any) =>
                    sum + (a.quantity || 0) * (a.unit_price || 0),
                  0
                );
                const grossValue = positiveValue + negativeValue;

                return (
                  <div className="space-y-6">
                    {/* GROSS TOTAL - matches the card (113905) */}
                    <div className="text-center">
                      <p className="text-amber-400 text-xs font-black uppercase tracking-widest">
                        Gross Adjustment Value
                      </p>
                      <p className="text-4xl font-black text-amber-400 mt-1">
                        {formatCurrency(grossValue)}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Total movement (before netting)
                      </p>
                    </div>

                    {/* Positive / Negative / Net */}
                    <div className="grid grid-cols-3 gap-6 text-center">
                      <div className="bg-emerald-500/10 rounded-2xl p-4">
                        <p className="text-emerald-400 text-xs font-black uppercase tracking-widest">
                          Positive Adj. Value
                        </p>
                        <p className="text-4xl font-black text-emerald-400 mt-1">
                          +{formatCurrency(positiveValue)}
                        </p>
                      </div>
                      <div className="bg-red-500/10 rounded-2xl p-4">
                        <p className="text-red-400 text-xs font-black uppercase tracking-widest">
                          Negative Adj. Value
                        </p>
                        <p className="text-4xl font-black text-red-400 mt-1">
                          -{formatCurrency(negativeValue)}
                        </p>
                      </div>
                      <div
                        className={`rounded-2xl p-4 ${
                          netValue >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'
                        }`}
                      >
                        <p className="text-slate-400 text-xs font-black uppercase tracking-widest">
                          Net Adj. Value
                        </p>
                        <p
                          className={`text-4xl font-black mt-1 ${
                            netValue >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {netValue >= 0 ? '+' : ''}
                          {formatCurrency(Math.abs(netValue))}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
            {/* DEBUG INFO (you can remove this later) */}

            <div className="flex-1 overflow-auto p-6">
              <table className="w-full text-sm">
                <thead className="bg-slate-950 sticky top-0">
                  <tr className="text-xs font-black uppercase text-slate-400">
                    <th className="text-left p-4">Item Name</th>
                    <th className="text-right p-4">Adj. Value</th>{' '}
                    {/* ← CHANGED */}
                    <th className="text-right p-4">Unit Price</th>
                    <th className="text-right p-4">Buy Cost</th>
                    <th className="text-right p-4">Total Selling</th>
                    <th className="text-right p-4">Total Buy Cost</th>
                    <th className="text-left p-4">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {adjustmentsList.map((adj: any, i: number) => {
                    const qty = adj.quantity || 0;
                    const unitPrice = adj.unit_price || 0;
                    const buyCost = adj.buy_cost || 0;
                    const adjValue = qty * unitPrice; // ← NEW: monetary value
                    const item = adj.inventory || {};
                    return (
                      <tr key={i} className="hover:bg-white/5">
                        <td className="p-4 font-medium">
                          {item.item_name || 'Deleted / Unknown Item'}
                        </td>
                        <td
                          className={`p-4 text-right font-mono font-semibold text-lg ${
                            adjValue >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {adjValue >= 0 ? '+' : ''}
                          {formatCurrency(Math.abs(adjValue))}
                        </td>
                        <td className="p-4 text-right font-mono">
                          {formatCurrency(unitPrice)}
                        </td>
                        <td className="p-4 text-right font-mono">
                          {formatCurrency(buyCost)}
                        </td>
                        <td className="p-4 text-right font-mono text-emerald-400">
                          {formatCurrency(unitPrice * Math.abs(qty))}
                        </td>
                        <td className="p-4 text-right font-mono text-blue-400">
                          {formatCurrency(buyCost * Math.abs(qty))}
                        </td>
                        <td className="p-4">{adj.reason || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-6 border-t border-white/10">
              <button
                onClick={() => setShowAdjustmentsModal(false)}
                className="w-full py-4 bg-white/10 hover:bg-white/20 rounded-2xl font-black uppercase text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PER-WEEK ITEM-BY-ITEM MODAL */}
      {showWeekDetail && selectedWeek && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100]"
          onClick={() => setShowWeekDetail(false)}
        >
          <div
            className="bg-slate-900 rounded-3xl max-w-7xl w-full mx-4 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-white/10 flex justify-between items-center">
              <h2 className="text-xl font-black uppercase">
                {selectedWeek.label} — ITEM-BY-ITEM RECONCILIATION
              </h2>
              <button
                onClick={() => setShowWeekDetail(false)}
                className="text-slate-400 hover:text-white text-3xl"
              >
                ✕
              </button>
            </div>

            {weekSummary && (
              <div className="p-4 border-b border-white/10 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <div
                  onClick={() => {
                    setShowWeekDetail(false);
                    setTimeout(() => {
                      setModalPeriod(selectedWeek);
                      setShowBreakdown('sales');
                      setModalView('daily');
                    }, 150);
                  }}
                  className="bg-slate-800 rounded-2xl p-4 cursor-pointer hover:bg-slate-700 transition-colors"
                >
                  <p className="text-xs font-black uppercase text-slate-400">
                    Sales
                  </p>
                  <p className="text-2xl font-black mt-1">
                    {formatCurrency(weekSummary.totalSales)}
                  </p>
                </div>
                <div
                  onClick={() => {
                    setShowWeekDetail(false);
                    setTimeout(() => {
                      setModalPeriod(selectedWeek);
                      setShowBreakdown('purchase');
                      setModalView('daily');
                    }, 150);
                  }}
                  className="bg-slate-800 rounded-2xl p-4 cursor-pointer hover:bg-slate-700 transition-colors"
                >
                  <p className="text-xs font-black uppercase text-slate-400">
                    Purchase
                  </p>
                  <p className="text-2xl font-black mt-1">
                    {formatCurrency(weekSummary.totalPurchase)}
                  </p>
                </div>
                <div className="bg-slate-800 rounded-2xl p-4">
                  <p className="text-xs font-black uppercase text-slate-400">
                    Expected Cash
                  </p>
                  <p className="text-2xl font-black mt-1">
                    {formatCurrency(weekSummary.expectedCash)}
                  </p>
                </div>
                <div
                  onClick={() => {
                    setShowWeekDetail(false);
                    setTimeout(() => {
                      setModalPeriod(selectedWeek);
                      setShowRemittance(true);
                    }, 150);
                  }}
                  className="bg-slate-800 rounded-2xl p-4 cursor-pointer hover:bg-slate-700 transition-colors"
                >
                  <p className="text-xs font-black uppercase text-slate-400">
                    Remitted
                  </p>
                  <p className="text-2xl font-black mt-1">
                    {formatCurrency(weekSummary.actualRemitted)}
                  </p>
                </div>
                <div
                  className={`rounded-2xl p-4 ${
                    weekSummary.cashVariance >= 0
                      ? 'bg-emerald-500/10 border border-emerald-500/30'
                      : 'bg-red-500/10 border border-red-500/30'
                  }`}
                >
                  <p className="text-xs font-black uppercase text-slate-400">
                    Cash Variance
                  </p>
                  <p
                    className={`text-2xl font-black mt-1 ${
                      weekSummary.cashVariance >= 0
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }`}
                  >
                    {weekSummary.cashVariance >= 0 ? '+' : ''}
                    {formatCurrency(weekSummary.cashVariance)}
                  </p>
                </div>
                <div
                  onClick={() => {
                    setShowWeekDetail(false);
                    setTimeout(
                      () =>
                        openAdjustmentsModal(
                          selectedWeek,
                          `${selectedWeek.label} Adjustments`
                        ),
                      150
                    );
                  }}
                  className="bg-slate-800 rounded-2xl p-4 cursor-pointer hover:bg-slate-700 transition-colors"
                >
                  <p className="text-xs font-black uppercase text-slate-400">
                    Adjustments
                  </p>
                  <p className="text-2xl font-black mt-1 text-amber-400">
                    {weekSummary.totalAdjustmentsValue}
                  </p>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-auto p-6">
              {modalLoading ? (
                <div className="flex items-center justify-center h-64">
                  <RefreshCw
                    className="animate-spin text-emerald-400"
                    size={32}
                  />
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-950 sticky top-0">
                    <tr className="text-xs font-black uppercase text-slate-400">
                      <th className="text-left p-4">Item Name</th>
                      <th className="text-right p-4">Beg. Stock</th>
                      <th className="text-right p-4">Purchases</th>
                      <th className="text-right p-4">Adjustments</th>
                      <th className="text-right p-4">Sold</th>
                      <th className="text-right p-4">Net Movement</th>
                      <th className="text-right p-4">Expected</th>
                      <th className="text-right p-4">Actual</th>
                      <th className="text-right p-4">Stock Var</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {weekItems.map((item) => (
                      <tr
                        key={item.id}
                        className="hover:bg-white/5 transition-colors"
                      >
                        <td className="p-4 font-medium text-sm">
                          {item.item_name}
                        </td>
                        <td className="p-4 text-right font-mono text-sm">
                          {item.beginning_stock}
                        </td>
                        <td className="p-4 text-right font-mono text-blue-400 text-sm">
                          {item.purchases_qty}
                        </td>
                        <td className="p-4 text-right font-mono text-amber-400 text-sm">
                          {item.adjustments_qty}
                        </td>
                        <td className="p-4 text-right font-mono text-emerald-400 text-sm">
                          {item.sales_qty}
                        </td>
                        <td
                          className={`p-4 text-right font-mono font-semibold text-sm ${
                            item.net_movement >= 0
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }`}
                        >
                          {item.net_movement >= 0 ? '+' : ''}
                          {item.net_movement}
                        </td>
                        <td className="p-4 text-right font-mono text-sm">
                          {item.expected_ending_stock}
                        </td>
                        <td className="p-4 text-right font-mono font-semibold text-sm">
                          {item.actual_ending_stock}
                        </td>
                        <td
                          className={`p-4 text-right font-mono font-black text-sm ${
                            item.stock_variance >= 0
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }`}
                        >
                          {item.stock_variance >= 0 ? '+' : ''}
                          {item.stock_variance}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="p-6 border-t border-white/10">
              <button
                onClick={() => setShowWeekDetail(false)}
                className="w-full py-4 bg-white/10 hover:bg-white/20 rounded-2xl font-black uppercase text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ITERATION DETAIL MODAL */}
      {showIterationModal && selectedIteration && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-[140]"
          onClick={closeIterationModal}
        >
          <div
            className="bg-slate-900 rounded-3xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-white/10 flex justify-between items-center">
              <h2 className="text-xl font-black uppercase">
                {selectedIteration.label}
              </h2>
              <button
                onClick={closeIterationModal}
                className="text-slate-400 hover:text-white text-3xl"
              >
                ✕
              </button>
            </div>

            <div className="p-8">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                <div className="bg-slate-800 rounded-2xl p-6">
                  <p className="text-xs font-black uppercase text-slate-400">
                    Total Sales
                  </p>
                  <p className="text-4xl font-black text-emerald-400 mt-2">
                    {formatCurrency(selectedIteration.total_sales || 0)}
                  </p>
                </div>
                <div className="bg-slate-800 rounded-2xl p-6">
                  <p className="text-xs font-black uppercase text-slate-400">
                    Total Purchase
                  </p>
                  <p className="text-4xl font-black text-blue-400 mt-2">
                    {formatCurrency(selectedIteration.total_purchase || 0)}
                  </p>
                </div>
                <div className="bg-slate-800 rounded-2xl p-6">
                  <p className="text-xs font-black uppercase text-slate-400">
                    Adjustments
                  </p>
                  <p className="text-4xl font-black text-amber-400 mt-2">
                    {formatCurrency(
                      selectedIteration.total_adjustments_value || 0
                    )}
                  </p>
                </div>
                <div className="bg-slate-800 rounded-2xl p-6">
                  <p className="text-xs font-black uppercase text-slate-400">
                    Cash Variance
                  </p>
                  <p
                    className={`text-4xl font-black mt-2 ${
                      selectedIteration.cash_variance >= 0
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }`}
                  >
                    {selectedIteration.cash_variance >= 0 ? '+' : ''}
                    {formatCurrency(selectedIteration.cash_variance || 0)}
                  </p>
                </div>
                <div className="bg-slate-800 rounded-2xl p-6">
                  <p className="text-xs font-black uppercase text-slate-400">
                    Charge to Staff
                  </p>
                  <p className="text-4xl font-black text-red-400 mt-2">
                    {formatCurrency(selectedIteration.charge_to_staff || 0)}
                  </p>
                </div>
                <div className="bg-slate-800 rounded-2xl p-6">
                  <p className="text-xs font-black uppercase text-slate-400">
                    Saved On
                  </p>
                  <p className="text-xl font-medium mt-2 text-slate-300">
                    {new Date(
                      selectedIteration.saved_at || selectedIteration.created_at
                    ).toLocaleString('en-US')}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-white/10">
              <button
                onClick={closeIterationModal}
                className="w-full py-4 bg-white/10 hover:bg-white/20 rounded-2xl font-black uppercase text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
