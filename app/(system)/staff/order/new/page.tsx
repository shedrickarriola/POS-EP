'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import {
  Trash2,
  ArrowLeft,
  User as UserIcon,
  Loader2,
  Receipt,
  FileText,
  RefreshCcw,
  Lock,
  Unlock,
  CheckCircle2,
  PlusCircle,
  Home,
  Camera,
  Sparkles,
  X,
  Plus,
  AlertCircle,
  Search,
  Users,
} from 'lucide-react';

// Import the AI action from your actions file
import {
  parseInvoiceImage,
  parseInvoiceText,
} from '@/app/actions/parseInvoice';

interface Product {
  id: string;
  item_name: string;
  price_piece: number;
  buy_cost: number;
  type: string;
  stock: number;
  branch_id: string;
}

interface OrderLineItem {
  id: string;
  product_id: string;
  item_name: string;
  type: string;
  qty: number;
  stock_on_hand: number;
  price_piece: number;
  buy_cost: number;
  discount_percent: number;
  is_override: boolean;
  match_status?: 'exact' | 'fuzzy' | 'none';
  lot_number?: string;
  expiry_date?: string;
  // === OFFICE USE: Available lots from item_details ===
  lot_options?: Array<{
    lot_number: string;
    expiry_date: string;
    current_stock: number;
  }>;
  selected_lot_stock?: number;
  lot_locked?: boolean;
}

// === "Looking for Orders?" client overview row ===
interface ClientOverviewRow {
  id: string;
  client_name: string;
  agent: string;
  phone: string | null;
  owner: string | null;
  birthday: string | null;
  notes: string | null;
  // Client's allowed payment terms, in days (0 = cash/cheque only).
  allowed_terms: number | null;
  // Sum of remaining_balance across this client's orders that aren't
  // status = 'completed' yet — what they still owe.
  receivables: number;
  // Sum of remaining_balance for this client's orders that are already
  // past their due_date (a subset of `receivables`).
  overdueReceivables: number;
  // Sum of remaining_balance for orders whose due_date is today.
  dueTodayReceivables: number;
  orderCount: number;
  averageOrder: number;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  // Average days between this client's own orders (needs 2+ orders to compute)
  avgGapDays: number | null;
  // Rough estimate of order value likely missed by going quiet this long,
  // based on THEIR OWN normal pace — used to prioritize outreach by revenue.
  potentialRecovery: number;
  // Projected next-order date = last order + their own average gap.
  // Only computable with 2+ orders (needs avgGapDays).
  nextExpectedDate: string | null;
  // Negative = overdue by this many days, positive = still X days out.
  daysUntilExpected: number | null;
}

// One order that still counts toward a client's receivables total — i.e.
// its status isn't 'completed' yet. Powers the click-through breakdown on
// the Receivables column; this list always sums to that client's own
// `receivables` value, since both are derived from the same query.
interface ReceivableOrderDetail {
  id: string;
  order_number: string;
  total_amount: number;
  remaining_balance: number;
  status: string;
  created_at: string;
  due_date: string | null;
  payment_method: string | null;
}

// --- LEVENSHTEIN DISTANCE UTILITY ---
const getLevenshteinDistance = (a: string, b: string): number => {
  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, (_, i) => i)
  );
  for (let i = 1; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 1; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
};

// === MONTH/YEAR EXPIRY HELPERS (Office Use) ===
const getCurrentMonthString = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
};

const monthToLastDayDate = (monthStr: string): string => {
  if (!monthStr || !monthStr.includes('-')) return '';
  const parts = monthStr.split('-');
  if (parts.length < 2) return '';
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return '';
  const lastDay = new Date(year, month, 0).getDate();
  const mm = parts[1].padStart(2, '0');
  const dd = lastDay.toString().padStart(2, '0');
  return `${parts[0]}-${mm}-${dd}`;
};

const getMonthFromDate = (dateStr: string | undefined | null): string => {
  if (!dateStr) return '';
  return dateStr.substring(0, 7);
};

// Format stored date → "06/2026" style (MM/YYYY)
const formatMonthYear = (dateStr: string | undefined | null): string => {
  if (!dateStr) return '';
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(5, 7);
  return `${month}/${year}`;
};

