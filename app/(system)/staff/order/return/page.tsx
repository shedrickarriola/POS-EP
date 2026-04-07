'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import {
  Search,
  RotateCcw,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  Trash2,
  AlertTriangle,
  Receipt,
  ShieldCheck,
  History,
} from 'lucide-react';

export default function ReturnOrder() {
  const router = useRouter();

  // Core State
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [activeOrder, setActiveOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [returnedItems, setReturnedItems] = useState<any[]>([]);

  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  const [orderResults, setOrderResults] = useState<any[]>([]);

  useEffect(() => {
    checkAccess();
  }, []);

  const checkAccess = async () => {
    const savedBranch = localStorage.getItem('active_branch');
    if (savedBranch) {
      const parsed = JSON.parse(savedBranch);
      setCurrentBranchId(parsed.id);
    }
  };

  const searchOrders = async () => {
    if (!searchTerm || !currentBranchId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('orders')
      .select(`*, order_items (*, inventory:product_id (item_name, stock))`)
      .eq('branch_id', currentBranchId)
      .ilike('order_number', `%${searchTerm}%`)
      .order('created_at', { ascending: false });

    if (!error && data) setOrderResults(data);
    setLoading(false);
  };

  const selectOrder = (order: any) => {
    setActiveOrder(order);
    // Ensure we handle cases where order_items might be null
    setItems(order.order_items || []);
    setReturnedItems([]);
    setOrderResults([]);
    setSearchTerm('');
  };

  const queueForReturn = (idx: number, returnQty: number) => {
    const itemToReturn = { ...items[idx] };

    // Calculate the value of just the returned portion
    const unitPrice = itemToReturn.subtotal / itemToReturn.quantity;
    const partialSubtotal = unitPrice * returnQty;

    // Add to return queue with the specific quantity
    setReturnedItems([
      ...returnedItems,
      {
        ...itemToReturn,
        quantity: returnQty,
        subtotal: partialSubtotal,
      },
    ]);

    // Update the original items list
    const updatedItems = [...items];
    if (itemToReturn.quantity === returnQty) {
      // If returning everything, remove the row
      updatedItems.splice(idx, 1);
    } else {
      // If partial, subtract the quantity and subtotal from the display
      updatedItems[idx] = {
        ...itemToReturn,
        quantity: itemToReturn.quantity - returnQty,
        subtotal: itemToReturn.subtotal - partialSubtotal,
      };
    }
    setItems(updatedItems);
  };

  const cancelReturn = (idx: number) => {
    const itemToRestore = returnedItems[idx];
    const updatedItems = [...items];

    // Check if the item already exists in the main list (partial return case)
    const existingItemIdx = updatedItems.findIndex(
      (i) => i.id === itemToRestore.id
    );

    if (existingItemIdx > -1) {
      // If it exists, add the quantity and subtotal back to the existing row
      updatedItems[existingItemIdx] = {
        ...updatedItems[existingItemIdx],
        quantity:
          updatedItems[existingItemIdx].quantity + itemToRestore.quantity,
        subtotal:
          updatedItems[existingItemIdx].subtotal + itemToRestore.subtotal,
      };
    } else {
      // If it was fully removed, push it back as a new row
      updatedItems.push(itemToRestore);
    }

    setItems(updatedItems);

    // Remove from the return queue
    const updatedQueue = [...returnedItems];
    updatedQueue.splice(idx, 1);
    setReturnedItems(updatedQueue);
  };

  const handleProcessReturn = async () => {
    if (isProcessing || returnedItems.length === 0) return;
    setIsProcessing(true);

    try {
      let brandedAdjustment = 0;
      let genericAdjustment = 0;
      let totalAdjustment = 0;

      for (const item of returnedItems) {
        const itemValue = Number(item.subtotal || 0);
        const category = (item.inventory?.category || 'Generic').toLowerCase();

        if (category === 'branded') {
          brandedAdjustment += itemValue;
        } else {
          genericAdjustment += itemValue;
        }
        totalAdjustment += itemValue;

        // 1. Update Stock in Inventory
        if (item.product_id) {
          const { data: inv } = await supabase
            .from('inventory')
            .select('stock')
            .eq('id', item.product_id)
            .single();

          await supabase
            .from('inventory')
            .update({ stock: (inv?.stock || 0) + item.quantity })
            .eq('id', item.product_id);
        }

        // 2. Updated Logic: Partial Reversal or Full Removal
        // Fetch the current item state to ensure we have the latest DB values
        const { data: currentDbItem } = await supabase
          .from('order_items')
          .select('quantity, subtotal')
          .eq('id', item.id)
          .single();

        if (currentDbItem) {
          const remainingQty = currentDbItem.quantity - item.quantity;
          const remainingSubtotal = currentDbItem.subtotal - item.subtotal;

          if (remainingQty > 0) {
            // Update the existing record for partial returns
            await supabase
              .from('order_items')
              .update({
                quantity: remainingQty,
                subtotal: remainingSubtotal,
              })
              .eq('id', item.id);
          } else {
            // If returning the last of the quantity, delete the row
            await supabase.from('order_items').delete().eq('id', item.id);
          }
        }
      }

      // 3. Financial Recalculation
      const newBranded = Math.max(
        0,
        Number(activeOrder.branded_amt || 0) - brandedAdjustment
      );
      const newGeneric = Math.max(
        0,
        Number(activeOrder.generic_amt || 0) - genericAdjustment
      );
      const newTotal = Math.max(
        0,
        Number(activeOrder.total_amount || 0) - totalAdjustment
      );

      const { error: orderError } = await supabase
        .from('orders')
        .update({
          total_amount: newTotal,
          total_price: newTotal,
          branded_amt: newBranded,
          generic_amt: newGeneric,
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeOrder.id);

      if (orderError) throw orderError;

      // 4. HEAL BUY_COST — Revert inventory buy_cost to the highest PO cost
      // This is critical because buy_cost may have changed since the original sale.
      // We run it AFTER stock has been restored and the order is adjusted.
      if (currentBranchId) {
        const { error: healError } = await supabase.rpc('heal_inventory_buy_cost', {
          p_branch_id: currentBranchId,
        });

        if (healError) {
          // Non-blocking warning — the return succeeded, heal is just a safety net
          console.warn('⚠️ heal_inventory_buy_cost warning:', healError.message);
        } else {
          console.log('✅ heal_inventory_buy_cost completed successfully');
        }
      }

      setShowSuccessModal(true);
    } catch (err: any) {
      alert(`Adjustment Failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 md:p-12 font-sans">
      <div className="max-w-6xl mx-auto">
        {/* HEADER SECTION */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
          <div>
            <button
              onClick={() => router.push('/staff')}
              className="flex items-center gap-2 text-slate-500 hover:text-red-500 text-[10px] font-black uppercase tracking-widest mb-4 transition-colors"
            >
              <ArrowLeft size={14} /> Return to Staff Hub
            </button>
            <h1 className="text-4xl font-black italic tracking-tighter uppercase">
              Return_<span className="text-red-500">Item</span>
            </h1>
          </div>

          {!activeOrder && (
            <div className="relative w-full md:w-96">
              <input
                type="text"
                placeholder="Search Order Number (e.g. 1001)..."
                className="w-full bg-slate-900 border border-white/5 rounded-2xl px-6 py-4 text-sm font-mono outline-none focus:border-red-500/50 transition-all shadow-2xl"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchOrders()}
              />
              <button
                onClick={searchOrders}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-red-500 transition-colors"
              >
                {loading ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : (
                  <Search size={20} />
                )}
              </button>

              {/* SEARCH RESULTS DROPDOWN */}
              {orderResults.length > 0 && (
                <div className="absolute top-full mt-2 w-full bg-slate-900 border border-white/10 rounded-2xl overflow-hidden z-[100] shadow-2xl animate-in fade-in slide-in-from-top-2">
                  {orderResults.map((order) => (
                    <button
                      key={order.id}
                      onClick={() => selectOrder(order)}
                      className="w-full p-4 text-left hover:bg-red-500/10 border-b border-white/5 last:border-0 flex justify-between items-center group"
                    >
                      <div>
                        <p className="font-mono text-red-500 text-xs font-bold uppercase">
                          {order.order_number}
                        </p>
                        <p className="text-[10px] text-slate-500 font-black uppercase">
                          {new Date(order.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-mono text-white">
                          ₱{order.total_amount?.toLocaleString()}
                        </p>
                        <p className="text-[8px] text-slate-600 uppercase font-black">
                          B: {order.branded_amt} | G: {order.generic_amt}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {activeOrder ? (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* LEDGER PREVIEW */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-white/5 p-6 rounded-3xl">
                <p className="text-[8px] font-black text-slate-500 uppercase mb-1 tracking-widest">
                  Master Total
                </p>
                <p className="text-xl font-mono">
                  ₱{activeOrder.total_amount?.toLocaleString()}
                </p>
              </div>
              <div className="bg-slate-900 border border-white/5 p-6 rounded-3xl border-l-4 border-l-blue-600">
                <p className="text-[8px] font-black text-blue-500 uppercase mb-1 tracking-widest">
                  Branded Ledger
                </p>
                <p className="text-xl font-mono">
                  ₱{activeOrder.branded_amt?.toLocaleString()}
                </p>
              </div>
              <div className="bg-slate-900 border border-white/5 p-6 rounded-3xl border-l-4 border-l-purple-600">
                <p className="text-[8px] font-black text-purple-500 uppercase mb-1 tracking-widest">
                  Generic Ledger
                </p>
                <p className="text-xl font-mono">
                  ₱{activeOrder.generic_amt?.toLocaleString()}
                </p>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-3xl">
                <p className="text-[8px] font-black text-red-500 uppercase mb-1 tracking-widest">
                  Deduction
                </p>
                <p className="text-xl font-mono text-red-500">
                  -₱
                  {returnedItems
                    .reduce((acc, c) => acc + Number(c.subtotal), 0)
                    .toFixed(2)}
                </p>
              </div>
            </div>

            {/* PROCESSOR CARD */}
            <div className="bg-slate-900 border border-white/5 rounded-[2.5rem] overflow-hidden shadow-2xl">
              <div className="p-5 bg-white/[0.02] border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-500/10 rounded-xl flex items-center justify-center text-red-500">
                    <History size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase text-white tracking-widest">
                      Order_{activeOrder.order_number}
                    </p>
                    <p className="text-[8px] font-bold text-slate-500 uppercase">
                      Process items for stock reversal
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setActiveOrder(null)}
                    className="px-6 py-3 text-[10px] font-black uppercase text-slate-500 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleProcessReturn}
                    disabled={isProcessing || returnedItems.length === 0}
                    className="bg-red-600 hover:bg-red-500 disabled:opacity-20 px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95 shadow-xl shadow-red-500/20"
                  >
                    {isProcessing ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <RotateCcw size={14} />
                    )}{' '}
                    Commit Adjustment
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-white/[0.01]">
                      <th className="p-6 text-[10px] font-black uppercase text-slate-600 tracking-widest">
                        Product_Label
                      </th>
                      <th className="p-6 text-[10px] font-black uppercase text-slate-600 tracking-widest text-center">
                        Class
                      </th>
                      <th className="p-6 text-[10px] font-black uppercase text-slate-600 tracking-widest text-center">
                        Qty
                      </th>
                      <th className="p-6 text-[10px] font-black uppercase text-slate-600 tracking-widest text-right">
                        Subtotal
                      </th>
                      <th className="p-6 text-center w-24">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {items.length > 0 ? (
                      items.map((item, idx) => (
                        <tr
                          key={item.id}
                          className="hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="p-6">
                            <p className="font-black italic uppercase text-white tracking-tighter">
                              {item.inventory?.item_name || 'Legacy_Item'}
                            </p>
                            <p className="text-[8px] font-mono text-slate-600 uppercase">
                              Ref: {item.product_id?.slice(0, 13)}
                            </p>
                          </td>
                          <td className="p-6 text-center">
                            <span
                              className={`text-[8px] font-black uppercase px-2 py-1 rounded ${
                                item.inventory?.category === 'Branded'
                                  ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                                  : 'bg-purple-500/10 text-purple-500 border border-purple-500/20'
                              }`}
                            >
                              {item.inventory?.category || 'Generic'}
                            </span>
                          </td>
                          <td className="p-6 text-center font-mono text-emerald-500 font-bold">
                            {item.quantity}
                          </td>
                          <td className="p-6 text-right font-mono text-white">
                            ₱{item.subtotal?.toLocaleString()}
                          </td>
                          <td className="p-6 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <input
                                type="number"
                                id={`qty-to-return-${idx}`}
                                defaultValue={item.quantity}
                                min={1}
                                max={item.quantity}
                                className="w-14 bg-slate-800 border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-red-500 outline-none focus:border-red-500"
                              />
                              <button
                                onClick={() => {
                                  const input = document.getElementById(
                                    `qty-to-return-${idx}`
                                  ) as HTMLInputElement;
                                  const val = parseInt(input.value);
                                  if (val > 0 && val <= item.quantity) {
                                    queueForReturn(idx, val);
                                  }
                                }}
                                className="text-slate-600 hover:text-red-500 p-2 bg-white/5 rounded-lg transition-colors group"
                              >
                                <RotateCcw
                                  size={16}
                                  className="group-hover:rotate-[-45deg] transition-transform"
                                />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="p-20 text-center">
                          <p className="text-[10px] font-black uppercase text-slate-700 tracking-[0.3em]">
                            No_Items_To_Display
                          </p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RETURN QUEUE CHIPS */}
            {returnedItems.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/10 rounded-[2rem] p-6 animate-in slide-in-from-bottom-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-red-500/50 mb-4">
                  Queued_For_Return
                </h3>
                <div className="flex flex-wrap gap-2">
                  {returnedItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-900 border border-red-500/20 px-4 py-2 rounded-xl flex items-center gap-3 group"
                    >
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase italic text-white leading-tight">
                          {item.inventory?.item_name}
                        </span>
                        <span className="text-[9px] font-mono text-red-500">
                          -{item.quantity} pcs | ₱
                          {item.subtotal?.toLocaleString()}
                        </span>
                      </div>

                      {/* CANCELLATION BUTTON */}
                      <button
                        onClick={() => cancelReturn(idx)}
                        className="p-1.5 hover:bg-red-500/20 text-slate-500 hover:text-red-500 rounded-lg transition-all"
                        title="Cancel return for this item"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-slate-900/30 border border-white/5 border-dashed rounded-[3rem] p-32 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center text-slate-800 mb-6">
              <Receipt size={32} />
            </div>
            <h2 className="text-xs font-black uppercase tracking-[0.4em] text-slate-700">
              Awaiting_Terminal_Input
            </h2>
            <p className="text-[9px] text-slate-800 font-bold mt-2 uppercase">
              Search by Order Number to begin adjustment
            </p>
          </div>
        )}
      </div>

      {/* SUCCESS DIALOG */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-950/95 backdrop-blur-xl">
          <div className="bg-slate-900 border border-red-500/30 p-12 rounded-[3.5rem] max-w-md w-full text-center shadow-2xl">
            <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 mx-auto mb-6 shadow-inner">
              <ShieldCheck size={48} />
            </div>
            <h2 className="text-2xl font-black uppercase italic tracking-tighter mb-2">
              Ledger_Synchronized
            </h2>
            <p className="text-xs text-slate-500 mb-8 font-mono uppercase tracking-widest leading-relaxed">
              Items restored to branch inventory. Financial records for branded
              and generic sales adjusted. Buy cost healed to highest PO price.
            </p>
            <button
              onClick={() => router.push('/staff')}
              className="w-full bg-red-600 hover:bg-red-500 py-5 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-2xl shadow-red-500/40 transition-all"
            >
              Close Terminal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}