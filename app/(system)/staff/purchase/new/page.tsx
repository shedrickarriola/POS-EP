'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  ArrowLeft,
  Trash2,
  Plus,
  PackageCheck,
  Camera,
  Loader2,
  CheckCircle2,
  RefreshCw,
  Search,
  Home,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { parseInvoiceImage } from '@/app/actions/parseInvoice';
// Bulletproof Levenshtein distance to handle typos in medicine keywords

const EMPTY_ITEM = {
  inventory_id: '',
  item_name: '',
  item_type: 'GENERIC',
  qty: 1,
  packaging_type: 1,
  invoice_price: 0,
  discount: 0,
  buy_cost: 0,
  buy_cost_total: 0,
  markup: 25,
  current_price: 0,
  new_price: 0,
  remaining_stock: 0,
};

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
    // List of common medicine indicators
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

    // Check if the name contains any of these keywords
    const isMedicine = medicineKeywords.some((keyword) =>
      lowerName.includes(keyword)
    );

    return isMedicine ? 10 : 15;
  }

  // Fallback for anything else
  return 25;
};

const getLevenshteinDistance = (a: string, b: string): number => {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();

  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;

  const matrix: number[][] = Array.from({ length: s1.length + 1 }, () =>
    new Array(s2.length + 1).fill(0)
  );

  // Initialize first row and first column
  for (let i = 0; i <= s1.length; i++) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[s1.length][s2.length];
};
const TableSkeleton = () => (
  <>
    {[...Array(5)].map((_, i) => (
      <tr key={i} className="animate-pulse border-b border-white/5">
        <td className="px-1">
          <div className="h-10 bg-white/5 rounded-lg w-full" />
        </td>
        <td className="px-1">
          <div className="h-10 bg-white/5 rounded-lg w-full" />
        </td>
        {[...Array(9)].map((_, j) => (
          <td key={j} className="px-1">
            <div className="h-8 bg-white/5 rounded-lg w-full mx-auto" />
          </td>
        ))}
        <td className="px-1 sticky right-0 bg-slate-900 border-l border-white/10">
          <div className="h-6 bg-white/5 rounded w-6 mx-auto" />
        </td>
      </tr>
    ))}
  </>
);

