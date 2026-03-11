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
  const [viewMode, setViewMode] = useState<'ALL' | 'AI'>('ALL');

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
              className="p-2 hover:bg-white/5 rounded-lg text-slate-400"
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
            <div className="flex bg-slate-950 p-1 rounded-md border border-white/10">
              <button
                onClick={() => setViewMode('ALL')}
                className={`px-3 py-1 text-[9px] font-black rounded ${
                  viewMode === 'ALL'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-600'
                }`}
              >
                FULL INVENTORY
              </button>
              <button
                onClick={() => setViewMode('AI')}
                className={`px-3 py-1 text-[9px] font-black rounded flex items-center gap-1 ${
                  viewMode === 'AI'
                    ? 'bg-indigo-600 text-white shadow-lg'
                    : 'text-slate-600'
                }`}
              >
                <Sparkles size={10} /> AI REORDER LIST
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
                className="bg-slate-950 border border-white/10 rounded-md pl-8 pr-4 py-1 text-[10px] font-bold w-48 focus:border-indigo-500 outline-none uppercase"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="h-[70vh] flex flex-col items-center justify-center gap-3 italic">
            <Loader2 className="animate-spin text-indigo-500" size={30} />
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-600">
              Analyzing Sales Trends...
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
                    const isHighYearly = (item.sold_yearly || 0) > 500;

                    return (
                      <tr
                        key={item.id}
                        className="group hover:bg-indigo-500/[0.04] transition-colors"
                      >
                        <td className="px-3 py-0.5 text-[9px] font-mono text-slate-600 text-center">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-300 uppercase truncate max-w-md">
                              {item.item_name}
                            </span>
                            {isHighYearly && (
                              <ArrowUpRight
                                size={10}
                                className="text-emerald-400"
                                title="Yearly Best Seller"
                              />
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-0.5 text-right text-[10px] font-mono text-emerald-500 font-bold">
                          ₱{Number(item.price || 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-0.5 text-right text-[10px] font-mono text-slate-500">
                          ₱{Number(item.buy_cost || 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-0.5 text-center text-[10px] font-black text-indigo-400 bg-indigo-500/[0.02]">
                          {item.sold_weekly || 0}
                        </td>
                        <td className="px-3 py-0.5 text-center text-[10px] font-bold text-slate-600">
                          {item.sold_yearly || 0}
                        </td>
                        <td className="px-3 py-0.5 text-right">
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
