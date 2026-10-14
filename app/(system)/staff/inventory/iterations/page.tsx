'use client';
import { useState, useEffect, useLayoutEffect } from 'react';
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

// ==================== THEME (LIGHT/DARK) ====================
// Scoped light-mode overrides, same elevation system as the other pages
// (strengthened shadow/wash values). Applied only when an ancestor has
// data-theme="light"; dark stays untouched.
// NOTE: bg-slate-950 sits directly on both root wrapper divs, and
// text-white also sits directly on the main one, alongside data-theme —
// so both need the same-element selector form (no space) in addition to
// the normal descendant form.
const THEME_OVERRIDES = `
  [data-theme-loading='true'],
  [data-theme-loading='true'] * { transition: none !important; }

  [data-theme='dark'] { color-scheme: dark; }
  [data-theme='light'] { color-scheme: light; }

  /* Page & recessed wells */
  [data-theme='light'] .bg-slate-950,
  [data-theme='light'].bg-slate-950 { background-color: #f1f5f9 !important; }
  [data-theme='light'] .bg-slate-950\\/50 { background-color: rgba(203,213,225,0.6) !important; }

  /* Card / panel surfaces */
  [data-theme='light'] .bg-slate-900 {
    background-color: #ffffff !important;
    box-shadow: 0 1px 3px rgba(15,23,42,0.07), 0 6px 20px rgba(15,23,42,0.10) !important;
  }
  [data-theme='light'] .bg-slate-800 { background-color: #e2e8f0 !important; }
  [data-theme='light'] .bg-slate-700 { background-color: #cbd5e1 !important; }

  /* Hover / interactive states */
  [data-theme='light'] .hover\\:bg-slate-700:hover { background-color: #94a3b8 !important; }
  [data-theme='light'] .hover\\:bg-white\\/5:hover { background-color: rgba(15,23,42,0.045) !important; }
  [data-theme='light'] .hover\\:bg-white\\/20:hover { background-color: rgba(15,23,42,0.1) !important; }
  [data-theme='light'] .bg-white\\/5 { background-color: rgba(15,23,42,0.045) !important; }
  [data-theme='light'] .bg-white\\/10 { background-color: rgba(15,23,42,0.08) !important; }

  /* Text */
  [data-theme='light'] .text-white,
  [data-theme='light'].text-white { color: #0f172a !important; }
  [data-theme='light'] .text-slate-200 { color: #1e293b !important; }
  [data-theme='light'] .text-slate-300 { color: #334155 !important; }
  [data-theme='light'] .text-slate-400 { color: #475569 !important; }
  [data-theme='light'] .text-slate-600 { color: #94a3b8 !important; }
  [data-theme='light'] .hover\\:text-white:hover { color: #0f172a !important; }

  /* Borders */
  [data-theme='light'] .border-white\\/10 { border-color: rgba(15,23,42,0.08) !important; }
  [data-theme='light'] .divide-white\\/10 > :not([hidden]) ~ :not([hidden]) { border-color: rgba(15,23,42,0.08) !important; }

  /* Accent text: darken bright dark-mode shades for light-background contrast */
  [data-theme='light'] .text-emerald-400 { color: #059669 !important; }
  [data-theme='light'] .text-red-400 { color: #dc2626 !important; }
  [data-theme='light'] .text-red-500 { color: #dc2626 !important; }
  [data-theme='light'] .text-amber-400 { color: #d97706 !important; }
  [data-theme='light'] .text-blue-400 { color: #2563eb !important; }
  [data-theme='light'] .text-sky-400 { color: #0284c7 !important; }
  [data-theme='light'] .text-purple-400 { color: #9333ea !important; }
  [data-theme='light'] .text-orange-400 { color: #ea580c !important; }
`;

