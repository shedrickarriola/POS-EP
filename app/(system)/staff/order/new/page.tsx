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

export default function NewOrderPOS() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showTextPaste, setShowTextPaste] = useState(false);
  const [pastedText, setPastedText] = useState('');

  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false); // ← NEW: Admin check from profiles
  const [products, setProducts] = useState<Product[]>([]);
  const [nextSONumber, setNextSONumber] = useState('SO01');
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  const [isOfficeUse, setIsOfficeUse] = useState(false); // ← NEW: Office use mode
  const [selectedClientTerms, setSelectedClientTerms] = useState<number>(0); // ← NEW
  const [agents, setAgents] = useState<{ id: string; full_name: string }[]>([]); // ← NEW
  const [selectedAgent, setSelectedAgent] = useState<string>('MAIN OFFICE');
  const [chequeDate, setChequeDate] = useState<string>(''); // ← NEW
  const [showTermsError, setShowTermsError] = useState(false); // ← NEW
  const [clientName, setClientName] = useState('WALK-IN'); // ← CHANGED: now defaults to WALK-IN
  const [showExpiryError, setShowExpiryError] = useState(false);
  const [invalidExpiryItems, setInvalidExpiryItems] = useState<string[]>([]);
  const [officeClients, setOfficeClients] = useState<
    {
      id: string;
      client_name: string;
      allowed_terms: number; // ← NEW
      agent?: string;
    }[]
  >([]);
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<
    'CASH' | 'CHEQUE' | 'TERMS'
  >('CASH');
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [searchTerms, setSearchTerms] = useState<string[]>(['']);
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(
    null
  );

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
      lot_number: '', // ← NEW
      expiry_date: '',
    },
  ]);

  const isDrugstoreUser = user?.email === 'drugstore@gmail.com';

  const handleQtyChange = (productId: string, newQty: number) => {
    setItems(
      items.map((item) => {
        if (item.product_id === productId) {
          let currentDiscount = item.discount_percent;

          // Only apply drugstore promo rules in non-office mode
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
  // Inside NewOrderPOS component
  // Update this function
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
        // Load more items when no search term (for "show all on click")
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
            .select('id, client_name, allowed_terms, agent') // ← ONLY CHANGE: added agent
            .eq('branch_id', branchId)
            .order('client_name', { ascending: true });

          if (clientError) throw clientError;
          setOfficeClients(data || []);
        } catch (err: any) {
          console.error('Fetch clients error:', err);
        }
      }
      // === END CLIENT FETCH ===

      // === NEW: OFFICE AGENTS FETCH ===
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
      // === END AGENT FETCH ===
    } catch (err: any) {
      console.error(`Database Error: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  };

  // --- FETCH CLIENTS (only for office use) ---
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

  // --- FETCH AGENTS (only for office use) ---
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

      // Refresh client list and select the new client
      await fetchClients();
      setClientName(trimmed);
      setNewClientName('');
      setShowNewClientModal(false);
    } catch (err: any) {
      console.error(err);
      alert('Failed to save new client: ' + err.message);
    }
  };
  useEffect(() => {
    const initPage = async () => {
      try {
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();
        setUser(authUser);

        // === NEW: Real admin check from profiles table ===
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
        // === END NEW ===

        // 1. Fetch inventory
        await fetchInventory();
        // NEW: Fetch clients for office branches
        if (isOfficeUse) {
          await fetchClients();
        }
        // 2. Get next SO number
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

    // NEW: Office-use branches require proper client name
    const hasValidClient = !isOfficeUse || !!clientName?.trim();

    return {
      total,
      generic_gross,
      branded_gross,
      generic_amt,
      branded_amt,
      total_discount,
      change: cashReceived > total ? cashReceived - total : 0,
      isValid:
        isPaid &&
        total > 0 &&
        items.every((i) => i.product_id) &&
        hasValidClient,
      termsAllowed,
    };
  }, [items, cashReceived, paymentMethod, isOfficeUse, clientName]);

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
  };

  const [confirmedSONumber, setConfirmedSONumber] = useState<string>('');

  const handleSubmit = async () => {
    if (!metrics.isValid || loading) return;

    // === NEW: EXPIRY DATE VALIDATION ===
    if (!validateExpiryDates()) {
      setLoading(false);
      return;
    }
    // === END EXPIRY VALIDATION ===

    // === TERMS VALIDATION ===
    if (paymentMethod === 'TERMS' && selectedClientTerms === 0) {
      setShowTermsError(true);
      setLoading(false);
      return;
    }
    // === END TERMS VALIDATION ===

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

      // === OFFICE USE - Save to clients table (SKIP WALK-IN) ===
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
            } else {
              console.log(`✅ Client "${trimmedName}" saved to clients table`);
            }
          }
        } catch (clientErr: any) {
          console.warn(
            'Client save skipped (non-critical):',
            clientErr.message
          );
        }
      }
      // === END OFFICE CLIENT SAVE ===

      // 1. Create the Order
      const { data: generatedSO, error: soErr } = await supabase.rpc(
        'get_next_so_number'
      );
      if (soErr) throw soErr;

      // Calculate TRUE GROSS from items
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

      // === NEW OFFICE LOGIC: status + due_date ===
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

      // 2. Create Order Items
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

      // 3. Inventory deduction
      const itemsPayloadForRPC = items.map((i) => ({
        product_id: i.product_id,
        qty: Number(i.qty),
      }));

      const { error: rpcErr } = await supabase.rpc('process_inventory_sale', {
        items_json: itemsPayloadForRPC,
        target_branch_id: branch.id,
      });

      if (rpcErr) throw new Error(`Inventory Sync Error: ${rpcErr.message}`);

      // 4. Update daily_reports
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

      // Optional heal
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

  const resetForm = () => {
    setClientName('WALK-IN');
    setCashReceived(0);
    setSearchTerms(['']);
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
        lot_number: '', // ← NEW
        expiry_date: '',
      },
    ]);
    setShowSuccess(false);
    fetchInventory();
  };

  return (
    // FIX: Changed h-screen + overflow-hidden to min-h-screen to allow proper scrolling/padding
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
      {/* NEW CLIENT MODAL - OFFICE USE ONLY */}
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
                setPaymentMethod('CASH'); // auto switch to safe option
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
        <div className="fixed inset-0 z- flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md p-8 shadow-2xl text-center">
            <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-500/30">
              <CheckCircle2 size={40} className="text-emerald-500" />
            </div>
            <h2 className="text-2xl font-black text-white mb-2 uppercase tracking-tighter">
              Order Recorded
            </h2>
            <p className="text-slate-400 mb-8 text-sm">
              Reference {/* Swapped nextSONumber for confirmedSONumber */}
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

      {/* MAIN CONTENT - FIX: MASSIVE pb-[500px] added here */}
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

                  // Auto-update agent if client has one
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

          {/* AGENT DROPDOWN - OFFICE USE ONLY (shorter UI) */}
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

        {/* TABLE SECTION - FIX: overflow-visible applied to allow dropdown to show */}
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
                      <th className="p-3 w-32 text-center">Expiry</th>
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

                  // Improved filtering: show more results and better matching
                  const filteredProducts = products
                    .filter((p) =>
                      p.item_name
                        .toLowerCase()
                        .includes((searchTerms[idx] || '').toLowerCase())
                    )
                    .slice(0, 30); // Increased from 5 to 30

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

                      {/* IMPROVED COMPACT PRODUCT SEARCH COLUMN */}
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

                            {/* COMPACT DROPDOWN */}
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

                      {/* Rest of the columns remain the same */}
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
                      {/* NEW: OFFICE USE ONLY COLUMNS */}
                      {isOfficeUse && (
                        <>
                          {/* Lot# */}
                          <td className="p-1.5">
                            <input
                              type="text"
                              value={item.lot_number || ''}
                              onChange={(e) => {
                                setItems(
                                  items.map((i) =>
                                    i.id === item.id
                                      ? { ...i, lot_number: e.target.value }
                                      : i
                                  )
                                );
                              }}
                              className="w-full bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-[11px] text-center uppercase font-mono outline-none"
                              placeholder="LOT#"
                            />
                          </td>

                          {/* Expiry Date */}
                          <td className="p-1.5">
                            <input
                              type="date"
                              value={item.expiry_date || ''}
                              onChange={(e) => {
                                setItems(
                                  items.map((i) =>
                                    i.id === item.id
                                      ? { ...i, expiry_date: e.target.value }
                                      : i
                                  )
                                );
                              }}
                              className="w-full bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-[11px] text-center font-mono outline-none"
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

                      {/* UNIT PRICE COLUMN - Improved alignment */}
                      <td className="p-1.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Price override lock - only for Office + Admin */}
                          {isOfficeUse && isAdmin && (
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
                            disabled={
                              !item.is_override || !(isOfficeUse && isAdmin)
                            }
                            value={item.price_piece}
                            onChange={(e) =>
                              setItems(
                                items.map((i) =>
                                  i.id === item.id
                                    ? {
                                        ...i,
                                        price_piece: Number(e.target.value),
                                      }
                                    : i
                                )
                              )
                            }
                            className={`w-20 bg-transparent text-right font-bold outline-none text-emerald-400 transition-all ${
                              item.is_override && isOfficeUse && isAdmin
                                ? 'border-b border-orange-500'
                                : ''
                            }`}
                          />
                        </div>
                      </td>

                      {/* === DISCOUNT / ADJUSTMENT COLUMN - Drugstore vs Office === */}
                      <td className="p-1.5 min-w-[130px]">
                        {isOfficeUse ? (
                          // OFFICE MODE: Only admins can use 6% discount or +10% markup
                          <select
                            disabled={!isAdmin}
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
                            className={`w-full bg-slate-800 text-blue-400 font-bold text-center py-1.5 rounded-md outline-none text-[10px] transition-all ${
                              !isAdmin
                                ? 'opacity-40 cursor-not-allowed'
                                : 'border border-amber-400/30'
                            }`}
                          >
                            <option value={0}>No Adjustment</option>
                            <option value={6}>6% Discount</option>
                            <option value={-10}>+10% Markup</option>
                          </select>
                        ) : (
                          // DRUGSTORE MODE: Original discounts (no admin check)
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
      {/* FOOTER - FIXED AT BOTTOM */}
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
          {/* PAYMENT METHOD - OFFICE vs DRUGSTORE */}
          <div className="flex bg-slate-950 p-1 rounded-lg border border-white/5">
            {isOfficeUse ? (
              // OFFICE MODE - full options
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
              // DRUGSTORE MODE - CASH only
              <button className="flex-1 py-2 rounded-md text-[9px] font-black bg-blue-600 text-white shadow-lg cursor-default">
                CASH
              </button>
            )}
          </div>

          {/* CHEQUE DATE - only for office + CHEQUE */}
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

          {/* TERMS INFO + EXPECTED DUE DATE - OFFICE USE ONLY */}
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
          {/* TERMS WARNING (only shows in office mode) */}
          {isOfficeUse &&
            paymentMethod === 'TERMS' &&
            selectedClientTerms === 0 && (
              <div className="mt-2 text-red-400 text-[10px] font-bold flex items-center gap-1 bg-red-950/50 border border-red-500/30 rounded-lg px-3 py-1.5">
                <AlertCircle size={14} />
                TERMS NOT ALLOWED — Client has 0 days terms (COD only)
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