export default function NewPurchaseOrder() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlBranchName = searchParams.get('branchName') || 'Pharmacy Branch';

  const [profile, setProfile] = useState<any>(null);
  const [inventoryList, setInventoryList] = useState<any[]>([]);
  const [supplierList, setSupplierList] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [isSupplierFocused, setIsSupplierFocused] = useState(false);
  const [poNumber, setPoNumber] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [searchTerms, setSearchTerms] = useState<string[]>(['']);
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(
    null
  );
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  const [finalGenericAmt, setFinalGenericAmt] = useState(0);
  const [finalBrandedAmt, setFinalBrandedAmt] = useState(0);

  const getNextPoNumber = useCallback(async () => {
    // 1. Fetch the total count of all purchase orders in the system
    const { count, error } = await supabase
      .from('purchase_orders')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('Error fetching PO count:', error);
      return 'PO1'; // Fallback for first entry
    }

    // 2. Generate the next number in the sequence
    const nextCount = (count || 0) + 1;

    // 3. Return as PO + Number (e.g., PO1, PO2...)
    return `PO${nextCount}`;
  }, []);

  const fetchInventory = async (branchId: string, searchTerm: string = '') => {
    let query = supabase
      .from('inventory')
      .select('*')
      .eq('branch_id', branchId)
      .order('item_name', { ascending: true })
      .limit(50); // Fetch a reasonable amount for the dropdown

    // If the user has typed something, filter by name
    if (searchTerm) {
      query = query.ilike('item_name', `%${searchTerm}%`);
    }

    const { data: invData, error } = await query;

    if (error) {
      console.error('Fetch error:', error.message);
      return;
    }

    if (invData) setInventoryList(invData);
  };

  const refreshSuppliers = async (branchId: string) => {
    const { data } = await supabase
      .from('suppliers')
      .select('*')
      .eq('branch_id', branchId)
      .order('name');
    if (data) setSupplierList(data);
  };

  useEffect(() => {
    async function loadData() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push('/login');

      // 1. Handle potential null from localStorage
      const savedBranch = localStorage.getItem('active_branch') ?? '';

      // 2. Only proceed if we actually have data
      if (!savedBranch) {
        setLoading(false);
        return;
      }

      try {
        const parsedBranch = JSON.parse(savedBranch);
        const branchId = parsedBranch.id;

        // Ensure branchId itself isn't null/undefined before state update
        if (branchId) {
          setCurrentBranchId(branchId);

          const { data: prof } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();
          setProfile(prof);

          const nextPo = await getNextPoNumber();
          setPoNumber(nextPo);

          // Use the local branchId variable to ensure stability
          await Promise.all([
            fetchInventory(branchId),
            refreshSuppliers(branchId),
          ]);
        }
      } catch (e) {
        console.error('Error parsing branch data:', e);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [router, getNextPoNumber]);

  const handleQuickAddSupplier = async () => {
    if (!supplierSearch || !currentBranchId || !profile?.org_id) return;
    try {
      const { data, error } = await supabase
        .from('suppliers')
        .insert([
          {
            name: supplierSearch,
            branch_id: currentBranchId,
            org_id: profile.org_id,
          },
        ])
        .select()
        .single();
      if (error) throw error;
      await refreshSuppliers(currentBranchId);
      setSupplierSearch(data.name);
      setIsSupplierFocused(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...items];
    const item = { ...newItems[index] };

    if (field === 'inventory_id') {
      const selected = inventoryList.find((p) => p.id === value);
      if (selected) {
        item.inventory_id = value;
        item.item_name = selected.item_name;
        item.item_type = (selected.item_type || 'GENERIC').toUpperCase();
        item.current_price = selected.price || 0;
        item.remaining_stock = selected.stock || 0;
        item.packaging_type = selected.packaging_type || 1;

        // AUTO-MARKUP: Using the keyword matcher
        item.markup = calculateMarkup(item.item_type, item.item_name);

        const newST = [...searchTerms];
        newST[index] = selected.item_name;
        setSearchTerms(newST);
      }
      setActiveSearchIndex(null);
    } else {
      (item as any)[field] = value;

      // RE-CALCULATE if type or name is edited manually
      if (field === 'item_name' || field === 'item_type') {
        item.markup = calculateMarkup(item.item_type, item.item_name);
      }
    }

    // Final Price Calculation
    const qty = Math.max(0, parseFloat(item.qty as any) || 0);
    const pack = Math.max(1, parseFloat(item.packaging_type as any) || 1);
    const invPrice = Math.max(0, parseFloat(item.invoice_price as any) || 0);
    const disc = Math.max(0, parseFloat(item.discount as any) || 0);
    const currentMarkup = parseFloat(item.markup as any) || 0;

    // 1. Calculate Total Buy Cost and round to 2 decimal places
    const rawTotal = qty * invPrice - disc;
    item.buy_cost_total = Math.round(rawTotal * 100) / 100;

    // 2. Calculate Unit Buy Cost and round to 2 decimal places
    const totalUnits = qty * pack;
    if (totalUnits > 0) {
      const rawUnitCost = item.buy_cost_total / totalUnits;
      item.buy_cost = Math.round(rawUnitCost * 100) / 100;
    } else {
      item.buy_cost = 0;
    }

    // 3. Suggested retail price remains rounded up to the nearest whole Peso
    item.new_price = Math.ceil(item.buy_cost * (1 + currentMarkup / 100));

    newItems[index] = item;
    setItems(newItems);
  };
  const handleQuickAdd = async (index: number) => {
    const item = items[index];
    if (!item.item_name || !currentBranchId) return;
    try {
      const { data, error } = await supabase
        .from('inventory')
        .insert([
          {
            item_name: item.item_name,
            branch_id: currentBranchId,
            stock: 0,
            price: item.new_price,
            item_type: item.item_type,
          },
        ])
        .select()
        .single();
      if (error) throw error;
      const newItems = [...items];
      newItems[index] = { ...newItems[index], inventory_id: data.id };
      setItems(newItems);
      await fetchInventory(currentBranchId);
    } catch (err: any) {
      alert(err.message);
    }
  };
  const handleAiUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const fileData = event.target?.result;
      if (typeof fileData !== 'string') {
        setIsScanning(false);
        return;
      }

      try {
        const extracted = await parseInvoiceImage(fileData, file.type);

        if (extracted && Array.isArray(extracted)) {
          const aiMappedItems = extracted.map((extractedItem: any) => {
            const aiName = (extractedItem.item_name || '').trim();

            let bestMatch: any = null;
            let minDistance = Infinity;

            if (Array.isArray(inventoryList) && inventoryList.length > 0) {
              for (const inv of inventoryList) {
                if (!inv?.item_name) continue;

                let distance = getLevenshteinDistance(aiName, inv.item_name);

                // Bonus: If one name is mostly contained in the other (common in AI vs DB)
                const aiLower = aiName.toLowerCase();
                const invLower = inv.item_name.toLowerCase();

                if (aiLower.includes(invLower) || invLower.includes(aiLower)) {
                  distance = Math.min(
                    distance,
                    Math.floor(
                      Math.max(aiName.length, inv.item_name.length) * 0.25
                    )
                  );
                }

                if (distance < minDistance) {
                  minDistance = distance;
                  bestMatch = inv;
                }

                if (distance === 0) break; // exact match
              }
            }

            // === NEW THRESHOLD LOGIC (relative + absolute) ===
            const longerLength = Math.max(
              aiName.length,
              bestMatch?.item_name?.length || 0
            );
            const relativeThreshold = Math.max(
              5,
              Math.floor(longerLength * 0.25)
            ); // allow ~25% difference

            const isGoodMatch =
              minDistance <= 5 || minDistance <= relativeThreshold;
            const isAcceptableMatch =
              minDistance <= 10 ||
              minDistance <= Math.floor(longerLength * 0.35);

            const matchedItem = isAcceptableMatch ? bestMatch : null;

            const price = Math.max(0, Number(extractedItem.invoice_price) || 0);
            const qty = Math.max(1, Number(extractedItem.qty) || 1);

            const finalName = matchedItem?.item_name || aiName;
            const markupVal = calculateMarkup(
              matchedItem?.item_type || 'GENERIC',
              finalName
            );

            return {
              ...EMPTY_ITEM,
              inventory_id: matchedItem?.id || '',
              item_name: finalName,
              item_type: (matchedItem?.item_type || 'GENERIC').toUpperCase(),
              qty,
              invoice_price: price,
              buy_cost: price,
              buy_cost_total: qty * price,
              match_score: matchedItem ? minDistance : 999,
              markup: markupVal,
              new_price: Math.ceil(price * (1 + markupVal / 100)),
              current_price: matchedItem?.price || 0,
              remaining_stock: matchedItem?.stock || 0,
            };
          });

          setItems(aiMappedItems);
          setSearchTerms(aiMappedItems.map((i: any) => i.item_name || ''));
        }
      } catch (err) {
        console.error('AI Extraction Failed:', err);
        alert('Error processing image. Check console for details.');
      } finally {
        setIsScanning(false);
        if (e.target) e.target.value = '';
      }
    };

    reader.readAsDataURL(file);
  };

  const totalTransaction = useMemo(
    () => items.reduce((sum, i) => sum + (i.buy_cost_total || 0), 0),
    [items]
  );

  const filteredSuppliers = useMemo(
    () =>
      supplierList.filter((s) =>
        s.name.toLowerCase().includes(supplierSearch.toLowerCase())
      ),
    [supplierList, supplierSearch]
  );

  const handleSubmit = async () => {
    if (!supplierSearch) return alert('Please enter or select a supplier.');
    if (items.some((i) => !i.inventory_id))
      return alert('Some items are not matched.');

    setIsSubmitting(true);
    try {
      if (!currentBranchId) throw new Error('Branch ID missing');

      // 1. CALCULATE SPLIT TOTALS (This was the missing part)
      const splitTotals = items.reduce(
        (acc, item) => {
          const amount = Number(item.buy_cost_total) || 0;
          if (item.item_type === 'GENERIC') acc.generic += amount;
          else acc.branded += amount;
          return acc;
        },
        { generic: 0, branded: 0 }
      );

      const phtDateString = new Date(new Date().getTime() + 8 * 60 * 60 * 1000)
        .toISOString()
        .split('T');

      // 2. MAP ITEMS FOR RPC
      const mappedItems = items.map((item) => ({
        inventory_id: item.inventory_id,
        item_name: item.item_name,
        item_type: item.item_type,
        qty: Number(item.qty),
        packaging_type: Number(item.packaging_type) || 1,
        unit_cost: Number(item.invoice_price),
        buy_cost: Number(item.buy_cost),
        // Only use the new suggested price if it is higher than the current price
        new_price:
          item.new_price > item.current_price
            ? Number(item.new_price)
            : Number(item.current_price),
      }));

      // 3. CALL RPC
      const { data: generatedPo, error } = await supabase.rpc(
        'process_branch_purchase_order',
        {
          p_supplier_name: supplierSearch,
          p_invoice_id: invoiceId,
          p_total_amount: totalTransaction,
          p_generic_amt: splitTotals.generic,
          p_branded_amt: splitTotals.branded,
          p_branch_id: currentBranchId,
          p_created_by: profile?.id,
          p_created_date_pht: phtDateString,
          p_items_json: mappedItems,
        }
      );

      if (error) throw error;

      // 4. UPDATE LOCAL STATE FOR SUCCESS MODAL
      setFinalGenericAmt(splitTotals.generic);
      setFinalBrandedAmt(splitTotals.branded);
      setIsSuccess(true);
    } catch (err: any) {
      alert(`Transaction Failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading)
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center">
        <Loader2 className="animate-spin text-indigo-500 mb-4" size={42} />
        <p className="text-white/40 text-[10px] uppercase font-black tracking-widest">
          Initializing System
        </p>
      </div>
    );

  if (isSuccess)
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-white/10 rounded-3xl p-10 text-center shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500" />
          <div className="w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-8 border border-emerald-500/30">
            <CheckCircle2 className="text-emerald-400" size={48} />
          </div>
          <h2 className="text-3xl font-black uppercase text-white mb-2 tracking-tighter">
            Order Logged
          </h2>
          <div className="bg-slate-950 rounded-2xl p-6 border border-white/5 mb-8 text-left space-y-4 shadow-inner">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">
                Generic Total
              </span>
              <span className="text-sm font-bold text-indigo-400">
                ₱{finalGenericAmt.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">
                Branded Total
              </span>
              <span className="text-sm font-bold text-amber-400">
                ₱{finalBrandedAmt.toLocaleString()}
              </span>
            </div>
            <div className="h-[1px] bg-white/10" />
            <div className="flex justify-between items-center pt-2">
              <span className="text-[10px] font-black uppercase text-emerald-500/60">
                Grand Total
              </span>
              <span className="text-2xl font-black text-emerald-400">
                ₱{totalTransaction.toLocaleString()}
              </span>
            </div>
          </div>
          <button
            onClick={() => router.push('/staff')}
            className="w-full bg-slate-800 text-slate-950 p-5 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-indigo-400 transition-colors shadow-lg"
          >
            <Home size={16} /> Hub
          </button>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-white text-slate-950 p-5 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-indigo-400 transition-colors shadow-lg"
          >
            Create Another PO
          </button>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans selection:bg-indigo-500/30">
      {isScanning && (
        <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-xl">
          <Loader2 className="animate-spin text-indigo-400 mb-6" size={64} />
          <h2 className="text-2xl font-black uppercase tracking-tighter mb-2">
            Neural Scan in Progress
          </h2>
        </div>
      )}

      <header className="border-b border-white/5 bg-slate-900/40 backdrop-blur-md sticky top-0 z-[1000]">
        <div className="max-w-[1800px] mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-6">
            <button
              onClick={() => router.push('/staff')}
              className="p-3 hover:bg-white/10 rounded-xl transition-all border border-transparent hover:border-white/10"
            >
              <ArrowLeft size={22} />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-black uppercase tracking-tighter">
                  Purchase Order
                </h1>
                <span className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[9px] font-black uppercase tracking-widest">
                  Draft
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">
                  {poNumber} • {urlBranchName}
                </p>
                <button
                  onClick={async () =>
                    currentBranchId && setPoNumber(await getNextPoNumber())
                  }
                  className="p-1 hover:text-indigo-400 transition-colors text-slate-600"
                >
                  <RefreshCw size={12} />
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              id="ai-scan"
              onChange={handleAiUpload}
            />
            <label
              htmlFor="ai-scan"
              className="flex items-center gap-3 px-6 py-3 rounded-2xl border border-white/5 hover:border-indigo-500/50 bg-slate-800/50 cursor-pointer transition-all group"
            >
              <Camera
                size={18}
                className="text-indigo-400 group-hover:scale-110 transition-transform"
              />
              <span className="text-[11px] font-black uppercase tracking-wider">
                AI Auto-Fill
              </span>
            </label>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="bg-indigo-600 hover:bg-indigo-500 px-8 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest flex items-center gap-3 active:scale-95 transition-all"
            >
              {isSubmitting ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <PackageCheck size={18} />
              )}
              <span>Complete Order</span>
            </button>
          </div>
        </div>
      </header>

      <main className="p-8 max-w-[1800px] mx-auto space-y-8">
        <section className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-2 relative group">
            <div className="relative bg-slate-900 p-6 rounded-2xl border border-white/10 shadow-xl">
              <label className="text-[10px] uppercase font-black text-slate-500 tracking-widest block mb-4">
                Supplier Entity
              </label>
              <input
                className="w-full bg-slate-950 border border-white/5 rounded-xl p-4 text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                placeholder="Search or enter supplier..."
                value={supplierSearch}
                onFocus={() => setIsSupplierFocused(true)}
                onBlur={() =>
                  setTimeout(() => setIsSupplierFocused(false), 200)
                }
                onChange={(e) => setSupplierSearch(e.target.value)}
              />
              {isSupplierFocused && (
                <div className="absolute left-0 right-0 top-full mt-2 bg-slate-800 border border-indigo-500/50 rounded-2xl z-[1100] max-h-64 overflow-y-auto p-2 shadow-2xl backdrop-blur-xl">
                  {filteredSuppliers.map((s) => (
                    <div
                      key={s.id}
                      className="px-1 hover:bg-indigo-600 rounded-xl cursor-pointer font-black text-[11px] uppercase tracking-wider transition-colors border-b border-white/5 last:border-0"
                      onClick={() => setSupplierSearch(s.name)}
                    >
                      {s.name}
                    </div>
                  ))}
                  {supplierSearch.length > 1 &&
                    !filteredSuppliers.some(
                      (s) =>
                        s.name.toLowerCase() === supplierSearch.toLowerCase()
                    ) && (
                      <button
                        onClick={handleQuickAddSupplier}
                        className="w-full px-1 mt-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500 transition-all"
                      >
                        + Create Entity: "{supplierSearch}"
                      </button>
                    )}
                </div>
              )}
            </div>
          </div>
          <div className="bg-slate-900 p-6 rounded-2xl border border-white/10 shadow-xl">
            <label className="text-[10px] uppercase font-black text-slate-500 tracking-widest block mb-4">
              Reference Invoice #
            </label>
            <input
              className="w-full bg-slate-950 border border-white/5 rounded-xl p-4 text-sm font-mono focus:border-indigo-500 outline-none"
              placeholder="INV-0000"
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
            />
          </div>
          <div className="bg-slate-900/50 border border-indigo-500/10 p-6 rounded-2xl flex flex-col justify-center shadow-xl">
            <span className="text-[10px] font-black uppercase text-indigo-400 block mb-2 tracking-tighter">
              Transaction Total
            </span>
            <span className="text-2xl font-black">
              ₱{totalTransaction.toLocaleString()}
            </span>
          </div>
        </section>

        <section className="bg-slate-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
          {/* Added pb-64 here to ensure dropdown space below the last row */}
          <div className="w-full overflow-x-auto overflow-y-visible pb-64">
            <table className="w-full text-left table-auto border-separate border-spacing-0">
              <thead className="bg-slate-950 text-slate-500 text-[10px] uppercase font-black sticky top-0 z-[10]">
                <tr>
                  <th className="p-5 min-w-[300px]">Inventory Item Mapping</th>
                  <th className="p-5 text-center w-[120px]">Type</th>
                  <th className="p-5 text-center w-[80px]">Qty</th>
                  <th className="p-5 text-center w-[80px]">Pack</th>
                  <th className="p-5 text-right w-[110px]">Inv Price</th>
                  <th className="p-5 text-right w-[100px]">Disc</th>
                  <th className="p-5 text-right w-[110px] text-indigo-300">
                    Net Cost
                  </th>
                  <th className="p-5 text-right w-[120px] text-white font-black">
                    Total
                  </th>
                  <th className="p-5 text-right w-[110px] text-indigo-400">
                    Current
                  </th>
                  <th className="p-5 text-center w-[80px]">M.Up%</th>
                  <th className="p-5 text-right w-[110px] text-emerald-400">
                    New Sug.
                  </th>
                  <th className="p-5 text-center w-[80px]">Stock</th>
                  <th className="p-5 w-[60px] sticky right-0 bg-slate-950 border-l border-white/10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {isScanning ? (
                  <TableSkeleton />
                ) : (
                  items.map((item, idx) => (
                    <tr
                      key={idx}
                      className={`group hover:bg-white/[0.02] transition-colors relative ${
                        activeSearchIndex === idx ? 'z-50' : 'z-0'
                      }`}
                    >
                      <td className="px-1 relative">
                        <input
                          className={`w-full bg-slate-950 border rounded-xl p-3 text-[12px] font-bold outline-none transition-all ${
                            // RED: No inventory_id linked (needs manual selection or + Add New)
                            !item.inventory_id
                              ? 'border-red-500/50 bg-red-500/5'
                              : // GREEN: Good / Close match
                              (item.match_score ?? 999) <= 5
                              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-50'
                              : // ORANGE: Fuzzy but acceptable match (Review)
                              (item.match_score ?? 999) <= 10
                              ? 'border-amber-500/50 bg-amber-500/10 text-amber-50'
                              : // RED: Poor or no meaningful match
                                'border-red-500/50 bg-red-500/5'
                          }`}
                          placeholder="Type to find product..."
                          value={searchTerms[idx]}
                          onFocus={() => setActiveSearchIndex(idx)}
                          onBlur={() =>
                            setTimeout(() => setActiveSearchIndex(null), 250)
                          }
                          onChange={(e) => {
                            const newVal = e.target.value;
                            const t = [...searchTerms];
                            t[idx] = newVal;
                            setSearchTerms(t);
                            fetchInventory(currentBranchId, newVal);
                          }}
                        />

                        {/* Status Badge for AI Matches */}
                        {item.inventory_id && (
                          <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                            {(item.match_score ?? 999) <= 5 ? (
                              <span className="text-[8px] font-black text-emerald-500/70 uppercase tracking-tighter">
                                Good Match
                              </span>
                            ) : (item.match_score ?? 999) <= 10 ? (
                              <span className="text-[8px] font-black text-amber-500/70 uppercase tracking-tighter">
                                Review
                              </span>
                            ) : (
                              <span className="text-[8px] font-black text-red-500/70 uppercase tracking-tighter">
                                No Match
                              </span>
                            )}
                          </div>
                        )}

                        {activeSearchIndex === idx && (
                          <div className="absolute left-0 right-0 top-full mt-2 bg-slate-900 border border-indigo-500 rounded-2xl z-[60] max-h-64 overflow-y-auto p-1 shadow-2xl">
                            {inventoryList
                              .filter(
                                (i) =>
                                  i.branch_id === currentBranchId &&
                                  i.item_name
                                    .toLowerCase()
                                    .includes(
                                      (searchTerms[idx] || '').toLowerCase()
                                    )
                              )
                              .map((inv) => (
                                <div
                                  key={inv.id}
                                  className="px-3 py-2 hover:bg-indigo-600 rounded-xl cursor-pointer text-[11px] font-black uppercase border-b border-white/5 last:border-0 transition-colors"
                                  onMouseDown={() =>
                                    updateItem(idx, 'inventory_id', inv.id)
                                  }
                                >
                                  <div className="flex justify-between items-center">
                                    <span>{inv.item_name}</span>
                                    <span className="text-[9px] opacity-60">
                                      Stock: {inv.stock}
                                    </span>
                                  </div>
                                </div>
                              ))}
                          </div>
                        )}

                        {!item.inventory_id && searchTerms[idx] !== '' && (
                          <button
                            onClick={() => handleQuickAdd(idx)}
                            className="absolute right-6 top-1/2 -translate-y-1/2 text-[9px] font-black uppercase text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded hover:bg-emerald-400 hover:text-white transition-all"
                          >
                            + Add New
                          </button>
                        )}
                      </td>

                      {/* Rest of the columns remain unchanged */}
                      <td className="px-1 text-center">
                        <button
                          onClick={() =>
                            updateItem(
                              idx,
                              'item_type',
                              item.item_type === 'GENERIC'
                                ? 'BRANDED'
                                : 'GENERIC'
                            )
                          }
                          className={`w-full py-2.5 rounded-lg text-[9px] font-black uppercase border transition-all ${
                            item.item_type === 'GENERIC'
                              ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
                              : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                          }`}
                        >
                          {item.item_type}
                        </button>
                      </td>

                      <td className="px-1">
                        <input
                          type="number"
                          className="w-full bg-slate-950 border border-white/5 p-3 rounded-lg text-center text-[12px] font-bold outline-none"
                          value={item.qty}
                          onChange={(e) =>
                            updateItem(idx, 'qty', e.target.value)
                          }
                        />
                      </td>

                      <td className="px-1">
                        <input
                          type="number"
                          className="w-full bg-slate-950 border border-white/5 p-3 rounded-lg text-center text-[12px] font-bold outline-none"
                          value={item.packaging_type}
                          onChange={(e) =>
                            updateItem(idx, 'packaging_type', e.target.value)
                          }
                        />
                      </td>

                      <td className="px-1">
                        <input
                          type="number"
                          className="w-full bg-slate-950 border border-white/5 p-3 rounded-lg text-right text-[12px] font-bold outline-none"
                          value={item.invoice_price}
                          onChange={(e) =>
                            updateItem(idx, 'invoice_price', e.target.value)
                          }
                        />
                      </td>

                      <td className="px-1">
                        <input
                          type="number"
                          className="w-full bg-slate-950 border border-white/5 p-3 rounded-lg text-right text-[12px] font-bold outline-none"
                          value={item.discount}
                          onChange={(e) =>
                            updateItem(idx, 'discount', e.target.value)
                          }
                        />
                      </td>

                      <td className="px-1 text-right font-black text-indigo-300 text-[12px]">
                        ₱{(item.buy_cost || 0).toFixed(2)}
                      </td>

                      <td className="px-1 text-right font-black text-white text-[12px]">
                        ₱{(item.buy_cost_total || 0).toFixed(2)}
                      </td>

                      <td className="px-1 text-right font-bold text-indigo-400/60 text-[12px]">
                        ₱{(item.current_price || 0).toFixed(2)}
                      </td>

                      <td className="px-1">
                        <input
                          type="number"
                          className="w-full bg-slate-950 border border-white/5 p-3 rounded-lg text-center text-[12px] font-bold outline-none"
                          value={item.markup}
                          onChange={(e) =>
                            updateItem(idx, 'markup', e.target.value)
                          }
                        />
                      </td>

                      <td className="px-1 text-right font-black text-emerald-400 text-[12px]">
                        ₱{(item.new_price || 0).toFixed(2)}
                      </td>

                      <td className="px-1 text-center text-slate-500 text-[11px] font-black">
                        {item.remaining_stock}
                      </td>

                      <td className="px-1 text-center sticky right-0 bg-slate-900 border-l border-white/10 group-hover:bg-slate-800 transition-colors">
                        <button
                          onClick={() => {
                            setItems(items.filter((_, i) => i !== idx));
                            setSearchTerms(
                              searchTerms.filter((_, i) => i !== idx)
                            );
                          }}
                          className="p-2 text-slate-600 hover:text-red-500 transition-all"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <button
            onClick={() => {
              setItems([...items, { ...EMPTY_ITEM }]);
              setSearchTerms([...searchTerms, '']);
            }}
            className="w-full p-6 bg-slate-950/50 hover:bg-indigo-600 hover:text-white text-indigo-400 text-[11px] font-black uppercase tracking-[0.3em] flex items-center justify-center gap-3 border-t border-white/5 transition-all"
          >
            <Plus size={20} /> Add Manifest Row
          </button>
        </section>
      </main>
    </div>
  );
}