const formatPeso = (amount: number) =>
  `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

// Stock-value reconciliation, using only what's actually recorded:
// purchases and sales alone tell you what the stock SHOULD be worth;
// the auditor's logged adjustments are the only thing that can make
// "actual" differ from that. So `difference` always equals the
// adjustments total — this isn't a new independent check, it's the
// existing Adjustments number laid out as an expected → actual story
// instead of a bare figure. (Charge to Staff is computed separately —
// see getChargeToStaff — since it also needs Cash Variance, not just
// the stock side.)
const getStockValueBreakdown = (
  totalPurchase: number,
  costOfSales: number,
  totalAdjustments: number,
  startingInventoryValue: number = 0
) => {
  const expectedStockValue =
    startingInventoryValue + totalPurchase - costOfSales;
  const actualStockValue = expectedStockValue + totalAdjustments;
  const difference = actualStockValue - expectedStockValue;
  return { expectedStockValue, actualStockValue, difference };
};

// Charge to Staff = Cash Variance netted against Adjustments — both are
// unit_price (selling price) basis, so this is apples-to-apples. A cash
// surplus (unlogged sale, money still turned in) offsets the stock
// shortage that same sale caused; whatever's left uncovered after that
// netting is a real, unexplained loss and gets charged. A surplus that
// more than covers the stock side comes out negative — a credit, not
// a charge.
const getChargeToStaff = (cashVariance: number, totalAdjustments: number) =>
  -(cashVariance + totalAdjustments);

const ReconciliationPanel = ({
  title,
  subtitle,
  totalSales,
  genericSales,
  brandedSales,
  discountSales,
  expenses,
  savings,
  actualRemitted,
  totalPurchase,
  genericPurchase,
  brandedPurchase,
  costOfSales,
  adjustments,
  liveInventoryValue,
  startingInventoryValue,
  onSetStartingValueClick,
  staff,
  onSalesClick,
  onPurchaseClick,
  onRemittanceClick,
  onAdjustmentsClick,
}: {
  title: string;
  subtitle?: string;
  totalSales: number;
  genericSales: number;
  brandedSales: number;
  discountSales: number;
  expenses: number;
  savings: number;
  actualRemitted: number;
  totalPurchase: number;
  genericPurchase: number;
  brandedPurchase: number;
  costOfSales: number;
  adjustments: number;
  liveInventoryValue?: number;
  startingInventoryValue?: number;
  onSetStartingValueClick?: () => void;
  staff?: any[];
  onSalesClick?: () => void;
  onPurchaseClick?: () => void;
  onRemittanceClick?: () => void;
  onAdjustmentsClick?: () => void;
}) => {
  const expectedCash = totalSales - expenses - savings;
  const cashExcess = actualRemitted - expectedCash;
  const {
    expectedStockValue,
    actualStockValue: derivedActualStockValue,
  } = getStockValueBreakdown(
    totalPurchase,
    costOfSales,
    adjustments,
    startingInventoryValue
  );
  // Actual comes straight from live inventory when available (Overall),
  // instead of Purchases − Cost of Sales + Adjustments — so it stays
  // correct even if Cost of Sales has a data problem. Charge to Staff
  // is NEVER based on this: it's always −(Cash Excess + Adjustments),
  // the auditor's real entry, so a bug here can't change what's charged.
  const actualStockValue = liveInventoryValue ?? derivedActualStockValue;
  const stockDifference = actualStockValue - expectedStockValue;
  const stockDifferenceMismatch =
    liveInventoryValue !== undefined &&
    Math.abs(stockDifference - adjustments) > 1;
  const chargeToStaff = getChargeToStaff(cashExcess, adjustments);
  const netExcess = cashExcess + adjustments;

  return (
    <div className="max-w-7xl mx-auto px-6 mt-8">
      <div className="flex items-center justify-between mb-4 px-1">
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">
          {title}
        </h2>
        <div className="flex items-center gap-4">
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
          {onSetStartingValueClick && (
            <button
              onClick={onSetStartingValueClick}
              className="text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-300 underline decoration-dotted"
            >
              {startingInventoryValue
                ? 'Update Starting Value'
                : 'Set Starting Value'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ===== CASH PANE ===== */}
        <div className="bg-black/20 rounded-3xl p-5 border border-white/10">
          <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-4 px-1">
            Cash
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div
              onClick={onSalesClick}
              className={`col-span-2 bg-slate-900 rounded-2xl p-4 border border-white/10 ${
                onSalesClick
                  ? 'cursor-pointer hover:border-emerald-400 transition-colors'
                  : ''
              }`}
            >
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Total Sales
              </p>
              <p className="text-xl font-black mt-1 text-emerald-400">
                {formatPeso(totalSales)}
              </p>
              <div className="mt-2 space-y-0.5 text-[11px] font-medium">
                <div className="flex justify-between">
                  <span className="text-emerald-400">Generic</span>
                  <span>{formatPeso(genericSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-400">Branded</span>
                  <span>{formatPeso(brandedSales)}</span>
                </div>
                <div className="flex justify-between text-red-400">
                  <span>Discount</span>
                  <span>-{formatPeso(discountSales)}</span>
                </div>
              </div>
            </div>
            <div className="bg-slate-900 rounded-2xl p-4 border border-white/10">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Expenses
              </p>
              <p className="text-xl font-black mt-1">{formatPeso(expenses)}</p>
            </div>
            <div className="bg-slate-900 rounded-2xl p-4 border border-white/10">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Savings
              </p>
              <p className="text-xl font-black mt-1 text-emerald-400">
                {formatPeso(savings)}
              </p>
            </div>
            <div
              onClick={onRemittanceClick}
              className={`col-span-2 bg-slate-900 rounded-2xl p-4 border border-white/10 ${
                onRemittanceClick
                  ? 'cursor-pointer hover:border-amber-400 transition-colors'
                  : ''
              }`}
            >
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Expected Cash
              </p>
              <p className="text-xl font-black mt-1 text-amber-400">
                {formatPeso(expectedCash)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">
                Sales − Expenses − Savings
              </p>
            </div>
            <div
              onClick={onRemittanceClick}
              className={`col-span-2 bg-slate-900 rounded-2xl p-4 border border-white/10 ${
                onRemittanceClick
                  ? 'cursor-pointer hover:border-emerald-400 transition-colors'
                  : ''
              }`}
            >
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Actual Remitted
              </p>
              <p className="text-xl font-black mt-1 text-emerald-400">
                {formatPeso(actualRemitted)}
              </p>
            </div>
            <div
              className={`col-span-2 rounded-2xl p-4 border ${
                cashExcess >= 0
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-red-500/10 border-red-500/30'
              }`}
            >
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Cash Excess — Remitted vs. Expected
              </p>
              <p
                className={`text-2xl font-black mt-1 ${
                  cashExcess >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {cashExcess >= 0 ? '+' : ''}
                {formatPeso(cashExcess)}
              </p>
            </div>
          </div>
        </div>

        {/* ===== STOCK PANE ===== */}
        <div className="bg-black/20 rounded-3xl p-5 border border-white/10">
          <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-4 px-1">
            Stock
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div
              onClick={onPurchaseClick}
              className={`col-span-2 bg-slate-900 rounded-2xl p-4 border border-white/10 ${
                onPurchaseClick
                  ? 'cursor-pointer hover:border-blue-400 transition-colors'
                  : ''
              }`}
            >
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Purchases
              </p>
              <p className="text-xl font-black mt-1 text-blue-400">
                {formatPeso(totalPurchase)}
              </p>
              <div className="mt-2 space-y-0.5 text-[11px] font-medium">
                <div className="flex justify-between">
                  <span className="text-blue-400">Generic</span>
                  <span>{formatPeso(genericPurchase)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-purple-400">Branded</span>
                  <span>{formatPeso(brandedPurchase)}</span>
                </div>
              </div>
            </div>
            <div className="bg-slate-900 rounded-2xl p-4 border border-white/10 col-span-2">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                {liveInventoryValue !== undefined
                  ? 'Expected Inventory Value'
                  : 'Expected Change in Inventory Value'}
              </p>
              <p className="text-xl font-black mt-1">
                {formatPeso(expectedStockValue)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">
                {liveInventoryValue !== undefined
                  ? startingInventoryValue
                    ? 'Starting Value + Purchases − Cost of Sales'
                    : 'Purchases − Cost of Sales (no starting value set)'
                  : 'Negative is normal here — it just means more sold from existing stock than was purchased this period'}
              </p>
            </div>
            <div
              onClick={onAdjustmentsClick}
              role={onAdjustmentsClick ? 'button' : undefined}
              className={`bg-slate-900 rounded-2xl p-4 border ${
                onAdjustmentsClick
                  ? 'border-amber-400/40 cursor-pointer hover:border-amber-400 active:border-amber-400 transition-colors'
                  : 'border-white/10'
              }`}
            >
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Adjustments
              </p>
              <p className="text-xl font-black mt-1 text-amber-400">
                {formatPeso(adjustments)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">
                Auditor's correction
              </p>
              {/* Hover styling never shows on a touchscreen, so say it outright */}
              {onAdjustmentsClick && (
                <p className="text-[10px] font-bold text-amber-400 mt-1">
                  Tap to see which items ›
                </p>
              )}
            </div>
            <div className="bg-slate-900 rounded-2xl p-4 border border-white/10">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                {liveInventoryValue !== undefined
                  ? 'Actual Inventory Value'
                  : 'Actual Change in Inventory Value'}
              </p>
              <p className="text-xl font-black mt-1">
                {formatPeso(actualStockValue)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">
                {liveInventoryValue !== undefined
                  ? 'Live — straight from inventory'
                  : 'Expected + Adjustments'}
              </p>
            </div>
            <div
              className={`col-span-2 rounded-2xl p-4 border ${
                stockDifference >= 0
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-red-500/10 border-red-500/30'
              }`}
            >
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                Stock Difference — Actual vs. Expected
              </p>
              <p
                className={`text-2xl font-black mt-1 ${
                  stockDifference >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {stockDifference >= 0 ? '+' : ''}
                {formatPeso(stockDifference)}
              </p>
              {stockDifferenceMismatch && (
                <p className="text-[10px] text-amber-400 mt-1">
                  ⚠ Doesn't match Adjustments ({formatPeso(adjustments)}) —
                  Cost of Sales or buy_cost data is likely off.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ===== FINAL CALCULATION ===== */}
      <div className="mt-6 bg-slate-900 rounded-3xl p-6 border border-red-400/30">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-slate-300">
          <span>Cash Excess {formatPeso(cashExcess)}</span>
          <span className="text-slate-500">+</span>
          {onAdjustmentsClick ? (
            <button
              type="button"
              onClick={onAdjustmentsClick}
              className="underline decoration-dotted decoration-amber-400/70 underline-offset-4 hover:text-white"
            >
              Adjustments {formatPeso(adjustments)} ›
            </button>
          ) : (
            <span>Adjustments {formatPeso(adjustments)}</span>
          )}
          <span className="text-slate-500">=</span>
          <span>Net {formatPeso(netExcess)}</span>
        </div>
        <div className="flex items-end justify-between mt-4 gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">
              Charge to Staff
            </p>
            <p className="text-3xl font-black mt-1 text-red-400">
              {formatPeso(chargeToStaff)}
            </p>
          </div>
          {staff && staff.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-end">
              {staff.map((s: any, idx: number) => (
                <span
                  key={s.id ?? idx}
                  className="text-[10px] bg-red-500/10 text-red-400 px-2 py-px rounded-lg"
                >
                  {s.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== EXPLANATION ===== */}
      <div className="mt-4 bg-slate-900/50 rounded-2xl p-5 border border-white/5">
        <p className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">
          How this is calculated
        </p>
        <p className="text-sm text-slate-400 leading-relaxed">
          <span className="text-slate-300 font-medium">Cash</span> compares
          what should've been collected — Expected Cash, which is Sales minus
          Expenses minus Savings — against what was actually turned in. The
          gap is the Cash Excess.{' '}
          <span className="text-slate-300 font-medium">Stock</span> compares
          what the shelves should be worth from purchases and sales alone
          (Expected Inventory Value) against what they're worth after the
          auditor's correction (Actual Inventory Value). That gap is the
          Stock Difference, and it always equals the Adjustments entered — a
          separate number wouldn't show anything new, only the same thing
          restated. A Cash Excess can cover part or all of a Stock
          Difference — that pattern usually means an item was sold but never
          logged, with the cash still handed in. Whatever the Stock
          Difference the Cash Excess can't cover is what gets charged to
          staff.
        </p>
      </div>
    </div>
  );
};

export default function WeeklyReport() {
  const router = useRouter();
  const [selectedBranch, setSelectedBranch] = useState<any>(null);

  // Theme preference: mirrors profiles.theme (same source/cache key as the
  // other pages). Defaults to 'dark' until loaded, and stays 'dark' if the
  // column is null/unset. No toggle control here. This file's existing
  // profile query only selects 'owner' and doesn't keep the user id in
  // state, so this is fully self-contained, including its own getUser call.
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [themeReady, setThemeReady] = useState(false);
  useLayoutEffect(() => {
    const cached = localStorage.getItem('staffhub_theme');
    if (cached === 'light' || cached === 'dark') {
      setTheme(cached);
    }
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => setThemeReady(true));
    });
    return () => cancelAnimationFrame(raf1);
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from('profiles')
        .select('theme')
        .eq('id', user.id)
        .single();
      if (!cancelled) {
        const resolved = data?.theme === 'light' ? 'light' : 'dark';
        setTheme(resolved);
        localStorage.setItem('staffhub_theme', resolved);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
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
    costOfSales: 0,
    liveInventoryValue: 0,
    startingInventoryValue: 0,
    expectedCash: 0,
    actualRemitted: 0,
    cashVariance: 0,
    expenses: 0,
    savings: 0,
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
  const [adjustmentsModalSubtitle, setAdjustmentsModalSubtitle] = useState('');
  // The number on the card that was tapped, so the popup can say so if its
  // list doesn't add up to it. null = nothing to compare against.
  const [adjustmentsCardTotal, setAdjustmentsCardTotal] = useState<
    number | null
  >(null);
  // The list is drawn 100 rows at a time: "All Adjustments" can run to
  // thousands of rows, and drawing them all at once freezes a tablet for
  // many seconds — which looks exactly like the tap did nothing. The totals
  // at the top are always computed from every entry, not just the rows shown.
  const [adjustmentsVisibleCount, setAdjustmentsVisibleCount] = useState(100);
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
      branchSettingsRes,
    ] = await Promise.all([
      fetchAll('inventory', 'id, item_name, stock, branch_id, buy_cost'),
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
          'report_date, generic_sales, branded_sales, discount_total, total_sales, actual_cash, expenses, savings, actual_remitted, notes, reported_by, is_checked'
        )
        .eq('branch_id', selectedBranch.id)
        .gte('report_date', firstDateStr)
        .lt('report_date', endStr),
      supabase
        .from('branch_settings')
        .select('starting_inventory_value')
        .eq('branch_id', selectedBranch.id)
        .maybeSingle(),
    ]);

    const startingInventoryValue =
      branchSettingsRes.data?.starting_inventory_value || 0;

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

    // Cost basis for stock-value reconciliation: purchases are already
    // cost (paid to suppliers), so sales need to be valued the same way —
    // quantity sold × that item's buy_cost — not at selling price/revenue.
    // Uses each item's CURRENT buy_cost, since there's no per-sale cost
    // history stored; if costs changed over time, or an item was later
    // removed from inventory, this will be an approximation for older
    // sales rather than exact.
    const buyCostByItem = new Map<string, number>();
    branchInventory.forEach((item: any) => {
      buyCostByItem.set(item.id, item.buy_cost || 0);
    });

    // Actual Inventory Value, read straight from the live inventory table —
    // stock × buy_cost, right now. `stock` is the real on-hand column in
    // this schema (not `stock_quantity`). Deliberately NOT derived from
    // Purchases/Cost of Sales/Adjustments: it doesn't depend on
    // order_items matching or on Cost of Sales being correct, so it stays
    // trustworthy even while those have bugs. This is a snapshot ("what's
    // on the shelf today"), not a period flow, so it's the same number
    // regardless of date range — used for the Overall panel only.
    const liveInventoryValue = branchInventory.reduce(
      (sum: number, item: any) =>
        sum + (item.stock || 0) * (item.buy_cost || 0),
      0
    );
    const itemsMissingBuyCost = branchInventory.filter(
      (item: any) => (item.stock || 0) > 0 && !item.buy_cost
    ).length;
    if (itemsMissingBuyCost > 0) {
      console.warn(
        `${itemsMissingBuyCost} in-stock item(s) have no buy_cost set — ` +
          'Actual Inventory Value is undercounting them.'
      );
    }

    const costOfSales = salesData.reduce((sum: number, s: any) => {
      const cost = buyCostByItem.get(s.product_id) || 0;
      return sum + (s.quantity || 0) * cost;
    }, 0);

    if (costOfSales === 0) {
      if (salesData.length === 0) {
        console.warn(
          "Cost of Sales is 0: no order_items rows matched this branch's " +
            'inventory for this period. Check whether order_items is being ' +
            'populated alongside orders.'
        );
      } else {
        const withCost = salesData.filter(
          (s: any) => (buyCostByItem.get(s.product_id) || 0) > 0
        ).length;
        console.warn(
          `Cost of Sales is 0 despite ${salesData.length} sale line items. ` +
            `Only ${withCost} of them are for items with a buy_cost > 0 in ` +
            "inventory — buy_cost likely isn't populated on most items."
        );
      }
    }

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
    const savings =
      remittanceRes.data?.reduce(
        (sum: number, r: any) => sum + (r.savings || 0),
        0
      ) || 0;

    const cashVariance =
      actualRemitted - reportedTotalSales + expenses + savings;

    const totalAdjustmentsValue = adjustments.reduce((sum: number, a: any) => {
      const qty = a.quantity || 0;
      const price = a.unit_price || 0;
      return sum + qty * price;
    }, 0);

    const freshSummary = {
      totalSales: reportedTotalSales,
      genericSales,
      brandedSales,
      discountSales,
      totalPurchase,
      genericPurchase,
      brandedPurchase,
      totalAdjustmentsValue,
      costOfSales,
      liveInventoryValue,
      startingInventoryValue,
      expectedCash: reportedTotalSales - expenses - savings,
      actualRemitted,
      cashVariance,
      expenses,
      savings,
    };
    setOverallSummary(freshSummary);

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
        const actual = item.stock || 0;
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

    const freshRawData = {
      branchInventory,
      purchaseData,
      salesData,
      adjustments,
      ordersFull: ordersRes.data || [],
      purchaseOrdersFull: purchaseRes.data || [],
      remittanceFullData: remittanceRes.data || [],
      firstDateStr,
      todayStr,
    };
    setRawData(freshRawData);

    setLoading(false);

    // Returned so callers that need this instant's true numbers (like
    // saveCurrentIteration) don't have to rely on React state, which
    // only reflects whatever was loaded as of the last render.
    return { summary: freshSummary, rawData: freshRawData };
  };

  const saveCurrentIteration = async () => {
    if (!selectedBranch?.id || !rawData) return;

    // Pull fresh numbers before saving, rather than trusting whatever was
    // already loaded in this tab — otherwise a daily report or adjustment
    // entered after the page was last loaded (here or in another tab)
    // gets silently missed and locked into the saved iteration forever.
    const fresh = await fetchWeeklyReport();
    if (!fresh) return;
    // NOTE: not named `rawData` — that would shadow the state variable the
    // guard on the first line of this function reads, and reading a `const`
    // before its declaration line throws, which silently killed the Save button.
    const { summary: overallSummary, rawData: freshRawData } = fresh;

    const { data: freshIterationsData } = await supabase
      .from('weekly_iterations')
      .select('*')
      .eq('branch_id', selectedBranch.id)
      .order('iteration_number', { ascending: false });
    const iterations = freshIterationsData || [];
    const nextIterationNumber = calculateNextIterationNumber(iterations);

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
    const currentCostOfSales = overallSummary.costOfSales - saved.costOfSales;
    const currentExpenses = overallSummary.expenses - saved.expenses;
    const currentSavings = overallSummary.savings - saved.savings;
    const currentActualRemitted =
      overallSummary.actualRemitted - saved.actualRemitted;
    const currentCashVariance =
      overallSummary.cashVariance - saved.cashVariance;
    const currentExpectedCash = currentSales - currentExpenses - currentSavings;

    // Charge to Staff = Cash Variance netted against Adjustments (both
    // unit_price basis) — see getChargeToStaff. A cash surplus from an
    // unlogged sale offsets the stock it explains; what's left uncovered
    // is what's actually charged.
    const currentChargeToStaff = getChargeToStaff(
      currentCashVariance,
      currentAdjustments
    );

    // === Date logic (already fixed) ===
    let currentStartDate = freshRawData.firstDateStr;
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
      cost_of_sales: currentCostOfSales,
      expenses: currentExpenses,
      actual_remitted: currentActualRemitted,
      cash_variance: currentCashVariance,
      expected_cash: currentExpectedCash,
      daily_savings_total: currentSavings,

      stock_variance: 0,
      charge_to_staff: currentChargeToStaff,
      savings_per_day: 0,

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

  // One-time (or occasional) action: back out what this branch's inventory
  // must have been worth before this app started tracking it, so Overall's
  // Expected Inventory Value accounts for stock that was already on the
  // shelf. Deliberately NOT recalculated automatically — locking it in
  // once, rather than every page load, is what keeps Expected vs Actual
  // able to catch future problems instead of always trivially matching.
  const setStartingInventoryValue = async () => {
    if (!selectedBranch?.id) return;

    const computed =
      overallSummary.liveInventoryValue -
      overallSummary.totalPurchase +
      overallSummary.costOfSales -
      overallSummary.totalAdjustmentsValue;

    const confirmed = window.confirm(
      `This locks in ${formatCurrency(computed)} as ${selectedBranch.name || 'this branch'}'s starting inventory value, ` +
        "calculated from today's live inventory minus everything ever purchased, sold, and adjusted through this app.\n\n" +
        "Only do this once buy_cost is filled in for your items — otherwise today's gaps get baked in permanently. Continue?"
    );
    if (!confirmed) return;

    const { error } = await supabase.from('branch_settings').upsert(
      {
        branch_id: selectedBranch.id,
        starting_inventory_value: computed,
        starting_inventory_value_set_at: new Date().toISOString(),
      },
      { onConflict: 'branch_id' }
    );

    if (error) {
      console.error(error);
      alert('❌ Failed to set starting inventory value');
      return;
    }

    alert(`✅ Starting inventory value set to ${formatCurrency(computed)}`);
    fetchWeeklyReport();
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

      const actualEndingStock = item.stock || 0;
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

  // Opens the Adjustments details popup. A period filters by each entry's own
  // date — the literal YYYY-MM-DD at the start of created_date_pht, the same
  // date the rest of this page compares against — so there's no UTC shifting
  // and no dependence on how a browser parses timestamp strings (Safari is
  // picky). `opts.cardTotal` is the number on the card that was tapped, so
  // the popup can flag it if its list doesn't add up to that number.
  const openAdjustmentsModal = (
    period: { start: string; end: string } | null,
    title: string,
    opts?: { subtitle?: string; cardTotal?: number }
  ) => {
    const raw = rawData;
    if (!raw) return;
    let filtered = raw.adjustments || [];
    if (period) {
      const periodStart = String(period.start || '').slice(0, 10);
      const periodEnd = String(period.end || '').slice(0, 10);
      filtered = filtered.filter((a: any) => {
        const dateStr = String(a.created_date_pht || '').slice(0, 10);
        return dateStr >= periodStart && dateStr <= periodEnd;
      });
    }
    setAdjustmentsList(filtered);
    setAdjustmentsModalTitle(title);
    setAdjustmentsModalSubtitle(opts?.subtitle || '');
    setAdjustmentsCardTotal(opts?.cardTotal ?? null);
    setAdjustmentsVisibleCount(100);
    setShowAdjustmentsModal(true);
  };

  const formatCurrency = (amount: number) =>
    `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

  // Same date style as the Period column in the Iterations table.
  const formatShortDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  // First day of the current open period: the day after the latest saved
  // iteration ended (or the very first transaction when none are saved yet).
  // Same rule the responsible-staff lookup above uses.
  const getCurrentPeriodStart = () => {
    if (iterations.length > 0) {
      const lastEnd = new Date(iterations[0].end_date);
      lastEnd.setDate(lastEnd.getDate() + 1);
      return lastEnd.toISOString().split('T')[0];
    }
    return rawData?.firstDateStr || '2020-01-01';
  };

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
        costOfSales: 0,
        expenses: 0,
        savings: 0,
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
      costOfSales: iters.reduce((sum, i) => sum + (i.cost_of_sales || 0), 0),
      expenses: iters.reduce((sum, i) => sum + (i.expenses || 0), 0),
      savings: iters.reduce((sum, i) => sum + (i.daily_savings_total || 0), 0),
      actualRemitted: iters.reduce(
        (sum, i) => sum + (i.actual_remitted || 0),
        0
      ),
      cashVariance: iters.reduce((sum, i) => sum + (i.cash_variance || 0), 0),
    };
  };

  const getIterationDays = (iteration: any) => {
    if (!iteration?.start_date || !iteration?.end_date) return 0;
    const start = new Date(iteration.start_date).getTime();
    const end = new Date(iteration.end_date).getTime();
    return Math.max(1, Math.round((end - start) / 86400000) + 1);
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
      <div
        data-theme={theme}
        data-theme-loading={themeReady ? 'false' : 'true'}
        className="min-h-screen bg-slate-950 flex items-center justify-center"
      >
        <style dangerouslySetInnerHTML={{ __html: THEME_OVERRIDES }} />
        <RefreshCw className="animate-spin text-emerald-400 mr-3" size={24} />
        LOADING WEEKLY REPORT...
      </div>
    );
  }

  return (
    <div
      data-theme={theme}
      data-theme-loading={themeReady ? 'false' : 'true'}
      className="min-h-screen bg-slate-950 text-white pb-20"
    >
      <style dangerouslySetInnerHTML={{ __html: THEME_OVERRIDES }} />
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

      {isOwner && (
        <ReconciliationPanel
          title="OVERALL RECONCILIATION"
          totalSales={overallSummary.totalSales}
          genericSales={overallSummary.genericSales}
          brandedSales={overallSummary.brandedSales}
          discountSales={overallSummary.discountSales}
          expenses={overallSummary.expenses}
          savings={overallSummary.savings}
          actualRemitted={overallSummary.actualRemitted}
          totalPurchase={overallSummary.totalPurchase}
          genericPurchase={overallSummary.genericPurchase}
          brandedPurchase={overallSummary.brandedPurchase}
          costOfSales={overallSummary.costOfSales}
          adjustments={overallSummary.totalAdjustmentsValue}
          liveInventoryValue={overallSummary.liveInventoryValue}
          startingInventoryValue={overallSummary.startingInventoryValue}
          onSetStartingValueClick={setStartingInventoryValue}
          onSalesClick={() => {
            setModalPeriod(null);
            setShowBreakdown('sales');
            setModalView('daily');
          }}
          onPurchaseClick={() => {
            setModalPeriod(null);
            setShowBreakdown('purchase');
            setModalView('daily');
          }}
          onRemittanceClick={() => {
            setModalPeriod(null);
            setShowRemittance(true);
          }}
          onAdjustmentsClick={() =>
            openAdjustmentsModal(null, 'All Adjustments')
          }
        />
      )}

      {/* CURRENT OPEN PERIOD - Grand Total minus total of all saved iterations */}
      <ReconciliationPanel
        title="CURRENT OPEN PERIOD (UNRECONCILED)"
        subtitle="Grand Total − Sum of all saved iterations • What to charge staff now"
        totalSales={
          overallSummary.totalSales - getSavedTotals(iterations).totalSales
        }
        genericSales={
          overallSummary.genericSales - getSavedTotals(iterations).genericSales
        }
        brandedSales={
          overallSummary.brandedSales - getSavedTotals(iterations).brandedSales
        }
        discountSales={
          overallSummary.discountSales -
          getSavedTotals(iterations).discountSales
        }
        expenses={
          overallSummary.expenses - getSavedTotals(iterations).expenses
        }
        savings={overallSummary.savings - getSavedTotals(iterations).savings}
        actualRemitted={
          overallSummary.actualRemitted -
          getSavedTotals(iterations).actualRemitted
        }
        totalPurchase={
          overallSummary.totalPurchase -
          getSavedTotals(iterations).totalPurchase
        }
        genericPurchase={
          overallSummary.genericPurchase -
          getSavedTotals(iterations).genericPurchase
        }
        brandedPurchase={
          overallSummary.brandedPurchase -
          getSavedTotals(iterations).brandedPurchase
        }
        costOfSales={
          overallSummary.costOfSales - getSavedTotals(iterations).costOfSales
        }
        adjustments={
          overallSummary.totalAdjustmentsValue -
          getSavedTotals(iterations).totalAdjustmentsValue
        }
        staff={currentResponsibleStaff}
        onAdjustmentsClick={() =>
          openAdjustmentsModal(
            // Open-ended: nothing can be dated after "now", and a far-off end
            // keeps an entry made early this morning from being cut off by
            // the UTC-vs-Manila date difference.
            { start: getCurrentPeriodStart(), end: '9999-12-31' },
            'Current Period — Adjustments',
            {
              subtitle: `${formatShortDate(getCurrentPeriodStart())} – today`,
              cardTotal:
                overallSummary.totalAdjustmentsValue -
                getSavedTotals(iterations).totalAdjustmentsValue,
            }
          )
        }
      />
      <div className="max-w-7xl mx-auto px-6 mt-10">
        <div className="flex items-center justify-between mb-1 px-1">
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
        <p className="text-[11px] text-slate-500 mb-4 px-1">
          Expected/Actual Stock are each iteration's own change, not a
          running balance — negative is normal and just means more sold from
          existing stock than was purchased that stretch.
        </p>

        <div className="bg-slate-900 rounded-3xl overflow-x-auto border border-white/10">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-950 text-xs font-black uppercase text-slate-400">
                <th className="text-left p-5">Iteration</th>
                <th className="text-left p-5">Period</th>
                <th className="text-right p-5">Days</th>
                <th className="text-right p-5">Sales</th>
                <th className="text-right p-5">Purchase</th>
                <th className="text-right p-5">Adj. / Stock Diff</th>
                <th className="text-right p-5">Expected Stock</th>
                <th className="text-right p-5">Actual Stock</th>
                <th className="text-right p-5">Savings</th>
                <th className="text-right p-5">Cash Var</th>
                <th className="text-right p-5">Excess</th>
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
                  <td className="p-5 text-right font-mono text-slate-400">
                    {getIterationDays(iter)}
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
                  {(() => {
                    const breakdown = getStockValueBreakdown(
                      iter.total_purchase || 0,
                      iter.cost_of_sales || 0,
                      iter.total_adjustments_value || 0
                    );
                    const chargeToStaff = getChargeToStaff(
                      iter.cash_variance || 0,
                      iter.total_adjustments_value || 0
                    );
                    return (
                      <>
                        <td className="p-5 text-right font-mono">
                          {formatCurrency(breakdown.expectedStockValue)}
                        </td>
                        <td className="p-5 text-right font-mono">
                          {formatCurrency(breakdown.actualStockValue)}
                        </td>
                        <td className="p-5 text-right font-mono text-emerald-400">
                          {formatCurrency(iter.daily_savings_total || 0)}
                        </td>
                        <td className="p-5 text-right font-mono">
                          {(iter.cash_variance || 0) >= 0 ? '+' : ''}
                          {formatCurrency(iter.cash_variance || 0)}
                        </td>
                        <td className="p-5 text-right font-mono">
                          {breakdown.difference + (iter.cash_variance || 0) >=
                          0
                            ? '+'
                            : ''}
                          {formatCurrency(
                            breakdown.difference + (iter.cash_variance || 0)
                          )}
                        </td>

                        {/* CHARGE TO STAFF + RESPONSIBLE STAFF NAMES */}
                        <td className="p-5 text-right">
                          <div className="font-mono font-black text-red-400">
                            {formatCurrency(chargeToStaff)}
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
                      </>
                    );
                  })()}

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
                const grossTotalSales = filteredData.reduce(
                  (sum: number, r: any) =>
                    sum + (r.generic_sales || 0) + (r.branded_sales || 0),
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
                const totalSavings = filteredData.reduce(
                  (sum: number, r: any) => sum + (r.savings || 0),
                  0
                );

                const totalExcess =
                  totalActualCash -
                  netTotalSales +
                  totalExpenses +
                  totalSavings;

                const remittedRows = filteredData.filter(
                  (r: any) =>
                    r.actual_remitted !== null &&
                    r.actual_remitted !== undefined
                );
                const totalActualRemitted = remittedRows.reduce(
                  (sum: number, r: any) => sum + (r.actual_remitted || 0),
                  0
                );
                const totalActualCashRemitted = remittedRows.reduce(
                  (sum: number, r: any) => sum + (r.actual_cash || 0),
                  0
                );
                const totalDiff = totalActualRemitted - totalActualCashRemitted;
                const remittedCoverage = `${remittedRows.length}/${filteredData.length} days confirmed`;

                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
                    <div>
                      <p className="text-xs font-black uppercase text-slate-400">
                        Total Sales (Gross)
                      </p>
                      <p className="text-3xl font-black text-emerald-400">
                        {formatCurrency(grossTotalSales)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase text-slate-400">
                        Expenses
                      </p>
                      <p className="text-3xl font-black text-orange-400">
                        {formatCurrency(totalExpenses)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase text-slate-400">
                        Savings
                      </p>
                      <p className="text-3xl font-black text-sky-400">
                        {formatCurrency(totalSavings)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase text-slate-400">
                        Expected Cash
                      </p>
                      <p className="text-3xl font-black text-amber-400">
                        {formatCurrency(
                          netTotalSales - totalExpenses - totalSavings
                        )}
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
                        Actual Remitted
                      </p>
                      <p className="text-3xl font-black text-white">
                        {formatCurrency(totalActualRemitted)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase text-slate-400">
                        Diff
                      </p>
                      <p
                        className={`text-3xl font-black ${
                          Math.abs(totalDiff) < 0.01
                            ? 'text-emerald-400'
                            : 'text-red-400'
                        }`}
                      >
                        {totalDiff >= 0 ? '+' : ''}
                        {formatCurrency(totalDiff)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1 normal-case">
                        {remittedCoverage}
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
                    <th className="text-right p-3">Generic Sales (Gross)</th>
                    <th className="text-right p-3">Branded Sales (Gross)</th>
                    <th className="text-right p-3">Discount</th>
                    <th className="text-right p-3">Total Sales (Net)</th>
                    <th className="text-right p-3">Expenses</th>
                    <th className="text-right p-3">Savings</th>
                    <th className="text-right p-3">Expected Cash</th>
                    <th className="text-right p-3">Actual Cash</th>
                    <th className="text-right p-3">Cash Excess / Shortage</th>
                    <th className="text-right p-3">Actual Remitted</th>
                    <th className="text-right p-3">Diff</th>
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
                      const expectedCash =
                        (row.total_sales || 0) -
                        (row.expenses || 0) -
                        (row.savings || 0);
                      const excess =
                        (row.actual_cash || 0) -
                        (row.total_sales || 0) +
                        (row.expenses || 0) +
                        (row.savings || 0);
                      const hasRemitted =
                        row.actual_remitted !== null &&
                        row.actual_remitted !== undefined;
                      const diff = hasRemitted
                        ? (row.actual_remitted || 0) - (row.actual_cash || 0)
                        : null;

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
                            {formatCurrency(row.expenses || 0)}
                          </td>
                          <td className="p-3 text-right text-sky-400">
                            {formatCurrency(row.savings || 0)}
                          </td>
                          <td className="p-3 text-right text-amber-400">
                            {formatCurrency(expectedCash)}
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
                            {hasRemitted ? (
                              formatCurrency(row.actual_remitted || 0)
                            ) : (
                              <span className="text-slate-600">–</span>
                            )}
                          </td>
                          <td
                            className={`p-3 text-right font-medium ${
                              !hasRemitted
                                ? 'text-slate-600'
                                : Math.abs(diff as number) < 0.01
                                ? 'text-emerald-400'
                                : 'text-red-400'
                            }`}
                          >
                            {hasRemitted ? (
                              <>
                                {(diff as number) >= 0 ? '+' : ''}
                                {formatCurrency(diff as number)}
                              </>
                            ) : (
                              '–'
                            )}
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
      {/* z-[150]: sits above the iteration popup (z-[140]) so it can open from inside it */}
      {showAdjustmentsModal && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-[150]"
          onClick={() => setShowAdjustmentsModal(false)}
        >
          <div
            className="bg-slate-900 rounded-3xl max-w-7xl w-full mx-4 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-white/10 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-black uppercase">
                  {adjustmentsModalTitle}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {adjustmentsModalSubtitle
                    ? `${adjustmentsModalSubtitle} · `
                    : ''}
                  {adjustmentsList.length}{' '}
                  {adjustmentsList.length === 1 ? 'entry' : 'entries'}
                </p>
              </div>
              <button
                onClick={() => setShowAdjustmentsModal(false)}
                className="text-slate-400 hover:text-white text-3xl"
              >
                ✕
              </button>
            </div>

            {/* One scroll area for the summary AND the list, so on a short
                screen the summary scrolls away instead of squeezing the
                list down to a row or two */}
            <div className="flex-1 overflow-auto">
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
                // Does this list add up to the card that was tapped?
                const cardMismatch =
                  adjustmentsCardTotal !== null &&
                  Math.abs(netValue - adjustmentsCardTotal) > 0.5;

                return (
                  <div className="space-y-6">
                    {/* NET TOTAL - the same number as the Adjustments card,
                        and the one Charge to Staff actually uses */}
                    <div className="text-center">
                      <p className="text-amber-400 text-xs font-black uppercase tracking-widest">
                        Net Adjustment Value
                      </p>
                      <p
                        className={`text-4xl font-black mt-1 ${
                          netValue >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {netValue >= 0 ? '+' : ''}
                        {formatCurrency(netValue)}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Same number as the Adjustments card — this is what goes
                        into Charge to Staff
                      </p>
                      {cardMismatch && adjustmentsCardTotal !== null && (
                        <p className="text-xs text-amber-400 mt-2">
                          ⚠ The card shows {formatCurrency(adjustmentsCardTotal)}
                          , but the entries below add up to{' '}
                          {formatCurrency(netValue)}. That usually means an
                          adjustment was added or edited after a period was
                          saved, or it's dated on the day one period ends and
                          the next begins.
                        </p>
                      )}
                    </div>

                    {/* Positive / Negative / Gross */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-6 text-center">
                      <div className="bg-emerald-500/10 rounded-2xl p-4">
                        <p className="text-emerald-400 text-xs font-black uppercase tracking-widest">
                          Positive Adj. Value
                        </p>
                        <p className="text-3xl font-black text-emerald-400 mt-1">
                          +{formatCurrency(positiveValue)}
                        </p>
                      </div>
                      <div className="bg-red-500/10 rounded-2xl p-4">
                        <p className="text-red-400 text-xs font-black uppercase tracking-widest">
                          Negative Adj. Value
                        </p>
                        <p className="text-3xl font-black text-red-400 mt-1">
                          -{formatCurrency(negativeValue)}
                        </p>
                      </div>
                      <div className="rounded-2xl p-4 bg-slate-800">
                        <p className="text-slate-400 text-xs font-black uppercase tracking-widest">
                          Gross Adj. Value
                        </p>
                        <p className="text-3xl font-black text-amber-400 mt-1">
                          {formatCurrency(grossValue)}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-1">
                          Total movement, before netting
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
            {/* DEBUG INFO (you can remove this later) */}

            <div className="p-6">
              <table className="w-full text-sm">
                <thead className="bg-slate-950 sticky top-0">
                  <tr className="text-xs font-black uppercase text-slate-400">
                    <th className="text-left p-4">Item Name</th>
                    <th className="text-right p-4">Adj. Value</th>
                    <th className="text-right p-4">Unit Price</th>
                    <th className="text-right p-4">Buy Cost</th>
                    <th className="text-right p-4">Total Selling</th>
                    <th className="text-right p-4">Total Buy Cost</th>
                    <th className="text-left p-4">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {[...adjustmentsList]
                    // newest first, so the latest entries are on top
                    .sort((a: any, b: any) =>
                      String(b.created_date_pht || '').localeCompare(
                        String(a.created_date_pht || '')
                      )
                    )
                    .slice(0, adjustmentsVisibleCount)
                    .map((adj: any, i: number) => {
                    const qty = adj.quantity || 0;
                    const unitPrice = adj.unit_price || 0;
                    const buyCost = adj.buy_cost || 0;
                    const adjValue = qty * unitPrice; // ← NEW: monetary value
                    const item = adj.inventory || {};
                    const entryDate = String(adj.created_date_pht || '').slice(
                      0,
                      10
                    );
                    return (
                      <tr key={adj.id ?? i} className="hover:bg-white/5">
                        <td className="p-4 font-medium">
                          {item.item_name || 'Deleted / Unknown Item'}
                          <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                            {entryDate ? formatShortDate(entryDate) : 'No date'}
                            {' · '}Qty {qty > 0 ? '+' : ''}
                            {qty}
                          </div>
                        </td>
                        <td
                          className={`p-4 text-right whitespace-nowrap font-mono font-semibold text-lg ${
                            adjValue >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {adjValue >= 0 ? '+' : ''}
                          {formatCurrency(adjValue)}
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
              {adjustmentsList.length > adjustmentsVisibleCount && (
                <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    Showing the latest{' '}
                    {adjustmentsVisibleCount.toLocaleString('en-US')} of{' '}
                    {adjustmentsList.length.toLocaleString('en-US')} entries —
                    the totals above already include all of them
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAdjustmentsVisibleCount((c) => c + 100)}
                      className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-black uppercase"
                    >
                      Show 100 more
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setAdjustmentsVisibleCount(adjustmentsList.length)
                      }
                      className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-black uppercase"
                    >
                      Show all
                    </button>
                  </div>
                </div>
              )}
            </div>
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
            className="bg-slate-900 rounded-3xl max-w-6xl w-full mx-4 max-h-[90vh] flex flex-col overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-white/10 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-black uppercase">
                  {selectedIteration.label}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {getIterationDays(selectedIteration)} day
                  {getIterationDays(selectedIteration) === 1 ? '' : 's'}
                </p>
              </div>
              <button
                onClick={closeIterationModal}
                className="text-slate-400 hover:text-white text-3xl"
              >
                ✕
              </button>
            </div>

            <div className="p-8">
              {(() => {
                const totalSales = selectedIteration.total_sales || 0;
                const expenses = selectedIteration.expenses || 0;
                const savings = selectedIteration.daily_savings_total || 0;
                const expectedCash = totalSales - expenses - savings;
                const actualRemitted = selectedIteration.actual_remitted || 0;
                const cashExcess = actualRemitted - expectedCash;

                const totalPurchase = selectedIteration.total_purchase || 0;
                const adjustments =
                  selectedIteration.total_adjustments_value || 0;
                const breakdown = getStockValueBreakdown(
                  totalPurchase,
                  selectedIteration.cost_of_sales || 0,
                  adjustments
                );
                const chargeToStaff = getChargeToStaff(
                  cashExcess,
                  adjustments
                );
                const netExcess = cashExcess + breakdown.difference;

                const goToRemittance = () => {
                  setShowIterationModal(false);
                  setTimeout(() => {
                    setModalPeriod({
                      start: selectedIteration.start_date,
                      end: selectedIteration.end_date,
                    });
                    setShowRemittance(true);
                  }, 150);
                };

                // Opens the item-by-item list ON TOP of this popup (the
                // details popup sits above it), so closing it lands right
                // back here instead of dropping you out to the table.
                const goToAdjustments = () =>
                  openAdjustmentsModal(
                    {
                      start: selectedIteration.start_date,
                      end: selectedIteration.end_date,
                    },
                    `Iteration ${selectedIteration.iteration_number} — Adjustments`,
                    {
                      subtitle: `${formatShortDate(
                        selectedIteration.start_date
                      )} – ${formatShortDate(selectedIteration.end_date)}`,
                      cardTotal: adjustments,
                    }
                  );

                return (
                  <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* CASH PANE */}
                      <div className="bg-black/20 rounded-3xl p-5 border border-white/10">
                        <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-4 px-1">
                          Cash
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-slate-800 rounded-2xl p-4 col-span-2">
                            <p className="text-[11px] font-black uppercase text-slate-400">
                              Total Sales
                            </p>
                            <p className="text-2xl font-black text-emerald-400 mt-1">
                              {formatCurrency(totalSales)}
                            </p>
                          </div>
                          <div className="bg-slate-800 rounded-2xl p-4">
                            <p className="text-[11px] font-black uppercase text-slate-400">
                              Expenses
                            </p>
                            <p className="text-xl font-black mt-1">
                              {formatCurrency(expenses)}
                            </p>
                          </div>
                          <div className="bg-slate-800 rounded-2xl p-4">
                            <p className="text-[11px] font-black uppercase text-slate-400">
                              Savings
                            </p>
                            <p className="text-xl font-black text-emerald-400 mt-1">
                              {formatCurrency(savings)}
                            </p>
                          </div>
                          <div
                            onClick={goToRemittance}
                            className="bg-slate-800 rounded-2xl p-4 col-span-2 cursor-pointer hover:bg-slate-700 transition-colors"
                          >
                            <p className="text-[11px] font-black uppercase text-slate-400">
                              Expected Cash
                            </p>
                            <p className="text-xl font-black text-amber-400 mt-1">
                              {formatCurrency(expectedCash)}
                            </p>
                            <p className="text-[10px] text-slate-500 mt-1">
                              Sales − Expenses − Savings
                            </p>
                          </div>
                          <div
                            onClick={goToRemittance}
                            className="bg-slate-800 rounded-2xl p-4 col-span-2 cursor-pointer hover:bg-slate-700 transition-colors"
                          >
                            <p className="text-[11px] font-black uppercase text-slate-400">
                              Actual Remitted
                            </p>
                            <p className="text-xl font-black text-emerald-400 mt-1">
                              {formatCurrency(actualRemitted)}
                            </p>
                          </div>
                          <div
                            className={`col-span-2 rounded-2xl p-4 ${
                              cashExcess >= 0
                                ? 'bg-emerald-500/10'
                                : 'bg-red-500/10'
                            }`}
                          >
                            <p className="text-[11px] font-black uppercase text-slate-400">
                              Cash Excess — Remitted vs. Expected
                            </p>
                            <p
                              className={`text-2xl font-black mt-1 ${
                                cashExcess >= 0
                                  ? 'text-emerald-400'
                                  : 'text-red-400'
                              }`}
                            >
                              {cashExcess >= 0 ? '+' : ''}
                              {formatCurrency(cashExcess)}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* STOCK PANE */}
                      <div className="bg-black/20 rounded-3xl p-5 border border-white/10">
                        <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-4 px-1">
                          Stock
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-slate-800 rounded-2xl p-4 col-span-2">
                            <p className="text-[11px] font-black uppercase text-slate-400">
                              Purchases
                            </p>
                            <p className="text-2xl font-black text-blue-400 mt-1">
                              {formatCurrency(totalPurchase)}
                            </p>
                          </div>
                          <div className="bg-slate-800 rounded-2xl p-4 col-span-2">
                            <p className="text-[11px] font-black uppercase text-slate-400">
                              Expected Change in Inventory Value
                            </p>
                            <p className="text-xl font-black mt-1">
                              {formatCurrency(breakdown.expectedStockValue)}
                            </p>
                            <p className="text-[10px] text-slate-500 mt-1">
                              Negative is normal here — it just means more
                              sold from existing stock than was purchased
                              this period
                            </p>
                          </div>
                          <div
                            onClick={goToAdjustments}
                            role="button"
                            className="bg-slate-800 rounded-2xl p-4 border border-amber-400/40 cursor-pointer hover:bg-slate-700 active:bg-slate-700 transition-colors"
                          >
                            <p className="text-[11px] font-black uppercase text-slate-400">
                              Adjustments
                            </p>
                            <p className="text-xl font-black text-amber-400 mt-1">
                              {formatCurrency(adjustments)}
                            </p>
                            <p className="text-[10px] font-bold text-amber-400 mt-1">
                              Tap to see which items ›
                            </p>
                          </div>
                          <div className="bg-slate-800 rounded-2xl p-4">
                            <p className="text-[11px] font-black uppercase text-slate-400">
                              Actual Change in Inventory Value
                            </p>
                            <p className="text-xl font-black mt-1">
                              {formatCurrency(breakdown.actualStockValue)}
                            </p>
                          </div>
                          <div
                            className={`col-span-2 rounded-2xl p-4 ${
                              breakdown.difference >= 0
                                ? 'bg-emerald-500/10'
                                : 'bg-red-500/10'
                            }`}
                          >
                            <p className="text-[11px] font-black uppercase text-slate-400">
                              Stock Difference — Actual vs. Expected
                            </p>
                            <p
                              className={`text-2xl font-black mt-1 ${
                                breakdown.difference >= 0
                                  ? 'text-emerald-400'
                                  : 'text-red-400'
                              }`}
                            >
                              {breakdown.difference >= 0 ? '+' : ''}
                              {formatCurrency(breakdown.difference)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* FINAL CALCULATION */}
                    <div className="mt-6 bg-slate-800 rounded-3xl p-6 border border-red-400/30">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-slate-300">
                        <span>Cash Excess {formatCurrency(cashExcess)}</span>
                        <span className="text-slate-500">+</span>
                        <span>
                          Stock Difference{' '}
                          {formatCurrency(breakdown.difference)}
                        </span>
                        <span className="text-slate-500">=</span>
                        <span>Net {formatCurrency(netExcess)}</span>
                      </div>
                      <p className="text-xs font-black uppercase tracking-widest text-slate-400 mt-4">
                        Charge to Staff
                      </p>
                      <p className="text-3xl font-black text-red-400 mt-1">
                        {formatCurrency(chargeToStaff)}
                      </p>
                    </div>

                    {/* EXPLANATION */}
                    <div className="mt-4 bg-slate-800/50 rounded-2xl p-5 border border-white/5">
                      <p className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">
                        How this is calculated
                      </p>
                      <p className="text-sm text-slate-400 leading-relaxed">
                        <span className="text-slate-300 font-medium">
                          Cash
                        </span>{' '}
                        compares what should've been collected — Expected
                        Cash, which is Sales minus Expenses minus Savings —
                        against what was actually turned in. The gap is the
                        Cash Excess.{' '}
                        <span className="text-slate-300 font-medium">
                          Stock
                        </span>{' '}
                        compares what the shelves should be worth from
                        purchases and sales alone (Expected Inventory Value)
                        against what they're worth after the auditor's
                        correction (Actual Inventory Value). That gap is the
                        Stock Difference, and it always equals the
                        Adjustments entered. A Cash Excess can cover part or
                        all of a Stock Difference — that pattern usually
                        means an item was sold but never logged, with the
                        cash still handed in. Whatever the Stock Difference
                        the Cash Excess can't cover is what gets charged to
                        staff.
                      </p>
                    </div>

                    <p className="text-xs text-slate-600 mt-4">
                      Saved{' '}
                      {new Date(
                        selectedIteration.saved_at ||
                          selectedIteration.created_at
                      ).toLocaleString('en-US')}
                    </p>
                  </>
                );
              })()}
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
