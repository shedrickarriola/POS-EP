'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import {
  Search,
  Save,
  Loader2,
  Trash2,
  PackageCheck,
  Database,
  CheckCircle2,
  Home,
  RefreshCcw,
  LayoutDashboard,
  AlertCircle,
  Plus,
} from 'lucide-react';

export default function UpdatePurchaseOrder() {
  const router = useRouter();

  // Core State
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [orderHeader, setOrderHeader] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  // ====================== PRICE ANOMALY CONFIG ======================
  const PRICE_ANOMALY_THRESHOLD = 3; // 3× current selling price = blocked
  // =================================================================
  // Summary and Search State
  const [commitSummary, setCommitSummary] = useState<any[]>([]);
  const [inventoryResults, setInventoryResults] = useState<any[]>([]);
  const [activeSearchIdx, setActiveSearchIdx] = useState<number | null>(null);
  const [showPriceError, setShowPriceError] = useState(false);
  const [priceErrorItems, setPriceErrorItems] = useState<any[]>([]);

  useEffect(() => {
    const savedBranch = localStorage.getItem('active_branch');
    if (savedBranch) {
      const parsed = JSON.parse(savedBranch);
      setCurrentBranchId(parsed.id);
    }
  }, []);

  const fetchPurchaseOrder = async () => {
    if (!searchTerm.trim() || !currentBranchId) return;
    setLoading(true);
    setOrderHeader(null);

    try {
      const { data: order, error } = await supabase
        .from('purchase_orders')
        .select(
          `
          *,
          purchase_order_items (
            *,
            inventory:inventory_id (price, buy_cost)
          )
        `
        )
        .eq('po_number', searchTerm.trim())
        .eq('branch_id', currentBranchId)
        .single();

      if (error || !order) {
        alert('Order not found in this branch.');
      } else {
        setOrderHeader(order);

        // === AUTO ANOMALY CHECK + ENRICH ON LOAD ===
        const enrichedItems = (order.purchase_order_items || []).map(
          (item: any) => {
            const currentBuyCost = Number(item.buy_cost) || 0;
            const currSellingPrice = Number(item.inventory?.price) || 0;

            let price_anomaly = false;
            let price_ratio = 1;

            if (currSellingPrice > 0) {
              price_ratio = Number(
                (currentBuyCost / currSellingPrice).toFixed(1)
              );
              price_anomaly =
                currentBuyCost > currSellingPrice * PRICE_ANOMALY_THRESHOLD;
            }

            return {
              ...item,
              current_price: currSellingPrice,
              original_buy_cost: currentBuyCost,
              price_anomaly,
              price_ratio,
            };
          }
        );

        setItems(enrichedItems);
      }
    } finally {
      setLoading(false);
    }
  };

  const searchInventory = async (query: string, index: number) => {
    updateItem(index, 'item_name', query);

    // Flag as unlinked if user starts typing a new name
    if (items[index].inventory_id) {
      updateItem(index, 'inventory_id', null);
    }

    if (query.length < 2) {
      setInventoryResults([]);
      return;
    }

    const { data } = await supabase
      .from('inventory')
      .select('id, item_name, item_type, stock')
      .eq('branch_id', currentBranchId)
      .ilike('item_name', `%${query}%`)
      .limit(5);

    setInventoryResults(data || []);
    setActiveSearchIdx(index);
  };

  const selectInventoryItem = (invItem: any, index: number) => {
    const newItems = [...items];
    newItems[index] = {
      ...newItems[index],
      inventory_id: invItem.id,
      item_name: invItem.item_name,
      item_type: invItem.item_type,
      current_price: invItem.price || 0, // ← NEW: for anomaly check
    };
    setItems(newItems);
    setInventoryResults([]);
    setActiveSearchIdx(null);
  };

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...items];
    const item = { ...newItems[index] };

    // Update the field
    item[field] = value;

    // Recalculate subtotal (always live)
    const qty = Number(item.quantity) || 0;
    const cost = Number(item.buy_cost) || 0;
    // We don't store subtotal in state — it's calculated on render

    // ====================== PRICE ANOMALY DETECTION ======================
    const currPrice = Number(item.current_price) || 0;
    if (currPrice > 0) {
      const ratio = Number((cost / currPrice).toFixed(1));
      item.price_anomaly = cost > currPrice * PRICE_ANOMALY_THRESHOLD;
      item.price_ratio = ratio;
    } else {
      item.price_anomaly = false;
      item.price_ratio = 1;
    }
    // =====================================================================

    newItems[index] = item;
    setItems(newItems);
  };
  const addNewRow = () => {
    setItems([
      ...items,
      {
        id: `temp-${Date.now()}`,
        item_name: '',
        quantity: 0,
        buy_cost: 0,
        inventory_id: null,
        item_type: 'GENERIC',
        current_price: 0, // needed for anomaly check
        price_anomaly: false,
        price_ratio: 1,
        original_buy_cost: 0, // for the new column
      },
    ]);
  };

  const removeRow = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const calculateTotals = () => {
    return items.reduce(
      (acc, item) => {
        const amount =
          (Number(item.quantity) || 0) * (Number(item.buy_cost) || 0);
        if (item.item_type === 'GENERIC') acc.generic += amount;
        else acc.branded += amount;
        acc.total += amount;
        return acc;
      },
      { generic: 0, branded: 0, total: 0 }
    );
  };
  const handleUpdate = async () => {
    const hasUnlinked = items.some((i) => !i.inventory_id);
    if (hasUnlinked)
      return alert(
        'Cannot commit: One or more rows are not linked to a valid product.'
      );

    // === HARD BLOCK ON PRICE ANOMALIES ===
    const anomalousItems = items.filter((i) => i.price_anomaly);
    if (anomalousItems.length > 0) {
      setPriceErrorItems(anomalousItems);
      setShowPriceError(true);
      return;
    }
    // =====================================

    setIsSaving(true);
    const totals = calculateTotals();
    const syncLog: any[] = [];

    try {
      // 1. REVERSAL (unchanged)
      const { data: dbItems } = await supabase
        .from('purchase_order_items')
        .select('inventory_id, quantity, item_name')
        .eq('purchase_order_id', orderHeader.id);

      for (const old of dbItems || []) {
        const { data: inv } = await supabase
          .from('inventory')
          .select('stock')
          .eq('id', old.inventory_id)
          .single();
        const revertedStock = (inv?.stock || 0) - Number(old.quantity);
        await supabase
          .from('inventory')
          .update({ stock: revertedStock })
          .eq('id', old.inventory_id);
        syncLog.push({
          name: old.item_name,
          action: 'REVERSE',
          qty: -old.quantity,
        });
      }

      // 2. RE-SYNC Header
      await supabase
        .from('purchase_orders')
        .update({
          total_amount: totals.total,
          generic_amt: totals.generic,
          branded_amt: totals.branded,
        })
        .eq('id', orderHeader.id);

      await supabase
        .from('purchase_order_items')
        .delete()
        .eq('purchase_order_id', orderHeader.id);

      // 3. INSERT NEW ITEMS + CONDITIONAL INVENTORY BUY_COST UPDATE
      for (const item of items) {
        const newBuyCost = Number(item.buy_cost) || 0;

        // Insert into PO items (this is the buy_cost for the PO)
        await supabase.from('purchase_order_items').insert([
          {
            purchase_order_id: orderHeader.id,
            inventory_id: item.inventory_id,
            item_name: item.item_name,
            quantity: Number(item.quantity),
            buy_cost: newBuyCost,
            item_type: item.item_type,
          },
        ]);

        // Update stock
        const { data: inv } = await supabase
          .from('inventory')
          .select('stock, buy_cost')
          .eq('id', item.inventory_id)
          .single();

        const appliedStock = (inv?.stock || 0) + Number(item.quantity);
        await supabase
          .from('inventory')
          .update({ stock: appliedStock })
          .eq('id', item.inventory_id);

        // === NEW: Update inventory.buy_cost ONLY IF HIGHER ===
        const currentInvBuyCost = Number(inv?.buy_cost) || 0;
        if (newBuyCost > currentInvBuyCost) {
          await supabase
            .from('inventory')
            .update({ buy_cost: newBuyCost })
            .eq('id', item.inventory_id);
        }
        // ====================================================

        syncLog.push({
          name: item.item_name,
          action: 'APPLY',
          qty: +item.quantity,
          final: appliedStock,
        });
      }

      setCommitSummary(syncLog);
      setShowSuccessModal(true);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8 font-sans selection:bg-blue-500/30">
      {/* SUCCESS MODAL WITH SUMMARY */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-white/10 p-8 rounded-[2.5rem] max-w-2xl w-full shadow-2xl">
            <div className="flex items-center gap-4 mb-6 text-emerald-500">
              <CheckCircle2 size={32} />
              <h2 className="text-xl font-black uppercase italic tracking-tighter">
                Manifest_Updated
              </h2>
            </div>

            <div className="bg-black/40 rounded-2xl border border-white/5 overflow-hidden mb-8 max-h-60 overflow-y-auto font-mono text-[10px]">
              <table className="w-full text-left">
                <thead className="bg-black/20 text-slate-500 text-[9px] uppercase font-black tracking-widest">
                  <tr>
                    <th className="p-5">Inventory Product Name</th>
                    <th className="p-5 text-center w-24">Qty</th>
                    <th className="p-5 text-right w-32">Original Cost</th>{' '}
                    {/* ← NEW COLUMN */}
                    <th className="p-5 text-right w-32">Unit Cost (New)</th>
                    <th className="p-5 text-right w-32">Subtotal</th>
                    <th className="p-5 text-center w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {commitSummary.map((log, i) => (
                    <tr key={i} className="hover:bg-white/[0.02]">
                      <td className="p-4">
                        <span
                          className={
                            log.qty > 0 ? 'text-emerald-400' : 'text-red-400'
                          }
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="p-4 text-slate-300">{log.name}</td>
                      <td className="p-4 text-right font-black">
                        {log.qty > 0 ? '+' : ''}
                        {log.qty}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => router.push('/staff')}
                className="py-4 bg-slate-800 rounded-2xl text-[10px] font-black uppercase tracking-widest"
              >
                Staff Hub
              </button>
              <button
                onClick={() => window.location.reload()}
                className="py-4 bg-blue-600 rounded-2xl text-[10px] font-black uppercase tracking-widest"
              >
                Update Another
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/staff')}
            className="p-2 bg-slate-900 border border-white/5 rounded-lg text-slate-400 hover:text-white"
          >
            <LayoutDashboard size={18} />
          </button>
          <h1 className="text-3xl font-black italic tracking-tighter uppercase leading-none">
            Update_<span className="text-blue-500">Manifest</span>
          </h1>
        </div>

        {orderHeader && (
          <div className="flex gap-3">
            <button
              onClick={addNewRow}
              className="bg-slate-800 hover:bg-slate-700 px-6 py-3.5 rounded-xl text-[11px] font-black uppercase tracking-widest flex items-center gap-3 border border-white/10 transition-all active:scale-95"
            >
              <Plus size={16} /> New Row
            </button>
            <button
              onClick={handleUpdate}
              disabled={isSaving || items.some((i) => !i.inventory_id)}
              className="bg-blue-600 hover:bg-blue-500 px-8 py-3.5 rounded-xl text-[11px] font-black uppercase tracking-widest flex items-center gap-3 shadow-lg shadow-blue-500/20 disabled:opacity-30"
            >
              {isSaving ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Save size={16} />
              )}{' '}
              Commit Changes
            </button>
          </div>
        )}
      </div>

      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-slate-900/50 border border-white/10 p-4 rounded-2xl flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600"
              size={18}
            />
            <input
              type="text"
              placeholder="Input PO Number..."
              className="w-full bg-slate-950 border border-white/10 rounded-xl py-3.5 pl-12 px-4 text-sm font-mono outline-none focus:border-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchPurchaseOrder()}
            />
          </div>
          <button
            onClick={fetchPurchaseOrder}
            className="bg-slate-800 px-8 py-3.5 rounded-xl font-black uppercase text-[11px] tracking-widest border border-white/5"
          >
            Retrieve
          </button>
        </div>

        {orderHeader && (
          <div className="bg-slate-900/30 border border-white/10 rounded-2xl overflow-visible shadow-2xl">
            <div className="p-6 border-b border-white/5 bg-white/[0.02] flex flex-col md:flex-row justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
                  <PackageCheck size={24} className="text-blue-500" />
                </div>
                <div>
                  <span className="font-mono text-xl font-black text-blue-400 block tracking-tighter">
                    {orderHeader.po_number}
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                    Supplier: {orderHeader.supplier_name}
                  </span>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-black/20 text-slate-500 text-[9px] uppercase font-black tracking-widest">
                  <tr>
                    <th className="p-5">Inventory Product Name</th>
                    <th className="p-5 text-center w-24">Qty</th>
                    <th className="p-5 text-right w-32">Unit Cost (₱)</th>
                    <th className="p-5 text-right w-32">Subtotal</th>
                    <th className="p-5 text-center w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {items.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-white/[0.01]">
                      <td className="p-4">
                        <div className="relative">
                          <input
                            type="text"
                            className={`w-full bg-slate-950/50 border p-3 rounded-xl text-[11px] font-black uppercase outline-none transition-all pr-10 ${
                              item.inventory_id
                                ? 'border-white/5 focus:border-blue-500'
                                : 'border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]'
                            }`}
                            value={item.item_name}
                            onChange={(e) =>
                              searchInventory(e.target.value, idx)
                            }
                            placeholder="Type to search..."
                          />
                          {item.inventory_id ? (
                            <CheckCircle2
                              size={16}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500"
                            />
                          ) : (
                            <AlertCircle
                              size={16}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500"
                            />
                          )}

                          {activeSearchIdx === idx &&
                            inventoryResults.length > 0 && (
                              <div className="absolute left-0 right-0 top-[105%] z-[60] bg-slate-900 border border-blue-500/40 rounded-xl overflow-hidden shadow-2xl">
                                {inventoryResults.map((inv) => (
                                  <button
                                    key={inv.id}
                                    onClick={() =>
                                      selectInventoryItem(inv, idx)
                                    }
                                    className="w-full text-left p-4 hover:bg-blue-600/20 text-[11px] uppercase flex justify-between border-b border-white/5"
                                  >
                                    <span>{inv.item_name}</span>
                                    <span className="text-blue-400 font-mono">
                                      Stock: {inv.stock}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                        </div>
                      </td>
                      <td className="p-4">
                        <input
                          type="number"
                          className="w-full bg-slate-950/50 border border-white/5 p-3 rounded-xl text-center font-mono text-xs"
                          value={item.quantity}
                          onChange={(e) =>
                            updateItem(idx, 'quantity', e.target.value)
                          }
                        />
                      </td>

                      {/* === NEW COLUMN: Original Cost (non-editable) === */}
                      <td className="p-4 text-right font-mono text-slate-400 text-xs">
                        ₱{Number(item.original_buy_cost || 0).toFixed(2)}
                      </td>

                      <td className="p-4 relative">
                        <input
                          type="number"
                          className={`w-full bg-slate-950/50 border p-3 rounded-xl text-right font-mono text-xs transition-all ${
                            item.price_anomaly
                              ? 'border-red-500 bg-red-500/10'
                              : 'border-white/5'
                          }`}
                          value={item.buy_cost}
                          onChange={(e) =>
                            updateItem(idx, 'buy_cost', e.target.value)
                          }
                        />
                        {item.price_anomaly && (
                          <div className="absolute -top-1 right-2 bg-red-500 text-white text-[10px] font-black px-1.5 py-px rounded flex items-center gap-1 shadow-md">
                            <AlertCircle size={12} />
                            <span>{item.price_ratio}x</span>
                          </div>
                        )}
                      </td>

                      <td className="p-4 text-right font-black font-mono text-emerald-500 text-sm">
                        ₱
                        {(
                          Number(item.quantity || 0) *
                          Number(item.buy_cost || 0)
                        ).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => removeRow(idx)}
                          className="text-slate-600 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-black/40 border-t border-white/10">
                  <tr>
                    <td
                      colSpan={3}
                      className="p-5 text-right text-[10px] font-black uppercase text-slate-500"
                    >
                      Total Manifest Valuation
                    </td>
                    <td className="p-5 text-right font-black font-mono text-xl text-emerald-400">
                      ₱
                      {calculateTotals().total.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
      {/* === PRICE ANOMALY ERROR MODAL (same style as New PO) === */}
      {showPriceError && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl">
          <div className="max-w-lg w-full bg-slate-900 border border-red-500/30 rounded-3xl p-8 shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-red-500/10 rounded-2xl flex items-center justify-center">
                <AlertCircle className="text-red-400" size={28} />
              </div>
              <div>
                <h2 className="text-2xl font-black text-red-400 tracking-tighter">
                  UPDATE BLOCKED
                </h2>
                <p className="text-slate-400 text-sm">Price anomaly detected</p>
              </div>
            </div>

            <div className="bg-slate-950 rounded-2xl p-5 mb-8 border border-red-500/20">
              <p className="text-red-400 text-sm font-bold mb-4">
                {priceErrorItems.length} item(s) have unrealistic buy cost (over{' '}
                {PRICE_ANOMALY_THRESHOLD}× current selling price)
              </p>
              <ul className="space-y-3 text-sm max-h-64 overflow-y-auto">
                {priceErrorItems.map((item, i) => (
                  <li
                    key={i}
                    className="flex justify-between bg-white/5 px-4 py-3 rounded-xl"
                  >
                    <span className="font-bold text-white">
                      {item.item_name}
                    </span>
                    <span className="font-black text-red-400">
                      {item.price_ratio}x
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-slate-400 text-center mb-8 leading-relaxed">
              This is almost always caused by a leftover{' '}
              <strong>box price</strong> from the original PO.
              <br />
              Please correct the{' '}
              <span className="text-emerald-400 font-bold">Unit Cost</span>{' '}
              field.
            </p>

            <button
              onClick={() => {
                setShowPriceError(false);
                setPriceErrorItems([]);
              }}
              className="w-full bg-red-500 hover:bg-red-600 text-white font-black uppercase tracking-widest py-5 rounded-2xl transition-all active:scale-95"
            >
              GOT IT — I’LL FIX THE PRICES
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
