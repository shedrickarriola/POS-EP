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
  X,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export default function InventoryProtocol() {
  // Toast system (modern success UI)
  const [toast, setToast] = useState<{
    show: boolean;
    msg: string;
    type: 'success' | 'error';
  }>({
    show: false,
    msg: '',
    type: 'success',
  });

  const triggerToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, msg, type });
    setTimeout(() => {
      setToast((prev) => ({ ...prev, show: false }));
    }, 3000);
  };
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [branchName, setBranchName] = useState<string>('Branch');
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const [viewMode, setViewMode] = useState<'ALL' | 'AI' | 'ITEM_CHECK'>('ALL');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [itemDetails, setItemDetails] = useState<{
    sos: any[];
    pos: any[];
    adjustments: any[];
  }>({
    sos: [],
    pos: [],
    adjustments: [],
  });
  const [innerSearch, setInnerSearch] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  // Auditor & Adjustment Modal
  const [isAuditor, setIsAuditor] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [adjustmentForm, setAdjustmentForm] = useState({
    quantity: 0,
    reason: '',
    notes: '',
  });
  const [selectedCheckItem, setSelectedCheckItem] = useState<any>(null);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryData, setSummaryData] = useState<any[]>([]);
  const [detailData, setDetailData] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Fetch auditor status
  useEffect(() => {
    const getAuditorStatus = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('auditor')
          .eq('id', user.id)
          .single();
        setIsAuditor(data?.auditor || false);
      }
    };
    getAuditorStatus();
  }, []);

  // Load branch + inventory
  useEffect(() => {
    const savedBranch = localStorage.getItem('active_branch') ?? '';
    if (savedBranch) {
      try {
        const parsed = JSON.parse(savedBranch);
        setBranchName(parsed.branch_name || 'Branch');
        fetchAllInventory(parsed.id); // ← Now defined
      } catch (e) {
        console.error('Error parsing branch', e);
      }
    }
  }, []);

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
    setLoading(true);

    try {
      const savedBranch = JSON.parse(
        localStorage.getItem('active_branch') || '{}'
      );
      const branchId = savedBranch.id;

      const { data, error } = await supabase.rpc('get_item_audit', {
        p_branch_id: branchId,
        p_inventory_id: item.id,
      });

      if (error) throw error;

      const pos = (data || []).filter((row: any) => row.type === 'inbound');
      const sos = (data || []).filter((row: any) => row.type === 'outbound');
      const adjustments = (data || []).filter(
        (row: any) => row.type === 'adjustment'
      );

      setItemDetails({ sos, pos, adjustments });
    } catch (error: any) {
      console.error('Audit fetch error:', error);
      alert(`Failed to load audit: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLifetimeSync = async () => {
    setShowSyncConfirm(true);
  };

  // AI Logic
  const aiRecommendations = useMemo(() => {
    return inventory
      .map((item) => {
        const weekly = Number(item.sold_weekly || 0);
        const yearly = Number(item.sold_yearly || 0);
        const stock = Number(item.stock || 0);
        const salesVelocity = weekly * 10 + yearly * 0.1;
        const priorityScore = salesVelocity / (stock <= 0 ? 0.5 : stock);
        return { ...item, priorityScore, isCritical: stock <= weekly };
      })
      .filter((item) => item.priorityScore > 2 || item.isCritical)
      .sort((a, b) => b.priorityScore - a.priorityScore);
  }, [inventory]);

  const displayData = useMemo(() => {
    const source = viewMode === 'AI' ? aiRecommendations : inventory;
    return source.filter((item) =>
      item.item_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [viewMode, inventory, aiRecommendations, searchTerm]);

  // Submit Adjustment
  const handleSubmitAdjustment = async () => {
    if (!adjustmentForm.quantity || !adjustmentForm.reason) {
      triggerToast('Quantity and Reason are required', 'error');
      return;
    }

    const savedBranch = JSON.parse(
      localStorage.getItem('active_branch') || '{}'
    );

    try {
      const { error } = await supabase.rpc('apply_inventory_adjustment', {
        p_branch_id: savedBranch.id,
        p_inventory_id: selectedCheckItem.id,
        p_quantity: Number(adjustmentForm.quantity),
        p_reason: adjustmentForm.reason,
        p_notes: adjustmentForm.notes || null,
      });

      if (error) throw error;

      triggerToast('Adjustment applied successfully!', 'success'); // ← Modern toast

      setShowAdjustmentModal(false);
      setAdjustmentForm({ quantity: 0, reason: '', notes: '' });

      await fetchAllInventory(savedBranch.id);
      if (expandedItemId) {
        const currentItem = inventory.find((i) => i.id === expandedItemId);
        if (currentItem) await fetchItemContext(currentItem);
      }
    } catch (err: any) {
      console.error(err);
      triggerToast('Failed to apply adjustment: ' + err.message, 'error');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-indigo-500/30">
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
      <div className="max-w-[1600px] mx-auto p-4 space-y-3">
        {/* Header */}
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

            {isAuditor && (
              <button
                onClick={() => {
                  if (!expandedItemId) {
                    alert('Please expand an item first to make an adjustment');
                    return;
                  }
                  const item = inventory.find((i) => i.id === expandedItemId);
                  if (item) {
                    setSelectedCheckItem(item);
                    setShowAdjustmentModal(true);
                  }
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[9px] font-black bg-rose-600/10 text-rose-500 border border-rose-600/20 hover:bg-rose-600 hover:text-white transition-all"
              >
                <AlertTriangle size={12} />
                MAKE ADJUSTMENT
              </button>
            )}
            {isAuditor && (
              <>
                <button
                  onClick={async () => {
                    const savedBranch = JSON.parse(
                      localStorage.getItem('active_branch') || '{}'
                    );
                    const { data } = await supabase.rpc(
                      'get_adjustment_summary',
                      {
                        p_branch_id: savedBranch.id,
                      }
                    );
                    setSummaryData(data || []);
                    setShowSummaryModal(true);
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[9px] font-black bg-violet-600/10 text-violet-400 border border-violet-600/20 hover:bg-violet-600 hover:text-white transition-all"
                >
                  📊 SUMMARY
                </button>

                {/* Existing MAKE ADJUSTMENT button stays here */}
              </>
            )}
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

                        {isExpanded && (
                          <tr>
                            <td
                              colSpan={7}
                              className="p-0 border-l-2 border-indigo-500 bg-black/40"
                            >
                              <div className="p-4 space-y-4">
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
                                      placeholder="FILTER..."
                                      value={innerSearch}
                                      onChange={(e) =>
                                        setInnerSearch(e.target.value)
                                      }
                                      className="bg-slate-900 border border-white/10 rounded px-6 py-1 text-[9px] w-48 outline-none focus:border-indigo-500"
                                    />
                                  </div>
                                </div>

                                {/* Calculated Ledger */}
                                <div className="mb-4 flex gap-4">
                                  <div className="bg-white/5 px-3 py-2 rounded border border-white/10">
                                    <p className="text-[7px] uppercase text-slate-500">
                                      Calculated Ledger
                                    </p>
                                    <p className="text-sm font-mono font-bold text-indigo-400">
                                      {itemDetails.pos.reduce(
                                        (acc, curr) =>
                                          acc + Number(curr.quantity || 0),
                                        0
                                      ) +
                                        itemDetails.adjustments.reduce(
                                          (acc, curr) =>
                                            acc + Number(curr.quantity || 0),
                                          0
                                        ) -
                                        itemDetails.sos.reduce(
                                          (acc, curr) =>
                                            acc + Number(curr.quantity || 0),
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

                                <div className="grid grid-cols-3 gap-6">
                                  {/* INBOUND */}
                                  <div className="space-y-px">
                                    <div className="flex justify-between items-end border-b border-emerald-500/30 pb-1">
                                      <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">
                                        Inbound (Purchase Orders)
                                      </p>
                                      <p className="text-[10px] font-mono font-bold text-emerald-400">
                                        Total: {itemDetails.pos.length} •{' '}
                                        {itemDetails.pos.reduce(
                                          (a, c) => a + Number(c.quantity || 0),
                                          0
                                        )}{' '}
                                        qty
                                      </p>
                                    </div>
                                    <div className="max-h-52 overflow-y-auto pr-2 space-y-px">
                                      {itemDetails.pos
                                        .filter((p: any) =>
                                          (p.doc_number ?? '')
                                            .toUpperCase()
                                            .includes(innerSearch.toUpperCase())
                                        )
                                        .map((p: any, i: number) => (
                                          <div
                                            key={i}
                                            className="flex items-center justify-between bg-white/5 hover:bg-white/10 px-3 py-1 rounded text-[10px] font-mono border border-white/5"
                                          >
                                            <div className="flex items-center gap-3">
                                              <span className="text-emerald-400 font-bold tabular-nums w-14">
                                                {p.created_date_pht}
                                              </span>
                                              <span className="text-slate-200 font-semibold">
                                                {p.doc_number}
                                              </span>
                                            </div>
                                            <span className="text-emerald-400 font-bold">
                                              +{p.quantity}
                                            </span>
                                          </div>
                                        ))}
                                    </div>
                                  </div>

                                  {/* OUTBOUND */}
                                  <div className="space-y-px">
                                    <div className="flex justify-between items-end border-b border-red-500/30 pb-1">
                                      <p className="text-[8px] font-black text-red-500 uppercase tracking-widest">
                                        Outbound (Sales Orders)
                                      </p>
                                      <p className="text-[10px] font-mono font-bold text-red-400">
                                        Total: {itemDetails.sos.length} •{' '}
                                        {itemDetails.sos.reduce(
                                          (a, c) => a + Number(c.quantity || 0),
                                          0
                                        )}{' '}
                                        qty
                                      </p>
                                    </div>
                                    <div className="max-h-52 overflow-y-auto pr-2 space-y-px">
                                      {itemDetails.sos
                                        .filter((s: any) =>
                                          (s.doc_number ?? '')
                                            .toUpperCase()
                                            .includes(innerSearch.toUpperCase())
                                        )
                                        .map((s: any, i: number) => (
                                          <div
                                            key={i}
                                            className="flex items-center justify-between bg-white/5 hover:bg-white/10 px-3 py-1 rounded text-[10px] font-mono border border-white/5"
                                          >
                                            <div className="flex items-center gap-3">
                                              <span className="text-red-400 font-bold tabular-nums w-14">
                                                {s.created_date_pht}
                                              </span>
                                              <span className="text-slate-200 font-semibold">
                                                {s.doc_number}
                                              </span>
                                            </div>
                                            <span className="text-red-400 font-bold">
                                              -{s.quantity}
                                            </span>
                                          </div>
                                        ))}
                                    </div>
                                  </div>

                                  {/* ADJUSTMENTS */}
                                  <div className="space-y-px">
                                    <div className="flex justify-between items-end border-b border-amber-500/30 pb-1">
                                      <p className="text-[8px] font-black text-amber-500 uppercase tracking-widest">
                                        Adjustments
                                      </p>
                                      <p className="text-[10px] font-mono font-bold text-amber-400">
                                        Total: {itemDetails.adjustments.length}{' '}
                                        •{' '}
                                        {itemDetails.adjustments.reduce(
                                          (a, c) => a + Number(c.quantity || 0),
                                          0
                                        )}{' '}
                                        qty
                                      </p>
                                    </div>
                                    <div className="max-h-52 overflow-y-auto pr-2 space-y-px">
                                      {itemDetails.adjustments
                                        .filter((a: any) =>
                                          (a.doc_number ?? '')
                                            .toUpperCase()
                                            .includes(innerSearch.toUpperCase())
                                        )
                                        .map((a: any, i: number) => (
                                          <div
                                            key={i}
                                            className="flex items-center justify-between bg-white/5 hover:bg-white/10 px-3 py-1 rounded text-[10px] font-mono border border-white/5"
                                          >
                                            <div className="flex-1">
                                              <div className="flex items-center gap-3">
                                                <span className="text-amber-400 font-bold tabular-nums w-14">
                                                  {a.created_date_pht}
                                                </span>
                                                <span className="text-slate-200 font-semibold">
                                                  {a.adjusted_by_name}
                                                </span>
                                              </div>
                                              <span className="text-[8px] text-amber-300">
                                                ({a.reason})
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                              <span
                                                className={`font-bold ${
                                                  Number(a.quantity) >= 0
                                                    ? 'text-emerald-400'
                                                    : 'text-red-400'
                                                }`}
                                              >
                                                {Number(a.quantity) >= 0
                                                  ? '+'
                                                  : ''}
                                                {a.quantity}
                                              </span>
                                              {isAuditor && (
                                                <button
                                                  onClick={async (e) => {
                                                    e.stopPropagation();
                                                    if (
                                                      !confirm(
                                                        'Delete this adjustment and reverse the stock?'
                                                      )
                                                    )
                                                      return;
                                                    const adjId =
                                                      a.doc_number.replace(
                                                        'ADJ-',
                                                        ''
                                                      );
                                                    const { error } =
                                                      await supabase.rpc(
                                                        'delete_inventory_adjustment',
                                                        {
                                                          p_adjustment_id:
                                                            adjId,
                                                        }
                                                      );
                                                    if (error)
                                                      alert(error.message);
                                                    else {
                                                      const savedBranch =
                                                        JSON.parse(
                                                          localStorage.getItem(
                                                            'active_branch'
                                                          ) || '{}'
                                                        );
                                                      await fetchAllInventory(
                                                        savedBranch.id
                                                      );
                                                      await fetchItemContext(
                                                        item
                                                      );
                                                    }
                                                  }}
                                                  className="text-red-400 hover:text-red-500 text-xs px-1"
                                                >
                                                  ✕
                                                </button>
                                              )}
                                            </div>
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
      {/* LIFETIME SYNC CONFIRMATION MODAL */}
      {showSyncConfirm && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999]">
          <div className="bg-slate-900 rounded-3xl w-full max-w-md mx-4 p-8 border border-amber-500/30">
            <div className="flex justify-center mb-6">
              <AlertTriangle size={48} className="text-amber-500" />
            </div>

            <h2 className="text-center text-xl font-black uppercase tracking-tighter text-amber-400 mb-2">
              Lifetime Sync
            </h2>
            <p className="text-center text-slate-300 mb-8 leading-relaxed">
              This will heal missing data and recalculate all stock levels.
              <br />
              This process can take some time.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowSyncConfirm(false)}
                className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 rounded-2xl text-sm font-black uppercase tracking-widest text-slate-300 transition-all"
              >
                CANCEL
              </button>
              <button
                onClick={async () => {
                  setShowSyncConfirm(false);
                  setIsSyncing(true);

                  try {
                    const savedBranch = JSON.parse(
                      localStorage.getItem('active_branch') || '{}'
                    );

                    const { error: healError } = await supabase.rpc(
                      'heal_purchase_order_items',
                      {
                        target_branch_id: savedBranch.id,
                      }
                    );
                    if (healError) throw healError;

                    const { error: syncError } = await supabase.rpc(
                      'sync_all_inventory_stock',
                      {
                        target_branch_id: savedBranch.id,
                      }
                    );
                    if (syncError) throw syncError;

                    await fetchAllInventory(savedBranch.id);
                    triggerToast('System Healed & Sync Complete!', 'success');
                  } catch (error: any) {
                    console.error('Full Sync Error:', error);
                    triggerToast('Sync failed. Please check console.', 'error');
                  } finally {
                    setIsSyncing(false);
                  }
                }}
                className="flex-1 py-4 bg-amber-600 hover:bg-amber-500 rounded-2xl text-sm font-black uppercase tracking-widest text-white transition-all"
              >
                PROCEED WITH SYNC
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Adjustment Modal */}
      {/* IMPROVED MAKE ADJUSTMENT MODAL */}
      {showAdjustmentModal && selectedCheckItem && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999]">
          <div className="bg-slate-900 rounded-3xl w-full max-w-md mx-4 p-8 border border-rose-500/30">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black uppercase tracking-tighter text-rose-400">
                Stock Adjustment
              </h2>
              <button
                onClick={() => setShowAdjustmentModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <p className="text-sm font-medium mb-6">
              {selectedCheckItem.item_name}
            </p>

            <div className="space-y-6">
              {/* Quantity - Text input with strict validation */}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                  Quantity <span className="text-rose-400">(+ or -)</span>
                </label>
                <input
                  type="text"
                  value={adjustmentForm.quantity}
                  onChange={(e) => {
                    const val = e.target.value;
                    // Only allow: optional leading "-" followed by digits only
                    if (/^-?\d*$/.test(val)) {
                      setAdjustmentForm({ ...adjustmentForm, quantity: val });
                    }
                  }}
                  className="w-full bg-slate-950 border border-white/10 rounded-2xl px-5 py-5 text-3xl font-mono text-center outline-none focus:border-rose-500"
                  placeholder="0"
                />
                <p className="text-[9px] text-slate-500 mt-1">
                  Whole numbers only. Use - for reduction.
                </p>
              </div>

              {/* Dynamic Reason Dropdown */}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                  Reason
                </label>
                <select
                  value={adjustmentForm.reason}
                  onChange={(e) =>
                    setAdjustmentForm({
                      ...adjustmentForm,
                      reason: e.target.value,
                    })
                  }
                  className="w-full bg-slate-950 border border-white/10 rounded-2xl px-5 py-5 outline-none focus:border-rose-500 text-sm"
                >
                  <option value="">Select reason...</option>

                  {/* Positive reasons (adding stock) */}
                  {Number(adjustmentForm.quantity) > 0 && (
                    <>
                      <option value="found_extra">Found Extra Stock</option>
                      <option value="cycle_count_correction">
                        Cycle Count Correction
                      </option>
                      <option value="return_from_customer">
                        Return from Customer
                      </option>
                      <option value="other_positive">Other (Positive)</option>
                    </>
                  )}

                  {/* Negative reasons (removing stock) */}
                  {Number(adjustmentForm.quantity) < 0 && (
                    <>
                      <option value="physical_shortage">
                        Physical Shortage
                      </option>
                      <option value="damage">Damage / Breakage</option>
                      <option value="spoiled">Spoiled / Expired</option>
                      <option value="theft">Theft / Loss</option>
                      <option value="other_negative">Other (Negative)</option>
                    </>
                  )}

                  {/* Common fallback if quantity = 0 */}
                  {Number(adjustmentForm.quantity) === 0 && (
                    <option value="other">Other</option>
                  )}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  value={adjustmentForm.notes}
                  onChange={(e) =>
                    setAdjustmentForm({
                      ...adjustmentForm,
                      notes: e.target.value,
                    })
                  }
                  rows={3}
                  className="w-full bg-slate-950 border border-white/10 rounded-2xl px-5 py-4 outline-none focus:border-rose-500"
                  placeholder="Auditor notes..."
                />
              </div>

              <button
                onClick={handleSubmitAdjustment}
                className="w-full py-5 bg-rose-600 hover:bg-rose-500 rounded-2xl text-sm font-black uppercase tracking-widest text-white transition-all"
              >
                CONFIRM ADJUSTMENT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADJUSTMENT SUMMARY MODAL */}
      {showSummaryModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999]">
          <div className="bg-slate-900 rounded-3xl w-full max-w-4xl mx-4 p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black uppercase tracking-tighter text-violet-400">
                Adjustment Summary
              </h2>
              <button
                onClick={() => setShowSummaryModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-800 sticky top-0">
                  <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-center"># Adj</th>
                    <th className="px-4 py-3 text-right">Net Qty</th>
                    <th className="px-4 py-3 text-right">Generic</th>
                    <th className="px-4 py-3 text-right">Branded</th>
                    <th className="px-4 py-3 text-right">Cost Impact</th>
                    <th className="px-4 py-3 text-right">Retail Impact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {summaryData.map((row) => (
                    <tr
                      key={row.adjustment_date}
                      onClick={async () => {
                        const savedBranch = JSON.parse(
                          localStorage.getItem('active_branch') || '{}'
                        );
                        const { data } = await supabase.rpc(
                          'get_adjustment_details',
                          {
                            p_branch_id: savedBranch.id,
                            p_date: row.adjustment_date,
                          }
                        );
                        setDetailData(data || []);
                        setSelectedDate(row.adjustment_date);
                      }}
                      className="hover:bg-white/5 cursor-pointer"
                    >
                      <td className="px-4 py-3 font-mono text-sm">
                        {row.adjustment_date}
                      </td>
                      <td className="px-4 py-3 text-center font-bold">
                        {row.total_adjustments}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {row.net_quantity}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-blue-400">
                        {row.generic_qty}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-amber-400">
                        {row.branded_qty}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        ₱{Number(row.total_buy_cost_impact).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        ₱{Number(row.total_retail_impact).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Detail view when a date is selected */}
            {selectedDate && detailData.length > 0 && (
              <div className="mt-8 border-t border-white/10 pt-6">
                <h3 className="text-sm font-black mb-4">
                  Details — {selectedDate}
                </h3>
                <div className="max-h-80 overflow-auto space-y-2">
                  {detailData.map((d, i) => (
                    <div
                      key={i}
                      className="flex justify-between items-center bg-white/5 p-3 rounded text-[10px]"
                    >
                      <div>
                        <span className="font-semibold">{d.item_name}</span>
                        <span className="ml-3 text-amber-300">
                          ({d.reason})
                        </span>
                        <span className="ml-3 text-slate-400">
                          by {d.adjusted_by_name}
                        </span>
                      </div>
                      <div className="text-right">
                        <span
                          className={`font-bold ${
                            Number(d.quantity) >= 0
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }`}
                        >
                          {Number(d.quantity) >= 0 ? '+' : ''}
                          {d.quantity}
                        </span>
                        <div className="text-[9px] text-slate-400">
                          Cost: ₱{Number(d.buy_cost_impact).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
