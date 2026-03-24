'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import {
  Database,
  Loader2,
  AlertTriangle,
  FileDown,
  ArrowLeft,
  Search,
  Package,
  Sparkles,
  TrendingUp,
  ArrowUpRight,
} from 'lucide-react';

export default function InventoryProtocol() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [branchName, setBranchName] = useState<string>('Branch');

  const [viewMode, setViewMode] = useState<'ALL' | 'AI' | 'ITEM_CHECK'>('ALL');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [itemDetails, setItemDetails] = useState<{ sos: any[]; pos: any[] }>({
    sos: [],
    pos: [],
  });
  const [innerSearch, setInnerSearch] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedCheckItem, setSelectedCheckItem] = useState<any>(null);
  const [itemHistory, setItemHistory] = useState<{ sos: any[]; pos: any[] }>({
    sos: [],
    pos: [],
  });

  useEffect(() => {
    const savedBranch = localStorage.getItem('active_branch') ?? '';
    if (savedBranch) {
      try {
        const parsed = JSON.parse(savedBranch);
        setBranchName(parsed.branch_name || 'Branch');
        fetchAllInventory(parsed.id);
      } catch (e) {
        console.error('Error parsing branch', e);
      }
    }
  }, []);
  const [syncProgress, setSyncProgress] = useState({
    current: 0,
    total: 0,
    percentage: 0,
    estimatedSeconds: 0,
  });

  const handleLifetimeSync = async () => {
    const confirmSync = confirm(
      'This will heal missing data and recalculate all stock. Continue?'
    );
    if (!confirmSync) return;

    setIsSyncing(true);
    try {
      const savedBranch = JSON.parse(
        localStorage.getItem('active_branch') || '{}'
      );

      // 1. RUN THE HEALER FIRST
      // This fills in any missing inventory_ids based on item_name
      const { error: healError } = await supabase.rpc(
        'heal_purchase_order_items',
        {
          target_branch_id: savedBranch.id,
        }
      );

      if (healError) throw healError;

      // 2. RUN THE ACTUAL STOCK SYNC
      // Now that IDs are filled, the calculation will be 100% accurate
      const { error: syncError } = await supabase.rpc(
        'sync_all_inventory_stock',
        {
          target_branch_id: savedBranch.id,
        }
      );

      if (syncError) throw syncError;

      // 3. REFRESH UI
      await fetchAllInventory(savedBranch.id);
      alert('System Healed & Sync Complete!');
    } catch (error) {
      console.error('Full Sync Error:', error);
      alert(
        'Process failed. Make sure both SQL functions are created in Supabase.'
      );
    } finally {
      setIsSyncing(false);
    }
  };
  const fetchItemHistory = async (inventoryItem: any) => {
    setLoading(true);
    try {
      // 1. Fetch Sales Orders containing this item name/SKU
      const { data: sos } = await supabase
        .from('order_items')
        .select('*, orders(order_number, created_at, status)')
        .eq('item_name', inventoryItem.item_name) // Or use SKU if you have it
        .order('created_at', { ascending: false });

      // 2. Fetch Purchase Orders containing this item
      const { data: pos } = await supabase
        .from('purchase_order_items')
        .select('*, purchase_orders(po_number, created_at, status)')
        .eq('item_name', inventoryItem.item_name)
        .order('created_at', { ascending: false });

      setItemHistory({ sos: sos || [], pos: pos || [] });
      setSelectedCheckItem(inventoryItem);
    } finally {
      setLoading(false);
    }
  };
  const fetchAllInventory = async (id: string) => {
    setLoading(true);
    try {
      let allData: any[] = [];
      let from = 0;
      let to = 999;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase
          .from('inventory')
          .select('*')
          .eq('branch_id', id)
          .order('item_name', { ascending: true })
          .range(from, to);
        if (error) throw error;
        if (data && data.length > 0) {
          allData = [...allData, ...data];
          from += 1000;
          to += 1000;
        } else {
          hasMore = false;
        }
      }
      setInventory(allData);
    } catch (err: any) {
      console.error('Fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchItemContext = async (item: any) => {
    if (expandedItemId === item.id) {
      setExpandedItemId(null);
      return;
    }
    setExpandedItemId(item.id);

    try {
      const savedBranch = JSON.parse(
        localStorage.getItem('active_branch') || '{}'
      );

      // Fetch Outbound using product_id
      const { data: sos } = await supabase
        .from('order_items')
        .select('quantity, orders!inner(order_number, status, branch_id)')
        .eq('product_id', item.id)
        .eq('orders.branch_id', savedBranch.id);

      // Fetch Inbound using inventory_id
      const { data: pos } = await supabase
        .from('purchase_order_items')
        .select('quantity, purchase_orders!inner(po_number, status, branch_id)')
        .eq('inventory_id', item.id)
        .eq('purchase_orders.branch_id', savedBranch.id);

      setItemDetails({ sos: sos || [], pos: pos || [] });
    } catch (error) {
      console.error('Audit fetch error:', error);
    }
  };

  // AI Logic: Prioritizes high velocity items with low stock
  const aiRecommendations = useMemo(() => {
    return inventory
      .map((item) => {
        const weekly = Number(item.sold_weekly || 0);
        const yearly = Number(item.sold_yearly || 0);
        const stock = Number(item.stock || 0);

        // Calculate a priority score (Higher = more urgent)
        // We weigh weekly sales heavily (x10) and yearly sales (x1)
        // Then divide by stock (if stock is 0, we treat it as 0.5 to avoid infinity)
        const salesVelocity = weekly * 10 + yearly * 0.1;
        const priorityScore = salesVelocity / (stock <= 0 ? 0.5 : stock);

        return { ...item, priorityScore, isCritical: stock <= weekly };
      })
      .filter((item) => item.priorityScore > 2 || item.isCritical) // Only show items needing attention
      .sort((a, b) => b.priorityScore - a.priorityScore); // Highest priority first
  }, [inventory]);

  const displayData = useMemo(() => {
    const source = viewMode === 'AI' ? aiRecommendations : inventory;
    return source.filter((item) =>
      item.item_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [viewMode, inventory, aiRecommendations, searchTerm]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-indigo-500/30">
      <div className="max-w-[1600px] mx-auto p-4 space-y-3">
        {/* Header Section */}
        <div className="flex items-center justify-between bg-slate-900/40 p-3 rounded-lg border border-white/5">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-2 hover:bg-white/5 rounded-lg text-slate-400 transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-lg font-black tracking-tighter uppercase flex items-center gap-2 italic">
                <Package className="text-indigo-500" size={18} />
                {branchName} <span className="text-slate-600">Inventory</span>
              </h1>
              <div className="flex gap-3 mt-1">
                <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">
                  Master Records: {inventory.length}
                </p>
                <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest flex items-center gap-1">
                  <Sparkles size={10} /> AI Recommendations:{' '}
                  {aiRecommendations.length}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleLifetimeSync}
              disabled={isSyncing}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[9px] font-black transition-all border ${
                isSyncing
                  ? 'bg-slate-800 text-slate-500 border-white/5'
                  : 'bg-amber-600/10 text-amber-500 border-amber-600/20 hover:bg-amber-600 hover:text-white'
              }`}
            >
              {isSyncing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Database size={12} />
              )}
              {isSyncing ? 'RECALCULATING...' : 'LIFETIME SYNC'}
            </button>

            <div className="flex bg-slate-950 p-1 rounded-md border border-white/10">
              <button
                onClick={() => setViewMode('ALL')}
                className={`px-3 py-1 text-[9px] font-black rounded transition-all ${
                  viewMode === 'ALL'
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-400'
                }`}
              >
                FULL INVENTORY
              </button>
              <button
                onClick={() => setViewMode('AI')}
                className={`px-3 py-1 text-[9px] font-black rounded flex items-center gap-1 transition-all ${
                  viewMode === 'AI'
                    ? 'bg-indigo-600 text-white shadow-lg'
                    : 'text-slate-600 hover:text-slate-400'
                }`}
              >
                <Sparkles size={10} /> AI REORDER
              </button>
            </div>

            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
                size={12}
              />
              <input
                type="text"
                placeholder="QUICK FIND..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-slate-950 border border-white/10 rounded-md pl-8 pr-4 py-1 text-[10px] font-bold w-48 focus:border-indigo-500 outline-none uppercase transition-all focus:w-64"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="h-[70vh] flex flex-col items-center justify-center gap-3 italic">
            <Loader2 className="animate-spin text-indigo-500" size={30} />
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-600">
              Reconciling Master Data...
            </span>
          </div>
        ) : (
          <div className="bg-slate-900/50 border border-white/5 rounded-lg overflow-hidden shadow-2xl">
            <div className="overflow-x-auto max-h-[80vh]">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-950 sticky top-0 z-10 border-b border-white/10">
                  <tr className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                    <th className="px-3 py-2 w-12 text-center">Rank</th>
                    <th className="px-3 py-2">Item Description</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                    <th className="px-3 py-2 text-center bg-indigo-500/5">
                      Sold Wkly
                    </th>
                    <th className="px-3 py-2 text-center">Sold Yrly</th>
                    <th className="px-3 py-2 text-right">Current Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {displayData.map((item, idx) => {
                    const isCritical = item.stock <= (item.sold_weekly || 0);
                    const isExpanded = expandedItemId === item.id;

                    return (
                      <React.Fragment key={item.id}>
                        <tr
                          onClick={() => fetchItemContext(item)}
                          className={`group hover:bg-indigo-500/[0.04] transition-all cursor-pointer ${
                            isExpanded ? 'bg-indigo-500/[0.08]' : ''
                          }`}
                        >
                          <td className="px-3 py-1.5 text-[9px] font-mono text-slate-600 text-center">
                            {idx + 1}
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-slate-300 uppercase truncate max-w-md">
                                {item.item_name}
                              </span>
                              {isExpanded && (
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-right text-[10px] font-mono text-emerald-500 font-bold">
                            ₱{Number(item.price || 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-[10px] font-mono text-slate-500">
                            ₱{Number(item.buy_cost || 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-1.5 text-center text-[10px] font-black text-indigo-400 bg-indigo-500/[0.02]">
                            {item.sold_weekly || 0}
                          </td>
                          <td className="px-3 py-1.5 text-center text-[10px] font-bold text-slate-600">
                            {item.sold_yearly || 0}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {isCritical && (
                                <AlertTriangle
                                  size={10}
                                  className="text-amber-500 animate-pulse"
                                />
                              )}
                              <span
                                className={`text-[10px] font-black font-mono ${
                                  item.stock <= 0
                                    ? 'text-red-600'
                                    : isCritical
                                    ? 'text-amber-500'
                                    : 'text-indigo-400'
                                }`}
                              >
                                {item.stock}
                              </span>
                            </div>
                          </td>
                        </tr>

                        {/* AUDIT DRAWER */}
                        {isExpanded && (
                          <tr>
                            <td
                              colSpan={7}
                              className="p-0 border-l-2 border-indigo-500 bg-black/40"
                            >
                              <div className="p-4 space-y-4 animate-in slide-in-from-top-2 duration-300">
                                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                                  <span className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter">
                                    Stock Audit Log — {item.item_name}
                                  </span>
                                  <div className="relative">
                                    <Search
                                      className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600"
                                      size={10}
                                    />
                                    <input
                                      placeholder="FILTER PO# / SO#..."
                                      value={innerSearch}
                                      onChange={(e) =>
                                        setInnerSearch(e.target.value)
                                      }
                                      className="bg-slate-900 border border-white/10 rounded px-6 py-1 text-[9px] w-48 outline-none focus:border-indigo-500"
                                    />
                                  </div>
                                </div>
                                <div className="mb-4 flex gap-4">
                                  <div className="bg-white/5 px-3 py-2 rounded border border-white/10">
                                    <p className="text-[7px] uppercase text-slate-500">
                                      Calculated Ledger
                                    </p>
                                    <p className="text-sm font-mono font-bold text-indigo-400">
                                      {itemDetails.pos.reduce(
                                        (acc, curr) =>
                                          acc + (Number(curr.quantity) || 0),
                                        0
                                      ) -
                                        itemDetails.sos.reduce(
                                          (acc, curr) =>
                                            acc + (Number(curr.quantity) || 0),
                                          0
                                        )}
                                    </p>
                                  </div>
                                  <div className="bg-white/5 px-3 py-2 rounded border border-white/10">
                                    <p className="text-[7px] uppercase text-slate-500">
                                      Current DB Stock
                                    </p>
                                    <p className="text-sm font-mono font-bold text-white">
                                      {item.stock}
                                    </p>
                                  </div>
                                </div>
                                {/* INSIDE THE AUDIT DRAWER MAPPING */}
                                {/* INSIDE THE AUDIT DRAWER MAPPING */}
                                <div className="grid grid-cols-2 gap-6">
                                  {/* PURCHASE ORDERS (INBOUND) */}
                                  <div className="space-y-2">
                                    <div className="flex justify-between items-end border-b border-emerald-500/30 pb-1">
                                      <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">
                                        Inbound (Purchase Orders)
                                      </p>
                                      <p className="text-[10px] font-mono font-bold text-emerald-400">
                                        Total:{' '}
                                        {itemDetails.pos.reduce(
                                          (acc, curr) =>
                                            acc + (Number(curr.quantity) || 0),
                                          0
                                        )}
                                      </p>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto space-y-1 pr-2">
                                      {itemDetails.pos
                                        .filter((p) =>
                                          (p.purchase_orders?.po_number ?? '')
                                            .toUpperCase()
                                            .includes(innerSearch.toUpperCase())
                                        )
                                        .map((p, i) => (
                                          <div
                                            key={i}
                                            className="flex justify-between items-center bg-white/5 p-2 rounded border border-white/5 font-mono text-[9px]"
                                          >
                                            <span className="text-slate-400">
                                              {p.purchase_orders?.po_number ??
                                                'UNKNOWN PO'}
                                            </span>
                                            <span className="text-emerald-400 font-bold">
                                              +{p.quantity}
                                            </span>
                                          </div>
                                        ))}
                                    </div>
                                  </div>

                                  {/* SALES ORDERS (OUTBOUND) */}
                                  <div className="space-y-2">
                                    <div className="flex justify-between items-end border-b border-red-500/30 pb-1">
                                      <p className="text-[8px] font-black text-red-500 uppercase tracking-widest">
                                        Outbound (Sales Orders)
                                      </p>
                                      <p className="text-[10px] font-mono font-bold text-red-400">
                                        Total:{' '}
                                        {itemDetails.sos.reduce(
                                          (acc, curr) =>
                                            acc + (Number(curr.quantity) || 0),
                                          0
                                        )}
                                      </p>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto space-y-1 pr-2">
                                      {itemDetails.sos
                                        .filter((s) =>
                                          (s.orders?.order_number ?? '')
                                            .toUpperCase()
                                            .includes(innerSearch.toUpperCase())
                                        )
                                        .map((s, i) => (
                                          <div
                                            key={i}
                                            className="flex justify-between items-center bg-white/5 p-2 rounded border border-white/5 font-mono text-[9px]"
                                          >
                                            <span className="text-slate-400">
                                              {s.orders?.order_number ??
                                                'UNKNOWN SO'}
                                            </span>
                                            <span className="text-red-400 font-bold">
                                              -{s.quantity}
                                            </span>
                                          </div>
                                        ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