// Parse MM/YYYY input with these rules:
// - No past dates (must be current month or future)
// - Upper limit = current year + 20 years (moves forward over time)
const parseMMYYYY = (input: string): { year: number; month: number } | null => {
  if (!input) return null;

  let cleaned = input.replace(/[^\d/]/g, '');
  let mm: string, yyyy: string;

  if (cleaned.includes('/')) {
    const parts = cleaned.split('/');
    if (parts.length !== 2) return null;
    mm = parts[0].padStart(2, '0');
    yyyy = parts[1];
  } else {
    if (cleaned.length !== 6) return null;
    mm = cleaned.substring(0, 2);
    yyyy = cleaned.substring(2, 6);
  }

  const monthNum = parseInt(mm, 10);
  const yearNum = parseInt(yyyy, 10);

  if (isNaN(monthNum) || isNaN(yearNum) || monthNum < 1 || monthNum > 12) {
    return null;
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  // Block past dates (anything before current month/year)
  if (
    yearNum < currentYear ||
    (yearNum === currentYear && monthNum < currentMonth)
  ) {
    return null;
  }

  // Upper bound: current year + 20 years (dynamic)
  const maxYear = currentYear + 20;
  if (yearNum > maxYear) {
    return null;
  }

  return { year: yearNum, month: monthNum };
};

const mmyyyyToFullDate = (input: string): string => {
  const parsed = parseMMYYYY(input);
  if (!parsed) return '';
  const { year, month } = parsed;
  const lastDay = new Date(year, month, 0).getDate();
  const mm = month.toString().padStart(2, '0');
  const dd = lastDay.toString().padStart(2, '0');
  return `${year}-${mm}-${dd}`;
};

// === "Looking for Orders?" HELPERS ===
// Fallback thresholds for clients with fewer than 2 orders, where we can't
// yet tell what "normal" looks like for them.
const REACH_OUT_AFTER_DAYS = 30;
const CHECK_IN_AFTER_DAYS = 14;

// Once we know a client's own average gap between orders, we compare their
// current silence to THAT instead of a flat number. 2x their normal gap =
// clearly overdue; 1.2x = starting to run late.
const REACH_OUT_RATIO = 2.0;
const CHECK_IN_RATIO = 1.2;

// Average days between a client's own orders. Needs 2+ orders — with just
// one, there's no pattern to compare against yet.
const computeAvgGapDays = (orderDates: string[]): number | null => {
  if (orderDates.length < 2) return null;
  const times = orderDates
    .map((d) => new Date(d).getTime())
    .sort((a, b) => a - b);
  let totalGapMs = 0;
  for (let i = 1; i < times.length; i++) {
    totalGapMs += times[i] - times[i - 1];
  }
  return totalGapMs / (times.length - 1) / (1000 * 60 * 60 * 24);
};

// Picks whichever cadence (weekly or monthly) reads more naturally.
// Plain-word cadence instead of a rate — "0.3x/week" is technically correct
// but nobody thinks in fractional weekly rates. Words read faster.
const describeFrequency = (avgGapDays: number | null): string => {
  if (avgGapDays === null) return 'New Client';
  if (avgGapDays < 2) return 'Daily';
  if (avgGapDays < 5) return 'A Few Times a Week';
  if (avgGapDays < 10) return 'Weekly';
  if (avgGapDays < 20) return 'Every 2 Weeks';
  if (avgGapDays < 45) return 'Monthly';
  if (avgGapDays < 100) return 'Every 2-3 Months';
  if (avgGapDays < 200) return 'A Few Times a Year';
  return 'Rarely';
};

// Rough estimate of order value likely missed by staying quiet this long,
// based on the client's own pace and average order size. Only counts the
// time BEYOND their normal gap, so it's ~0 for anyone still on schedule.
// Caps how many "missed cycles" we'll count. Without this, a client who
// orders often but small (e.g. every 2 days) and goes quiet for a month
// can rack up 15+ "missed" cycles — mathematically consistent, but not a
// believable amount of pent-up demand. Capping keeps the estimate honest.
// "Potential" is just this client's own average order — the realistic
// value of getting them to place one more, not a multiplied cycle count.
// It only counts once they're actually behind their own pace (or, for
// clients without enough history for a pace yet, past the flat fallback).
const computePotentialRecovery = (
  daysSinceLastOrder: number | null,
  avgGapDays: number | null,
  averageOrder: number
): number => {
  if (!daysSinceLastOrder || averageOrder <= 0) return 0;
  const isOverdue =
    avgGapDays && avgGapDays > 0
      ? daysSinceLastOrder > avgGapDays
      : daysSinceLastOrder > CHECK_IN_AFTER_DAYS;
  return isOverdue ? averageOrder : 0;
};

// Turns "days until their projected next order" into a plain, glanceable
// label — this is the "high chance they order soon" signal.
const describeNextExpected = (
  daysUntilExpected: number | null
): { label: string; colorClass: string } => {
  if (daysUntilExpected === null) {
    return { label: 'Not Enough Data', colorClass: 'text-slate-600' };
  }
  if (daysUntilExpected > 3) {
    return {
      label: `Due In ~${daysUntilExpected}d`,
      colorClass: 'text-slate-300',
    };
  }
  if (daysUntilExpected === 1) {
    return { label: 'Due Tomorrow', colorClass: 'text-emerald-400 font-bold' };
  }
  if (daysUntilExpected >= 0) {
    return { label: 'Due Today', colorClass: 'text-emerald-400 font-bold' };
  }
  const overdueBy = Math.abs(daysUntilExpected);
  return {
    label: `${overdueBy}d Overdue`,
    colorClass:
      overdueBy <= 7 ? 'text-amber-400 font-bold' : 'text-red-400 font-bold',
  };
};

const getClientStatus = (
  daysSinceLastOrder: number | null,
  avgGapDays: number | null
): { label: string; badgeClass: string; dotClass: string } => {
  if (daysSinceLastOrder === null) {
    return {
      label: 'No Orders Yet',
      badgeClass: 'bg-slate-600/10 text-slate-400 border-slate-500/30',
      dotClass: 'bg-slate-500',
    };
  }

  // Enough history to judge them against their own normal pace.
  if (avgGapDays && avgGapDays > 0) {
    const ratio = daysSinceLastOrder / avgGapDays;
    if (ratio > REACH_OUT_RATIO) {
      return {
        label: 'Reach Out',
        badgeClass: 'bg-red-500/10 text-red-400 border-red-500/30',
        dotClass: 'bg-red-500',
      };
    }
    if (ratio > CHECK_IN_RATIO) {
      return {
        label: 'Check In',
        badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
        dotClass: 'bg-amber-500',
      };
    }
    return {
      label: 'Active',
      badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
      dotClass: 'bg-emerald-500',
    };
  }

  // Fewer than 2 orders on file — fall back to flat day counts.
  if (daysSinceLastOrder > REACH_OUT_AFTER_DAYS) {
    return {
      label: 'Reach Out',
      badgeClass: 'bg-red-500/10 text-red-400 border-red-500/30',
      dotClass: 'bg-red-500',
    };
  }
  if (daysSinceLastOrder > CHECK_IN_AFTER_DAYS) {
    return {
      label: 'Check In',
      badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      dotClass: 'bg-amber-500',
    };
  }
  return {
    label: 'Active',
    badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    dotClass: 'bg-emerald-500',
  };
};

// Turns one order's due_date + remaining_balance into a glanceable status —
// the payment-due counterpart to describeNextExpected's "next order" one.
const describeReceivableDueStatus = (
  dueDate: string | null,
  remainingBalance: number
): {
  label: string;
  colorClass: string;
  isOverdue: boolean;
  isDueToday: boolean;
} => {
  if (remainingBalance <= 0) {
    return {
      label: 'Settled',
      colorClass: 'text-slate-500',
      isOverdue: false,
      isDueToday: false,
    };
  }
  if (!dueDate) {
    return {
      label: 'No Due Date',
      colorClass: 'text-slate-500',
      isOverdue: false,
      isDueToday: false,
    };
  }
  const todayStr = new Date().toISOString().split('T')[0];
  const due = dueDate.substring(0, 10);
  if (due < todayStr) {
    const days = Math.floor(
      (new Date(todayStr).getTime() - new Date(due).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    return {
      label: `${days}d Overdue`,
      colorClass: 'text-red-400 font-bold',
      isOverdue: true,
      isDueToday: false,
    };
  }
  if (due === todayStr) {
    return {
      label: 'Due Today',
      colorClass: 'text-amber-400 font-bold',
      isOverdue: false,
      isDueToday: true,
    };
  }
  return {
    label: 'Not Yet Due',
    colorClass: 'text-slate-400',
    isOverdue: false,
    isDueToday: false,
  };
};

// Formats a stored date/timestamp into "Jul 3, 2026"
const formatDisplayDate = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

// <input type="date"> needs an exact "YYYY-MM-DD" value or it won't populate.
const toDateInputValue = (raw: string | null): string => {
  if (!raw) return '';
  return raw.substring(0, 10);
};

// PH mobile validation: accepts 09XXXXXXXXX, +639XXXXXXXXX, or 639XXXXXXXXX.
// Spaces/dashes are stripped before testing so "0917 123 4567" still passes.
const isValidPHMobile = (input: string): boolean => {
  const trimmed = (input || '').trim();
  if (!trimmed) return false;
  const cleaned = trimmed.startsWith('+')
    ? '+' + trimmed.slice(1).replace(/\D/g, '')
    : trimmed.replace(/\D/g, '');
  return /^(0|\+63|63)9\d{9}$/.test(cleaned);
};

export default function NewOrderPOS() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showTextPaste, setShowTextPaste] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const [showPriceError, setShowPriceError] = useState(false);
  const [priceErrorMessages, setPriceErrorMessages] = useState<string[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [nextSONumber, setNextSONumber] = useState('SO01');
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  const [isOfficeUse, setIsOfficeUse] = useState(false);
  const [selectedClientTerms, setSelectedClientTerms] = useState<number>(0);
  const [agents, setAgents] = useState<{ id: string; full_name: string }[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('MAIN OFFICE');
  const [chequeDate, setChequeDate] = useState<string>('');
  const [showTermsError, setShowTermsError] = useState(false);
  const [clientName, setClientName] = useState('WALK-IN');
  const [showExpiryError, setShowExpiryError] = useState(false);
  const [invalidExpiryItems, setInvalidExpiryItems] = useState<string[]>([]);

  // === NEW: Lot Stock Error Modal ===
  const [showLotStockError, setShowLotStockError] = useState(false);
  const [lotStockErrorMessage, setLotStockErrorMessage] = useState('');
  const [officeClients, setOfficeClients] = useState<
    {
      id: string;
      client_name: string;
      allowed_terms: number;
      agent?: string;
    }[]
  >([]);
  const [showNewClientModal, setShowNewClientModal] = useState(false);

  // === CLIENT ORDERS OVERVIEW ("Looking for Orders?") ===
  const [showOrdersOverviewModal, setShowOrdersOverviewModal] = useState(false);
  const [loadingOrderStats, setLoadingOrderStats] = useState(false);
  const [clientOrderStats, setClientOrderStats] = useState<ClientOverviewRow[]>(
    []
  );
  const [receivableOrdersByClient, setReceivableOrdersByClient] = useState<
    Record<string, ReceivableOrderDetail[]>
  >({});
  // Which client's receivables breakdown is open, if any — stored as an id
  // (not a snapshot) so the modal always reflects the latest fetched data.
  const [showReceivablesDetailModal, setShowReceivablesDetailModal] =
    useState(false);
  const [selectedReceivablesClientId, setSelectedReceivablesClientId] =
    useState<string | null>(null);
  const [clientOverviewSearch, setClientOverviewSearch] = useState('');
  const [clientOverviewAgentFilter, setClientOverviewAgentFilter] =
    useState('ALL');
  const [clientOverviewSort, setClientOverviewSort] = useState<{
    key: keyof ClientOverviewRow;
    dir: 'asc' | 'desc';
  }>({ key: 'potentialRecovery', dir: 'desc' });
  // Tracks inline-edit save status per cell (key = `${clientId}-${field}`)
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [savedCell, setSavedCell] = useState<string | null>(null);
  const [errorCell, setErrorCell] = useState<{
    key: string;
    message: string;
  } | null>(null);
  // A row's Number/Owner/Birthday fields stay read-only until its lock icon
  // is clicked, so nothing gets edited by accident.
  const [unlockedClientIds, setUnlockedClientIds] = useState<Set<string>>(
    new Set()
  );
  const [newClientName, setNewClientName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<
    'CASH' | 'CHEQUE' | 'TERMS'
  >('CASH');
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [searchTerms, setSearchTerms] = useState<string[]>(['']);
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(
    null
  );

  // Raw MM/YYYY typing buffer per row (for nice auto-slash + validation)
  const [rawExpiryInputs, setRawExpiryInputs] = useState<
    Record<string, string>
  >({});

  // === DRUGSTORE-ONLY: Discount Availed client capture ===
  // When any line item on a DRUGSTORE order (isOfficeUse === false) has a
  // discount applied, the client's name + PH mobile number must be on file
  // before the order can be committed. See metrics.hasValidDiscountInfo.
  const [discountClientName, setDiscountClientName] = useState('');
  const [discountClientNumber, setDiscountClientNumber] = useState('');

  const DISCOUNT_OPTIONS = [
    { label: 'No Discount', value: 0 },
    { label: '20% Off', value: 20 },
    { label: '5+1 Promo', value: 16.666667 },
  ];

  const [items, setItems] = useState<OrderLineItem[]>([
    {
      id: crypto.randomUUID(),
      product_id: '',
      item_name: '',
      type: '',
      qty: 1,
      stock_on_hand: 0,
      price_piece: 0,
      buy_cost: 0,
      discount_percent: 0,
      is_override: false,
      match_status: 'none',
      lot_number: '',
      expiry_date: '',
    },
  ]);

  const isDrugstoreUser = user?.email === 'drugstore@gmail.com';

  const handleQtyChange = (productId: string, newQty: number) => {
    setItems(
      items.map((item) => {
        if (item.product_id === productId) {
          let currentDiscount = item.discount_percent;

          if (!isOfficeUse) {
            if (
              currentDiscount === 20 &&
              (newQty < 120 || newQty % 120 !== 0)
            ) {
              currentDiscount = 0;
            }
            if (
              currentDiscount === 16.666667 &&
              (newQty < 6 || newQty % 6 !== 0)
            ) {
              currentDiscount = 0;
            }
          }

          return { ...item, qty: newQty, discount_percent: currentDiscount };
        }
        return item;
      })
    );
  };

  // --- AI PROCESSING ---
  const processAiResults = (extracted: any) => {
    const dataToProcess = Array.isArray(extracted)
      ? extracted
      : extracted?.items || extracted?.data || [];
    if (!dataToProcess || dataToProcess.length === 0) return;

    const aiMappedItems = dataToProcess.map((aiItem: any) => {
      const rawName = (aiItem.item_name || aiItem.name || '').toString();
      const aiNameNormalized = rawName
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

      let bestMatch: Product | null = null;
      let minDistance = 999;

      products.forEach((p) => {
        const dbNameNormalized = p.item_name
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim();
        const distance = getLevenshteinDistance(
          aiNameNormalized,
          dbNameNormalized
        );
        if (distance < minDistance) {
          minDistance = distance;
          bestMatch = p;
        }
      });

      let status: 'exact' | 'fuzzy' | 'none' = 'none';
      if (minDistance <= 1) status = 'exact';
      else if (minDistance <= 5) status = 'fuzzy';

      const finalMatch =
        status === 'exact' || status === 'fuzzy' ? bestMatch : null;

      return {
        id: crypto.randomUUID(),
        product_id: finalMatch?.id || '',
        item_name: finalMatch?.item_name || rawName,
        type: finalMatch?.type || 'generic',
        qty: parseFloat(aiItem.qty || aiItem.quantity) || 1,
        stock_on_hand: finalMatch?.stock || 0,
        price_piece: finalMatch?.price_piece || 0,
        buy_cost: finalMatch?.buy_cost || 0,
        discount_percent: 0,
        is_override: false,
        match_status: status,
        lot_number: '',
        expiry_date: '',
      };
    });

    setItems(aiMappedItems);
    setSearchTerms(
      aiMappedItems.map((item) =>
        item.match_status === 'none' ? item.item_name : ''
      )
    );
  };

  const handleAiUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsScanning(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        const extracted = await parseInvoiceImage(base64Data, file.type);
        processAiResults(extracted);
        setIsScanning(false);
      };
    } catch (err) {
      console.error(err);
      setIsScanning(false);
    }
  };

  const handleTextParse = async () => {
    if (!pastedText.trim()) return;
    setIsScanning(true);
    setShowTextPaste(false);
    try {
      const extracted = await parseInvoiceText(pastedText);
      processAiResults(extracted);
    } catch (err) {
      console.error(err);
    } finally {
      setIsScanning(false);
      setPastedText('');
    }
  };

  // --- FETCH INVENTORY (FILTERED BY BRANCH) ---
  const fetchInventory = async (searchTerm: string = '') => {
    try {
      setRefreshing(true);
      const savedBranch = localStorage.getItem('active_branch') ?? '';
      if (!savedBranch) return;

      const parsedBranch = JSON.parse(savedBranch);
      const branchId = parsedBranch.id;
      setCurrentBranchId(branchId);
      setIsOfficeUse(!!parsedBranch.is_office_use);

      let query = supabase
        .from('inventory')
        .select('*')
        .eq('branch_id', branchId)
        .order('item_name', { ascending: true });

      if (searchTerm) {
        query = query.ilike('item_name', `%${searchTerm}%`);
      } else {
        query = query.limit(100);
      }

      const { data: invData, error } = await query;

      if (error) throw error;

      if (invData) {
        setProducts(
          invData.map((p: any) => ({
            id: p.id,
            item_name: p.item_name || 'Unnamed Item',
            price_piece: Number(p.price_piece ?? p.price ?? 0),
            buy_cost: Number(p.buy_cost || 0),
            type: p.item_type
              ? String(p.item_type).toLowerCase().trim()
              : 'generic',
            stock: Number(p.stock || 0),
            branch_id: p.branch_id,
          }))
        );
      }

      // === OFFICE CLIENTS FETCH ===
      if (parsedBranch.is_office_use && branchId) {
        try {
          const { data, error: clientError } = await supabase
            .from('clients')
            .select('id, client_name, allowed_terms, agent')
            .eq('branch_id', branchId)
            .order('client_name', { ascending: true });

          if (clientError) throw clientError;
          setOfficeClients(data || []);
        } catch (err: any) {
          console.error('Fetch clients error:', err);
        }
      }

      // === OFFICE AGENTS FETCH ===
      if (parsedBranch.is_office_use && branchId) {
        try {
          const { data, error: agentError } = await supabase
            .from('profiles')
            .select('id, full_name')
            .eq('is_agent', true)
            .eq('office_branch_id', branchId)
            .order('full_name', { ascending: true });

          if (agentError) throw agentError;
          setAgents(data || []);
        } catch (err: any) {
          console.error('Fetch agents error:', err);
        }
      }
    } catch (err: any) {
      console.error(`Database Error: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  };

  const fetchClients = async () => {
    if (!isOfficeUse || !currentBranchId) return;
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('id, client_name')
        .eq('branch_id', currentBranchId)
        .order('client_name', { ascending: true });

      if (error) throw error;
      setOfficeClients(data || []);
    } catch (err: any) {
      console.error('Fetch clients error:', err);
    }
  };

  const fetchAgents = async () => {
    if (!isOfficeUse || !currentBranchId) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('is_agent', true)
        .eq('office_branch_id', currentBranchId)
        .order('full_name', { ascending: true });

      if (error) throw error;
      setAgents(data || []);
    } catch (err: any) {
      console.error('Fetch agents error:', err);
    }
  };

  // === CLIENT ORDERS OVERVIEW FETCH ("Looking for Orders?") ===
  // Pulls every client + every order for this branch, then groups the orders
  // client-side into last-order-date / average-order-size per client.
  const fetchClientOrderOverview = async () => {
    if (!isOfficeUse || !currentBranchId) return;
    setLoadingOrderStats(true);
    try {
      const { data: clientRows, error: clientErr } = await supabase
        .from('clients')
        .select(
          'id, client_name, agent, phone, owner, birthday, notes, allowed_terms'
        )
        .eq('branch_id', currentBranchId);
      if (clientErr) throw clientErr;

      const { data: orderRows, error: orderErr } = await supabase
        .from('orders')
        .select(
          'id, order_number, client_name, total_amount, created_at, agent, remaining_balance, status, due_date, payment_method'
        )
        .eq('branch_id', currentBranchId)
        .order('created_at', { ascending: false });
      if (orderErr) throw orderErr;

      type Agg = {
        count: number;
        total: number;
        last: string | null;
        dates: string[];
        // Sum of remaining_balance for this client's orders that aren't
        // marked completed yet — i.e. what they still owe.
        receivables: number;
        // Subset of `receivables` that's already past its due_date.
        overdueReceivables: number;
        // Subset of `receivables` whose due_date is today.
        dueTodayReceivables: number;
      };
      const statsByClient: Record<string, Agg> = {};
      // Every non-completed order, grouped by client — the exact set that
      // adds up to that client's `receivables` figure, kept around so the
      // Receivables column can be clicked through to the orders behind it.
      const detailsByClient: Record<string, ReceivableOrderDetail[]> = {};

      (orderRows || []).forEach((o: any) => {
        const key = (o.client_name || '').trim().toUpperCase();
        if (!key || key === 'WALK-IN') return;
        if (!statsByClient[key]) {
          statsByClient[key] = {
            count: 0,
            total: 0,
            last: null,
            dates: [],
            receivables: 0,
            overdueReceivables: 0,
            dueTodayReceivables: 0,
          };
        }
        statsByClient[key].count += 1;
        statsByClient[key].total += Number(o.total_amount) || 0;
        statsByClient[key].dates.push(o.created_at);
        if (
          !statsByClient[key].last ||
          o.created_at > (statsByClient[key].last as string)
        ) {
          statsByClient[key].last = o.created_at;
        }
        const statusNotCompleted =
          (o.status || '').trim().toLowerCase() !== 'completed';
        if (statusNotCompleted) {
          const remainingBalance = Number(o.remaining_balance) || 0;
          statsByClient[key].receivables += remainingBalance;

          const dueStatus = describeReceivableDueStatus(
            o.due_date || null,
            remainingBalance
          );
          if (dueStatus.isOverdue) {
            statsByClient[key].overdueReceivables += remainingBalance;
          } else if (dueStatus.isDueToday) {
            statsByClient[key].dueTodayReceivables += remainingBalance;
          }

          if (!detailsByClient[key]) detailsByClient[key] = [];
          detailsByClient[key].push({
            id: o.id,
            order_number: o.order_number,
            total_amount: Number(o.total_amount) || 0,
            remaining_balance: remainingBalance,
            status: o.status || '',
            created_at: o.created_at,
            due_date: o.due_date || null,
            payment_method: o.payment_method || null,
          });
        }
      });

      // Soonest-due (or most overdue) order first, so the breakdown modal
      // opens with whatever needs following up on right at the top.
      Object.keys(detailsByClient).forEach((key) => {
        detailsByClient[key].sort((a, b) => {
          const aDue = a.due_date || '9999-99-99';
          const bDue = b.due_date || '9999-99-99';
          if (aDue !== bDue) return aDue < bDue ? -1 : 1;
          return (b.created_at || '').localeCompare(a.created_at || '');
        });
      });

      const merged: ClientOverviewRow[] = (clientRows || []).map((c: any) => {
        const stat = statsByClient[(c.client_name || '').trim().toUpperCase()];
        const lastOrderDate = stat?.last || null;
        const daysSinceLastOrder = lastOrderDate
          ? Math.floor(
              (Date.now() - new Date(lastOrderDate).getTime()) /
                (1000 * 60 * 60 * 24)
            )
          : null;
        const averageOrder = stat ? stat.total / stat.count : 0;
        const avgGapDays = stat ? computeAvgGapDays(stat.dates) : null;
        const potentialRecovery = computePotentialRecovery(
          daysSinceLastOrder,
          avgGapDays,
          averageOrder
        );

        let nextExpectedDate: string | null = null;
        let daysUntilExpected: number | null = null;
        if (lastOrderDate && avgGapDays !== null) {
          const nextTime =
            new Date(lastOrderDate).getTime() +
            avgGapDays * 24 * 60 * 60 * 1000;
          nextExpectedDate = new Date(nextTime).toISOString();
          daysUntilExpected = Math.round(
            (nextTime - Date.now()) / (1000 * 60 * 60 * 24)
          );
        }

        return {
          id: c.id,
          client_name: c.client_name || 'Unnamed Client',
          agent: (c.agent && c.agent.trim()) || 'MAIN OFFICE',
          phone: c.phone ?? null,
          owner: c.owner ?? null,
          birthday: c.birthday ?? null,
          notes: c.notes ?? null,
          allowed_terms:
            c.allowed_terms === null || c.allowed_terms === undefined
              ? null
              : Number(c.allowed_terms),
          receivables: stat?.receivables || 0,
          overdueReceivables: stat?.overdueReceivables || 0,
          dueTodayReceivables: stat?.dueTodayReceivables || 0,
          orderCount: stat?.count || 0,
          averageOrder,
          lastOrderDate,
          daysSinceLastOrder,
          avgGapDays,
          potentialRecovery,
          nextExpectedDate,
          daysUntilExpected,
        };
      });

      setClientOrderStats(merged);
      setReceivableOrdersByClient(detailsByClient);
    } catch (err: any) {
      console.error('Fetch client overview error:', err);
    } finally {
      setLoadingOrderStats(false);
    }
  };

  // Reflects a keystroke immediately in the table (no DB round trip yet).
  const updateLocalClientField = (
    clientId: string,
    field: 'phone' | 'owner' | 'birthday' | 'notes' | 'agent' | 'allowed_terms',
    value: string
  ) => {
    setClientOrderStats((prev) =>
      prev.map((c) =>
        c.id === clientId
          ? {
              ...c,
              [field]:
                field === 'allowed_terms'
                  ? value === ''
                    ? null
                    : Number(value)
                  : value,
            }
          : c
      )
    );
  };

  // Persists an edited number/owner/birthday/notes/agent back to the `clients` table.
  const saveClientField = async (
    clientId: string,
    field: 'phone' | 'owner' | 'birthday' | 'notes' | 'agent' | 'allowed_terms',
    value: string
  ) => {
    const cellKey = `${clientId}-${field}`;
    setSavingCell(cellKey);
    setErrorCell((prev) => (prev?.key === cellKey ? null : prev));

    try {
      const updateValue =
        field === 'allowed_terms'
          ? value.trim() === ''
            ? null
            : Number(value)
          : value.trim()
          ? value.trim()
          : null;

      const { error } = await supabase
        .from('clients')
        .update({ [field]: updateValue })
        .eq('id', clientId);

      if (error) throw error;

      setSavedCell(cellKey);
      setTimeout(() => {
        setSavedCell((prev) => (prev === cellKey ? null : prev));
      }, 1500);
    } catch (err: any) {
      console.error(`Failed to update client ${field}:`, err);
      setErrorCell({ key: cellKey, message: err.message || 'Save failed' });
    } finally {
      setSavingCell((prev) => (prev === cellKey ? null : prev));
    }
  };

  // Small inline spinner / checkmark / error icon shown beside an edited cell.
  const renderCellStatus = (cellKey: string) => {
    if (savingCell === cellKey) {
      return <Loader2 size={12} className="animate-spin text-slate-500" />;
    }
    if (savedCell === cellKey) {
      return <CheckCircle2 size={12} className="text-emerald-500" />;
    }
    if (errorCell?.key === cellKey) {
      return (
        <span title={errorCell.message}>
          <AlertCircle size={12} className="text-red-500" />
        </span>
      );
    }
    return null;
  };

  // Unlocks (or re-locks) a single client row's editable fields.
  const toggleClientEditUnlock = (clientId: string) => {
    setUnlockedClientIds((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  };

  // Closing the modal always re-locks every row, so it opens safely next time.
  const closeOrdersOverviewModal = () => {
    setShowOrdersOverviewModal(false);
    setUnlockedClientIds(new Set());
    setSavingCell(null);
    setSavedCell(null);
    setErrorCell(null);
    setShowReceivablesDetailModal(false);
    setSelectedReceivablesClientId(null);
  };

  // Opens the per-order breakdown behind one client's Receivables number.
  const openReceivablesDetail = (client: ClientOverviewRow) => {
    setSelectedReceivablesClientId(client.id);
    setShowReceivablesDetailModal(true);
  };

  // Closing just the breakdown leaves the parent "Looking For Orders?"
  // modal open behind it.
  const closeReceivablesDetailModal = () => {
    setShowReceivablesDetailModal(false);
    setSelectedReceivablesClientId(null);
  };

  // --- CREATE NEW CLIENT ---
  const handleCreateNewClient = async () => {
    if (!newClientName.trim() || !currentBranchId) return;

    const trimmed = newClientName.trim();

    try {
      const { error } = await supabase.from('clients').insert([
        {
          client_name: trimmed,
          branch_id: currentBranchId,
        },
      ]);

      if (error) throw error;

      await fetchClients();
      setClientName(trimmed);
      setNewClientName('');
      setShowNewClientModal(false);
    } catch (err: any) {
      console.error(err);
      alert('Failed to save new client: ' + err.message);
    }
  };

  // === OFFICE USE: Fetch available lots from item_details ===
  const fetchAvailableLots = async (itemName: string, rowIndex: number) => {
    if (!isOfficeUse || !currentBranchId || !itemName) return;

    try {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('item_details')
        .select('lot_number, expiry_date, current_stock')
        .eq('branch_id', currentBranchId)
        .eq('item_name', itemName)
        .gt('current_stock', 0)
        .gte('expiry_date', today)
        .order('expiry_date', { ascending: true });

      if (error) throw error;

      const usedLots = items
        .filter((_, idx) => idx !== rowIndex)
        .map((i) => i.lot_number)
        .filter(Boolean);

      const filteredLots = (data || []).filter(
        (lot) => !usedLots.includes(lot.lot_number)
      );

      setItems((prevItems) =>
        prevItems.map((item, idx) =>
          idx === rowIndex
            ? {
                ...item,
                lot_options: filteredLots,
              }
            : item
        )
      );
    } catch (err: any) {
      console.error('Error fetching available lots:', err);
    }
  };

  useEffect(() => {
    const initPage = async () => {
      try {
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();
        setUser(authUser);

        if (authUser?.id) {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('role, owner')
            .eq('id', authUser.id)
            .single();

          const role = profileData?.role?.toLowerCase() || '';
          const isAdminUser =
            role === 'super_admin' ||
            role === 'branch_admin' ||
            role === 'org_manager' ||
            profileData?.owner === true;

          setIsAdmin(isAdminUser);
        }

        await fetchInventory();

        if (isOfficeUse) {
          await fetchClients();
        }

        const { data: lastOrders } = await supabase
          .from('orders')
          .select('order_number')
          .order('created_at', { ascending: false })
          .limit(1);

        if (lastOrders?.[0]?.order_number) {
          const lastNo = lastOrders[0].order_number;
          const numPart = parseInt(lastNo.replace('SO', ''));
          setNextSONumber(`SO${(numPart + 1).toString().padStart(2, '0')}`);
        } else {
          setNextSONumber('SO01');
        }
      } catch (err) {
        console.error('Init page error:', err);
      }
    };

    initPage();
  }, []);

  const metrics = useMemo(() => {
    let total = 0;
    let generic_gross = 0;
    let branded_gross = 0;
    let generic_amt = 0;
    let branded_amt = 0;
    let total_discount = 0;

    items.forEach((i) => {
      if (!i.product_id) return;

      const gross = Number(i.qty) * Number(i.price_piece);
      const discountAmount = gross * (Number(i.discount_percent) / 100);
      const subtotal = gross - discountAmount;

      total += subtotal;
      total_discount += discountAmount;

      if (i.type === 'branded') {
        branded_gross += gross;
        branded_amt += subtotal;
      } else {
        generic_gross += gross;
        generic_amt += subtotal;
      }
    });

    const isPaid = paymentMethod !== 'CASH' || cashReceived >= total;
    const termsAllowed = !(
      paymentMethod === 'TERMS' && selectedClientTerms === 0
    );
    const hasValidClient = !isOfficeUse || !!clientName?.trim();

    // DRUGSTORE-only: once a discount lands on any line, the client's name
    // and a valid PH mobile number are required before the order can commit.
    const discountAvailed = !isOfficeUse && total_discount > 0;
    const hasValidDiscountInfo =
      !discountAvailed ||
      (!!discountClientName.trim() && isValidPHMobile(discountClientNumber));

    return {
      total,
      generic_gross,
      branded_gross,
      generic_amt,
      branded_amt,
      total_discount,
      change: cashReceived > total ? cashReceived - total : 0,
      discountAvailed,
      hasValidDiscountInfo,
      isValid:
        isPaid &&
        total > 0 &&
        items.every((i) => i.product_id) &&
        hasValidClient &&
        hasValidDiscountInfo,
      termsAllowed,
    };
  }, [
    items,
    cashReceived,
    paymentMethod,
    isOfficeUse,
    clientName,
    discountClientName,
    discountClientNumber,
  ]);

  // === CLIENT ORDERS OVERVIEW: search, sort, and status helpers ===
  // For most columns, the "interesting" values are highest (most overdue
  // days, most revenue). daysUntilExpected is the opposite — its most
  // urgent rows are the smallest (most negative) numbers — so it gets an
  // ascending first click instead.
  const ASCENDING_FIRST_KEYS = new Set<keyof ClientOverviewRow>([
    'daysUntilExpected',
  ]);

  const toggleOverviewSort = (key: keyof ClientOverviewRow) => {
    setClientOverviewSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: ASCENDING_FIRST_KEYS.has(key) ? 'asc' : 'desc' }
    );
  };

  const sortIndicator = (key: keyof ClientOverviewRow) => {
    if (clientOverviewSort.key !== key) return '';
    return clientOverviewSort.dir === 'asc' ? ' ↑' : ' ↓';
  };

  const filteredClientStats = useMemo(() => {
    let list = [...clientOrderStats];

    if (clientOverviewAgentFilter !== 'ALL') {
      list = list.filter((c) => c.agent === clientOverviewAgentFilter);
    }

    if (clientOverviewSearch.trim()) {
      const q = clientOverviewSearch.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.client_name.toLowerCase().includes(q) ||
          c.agent.toLowerCase().includes(q)
      );
    }

    const { key, dir } = clientOverviewSort;
    const sign = dir === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];

      // Missing values (never ordered, no owner/birthday on file) always
      // sink to the bottom regardless of direction, so they don't drown out
      // the rows that actually have something to compare.
      const aEmpty = aVal === null || aVal === undefined || aVal === '';
      const bEmpty = bVal === null || bVal === undefined || bVal === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal) * sign;
      }
      return ((Number(aVal) || 0) - (Number(bVal) || 0)) * sign;
    });

    return list;
  }, [
    clientOrderStats,
    clientOverviewAgentFilter,
    clientOverviewSearch,
    clientOverviewSort,
  ]);

  // Rolled up only when one agent is selected — sums whatever's currently
  // visible in the table (agent filter + search combined).
  const agentPotentialTotal =
    clientOverviewAgentFilter !== 'ALL'
      ? filteredClientStats.reduce((sum, c) => sum + c.potentialRecovery, 0)
      : 0;
  const agentClientsWithPotential = filteredClientStats.filter(
    (c) => c.potentialRecovery > 0
  ).length;

  // The client whose Receivables breakdown is currently open, if any —
  // re-derived from clientOrderStats (not a stored snapshot) so a refresh
  // while the modal is open still shows current numbers.
  const selectedReceivablesClient = useMemo(
    () =>
      clientOrderStats.find((c) => c.id === selectedReceivablesClientId) ||
      null,
    [clientOrderStats, selectedReceivablesClientId]
  );

  // The outstanding orders behind that client's Receivables total.
  const selectedReceivablesOrders = useMemo(() => {
    if (!selectedReceivablesClient) return [];
    const key = selectedReceivablesClient.client_name.trim().toUpperCase();
    return receivableOrdersByClient[key] || [];
  }, [selectedReceivablesClient, receivableOrdersByClient]);

  // Live sum of the balances below — should always match `receivables`.
  const selectedReceivablesOrdersTotal = useMemo(
    () =>
      selectedReceivablesOrders.reduce(
        (sum, o) => sum + o.remaining_balance,
        0
      ),
    [selectedReceivablesOrders]
  );

  // --- EXPIRY DATE VALIDATION ---
  const validateExpiryDates = (): boolean => {
    if (!isOfficeUse) return true;

    const today = new Date().toISOString().split('T')[0];

    const invalid = items.filter((item) => {
      if (!item.product_id) return false;
      if (item.expiry_date && item.expiry_date < today) return true;
      return false;
    });

    if (invalid.length > 0) {
      setInvalidExpiryItems(invalid.map((i) => i.item_name));
      setShowExpiryError(true);
      return false;
    }

    return true;
  };

  // Helper to show "06/2026" in the input (uses raw buffer while user is typing)
  const getExpiryDisplayValue = (
    itemId: string,
    currentExpiryDate?: string
  ): string => {
    if (rawExpiryInputs[itemId] !== undefined) {
      return rawExpiryInputs[itemId];
    }
    return formatMonthYear(currentExpiryDate);
  };

  const handleProductSelect = (idx: number, product: Product) => {
    const newItems = [...items];
    newItems[idx] = {
      ...newItems[idx],
      product_id: product.id,
      item_name: product.item_name,
      price_piece: product.price_piece,
      buy_cost: product.buy_cost,
      type: product.type,
      stock_on_hand: product.stock,
      match_status: 'exact',
      lot_number: '',
      expiry_date: '',
    };
    setItems(newItems);

    const newSearchTerms = [...searchTerms];
    newSearchTerms[idx] = '';
    setSearchTerms(newSearchTerms);
    setActiveSearchIndex(null);

    if (isOfficeUse) {
      fetchAvailableLots(product.item_name, idx);
    }
  };

  const [confirmedSONumber, setConfirmedSONumber] = useState<string>('');
  const [loadingQuotation, setLoadingQuotation] = useState(false);

  const handleSubmit = async () => {
    if (!metrics.isValid || loading) return;

    if (!validateExpiryDates()) {
      setLoading(false);
      return;
    }

    if (paymentMethod === 'TERMS' && selectedClientTerms === 0) {
      setShowTermsError(true);
      setLoading(false);
      return;
    }

    if (isOfficeUse && !isAdmin) {
      const errors: string[] = [];

      items.forEach((item) => {
        if (!item.is_override || !item.product_id) return;

        const buyCost = Number(item.buy_cost || 0);
        const currentPrice = Number(item.price_piece);

        if (buyCost <= 0) {
          errors.push(
            `${item.item_name}: Buy cost not set properly. Ask the Admin to recheck the product and set the proper Buy Cost.`
          );
        } else {
          const minPrice = buyCost * 1.1;
          if (currentPrice < minPrice) {
            errors.push(`${item.item_name}: Price too low.`);
          }
        }
      });

      if (errors.length > 0) {
        setPriceErrorMessages(errors);
        setShowPriceError(true);
        setLoading(false);
        return;
      }
    }

    if (isOfficeUse) {
      for (const item of items) {
        if (
          !item.product_id ||
          !item.lot_number ||
          item.selected_lot_stock === undefined
        )
          continue;

        const { data: lotData } = await supabase
          .from('item_details')
          .select('current_stock')
          .eq('branch_id', currentBranchId)
          .eq('item_name', item.item_name)
          .eq('lot_number', item.lot_number)
          .eq('expiry_date', item.expiry_date)
          .single();

        const latestStock = lotData?.current_stock ?? 0;

        if (item.qty > latestStock) {
          setLotStockErrorMessage(
            `Cannot proceed with this order.\n\nLot# ${
              item.lot_number
            } (Expiry: ${formatMonthYear(item.expiry_date)})\nfor "${
              item.item_name
            }" only has ${latestStock} pcs left.\n\nYou are trying to sell ${
              item.qty
            } pcs from this lot.`
          );
          setShowLotStockError(true);
          setLoading(false);
          return;
        }
      }
    }

    setLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('No active session');

      const branchData = localStorage.getItem('active_branch');
      if (!branchData) throw new Error('No active branch selected');
      const branch = JSON.parse(branchData);

      const todayPHT = new Date().toISOString().split('T')[0];

      if (
        isOfficeUse &&
        clientName?.trim() &&
        clientName.trim().toUpperCase() !== 'WALK-IN'
      ) {
        try {
          const trimmedName = clientName.trim();

          const { data: existing } = await supabase
            .from('clients')
            .select('id')
            .eq('client_name', trimmedName)
            .eq('branch_id', currentBranchId)
            .maybeSingle();

          if (!existing) {
            const { error: insertErr } = await supabase.from('clients').insert([
              {
                client_name: trimmedName,
                branch_id: currentBranchId,
              },
            ]);
            if (insertErr) {
              console.warn('Client save warning (non-critical):', insertErr);
            }
          }
        } catch (clientErr: any) {
          console.warn(
            'Client save skipped (non-critical):',
            clientErr.message
          );
        }
      }

      const { data: generatedSO, error: soErr } = await supabase.rpc(
        'get_next_so_number'
      );
      if (soErr) throw soErr;

      let grossGeneric = 0;
      let grossBranded = 0;
      let totalDiscount = 0;

      items.forEach((i) => {
        const gross = Number(i.qty) * Number(i.price_piece);
        const itemDiscount = gross * (Number(i.discount_percent) / 100 || 0);

        if ((i.type || '').toLowerCase() === 'generic') {
          grossGeneric += gross;
        } else {
          grossBranded += gross;
        }
        totalDiscount += itemDiscount;
      });

      const orderStatus = isOfficeUse ? 'PENDING' : 'completed';

      let dueDateValue: string | null = null;
      if (isOfficeUse) {
        if (paymentMethod === 'CASH') {
          dueDateValue = todayPHT;
        } else if (paymentMethod === 'CHEQUE') {
          dueDateValue = chequeDate || todayPHT;
        } else if (paymentMethod === 'TERMS') {
          const days = selectedClientTerms || 0;
          const due = new Date();
          due.setDate(due.getDate() + days);
          dueDateValue = due.toISOString().split('T')[0];
        }
      }

      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .insert([
          {
            order_number: generatedSO,
            client_name: clientName || 'WALK-IN',
            total_amount: metrics.total,
            generic_amt: grossGeneric,
            branded_amt: grossBranded,
            discount_total: totalDiscount,
            payment_method: paymentMethod,
            created_by: session.user.email,
            status: orderStatus,
            branch_id: currentBranchId,
            created_date_pht: todayPHT,
            agent: selectedAgent,
            due_date: dueDateValue,
          },
        ])
        .select()
        .single();

      if (orderErr) throw orderErr;

      setConfirmedSONumber(order.order_number);

      // DRUGSTORE-only: log who the discount was extended to. Non-critical —
      // an issue here should not block an otherwise-valid completed order.
      if (!isOfficeUse && totalDiscount > 0) {
        try {
          const { error: discountLogErr } = await supabase
            .from('order_discount_logs')
            .insert([
              {
                order_id: order.id,
                order_number: order.order_number,
                branch_id: currentBranchId,
                client_name: discountClientName.trim(),
                client_number: discountClientNumber.trim(),
                discount_amount: totalDiscount,
                created_by: session.user.email,
                created_date_pht: todayPHT,
              },
            ]);
          if (discountLogErr) {
            console.warn(
              'Discount log save warning (non-critical):',
              discountLogErr
            );
          }
        } catch (discountLogEx: any) {
          console.warn(
            'Discount log save skipped (non-critical):',
            discountLogEx.message
          );
        }
      }

      const payload = items.map((i) => {
        const gross = Number(i.qty) * Number(i.price_piece);
        const discountAmount = gross * (Number(i.discount_percent) / 100 || 0);

        return {
          order_id: order.id,
          product_id: i.product_id,
          quantity: Number(i.qty),
          unit_price: Number(i.price_piece),
          type: i.type,
          subtotal: gross - discountAmount,
          discount: discountAmount,
          created_date_pht: todayPHT,
          lot_number: i.lot_number || null,
          expiry_date: i.expiry_date || null,
          agent: selectedAgent,
          status: isOfficeUse ? 'PENDING' : 'completed',
          payment_method: paymentMethod,
        };
      });

      const { error: itemsErr } = await supabase
        .from('order_items')
        .insert(payload);
      if (itemsErr) throw itemsErr;

      if (isOfficeUse) {
        for (const item of items) {
          if (!item.lot_number || !item.expiry_date) continue;

          try {
            const { data: currentLot } = await supabase
              .from('item_details')
              .select('current_stock')
              .eq('branch_id', currentBranchId)
              .eq('item_name', item.item_name)
              .eq('lot_number', item.lot_number)
              .eq('expiry_date', item.expiry_date)
              .single();

            if (currentLot) {
              const newStock = Math.max(0, currentLot.current_stock - item.qty);
              await supabase
                .from('item_details')
                .update({ current_stock: newStock })
                .eq('branch_id', currentBranchId)
                .eq('item_name', item.item_name)
                .eq('lot_number', item.lot_number)
                .eq('expiry_date', item.expiry_date);
            }
          } catch (deductErr) {
            console.error('Failed to deduct from item_details:', deductErr);
          }
        }
      }

      const itemsPayloadForRPC = items.map((i) => ({
        product_id: i.product_id,
        qty: Number(i.qty),
      }));

      const { error: rpcErr } = await supabase.rpc('process_inventory_sale', {
        items_json: itemsPayloadForRPC,
        target_branch_id: branch.id,
      });

      if (rpcErr) throw new Error(`Inventory Sync Error: ${rpcErr.message}`);

      await supabase.from('daily_reports').upsert(
        {
          branch_id: currentBranchId,
          report_date: todayPHT,
          generic_sales: grossGeneric,
          branded_sales: grossBranded,
          total_sales: metrics.total,
          discount_total: totalDiscount,
          branch_name: branch.branch_name,
        },
        { onConflict: 'branch_id,report_date' }
      );

      try {
        await supabase.rpc('heal_order_pht_date_solo', {
          p_order_id: order.id,
        });
      } catch (healErr) {
        console.warn('Solo heal failed (non-critical):', healErr);
      }

      setShowSuccess(true);
    } catch (err: any) {
      console.error('Submit Error:', err);
      alert(`Submission Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // === QUOTATION PDF (office branches only) ===
  // Reuses the same layout/engine as StaffHub's handlePrintOrder, but:
  //  - always renders the WITH HEADERS layout
  //  - "SALES ORDER #:" line is replaced with "FOR QUOTATION"
  //  - client name (and address, which has no meaning without a client) is omitted
  //  - pulls products/total straight from this in-progress order (no DB read/write)
  const handleGenerateQuotation = async () => {
    const validItems = items.filter((i) => i.product_id);
    if (validItems.length === 0) {
      alert('Add at least one product before generating a quotation.');
      return;
    }

    setLoadingQuotation(true);
    try {
      // Resolve current staff's name for "PROCESSED BY" (same pattern as StaffHub)
      let processedBy = 'Staff';
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user?.email) {
          processedBy = session.user.email;
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('email', session.user.email)
            .single();
          if (profile?.full_name) processedBy = profile.full_name;
        }
      } catch (profileErr) {
        console.warn('Could not resolve staff name for quotation:', profileErr);
      }

      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF('p', 'mm', 'a4');

      const PAGE_HEIGHT = 278; // Safe bottom margin for A4
      let y = 18;

      // ==================== HEADER (quotation is always WITH HEADERS) ====================
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
      doc.text('FOR QUOTATION PURPOSES ONLY', 105, y, { align: 'center' });
      y += 10;

      // Date only — "FOR QUOTATION" now lives in the title above; client name/address omitted entirely
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`DATE: ${new Date().toLocaleDateString('en-US')}`, 145, y);
      y += 10;

      // Table header
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

      // ==================== ITEM ROWS (WITH MULTI-PAGE SUPPORT) ====================
      let itemCount = 0;
      let grandTotal = 0;
      let currentY = y;

      const addPageIfNeeded = (spaceNeeded: number = 12) => {
        if (currentY + spaceNeeded > PAGE_HEIGHT) {
          doc.addPage();
          currentY = 20;

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.text('FOR QUOTATION PURPOSES ONLY (continued)', 105, currentY, {
            align: 'center',
          });
          currentY += 7;

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

      const formatExpiryMMYYYY = (dateStr: string): string => {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length >= 2) {
          return `${parts[1]}/${parts[0]}`; // MM/YYYY
        }
        return dateStr;
      };

      validItems.forEach((item) => {
        const qty = Number(item.qty || 1);
        const unitPrice = Number(item.price_piece || 0);
        const gross = qty * unitPrice;
        const discountAmount =
          gross * (Number(item.discount_percent || 0) / 100);
        const lineTotal = gross - discountAmount;
        const itemName = (item.item_name || '').trim();
        const lotNumber = (item.lot_number || '').trim().toUpperCase();
        const expiryDate = item.expiry_date || '';
        const expiryDisplay = formatExpiryMMYYYY(expiryDate);

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
        const rowHeight = lineHeight * numLines; // single (1x) spacing — matches the updated StaffHub print function

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

      const fileName = `${new Date().toISOString().slice(0, 10)}_QUOTATION.pdf`;
      doc.save(fileName);
    } catch (err: any) {
      console.error(err);
      alert('Failed to generate quotation: ' + err.message);
    } finally {
      setLoadingQuotation(false);
    }
  };

  const resetForm = () => {
    setClientName('WALK-IN');
    setCashReceived(0);
    setSearchTerms(['']);
    setRawExpiryInputs({});
    setDiscountClientName('');
    setDiscountClientNumber('');
    setItems([
      {
        id: crypto.randomUUID(),
        product_id: '',
        item_name: '',
        type: '',
        qty: 1,
        stock_on_hand: 0,
        price_piece: 0,
        buy_cost: 0,
        discount_percent: 0,
        is_override: false,
        match_status: 'none',
        lot_number: '',
        expiry_date: '',
      },
    ]);
    setShowSuccess(false);
    fetchInventory();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 flex flex-col font-sans text-[13px]">
      {/* AI OVERLAY */}
      {isScanning && (
        <div className="fixed inset-0 z-[3000] flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md">
          <div className="relative bg-slate-900 p-8 rounded-full border border-blue-500/50">
            <Loader2 className="animate-spin text-blue-400" size={48} />
          </div>
          <h2 className="text-2xl font-black uppercase text-white mt-8 tracking-tighter flex items-center gap-3">
            <Sparkles className="text-blue-400 animate-bounce" size={24} /> AI
            Processing Order
          </h2>
        </div>
      )}

      {/* TEXT PASTE MODAL */}
      {showTextPaste && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-black text-white uppercase tracking-tight">
                Paste Order Text
              </h2>
              <button
                onClick={() => setShowTextPaste(false)}
                className="text-slate-500 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <textarea
              className="w-full h-48 bg-slate-950 border border-white/10 rounded-xl p-4 text-white font-mono text-xs focus:border-blue-500 outline-none mb-4"
              placeholder="Example: 5pcs Paracetamol..."
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
            />
            <button
              onClick={handleTextParse}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
            >
              Extract Items
            </button>
          </div>
        </div>
      )}

      {/* NEW CLIENT MODAL */}
      {showNewClientModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-black text-white uppercase tracking-tight">
                Add New Client
              </h2>
              <button
                onClick={() => {
                  setShowNewClientModal(false);
                  setNewClientName('');
                }}
                className="text-slate-500 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <input
              className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500 mb-6"
              placeholder="Enter client name"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateNewClient()}
            />

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowNewClientModal(false);
                  setNewClientName('');
                }}
                className="flex-1 py-3 bg-slate-800 text-white rounded-xl font-bold text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateNewClient}
                disabled={!newClientName.trim()}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white rounded-xl font-bold text-xs"
              >
                Save Client
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CLIENT ORDERS OVERVIEW MODAL ("Looking for Orders?") */}
      {showOrdersOverviewModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-7xl max-h-[88vh] flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="flex justify-between items-start p-6 border-b border-white/10">
              <div>
                <h2 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2">
                  <Users size={18} className="text-amber-400" />
                  Looking For Orders?
                </h2>
                <p className="text-[11px] text-slate-500 mt-1">
                  Sorted by ₱ opportunity — each client is judged against{' '}
                  <span className="text-slate-400">their own</span> normal
                  ordering pace, not a flat day count.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={fetchClientOrderOverview}
                  title="Refresh"
                  className="text-slate-500 hover:text-blue-400"
                >
                  <RefreshCcw
                    size={16}
                    className={loadingOrderStats ? 'animate-spin' : ''}
                  />
                </button>
                <button
                  onClick={closeOrdersOverviewModal}
                  className="text-slate-500 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Search + Filter + Legend */}
            <div className="p-4 border-b border-white/5 flex flex-wrap items-center gap-4">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
                />
                <input
                  className="w-full bg-slate-950 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-white outline-none focus:border-blue-500 text-xs"
                  placeholder="Search client or agent..."
                  value={clientOverviewSearch}
                  onChange={(e) => setClientOverviewSearch(e.target.value)}
                />
              </div>

              <select
                value={clientOverviewAgentFilter}
                onChange={(e) => {
                  const nextAgent = e.target.value;
                  setClientOverviewAgentFilter(nextAgent);
                  if (nextAgent !== 'ALL') {
                    setClientOverviewSort({
                      key: 'potentialRecovery',
                      dir: 'desc',
                    });
                  }
                }}
                className="bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500 text-xs"
              >
                <option value="ALL">All Agents</option>
                <option value="MAIN OFFICE">MAIN OFFICE</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.full_name}>
                    {a.full_name}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-3 text-[9px] font-black uppercase text-slate-500 ml-auto">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500" /> Reach Out
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" /> Check
                  In
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />{' '}
                  Active
                </span>
              </div>
            </div>

            {/* Agent Potential Total - only when one agent is selected */}
            {clientOverviewAgentFilter !== 'ALL' && (
              <div className="px-4 py-3 bg-amber-500/5 border-b border-amber-500/10 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  {clientOverviewAgentFilter} — Total Potential
                </span>
                <span className="text-sm font-black text-amber-400 font-mono">
                  ~₱
                  {agentPotentialTotal.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                  <span className="text-[9px] text-slate-500 font-normal uppercase ml-2 tracking-wider">
                    across {agentClientsWithPotential} client
                    {agentClientsWithPotential === 1 ? '' : 's'}
                  </span>
                </span>
              </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {loadingOrderStats ? (
                <div className="p-16 flex flex-col items-center justify-center gap-3 text-slate-500">
                  <Loader2 className="animate-spin" size={28} />
                  <p className="text-xs font-bold uppercase">
                    Crunching order history...
                  </p>
                </div>
              ) : filteredClientStats.length === 0 ? (
                <div className="p-16 text-center text-slate-500 text-xs font-bold uppercase">
                  No clients found for this branch yet.
                </div>
              ) : (
                <table className="w-full text-left text-[12px] table-fixed">
                  <colgroup>
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '9%' }} />
                    <col style={{ width: '3%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '6%' }} />
                    <col style={{ width: '5%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '6%' }} />
                    <col style={{ width: '5%' }} />
                    <col style={{ width: '6%' }} />
                    <col style={{ width: '6%' }} />
                    <col style={{ width: '3%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '9%' }} />
                  </colgroup>
                  <thead className="bg-white/5 text-[10px] font-black uppercase text-slate-500 sticky top-0 z-10">
                    <tr>
                      <th
                        onClick={() => toggleOverviewSort('agent')}
                        className="p-2 cursor-pointer select-none"
                      >
                        Agent{sortIndicator('agent')}
                      </th>
                      <th
                        onClick={() => toggleOverviewSort('client_name')}
                        className="p-2 cursor-pointer select-none"
                      >
                        Client{sortIndicator('client_name')}
                      </th>
                      <th className="p-2 text-center whitespace-nowrap">
                        Edit
                      </th>
                      <th className="p-2">Number</th>
                      <th
                        onClick={() => toggleOverviewSort('owner')}
                        className="p-2 cursor-pointer select-none"
                      >
                        Owner{sortIndicator('owner')}
                      </th>
                      <th
                        onClick={() => toggleOverviewSort('allowed_terms')}
                        className="p-2 text-center cursor-pointer select-none"
                        title="Payment terms allowed for this client, in days"
                      >
                        Terms{sortIndicator('allowed_terms')}
                      </th>
                      <th
                        onClick={() => toggleOverviewSort('birthday')}
                        className="p-2 cursor-pointer select-none"
                      >
                        Birthday{sortIndicator('birthday')}
                      </th>
                      <th className="p-2">Manager Notes</th>
                      <th
                        onClick={() => toggleOverviewSort('daysSinceLastOrder')}
                        className="p-2 text-center cursor-pointer select-none"
                      >
                        Last Ordered{sortIndicator('daysSinceLastOrder')}
                      </th>
                      <th
                        onClick={() => toggleOverviewSort('avgGapDays')}
                        className="p-2 text-center cursor-pointer select-none"
                        title="Average days between this client's own orders"
                      >
                        Frequency{sortIndicator('avgGapDays')}
                      </th>
                      <th
                        onClick={() => toggleOverviewSort('daysUntilExpected')}
                        className="p-2 text-center cursor-pointer select-none"
                        title="Projected next order, based on this client's own pace — not a guarantee"
                      >
                        Next Expected{sortIndicator('daysUntilExpected')}
                      </th>
                      <th
                        onClick={() => toggleOverviewSort('averageOrder')}
                        className="p-2 text-right cursor-pointer select-none"
                      >
                        Avg Order{sortIndicator('averageOrder')}
                      </th>
                      <th
                        onClick={() => toggleOverviewSort('orderCount')}
                        className="p-2 text-center cursor-pointer select-none"
                      >
                        Orders{sortIndicator('orderCount')}
                      </th>
                      <th
                        onClick={() => toggleOverviewSort('receivables')}
                        className="p-2 text-right cursor-pointer select-none"
                        title="Remaining unpaid/uncollected balance for this client"
                      >
                        Receivables{sortIndicator('receivables')}
                      </th>
                      <th
                        onClick={() => toggleOverviewSort('potentialRecovery')}
                        className="p-2 text-center cursor-pointer select-none"
                        title="Sort by estimated ₱ opportunity"
                      >
                        Status{sortIndicator('potentialRecovery')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredClientStats.map((c) => {
                      const status = getClientStatus(
                        c.daysSinceLastOrder,
                        c.avgGapDays
                      );
                      const nextExpected = describeNextExpected(
                        c.daysUntilExpected
                      );
                      const isUnlocked = unlockedClientIds.has(c.id);

                      return (
                        <tr
                          key={c.id}
                          className="hover:bg-white/[0.02] align-top"
                        >
                          <td className="p-2 break-words">
                            {isUnlocked ? (
                              <div className="flex items-center gap-1.5">
                                <select
                                  value={c.agent}
                                  onChange={(e) => {
                                    const newAgent = e.target.value;
                                    updateLocalClientField(
                                      c.id,
                                      'agent',
                                      newAgent
                                    );
                                    saveClientField(c.id, 'agent', newAgent);
                                  }}
                                  className="w-full min-w-0 max-w-full bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500"
                                >
                                  <option value="MAIN OFFICE">
                                    MAIN OFFICE
                                  </option>
                                  {agents.map((a) => (
                                    <option key={a.id} value={a.full_name}>
                                      {a.full_name}
                                    </option>
                                  ))}
                                </select>
                                {renderCellStatus(`${c.id}-agent`)}
                              </div>
                            ) : (
                              <span className="text-slate-400">{c.agent}</span>
                            )}
                          </td>
                          <td className="p-2 font-bold text-white break-words">
                            {c.client_name}
                          </td>
                          <td className="p-2 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => toggleClientEditUnlock(c.id)}
                              title={
                                isUnlocked
                                  ? 'Lock this client\u2019s fields'
                                  : 'Unlock to edit number, owner, birthday, and terms'
                              }
                              className="shrink-0"
                            >
                              {isUnlocked ? (
                                <Unlock size={14} className="text-orange-400" />
                              ) : (
                                <Lock size={14} className="text-slate-400" />
                              )}
                            </button>
                          </td>
                          <td className="p-2 break-words">
                            {isUnlocked ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="tel"
                                  value={c.phone || ''}
                                  placeholder="Add number"
                                  onChange={(e) =>
                                    updateLocalClientField(
                                      c.id,
                                      'phone',
                                      e.target.value
                                    )
                                  }
                                  onBlur={(e) =>
                                    saveClientField(
                                      c.id,
                                      'phone',
                                      e.target.value
                                    )
                                  }
                                  className="w-full min-w-0 max-w-full bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500"
                                />
                                {renderCellStatus(`${c.id}-phone`)}
                              </div>
                            ) : (
                              <span className="text-slate-300 break-words">
                                {c.phone || (
                                  <span className="text-slate-600">—</span>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="p-2 break-words">
                            {isUnlocked ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={c.owner || ''}
                                  placeholder="—"
                                  onChange={(e) =>
                                    updateLocalClientField(
                                      c.id,
                                      'owner',
                                      e.target.value
                                    )
                                  }
                                  onBlur={(e) =>
                                    saveClientField(
                                      c.id,
                                      'owner',
                                      e.target.value
                                    )
                                  }
                                  className="w-full min-w-0 max-w-full bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500"
                                />
                                {renderCellStatus(`${c.id}-owner`)}
                              </div>
                            ) : (
                              <span className="text-slate-300 break-words">
                                {c.owner || (
                                  <span className="text-slate-600">—</span>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            {isUnlocked ? (
                              <div className="flex flex-col items-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={
                                    c.allowed_terms === null ||
                                    c.allowed_terms === undefined
                                      ? ''
                                      : c.allowed_terms
                                  }
                                  placeholder="0"
                                  onChange={(e) =>
                                    updateLocalClientField(
                                      c.id,
                                      'allowed_terms',
                                      e.target.value
                                    )
                                  }
                                  onBlur={(e) =>
                                    saveClientField(
                                      c.id,
                                      'allowed_terms',
                                      e.target.value
                                    )
                                  }
                                  className="w-full min-w-0 max-w-full bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-[11px] text-white text-center outline-none focus:border-blue-500"
                                />
                                {renderCellStatus(`${c.id}-allowed_terms`)}
                              </div>
                            ) : (
                              <span className="text-slate-300">
                                {c.allowed_terms === null ||
                                c.allowed_terms === undefined ? (
                                  <span className="text-slate-600">—</span>
                                ) : (
                                  `${c.allowed_terms}d`
                                )}
                              </span>
                            )}
                          </td>
                          <td className="p-2 break-words">
                            {isUnlocked ? (
                              <div className="flex items-start gap-1.5">
                                <input
                                  type="date"
                                  value={toDateInputValue(c.birthday)}
                                  onChange={(e) =>
                                    updateLocalClientField(
                                      c.id,
                                      'birthday',
                                      e.target.value
                                    )
                                  }
                                  onBlur={(e) =>
                                    saveClientField(
                                      c.id,
                                      'birthday',
                                      e.target.value
                                    )
                                  }
                                  className="w-full min-w-0 max-w-full bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500"
                                />
                                {renderCellStatus(`${c.id}-birthday`)}
                              </div>
                            ) : (
                              <span className="text-slate-300 break-words">
                                {c.birthday ? (
                                  formatDisplayDate(c.birthday)
                                ) : (
                                  <span className="text-slate-600">—</span>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="p-2">
                            {isUnlocked ? (
                              <div className="flex items-start gap-1.5">
                                <textarea
                                  rows={2}
                                  value={c.notes || ''}
                                  placeholder="Add a note..."
                                  onChange={(e) =>
                                    updateLocalClientField(
                                      c.id,
                                      'notes',
                                      e.target.value
                                    )
                                  }
                                  onBlur={(e) =>
                                    saveClientField(
                                      c.id,
                                      'notes',
                                      e.target.value
                                    )
                                  }
                                  className="w-full min-w-0 max-w-full bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500 resize-y"
                                />
                                {renderCellStatus(`${c.id}-notes`)}
                              </div>
                            ) : (
                              <span
                                className="text-slate-300 block break-words"
                                title={c.notes || ''}
                              >
                                {c.notes || (
                                  <span className="text-slate-600">—</span>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            {c.lastOrderDate ? (
                              <div>
                                <div className="text-slate-300 break-words">
                                  {formatDisplayDate(c.lastOrderDate)}
                                </div>
                                <div className="text-[9px] text-slate-500">
                                  {c.daysSinceLastOrder === 0
                                    ? 'today'
                                    : `${c.daysSinceLastOrder} day${
                                        c.daysSinceLastOrder === 1 ? '' : 's'
                                      } ago`}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-600">Never</span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            {c.avgGapDays !== null ? (
                              <div>
                                <div className="text-slate-300 break-words">
                                  {describeFrequency(c.avgGapDays)}
                                </div>
                                <div className="text-[9px] text-slate-500">
                                  Every ~{Math.max(1, Math.round(c.avgGapDays))}
                                  d
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-600">New</span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            <div
                              className={`${nextExpected.colorClass} break-words`}
                            >
                              {nextExpected.label}
                            </div>
                            {c.nextExpectedDate && (
                              <div className="text-[9px] text-slate-500">
                                {formatDisplayDate(c.nextExpectedDate)}
                              </div>
                            )}
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-emerald-400 break-words">
                            {c.orderCount > 0
                              ? `₱${c.averageOrder.toLocaleString(undefined, {
                                  maximumFractionDigits: 0,
                                })}`
                              : '—'}
                          </td>
                          <td className="p-2 text-center text-slate-400">
                            {c.orderCount}
                          </td>
                          <td className="p-2 text-right font-mono font-bold break-words">
                            <button
                              type="button"
                              onClick={() => openReceivablesDetail(c)}
                              className="w-full text-right cursor-pointer hover:underline decoration-dotted underline-offset-2"
                              title="Remaining unpaid/uncollected balance — click to see the orders behind it"
                            >
                              <span
                                className={
                                  c.receivables > 0
                                    ? 'text-red-400'
                                    : 'text-slate-600'
                                }
                              >
                                ₱
                                {c.receivables.toLocaleString(undefined, {
                                  maximumFractionDigits: 0,
                                })}
                              </span>
                              {c.overdueReceivables > 0 ? (
                                <div className="text-[9px] text-red-500 font-black uppercase tracking-wider mt-0.5">
                                  ₱
                                  {c.overdueReceivables.toLocaleString(
                                    undefined,
                                    { maximumFractionDigits: 0 }
                                  )}{' '}
                                  Overdue
                                </div>
                              ) : c.dueTodayReceivables > 0 ? (
                                <div className="text-[9px] text-amber-400 font-black uppercase tracking-wider mt-0.5">
                                  Due Today
                                </div>
                              ) : null}
                            </button>
                          </td>
                          <td className="p-2 text-center">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-black uppercase whitespace-nowrap ${status.badgeClass}`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`}
                              />
                              {status.label}
                            </span>
                            {c.potentialRecovery > 0 && (
                              <div
                                className="text-[9px] text-amber-400/80 mt-1 font-mono break-words"
                                title="This client's own average order size — shown once they've gone past their usual ordering pace"
                              >
                                ~₱
                                {c.potentialRecovery.toLocaleString(undefined, {
                                  maximumFractionDigits: 0,
                                })}{' '}
                                potential
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 flex justify-between items-center">
              <span className="text-[10px] text-slate-500 font-bold uppercase">
                {filteredClientStats.length} client
                {filteredClientStats.length === 1 ? '' : 's'}
              </span>
              <button
                onClick={closeOrdersOverviewModal}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RECEIVABLES BREAKDOWN MODAL — orders behind one client's Receivables number */}
      {showReceivablesDetailModal && selectedReceivablesClient && (
        <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex justify-between items-start p-6 border-b border-white/10">
              <div>
                <h2 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2">
                  <Receipt size={18} className="text-amber-400" />
                  {selectedReceivablesClient.client_name}
                </h2>
                <p className="text-[11px] text-slate-500 mt-1">
                  {selectedReceivablesOrders.length} outstanding order
                  {selectedReceivablesOrders.length === 1 ? '' : 's'} — Agent:{' '}
                  <span className="text-slate-400">
                    {selectedReceivablesClient.agent}
                  </span>
                </p>
              </div>
              <button
                onClick={closeReceivablesDetailModal}
                className="text-slate-500 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {/* Totals strip */}
            <div className="px-6 py-3 bg-white/[0.03] border-b border-white/5 flex flex-wrap items-center gap-x-8 gap-y-2">
              <div>
                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                  Total Receivables
                </div>
                <div className="text-sm font-black font-mono text-red-400">
                  ₱
                  {selectedReceivablesClient.receivables.toLocaleString(
                    undefined,
                    { maximumFractionDigits: 0 }
                  )}
                </div>
              </div>
              {selectedReceivablesClient.overdueReceivables > 0 ? (
                <div>
                  <div className="text-[9px] font-black uppercase tracking-wider text-red-500">
                    Overdue
                  </div>
                  <div className="text-sm font-black font-mono text-red-500">
                    ₱
                    {selectedReceivablesClient.overdueReceivables.toLocaleString(
                      undefined,
                      { maximumFractionDigits: 0 }
                    )}
                  </div>
                </div>
              ) : selectedReceivablesClient.dueTodayReceivables > 0 ? (
                <div>
                  <div className="text-[9px] font-black uppercase tracking-wider text-amber-400">
                    Due Today
                  </div>
                  <div className="text-sm font-black font-mono text-amber-400">
                    ₱
                    {selectedReceivablesClient.dueTodayReceivables.toLocaleString(
                      undefined,
                      { maximumFractionDigits: 0 }
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Order list */}
            <div className="flex-1 overflow-y-auto">
              {selectedReceivablesOrders.length === 0 ? (
                <div className="p-16 flex flex-col items-center justify-center gap-3 text-slate-500">
                  <CheckCircle2 size={28} className="text-emerald-600" />
                  <p className="text-xs font-bold uppercase">
                    No outstanding orders — all paid up.
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-white/5 text-[10px] font-black uppercase text-slate-500 sticky top-0">
                    <tr>
                      <th className="p-2">Order #</th>
                      <th className="p-2">Placed</th>
                      <th className="p-2">Method</th>
                      <th className="p-2">Due Status</th>
                      <th className="p-2 text-right">Total</th>
                      <th className="p-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {selectedReceivablesOrders.map((o) => {
                      const dueInfo = describeReceivableDueStatus(
                        o.due_date,
                        o.remaining_balance
                      );
                      return (
                        <tr
                          key={o.id}
                          className="hover:bg-white/[0.02] align-top"
                        >
                          <td className="p-2 font-bold text-white whitespace-nowrap">
                            {o.order_number}
                          </td>
                          <td className="p-2 text-slate-300 whitespace-nowrap">
                            {formatDisplayDate(o.created_at)}
                          </td>
                          <td className="p-2 text-slate-400 whitespace-nowrap">
                            {o.payment_method || '—'}
                          </td>
                          <td className="p-2 whitespace-nowrap">
                            <div className={dueInfo.colorClass}>
                              {dueInfo.label}
                            </div>
                            {o.due_date && (
                              <div className="text-[9px] text-slate-500">
                                {formatDisplayDate(o.due_date)}
                              </div>
                            )}
                          </td>
                          <td className="p-2 text-right font-mono text-slate-300">
                            ₱
                            {o.total_amount.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })}
                          </td>
                          <td className="p-2 text-right font-mono font-bold">
                            <span
                              className={
                                o.remaining_balance > 0
                                  ? 'text-red-400'
                                  : 'text-slate-600'
                              }
                            >
                              ₱
                              {o.remaining_balance.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 flex justify-between items-center">
              <span className="text-[10px] text-slate-500 font-bold uppercase">
                {selectedReceivablesOrders.length} order
                {selectedReceivablesOrders.length === 1 ? '' : 's'} · ₱
                {selectedReceivablesOrdersTotal.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}{' '}
                total outstanding
              </span>
              <button
                onClick={closeReceivablesDetailModal}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TERMS ERROR MODAL */}
      {showTermsError && (
        <div className="fixed inset-0 z-[2500] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-red-500/30 rounded-2xl w-full max-w-md p-6 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertCircle size={28} className="text-red-400" />
            </div>
            <h2 className="text-xl font-black text-red-400 uppercase tracking-tight mb-2">
              TERMS NOT ALLOWED
            </h2>
            <p className="text-slate-300 mb-6">
              This client has <span className="font-bold">0 days terms</span>.
              <br />
              Please select{' '}
              <span className="text-emerald-400 font-bold">CASH</span> or{' '}
              <span className="text-emerald-400 font-bold">CHEQUE</span>.
            </p>
            <button
              onClick={() => {
                setShowTermsError(false);
                setPaymentMethod('CASH');
              }}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm"
            >
              OK — Switch to CASH
            </button>
          </div>
        </div>
      )}

      {/* SUCCESS MODAL */}
      {showSuccess && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md p-8 shadow-2xl text-center">
            <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-500/30">
              <CheckCircle2 size={40} className="text-emerald-500" />
            </div>
            <h2 className="text-2xl font-black text-white mb-2 uppercase tracking-tighter">
              Order Recorded
            </h2>
            <p className="text-slate-400 mb-8 text-sm">
              Reference{' '}
              <span className="text-blue-500 font-bold">
                {confirmedSONumber}
              </span>{' '}
              saved successfully.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => router.push('/staff')}
                className="py-3 bg-slate-800 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2"
              >
                <Home size={16} /> Hub
              </button>
              <button
                onClick={resetForm}
                className="py-3 bg-blue-600 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2"
              >
                <PlusCircle size={16} /> New Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="bg-slate-900 border-b border-white/5 px-5 py-2.5 flex justify-between items-center sticky top-0 z-[1001]">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-1.5 hover:bg-white/5 rounded-md border border-white/5 text-slate-500"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2.5 border-l border-white/10 pl-4">
            <UserIcon size={14} className="text-blue-500" />
            <span className="font-semibold text-slate-200">
              {user?.email || 'User'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            id="ai-scan"
            onChange={handleAiUpload}
            disabled={isScanning}
          />
          <label
            htmlFor="ai-scan"
            className="flex items-center gap-3 px-4 py-1.5 rounded-lg border border-white/10 hover:border-blue-500 bg-slate-800/50 transition-all cursor-pointer group"
          >
            <Camera
              size={14}
              className="text-blue-400 group-hover:scale-110 transition-transform"
            />
            <span className="text-[9px] font-black uppercase tracking-widest hidden md:inline">
              Scan Photo
            </span>
          </label>
          <button
            onClick={() => setShowTextPaste(true)}
            className="flex items-center gap-3 px-4 py-1.5 rounded-lg border border-white/10 hover:border-blue-500 bg-slate-800/50 transition-all group"
          >
            <Receipt
              size={14}
              className="text-blue-400 group-hover:scale-110 transition-transform"
            />
            <span className="text-[9px] font-black uppercase tracking-widest hidden md:inline">
              Paste Text
            </span>
          </button>
          <button
            onClick={fetchInventory}
            className="flex items-center gap-2 text-[10px] font-bold text-slate-500 hover:text-blue-400 ml-4"
          >
            <RefreshCcw
              size={12}
              className={refreshing ? 'animate-spin' : ''}
            />{' '}
            {refreshing ? 'SYNCING...' : 'REFRESH STOCK'}
          </button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-5 pb-[500px] space-y-4">
        <div className="flex justify-between items-end">
          <div className="w-1/4">
            <label className="text-[10px] font-black text-slate-500 uppercase mb-1.5 block tracking-wider">
              Client Name
              {isOfficeUse && (
                <span className="text-amber-400 ml-1 text-[9px]">
                  (select or add new)
                </span>
              )}
            </label>

            {isOfficeUse ? (
              <select
                className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500 text-xs"
                value={clientName}
                onChange={(e) => {
                  if (e.target.value === '__NEW__') {
                    setShowNewClientModal(true);
                    return;
                  }
                  setClientName(e.target.value);

                  const selectedClient = officeClients.find(
                    (c) => c.client_name === e.target.value
                  );
                  setSelectedClientTerms(selectedClient?.allowed_terms ?? 0);

                  const clientAgent = selectedClient?.agent?.trim();
                  if (
                    clientAgent &&
                    agents.some((a) => a.full_name === clientAgent)
                  ) {
                    setSelectedAgent(clientAgent);
                  } else {
                    setSelectedAgent('MAIN OFFICE');
                  }
                }}
              >
                <option value="WALK-IN">WALK-IN</option>
                {[...officeClients]
                  .sort((a, b) =>
                    a.client_name.localeCompare(b.client_name, 'en', {
                      sensitivity: 'base',
                    })
                  )
                  .map((client) => (
                    <option key={client.id} value={client.client_name}>
                      {client.client_name}
                    </option>
                  ))}
                <option value="__NEW__" className="text-blue-400">
                  + Add New Client
                </option>
              </select>
            ) : (
              <input
                className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500 text-xs cursor-not-allowed opacity-75"
                value={clientName || 'WALK-IN'}
                disabled
                readOnly
              />
            )}
          </div>

          {/* LOOKING FOR ORDERS? + QUOTATION - OFFICE USE ONLY */}
          {isOfficeUse && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowOrdersOverviewModal(true);
                  fetchClientOrderOverview();
                }}
                title="See every client's last order, average order, and who to message"
                className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 transition-all"
              >
                <Search size={14} />
                <span className="text-[9px] font-black uppercase tracking-wider whitespace-nowrap">
                  Looking for Orders?
                </span>
              </button>

              <button
                type="button"
                disabled={!items.some((i) => i.product_id) || loadingQuotation}
                onClick={handleGenerateQuotation}
                title="Generate a price quotation PDF from the current items"
                className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
                  items.some((i) => i.product_id)
                    ? 'border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400'
                    : 'border-white/5 bg-slate-900/50 text-slate-600'
                }`}
              >
                {loadingQuotation ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <FileText size={14} />
                )}
                <span className="text-[9px] font-black uppercase tracking-wider whitespace-nowrap">
                  {loadingQuotation ? 'Generating...' : 'Quotation'}
                </span>
              </button>
            </div>
          )}

          {/* AGENT DROPDOWN - OFFICE USE ONLY */}
          {isOfficeUse && (
            <div className="w-1/4">
              <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block tracking-wider">
                Agent
              </label>
              <select
                className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-white outline-none focus:border-blue-500 text-xs"
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
              >
                <option value="MAIN OFFICE">MAIN OFFICE</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.full_name}>
                    {agent.full_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="text-right">
            <p className="text-[9px] font-black text-slate-500 uppercase leading-none">
              Reference
            </p>
            <p className="text-2xl font-black text-blue-500 italic uppercase">
              {nextSONumber}
            </p>
          </div>
        </div>

        {/* TABLE SECTION */}
        <div className="bg-slate-900/40 border border-white/5 rounded-xl overflow-visible">
          <div className="overflow-visible">
            <table className="w-full text-left overflow-visible">
              <thead className="bg-white/5 text-[10px] font-black uppercase text-slate-500">
                <tr>
                  <th className="p-3 w-10 text-center">#</th>
                  <th className="p-3">Item Description</th>
                  <th className="p-3 w-20 text-center">Type</th>
                  <th className="p-3 w-20 text-center">Stock</th>
                  {isOfficeUse && (
                    <>
                      <th className="p-3 w-28 text-center">Lot#</th>
                      <th className="p-3 w-28 text-center">
                        Expiry
                        <br />
                        <span className="text-[8px] font-normal tracking-normal">
                          MM/YYYY
                        </span>
                      </th>
                    </>
                  )}
                  <th className="p-3 w-24 text-center">Qty</th>
                  <th className="p-3 w-32 text-right">Unit Price</th>
                  <th className="p-3 w-28 text-center">
                    {isOfficeUse ? 'Adj%' : 'Disc%'}
                  </th>
                  <th className="p-3 w-36 text-right pr-8">Subtotal</th>
                  <th className="p-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono text-[12px] overflow-visible">
                {items.map((item, idx) => {
                  const subtotal =
                    item.qty *
                    (item.price_piece * (1 - item.discount_percent / 100));

                  const filteredProducts = products
                    .filter((p) =>
                      p.item_name
                        .toLowerCase()
                        .includes((searchTerms[idx] || '').toLowerCase())
                    )
                    .slice(0, 30);

                  let inputBorderColor = 'border-white/5';
                  let statusIcon = null;

                  if (item.match_status === 'exact') {
                    inputBorderColor = 'border-emerald-500/50 bg-emerald-500/5';
                    statusIcon = (
                      <CheckCircle2 size={12} className="text-emerald-500" />
                    );
                  } else if (item.match_status === 'fuzzy') {
                    inputBorderColor = 'border-orange-500/50 bg-orange-500/5';
                    statusIcon = (
                      <AlertCircle size={12} className="text-orange-500" />
                    );
                  } else if (
                    item.match_status === 'none' &&
                    (item.product_id || searchTerms[idx])
                  ) {
                    inputBorderColor = 'border-red-500/50 bg-red-500/5';
                    statusIcon = <X size={12} className="text-red-500" />;
                  }

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-white/[0.02] group overflow-visible"
                    >
                      <td className="p-3 text-slate-600 text-center">
                        {idx + 1}
                      </td>

                      {/* PRODUCT SEARCH COLUMN */}
                      <td className="p-1.5 relative overflow-visible">
                        <div className="relative flex items-center gap-2 overflow-visible">
                          <div className="relative flex-1 overflow-visible">
                            <input
                              type="text"
                              className={`w-full bg-slate-950 border ${inputBorderColor} rounded-md px-3 py-1.5 text-[11px] font-semibold text-slate-200 outline-none uppercase transition-all`}
                              placeholder="SEARCH PRODUCT... (click to browse)"
                              value={
                                item.product_id
                                  ? item.item_name
                                  : searchTerms[idx] || ''
                              }
                              onFocus={() => {
                                setActiveSearchIndex(idx);
                                if (
                                  !searchTerms[idx] ||
                                  searchTerms[idx].length < 2
                                ) {
                                  fetchInventory('');
                                }
                              }}
                              onBlur={() => {
                                setTimeout(() => {
                                  if (activeSearchIndex === idx)
                                    setActiveSearchIndex(null);
                                }, 150);
                              }}
                              onChange={(e) => {
                                const newVal = e.target.value;

                                const newTerms = [...searchTerms];
                                newTerms[idx] = newVal;
                                setSearchTerms(newTerms);

                                const newItems = [...items];
                                newItems[idx].match_status = 'none';
                                newItems[idx].product_id = '';
                                setItems(newItems);

                                setActiveSearchIndex(idx);

                                if (newVal.length >= 2) {
                                  fetchInventory(newVal);
                                }
                              }}
                            />

                            {/* DROPDOWN */}
                            {activeSearchIndex === idx && (
                              <div className="absolute left-0 right-0 top-full mt-1 bg-slate-900 border border-white/10 rounded-lg shadow-2xl z-[2000] max-h-[260px] overflow-auto text-sm">
                                {filteredProducts.length > 0 ? (
                                  filteredProducts.map((p) => (
                                    <button
                                      key={p.id}
                                      onClick={() =>
                                        handleProductSelect(idx, p)
                                      }
                                      className="w-full text-left px-3 py-2 hover:bg-blue-600 transition-colors flex justify-between items-center border-b border-white/5 last:border-b-0 text-[11px]"
                                    >
                                      <div className="flex-1 min-w-0 pr-2">
                                        <div className="font-bold uppercase truncate">
                                          {p.item_name}
                                        </div>
                                        <div className="text-[10px] text-slate-400 flex gap-2">
                                          <span>{p.type.toUpperCase()}</span>
                                          <span>Stock: {p.stock}</span>
                                        </div>
                                      </div>
                                      <div className="text-emerald-400 font-mono whitespace-nowrap">
                                        ₱{p.price_piece}
                                      </div>
                                    </button>
                                  ))
                                ) : (
                                  <div className="px-4 py-6 text-center text-[10px] text-slate-500">
                                    No matching products found
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="shrink-0">{statusIcon}</div>
                        </div>
                      </td>

                      <td className="p-1.5 text-center">
                        <span
                          className={`text-[9px] font-black px-2 py-0.5 rounded ${
                            item.type === 'branded'
                              ? 'bg-purple-500/10 text-purple-400'
                              : 'bg-blue-500/10 text-blue-400'
                          }`}
                        >
                          {item.product_id ? item.type.toUpperCase() : '-'}
                        </span>
                      </td>

                      <td className="p-1.5 text-center font-bold text-slate-500">
                        {item.product_id ? item.stock_on_hand : '-'}
                      </td>

                      {/* OFFICE USE ONLY COLUMNS */}
                      {isOfficeUse && (
                        <>
                          {/* Lot# Column */}
                          <td className="p-1 w-[165px]">
                            <div className="flex items-center gap-1">
                              {item.lot_options &&
                                item.lot_options.length > 0 && (
                                  <select
                                    value={
                                      item.lot_number && item.expiry_date
                                        ? `${item.lot_number}__${item.expiry_date}`
                                        : ''
                                    }
                                    onChange={(e) => {
                                      const value = e.target.value;

                                      if (!value) {
                                        // Clear selection
                                        setItems(
                                          items.map((i) =>
                                            i.id === item.id
                                              ? {
                                                  ...i,
                                                  lot_number: '',
                                                  expiry_date: '',
                                                  selected_lot_stock: undefined,
                                                  lot_locked: false,
                                                }
                                              : i
                                          )
                                        );
                                        return;
                                      }

                                      // Split composite value (lot_number__expiry_date)
                                      const [
                                        selectedLotNumber,
                                        selectedExpiry,
                                      ] = value.split('__');

                                      const selectedLot =
                                        item.lot_options?.find(
                                          (l) =>
                                            l.lot_number ===
                                              selectedLotNumber &&
                                            l.expiry_date === selectedExpiry
                                        );

                                      if (selectedLot) {
                                        setItems(
                                          items.map((i) =>
                                            i.id === item.id
                                              ? {
                                                  ...i,
                                                  lot_number:
                                                    selectedLot.lot_number,
                                                  expiry_date:
                                                    selectedLot.expiry_date,
                                                  selected_lot_stock:
                                                    selectedLot.current_stock,
                                                  lot_locked: true,
                                                }
                                              : i
                                          )
                                        );
                                      }
                                    }}
                                    className="w-[115px] bg-slate-950 border border-white/10 rounded-md px-1.5 py-1 text-[10px] text-center uppercase font-mono outline-none"
                                  >
                                    <option value="">-- Select lot --</option>
                                    {item.lot_options.map((lot) => {
                                      const compositeValue = `${lot.lot_number}__${lot.expiry_date}`;
                                      return (
                                        <option
                                          key={compositeValue}
                                          value={compositeValue}
                                        >
                                          {lot.lot_number} |{' '}
                                          {formatMonthYear(lot.expiry_date)} |{' '}
                                          {lot.current_stock}pcs
                                        </option>
                                      );
                                    })}
                                  </select>
                                )}

                              {/* Manual Lot# Input */}
                              <input
                                type="text"
                                value={item.lot_number || ''}
                                disabled={!!item.lot_locked}
                                readOnly={!!item.lot_locked}
                                onChange={(e) => {
                                  setItems(
                                    items.map((i) =>
                                      i.id === item.id
                                        ? {
                                            ...i,
                                            lot_number: e.target.value,
                                            selected_lot_stock: undefined,
                                            lot_locked: false,
                                          }
                                        : i
                                    )
                                  );
                                }}
                                className={`flex-1 bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-[10px] text-center uppercase font-mono outline-none min-w-[55px] ${
                                  item.lot_locked
                                    ? 'opacity-70 bg-slate-900 cursor-not-allowed'
                                    : ''
                                }`}
                                placeholder="LOT#"
                              />

                              {isOfficeUse && item.product_id && (
                                <button
                                  onClick={() =>
                                    fetchAvailableLots(item.item_name, idx)
                                  }
                                  className="shrink-0 p-0.5 text-slate-500 hover:text-blue-400"
                                  title="Refresh lots from item_details"
                                >
                                  <RefreshCcw size={12} />
                                </button>
                              )}
                            </div>
                          </td>

                          {/* Expiry Date Column - MM/YYYY */}
                          <td className="p-1 w-[92px]">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={7}
                              placeholder="MM/YYYY"
                              value={getExpiryDisplayValue(
                                item.id,
                                item.expiry_date
                              )}
                              disabled={!!item.lot_locked}
                              onChange={(e) => {
                                let val = e.target.value.replace(/[^\d/]/g, '');

                                if (val.length === 2 && !val.includes('/')) {
                                  val = val + '/';
                                }
                                const parts = val.split('/');
                                if (parts.length > 2)
                                  val =
                                    parts[0] + '/' + parts.slice(1).join('');
                                if (val.length > 7) val = val.slice(0, 7);

                                setRawExpiryInputs((prev) => ({
                                  ...prev,
                                  [item.id]: val,
                                }));

                                if (val.length === 7 && val.includes('/')) {
                                  const fullDate = mmyyyyToFullDate(val);
                                  if (fullDate) {
                                    setItems((prevItems) =>
                                      prevItems.map((i) =>
                                        i.id === item.id
                                          ? {
                                              ...i,
                                              expiry_date: fullDate,
                                              lot_locked: false,
                                            }
                                          : i
                                      )
                                    );
                                    setRawExpiryInputs((prev) => {
                                      const copy = { ...prev };
                                      delete copy[item.id];
                                      return copy;
                                    });
                                  }
                                }
                              }}
                              onBlur={() => {
                                const raw = rawExpiryInputs[item.id] || '';
                                if (raw.length === 7 && raw.includes('/')) {
                                  const fullDate = mmyyyyToFullDate(raw);
                                  if (fullDate) {
                                    setItems((prevItems) =>
                                      prevItems.map((i) =>
                                        i.id === item.id
                                          ? {
                                              ...i,
                                              expiry_date: fullDate,
                                              lot_locked: false,
                                            }
                                          : i
                                      )
                                    );
                                  } else {
                                    setItems((prevItems) =>
                                      prevItems.map((i) =>
                                        i.id === item.id
                                          ? { ...i, expiry_date: '' }
                                          : i
                                      )
                                    );
                                  }
                                } else if (raw.length > 0) {
                                  setItems((prevItems) =>
                                    prevItems.map((i) =>
                                      i.id === item.id
                                        ? { ...i, expiry_date: '' }
                                        : i
                                    )
                                  );
                                }
                                setRawExpiryInputs((prev) => {
                                  const copy = { ...prev };
                                  delete copy[item.id];
                                  return copy;
                                });
                              }}
                              className={`w-full bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-[10px] text-center font-mono outline-none tracking-[0.5px] ${
                                item.lot_locked
                                  ? 'opacity-60 cursor-not-allowed'
                                  : ''
                              }`}
                            />
                          </td>
                        </>
                      )}

                      <td className="p-1.5">
                        <input
                          type="number"
                          value={item.qty}
                          onChange={(e) => {
                            const newQty = Math.max(1, Number(e.target.value));

                            if (
                              isOfficeUse &&
                              item.lot_number &&
                              item.selected_lot_stock !== undefined
                            ) {
                              if (newQty > item.selected_lot_stock) {
                                setLotStockErrorMessage(
                                  `Lot# ${
                                    item.lot_number
                                  } (Expiry: ${formatMonthYear(
                                    item.expiry_date
                                  )})\nonly has ${
                                    item.selected_lot_stock
                                  } pcs remaining.\n\nYou cannot sell ${newQty} pcs from this specific lot.`
                                );
                                setShowLotStockError(true);
                                return;
                              }
                            }

                            setItems(
                              items.map((i) => {
                                if (i.id === item.id) {
                                  let updatedDiscount = i.discount_percent;

                                  const isValidBox =
                                    newQty % 30 === 0 ||
                                    newQty % 50 === 0 ||
                                    newQty % 100 === 0;

                                  if (updatedDiscount === 20 && !isValidBox) {
                                    updatedDiscount = 0;
                                  }

                                  if (
                                    updatedDiscount === 16.666667 &&
                                    (newQty < 6 || newQty % 6 !== 0)
                                  ) {
                                    updatedDiscount = 0;
                                  }

                                  return {
                                    ...i,
                                    qty: newQty,
                                    discount_percent: updatedDiscount,
                                  };
                                }
                                return i;
                              })
                            );
                          }}
                          className="w-full bg-yellow-400 text-slate-950 font-bold text-center py-1.5 rounded-md outline-none text-xs"
                        />
                      </td>

                      {/* UNIT PRICE COLUMN */}
                      <td className="p-1.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isOfficeUse && (
                            <button
                              onClick={() =>
                                setItems(
                                  items.map((i) =>
                                    i.id === item.id
                                      ? { ...i, is_override: !i.is_override }
                                      : i
                                  )
                                )
                              }
                              className="shrink-0"
                            >
                              {item.is_override ? (
                                <Unlock size={13} className="text-orange-400" />
                              ) : (
                                <Lock size={13} className="text-slate-400" />
                              )}
                            </button>
                          )}

                          <input
                            type="number"
                            step="0.01"
                            disabled={!item.is_override || !isOfficeUse}
                            value={item.price_piece}
                            onChange={(e) => {
                              const newPrice = Number(e.target.value);
                              setItems(
                                items.map((i) =>
                                  i.id === item.id
                                    ? { ...i, price_piece: newPrice }
                                    : i
                                )
                              );
                            }}
                            onBlur={() => {
                              if (!isOfficeUse || !item.is_override || isAdmin)
                                return;

                              const buyCost = Number(item.buy_cost || 0);
                              const currentPrice = Number(item.price_piece);

                              let errorMsg = '';

                              if (buyCost <= 0) {
                                errorMsg =
                                  'Buy cost for this item is not set properly. Ask the Admin to recheck the product and set the proper buy_cost.';
                              } else {
                                const minPrice = buyCost * 1.1;
                                if (currentPrice < minPrice) {
                                  errorMsg = `Price too low.`;
                                }
                              }

                              if (errorMsg) {
                                setPriceErrorMessages([errorMsg]);
                                setShowPriceError(true);
                              }
                            }}
                            className={`w-20 bg-transparent text-right font-bold outline-none text-emerald-400 transition-all ${
                              item.is_override && isOfficeUse
                                ? 'border-b border-orange-500'
                                : ''
                            }`}
                          />
                        </div>
                      </td>

                      {/* DISCOUNT / ADJUSTMENT COLUMN */}
                      <td className="p-1.5 min-w-[130px]">
                        {isOfficeUse ? (
                          <select
                            value={item.discount_percent}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setItems(
                                items.map((i) =>
                                  i.id === item.id
                                    ? { ...i, discount_percent: val }
                                    : i
                                )
                              );
                            }}
                            className="w-full bg-slate-800 text-blue-400 font-bold text-center py-1.5 rounded-md outline-none text-[10px] transition-all border border-amber-400/30"
                          >
                            <option value={0}>No Adjustment</option>
                            <option value={6}>6% Discount</option>
                            <option value={-10}>+10% Markup</option>
                          </select>
                        ) : (
                          <select
                            disabled={item.type.toLowerCase() !== 'generic'}
                            value={item.discount_percent}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              const qty = Number(item.qty);

                              const isBoxMultiple =
                                qty % 30 === 0 ||
                                qty % 50 === 0 ||
                                qty % 100 === 0;

                              if (val === 20 && !isBoxMultiple) {
                                alert(
                                  '20% Discount is only for full boxes (multiples of 30, 50, or 100).'
                                );
                                return;
                              }
                              if (
                                val === 16.666667 &&
                                (qty < 6 || qty % 6 !== 0)
                              ) {
                                alert('5+1 Promo is only for multiples of 6.');
                                return;
                              }

                              setItems(
                                items.map((i) =>
                                  i.id === item.id
                                    ? { ...i, discount_percent: val }
                                    : i
                                )
                              );
                            }}
                            className={`w-full bg-slate-800 text-blue-400 font-bold text-center py-1.5 rounded-md outline-none text-[10px] transition-all ${
                              item.type.toLowerCase() === 'generic'
                                ? 'border border-blue-500/20'
                                : 'opacity-40 cursor-not-allowed'
                            }`}
                          >
                            {item.type.toLowerCase() === 'generic' ? (
                              <>
                                <option value={0}>No Discount</option>
                                <option
                                  value={20}
                                  disabled={
                                    !(
                                      Number(item.qty) % 30 === 0 ||
                                      Number(item.qty) % 50 === 0 ||
                                      Number(item.qty) % 100 === 0
                                    )
                                  }
                                >
                                  20% (Box Promo)
                                </option>
                                <option
                                  value={16.666667}
                                  disabled={
                                    Number(item.qty) < 6 ||
                                    Number(item.qty) % 6 !== 0
                                  }
                                >
                                  Promo Pack
                                </option>
                              </>
                            ) : (
                              <option value={0}>Fixed (Branded)</option>
                            )}
                          </select>
                        )}
                      </td>

                      <td className="p-1.5 text-right pr-8 font-bold text-white">
                        ₱{subtotal.toLocaleString()}
                      </td>

                      <td className="p-1.5 text-center">
                        <button
                          onClick={() => {
                            setItems(items.filter((i) => i.id !== item.id));
                            setSearchTerms(
                              searchTerms.filter((_, i) => i !== idx)
                            );
                          }}
                          className="text-slate-700 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            onClick={() => {
              setItems([
                ...items,
                {
                  id: crypto.randomUUID(),
                  product_id: '',
                  item_name: '',
                  type: '',
                  qty: 1,
                  stock_on_hand: 0,
                  price_piece: 0,
                  buy_cost: 0,
                  discount_percent: 0,
                  is_override: false,
                  match_status: 'none',
                },
              ]);
              setSearchTerms([...searchTerms, '']);
            }}
            className="w-full p-4 bg-slate-950/50 hover:bg-slate-950 text-indigo-400 text-[10px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2 border-t border-white/5 transition-all"
          >
            <Plus size={16} /> Add Next Item
          </button>
        </div>
      </main>

      {/* PRICE ERROR MODAL */}
      {showPriceError && (
        <div className="fixed inset-0 z-[2500] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-red-500/30 rounded-2xl w-full max-w-md p-6 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertCircle size={28} className="text-red-400" />
            </div>
            <h2 className="text-xl font-black text-red-400 uppercase tracking-tight mb-2">
              PRICE VALIDATION ERROR
            </h2>
            <p className="text-slate-300 mb-4">
              The following price issue was detected:
            </p>
            <div className="bg-slate-950 border border-red-500/20 rounded-xl p-4 mb-6 text-left text-sm font-medium max-h-64 overflow-auto">
              {priceErrorMessages.map((msg, i) => (
                <div
                  key={i}
                  className="py-2 border-b border-white/10 last:border-none"
                >
                  • {msg}
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                setShowPriceError(false);
                setPriceErrorMessages([]);
              }}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm"
            >
              OK — FIX PRICES
            </button>
          </div>
        </div>
      )}

      {/* EXPIRY ERROR MODAL */}
      {showExpiryError && (
        <div className="fixed inset-0 z-[2500] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-red-500/30 rounded-2xl w-full max-w-md p-6 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertCircle size={28} className="text-red-400" />
            </div>
            <h2 className="text-xl font-black text-red-400 uppercase tracking-tight mb-2">
              INVALID EXPIRY DATES
            </h2>
            <p className="text-slate-300 mb-4">
              The following items have expired dates:
            </p>
            <div className="bg-slate-950 border border-red-500/20 rounded-xl p-3 mb-6 text-left text-sm font-mono max-h-48 overflow-auto">
              {invalidExpiryItems.map((name, i) => (
                <div
                  key={i}
                  className="py-1 border-b border-white/10 last:border-none"
                >
                  • {name}
                </div>
              ))}
            </div>
            <p className="text-slate-400 text-xs mb-6">
              Expiry date must be{' '}
              <span className="font-bold text-emerald-400">
                today or in the future
              </span>
              .
            </p>
            <button
              onClick={() => {
                setShowExpiryError(false);
                setInvalidExpiryItems([]);
              }}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm"
            >
              OK — FIX EXPIRY DATES
            </button>
          </div>
        </div>
      )}

      {/* LOT STOCK ERROR MODAL */}
      {showLotStockError && (
        <div className="fixed inset-0 z-[2500] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-red-500/30 rounded-2xl w-full max-w-md p-6 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertCircle size={28} className="text-red-400" />
            </div>
            <h2 className="text-xl font-black text-red-400 uppercase tracking-tight mb-2">
              LOT STOCK LIMIT REACHED
            </h2>
            <div className="bg-slate-950 border border-red-500/20 rounded-xl p-4 mb-6 text-left text-sm font-medium whitespace-pre-line">
              {lotStockErrorMessage}
            </div>
            <button
              onClick={() => {
                setShowLotStockError(false);
                setLotStockErrorMessage('');
              }}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm"
            >
              OK — I’LL ADJUST THE QUANTITY
            </button>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="bg-slate-900 border-t border-white/10 p-5 flex items-center justify-between sticky bottom-0 z-[1001]">
        <div className="flex gap-6 items-center">
          <div className="bg-slate-950 px-5 py-3 rounded-xl border border-white/5">
            <p className="text-[9px] font-black text-slate-500 uppercase mb-0.5">
              Grand Total
            </p>
            <p className="text-3xl font-black text-emerald-400 italic">
              ₱{metrics.total.toLocaleString()}
            </p>
          </div>
          <div className="text-[10px] font-mono space-y-1 bg-white/[0.02] p-2 rounded-lg border border-white/5">
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">GENERIC:</span>
              <span className="text-blue-400 font-bold">
                ₱{metrics.generic_amt.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">BRANDED:</span>
              <span className="text-purple-400 font-bold">
                ₱{metrics.branded_amt.toLocaleString()}
              </span>
            </div>
          </div>
          {paymentMethod === 'CASH' && (
            <div className="w-40 border-l border-white/10 pl-6">
              <p className="text-[9px] font-black text-slate-500 uppercase mb-1">
                Cash Tendered
              </p>
              <input
                type="number"
                value={cashReceived || ''}
                onChange={(e) =>
                  setCashReceived(parseFloat(e.target.value) || 0)
                }
                className="w-full bg-slate-950 border border-white/10 rounded-lg py-2 px-3 text-white font-mono text-xl font-bold outline-none focus:border-emerald-500/50"
                placeholder="0.00"
              />
              {metrics.change >= 0 && (
                <p className="text-[10px] font-bold text-emerald-500 mt-1">
                  CHANGE: ₱{metrics.change.toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 w-64">
          {/* PAYMENT METHOD */}
          <div className="flex bg-slate-950 p-1 rounded-lg border border-white/5">
            {isOfficeUse ? (
              (['CASH', 'CHEQUE', 'TERMS'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`flex-1 py-2 rounded-md text-[9px] font-black transition-all ${
                    paymentMethod === m
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'text-slate-600 hover:bg-white/5'
                  }`}
                >
                  {m}
                </button>
              ))
            ) : (
              <button className="flex-1 py-2 rounded-md text-[9px] font-black bg-blue-600 text-white shadow-lg cursor-default">
                CASH
              </button>
            )}
          </div>

          {/* CHEQUE DATE */}
          {isOfficeUse && paymentMethod === 'CHEQUE' && (
            <div className="w-40 border-l border-white/10 pl-6">
              <p className="text-[9px] font-black text-slate-500 uppercase mb-1">
                Cheque Date
              </p>
              <input
                type="date"
                value={chequeDate}
                onChange={(e) => setChequeDate(e.target.value)}
                className="w-full bg-slate-950 border border-white/10 rounded-lg py-2 px-3 text-white font-mono text-sm outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* TERMS INFO */}
          {isOfficeUse && paymentMethod === 'TERMS' && (
            <div className="w-52 border-l border-white/10 pl-6 text-[10px]">
              <div className="flex justify-between items-baseline">
                <span className="font-black text-slate-400 uppercase">
                  Terms
                </span>
                <span className="font-mono font-bold text-blue-400">
                  {selectedClientTerms} days
                </span>
              </div>
              <div className="flex justify-between items-baseline mt-1">
                <span className="font-black text-slate-400 uppercase">
                  Due Date
                </span>
                <span className="font-mono font-bold text-emerald-400">
                  {(() => {
                    if (selectedClientTerms <= 0) return '—';
                    const due = new Date();
                    due.setDate(due.getDate() + selectedClientTerms);
                    return due.toISOString().split('T')[0];
                  })()}
                </span>
              </div>
              {selectedClientTerms === 0 && (
                <div className="mt-2 text-red-400 text-[9px] font-bold flex items-center gap-1">
                  <AlertCircle size={12} />
                  NOT ALLOWED (COD only)
                </div>
              )}
            </div>
          )}

          {isOfficeUse &&
            paymentMethod === 'TERMS' &&
            selectedClientTerms === 0 && (
              <div className="mt-2 text-red-400 text-[10px] font-bold flex items-center gap-1 bg-red-950/50 border border-red-500/30 rounded-lg px-3 py-1.5">
                <AlertCircle size={14} />
                TERMS NOT ALLOWED — Client has 0 days terms (COD only)
              </div>
            )}

          {/* DRUGSTORE ONLY: Discount Availed capture */}
          {metrics.discountAvailed && (
            <div className="border border-amber-500/30 bg-amber-950/40 rounded-lg px-3 py-2.5 flex flex-col gap-2">
              <div className="flex items-center gap-1 text-amber-400 text-[9px] font-black uppercase tracking-wide">
                <AlertCircle size={12} />
                Discount Availed
              </div>
              <input
                type="text"
                placeholder="Client Name"
                value={discountClientName}
                onChange={(e) => setDiscountClientName(e.target.value)}
                className="w-full bg-slate-950 border border-white/10 rounded-lg py-2 px-3 text-white text-xs outline-none focus:border-amber-500"
              />
              <input
                type="tel"
                placeholder="Mobile No. (e.g. 09171234567)"
                value={discountClientNumber}
                onChange={(e) => setDiscountClientNumber(e.target.value)}
                className={`w-full bg-slate-950 border rounded-lg py-2 px-3 text-white text-xs outline-none ${
                  discountClientNumber && !isValidPHMobile(discountClientNumber)
                    ? 'border-red-500 focus:border-red-500'
                    : 'border-white/10 focus:border-amber-500'
                }`}
              />
              {discountClientNumber && !isValidPHMobile(discountClientNumber) && (
                <span className="text-red-400 text-[9px] font-bold">
                  Enter a valid PH mobile number (e.g. 09171234567)
                </span>
              )}
            </div>
          )}

          <button
            disabled={!metrics.isValid || loading}
            onClick={handleSubmit}
            className={`h-14 rounded-xl font-black text-sm flex items-center justify-center gap-3 transition-all ${
              metrics.isValid
                ? 'bg-blue-600 text-white shadow-xl'
                : 'bg-slate-800 text-slate-600'
            }`}
          >
            {loading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Receipt size={18} />
            )}
            {loading ? 'STORING...' : 'COMMIT ORDER'}
          </button>
        </div>
      </footer>
    </div>
  );
}
