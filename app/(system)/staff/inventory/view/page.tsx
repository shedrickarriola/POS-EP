'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import {
  Database,
  Sparkles,
  LayoutDashboard,
  Loader2,
  TrendingUp,
  AlertTriangle,
  FileDown,
} from 'lucide-react';

export default function InventoryProtocol() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState<any[]>([]);
  const [view, setView] = useState<'ALL' | 'AI'>('ALL');
  const [branchName, setBranchName] = useState<string>('Branch');
  const [branchId, setBranchId] = useState<string | null>(null);

  useEffect(() => {
    const savedBranch = localStorage.getItem('active_branch');
    if (savedBranch) {
      const parsed = JSON.parse(savedBranch);
      setBranchId(parsed.id);
      setBranchName(parsed.branch_name || 'Branch');
      fetchInventory(parsed.id);
    }
  }, []);

  const fetchInventory = async (id: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('inventory')
        .select('*')
        .eq('branch_id', id)
        .order('item_name', { ascending: true });

      if (error) throw error;
      setInventory(data || []);
    } catch (err) {
      console.error('Error fetching inventory:', err);
    } finally {
      setLoading(false);
    }
  };

  // AI Recommendation Logic
  const recommendations = inventory
    .filter(
      (item) => item.weekly_sold > 0 && item.stock <= item.weekly_sold * 1.5
    )
    .sort((a, b) => b.weekly_sold - a.weekly_sold);

  const displayData = view === 'ALL' ? inventory : recommendations;

  const handleExport = () => {
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `${branchName.replace(/\s+/g, '_')}_${dateStr}.xlsx`;

    // Tab 1: All Inventory
    const allData = inventory.map((item) => ({
      Type: item.item_type,
      'Item Name': item.item_name,
      'Current Stock': item.stock,
      'Buy Cost': item.buy_cost,
      Price: item.price,
      'Weekly Sold': item.weekly_sold,
    }));

    // Tab 2: AI Re-order Recommendations
    const aiData = recommendations.map((item) => {
      const status =
        item.stock <= item.weekly_sold ? 'CRITICAL RE-ORDER' : 'RE-ORDER SOON';
      const recommendedQty = Math.max(0, item.weekly_sold * 4 - item.stock);
      return {
        'AI Advice': status,
        'Item Name': item.item_name,
        'Current Stock': item.stock,
        'Weekly Sales Velocity': item.weekly_sold,
        'Recommended Qty (1 Month)': recommendedQty,
        'Estimated Investment': recommendedQty * item.buy_cost,
      };
    });

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(allData);
    const ws2 = XLSX.utils.json_to_sheet(aiData);

    XLSX.utils.book_append_sheet(wb, ws1, 'Current Inventory');
    XLSX.utils.book_append_sheet(wb, ws2, 'AI What To Order');

    XLSX.writeFile(wb, filename);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8 font-sans">
      {/* HEADER */}
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6">
        <div>
          <div className="flex items-center gap-4 mb-2">
            <button
              onClick={() => router.push('/staff')}
              className="p-2 bg-slate-900 border border-white/5 rounded-lg text-slate-400 hover:text-white transition-all"
            >
              <LayoutDashboard size={18} />
            </button>
            <h1 className="text-3xl font-black italic tracking-tighter uppercase leading-none">
              Inventory_<span className="text-blue-500">Core</span>
            </h1>
          </div>
          <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-12">
            Stock Analysis • {branchName}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 bg-emerald-600/10 hover:bg-emerald-600 border border-emerald-500/20 px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all group"
          >
            <FileDown
              size={16}
              className="text-emerald-500 group-hover:text-white"
            />
            <span>Export Report</span>
          </button>

          <div className="flex bg-slate-900 p-1.5 rounded-2xl border border-white/5 shadow-2xl">
            <button
              onClick={() => setView('ALL')}
              className={`px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${
                view === 'ALL'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-slate-500 hover:text-white'
              }`}
            >
              <Database size={14} /> All
            </button>
            <button
              onClick={() => setView('AI')}
              className={`px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${
                view === 'AI'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                  : 'text-slate-500 hover:text-white'
              }`}
            >
              <Sparkles size={14} /> AI Recommendations
            </button>
          </div>
        </div>
      </div>

      {/* DATA TABLE */}
      <div className="max-w-7xl mx-auto">
        {loading ? (
          <div className="py-40 flex flex-col items-center gap-4">
            <Loader2 className="animate-spin text-blue-500" size={40} />
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
              Accessing_Database
            </p>
          </div>
        ) : (
          <div className="bg-slate-900/30 border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl backdrop-blur-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-white/[0.02] text-slate-500 text-[9px] uppercase font-black tracking-widest border-b border-white/5">
                  <tr>
                    <th className="p-6">Product Details</th>
                    <th className="p-6">Type</th>
                    <th className="p-6 text-right">Costs (₱)</th>
                    <th className="p-6 text-center">Velocity</th>
                    <th className="p-6 text-right">Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {displayData.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-white/[0.02] transition-colors group"
                    >
                      <td className="p-6">
                        <div className="font-black text-sm uppercase italic tracking-tighter text-slate-200 group-hover:text-blue-400 transition-colors">
                          {item.item_name}
                        </div>
                        <div className="text-[9px] font-mono text-slate-600 uppercase">
                          ID: {item.id.slice(0, 8)}
                        </div>
                      </td>
                      <td className="p-6 text-[9px] font-black text-slate-400 uppercase">
                        {item.item_type}
                      </td>
                      <td className="p-6 text-right font-mono">
                        <div className="text-xs font-bold text-slate-300">
                          Buy: {item.buy_cost?.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-emerald-500 font-black">
                          Sell: {item.price?.toLocaleString()}
                        </div>
                      </td>
                      <td className="p-6">
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex items-center gap-1.5 text-blue-400">
                            <TrendingUp size={12} />
                            <span className="font-black text-xs">
                              {item.weekly_sold}
                            </span>
                          </div>
                          <span className="text-[8px] text-slate-600 font-bold uppercase tracking-tighter">
                            Weekly Sold
                          </span>
                        </div>
                      </td>
                      <td className="p-6 text-right">
                        <div
                          className={`text-lg font-black font-mono ${
                            item.stock <= item.weekly_sold
                              ? 'text-red-500'
                              : 'text-slate-200'
                          }`}
                        >
                          {item.stock}
                        </div>
                        {item.stock <= item.weekly_sold && (
                          <div className="flex items-center justify-end gap-1 text-red-500/60 animate-pulse">
                            <AlertTriangle size={10} />
                            <span className="text-[8px] font-black uppercase tracking-widest">
                              Critical
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
