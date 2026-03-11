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
  ArrowLeft,
  Search,
} from 'lucide-react';

export default function InventoryProtocol() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [branchName, setBranchName] = useState<string>('Branch');

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

  // BYPASSES THE 1000 LIMIT BY FETCHING IN CHUNKS
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

  const filteredInventory = inventory.filter((item) =>
    item.item_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(inventory);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory');
    XLSX.writeFile(workbook, `Inventory_${branchName}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-indigo-500/30">
      {/* Header Section */}
      <div className="max-w-[1600px] mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors text-slate-400"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-black tracking-tighter uppercase flex items-center gap-2 italic">
                <Database className="text-indigo-500" size={20} />
                {branchName}{' '}
                <span className="text-slate-600">Inventory Management</span>
              </h1>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">
                Total Items Loaded: {inventory.length}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
                size={14}
              />
              <input
                type="text"
                placeholder="QUICK SEARCH..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-slate-900 border border-white/5 rounded-md pl-9 pr-4 py-1.5 text-[10px] font-bold w-64 focus:border-indigo-500 outline-none transition-all uppercase tracking-wider"
              />
            </div>
            <button
              onClick={exportToExcel}
              className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-[10px] font-black uppercase transition-all shadow-lg shadow-emerald-900/20"
            >
              <FileDown size={14} /> Export Excel
            </button>
          </div>
        </div>

        {loading ? (
          <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
            <Loader2 className="animate-spin text-indigo-500" size={40} />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">
              Synchronizing Database...
            </span>
          </div>
        ) : (
          <div className="bg-slate-900/50 border border-white/5 rounded-xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-950 border-b border-white/10">
                  <tr className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Product Name</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Piece Price</th>
                    <th className="px-3 py-2">Unit Cost</th>
                    <th className="px-3 py-2 text-center">Weekly</th>
                    <th className="px-3 py-2 text-center">Monthly</th>
                    <th className="px-3 py-2 text-right">Current Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredInventory.map((item, idx) => {
                    const isCritical = item.stock <= (item.sold_weekly || 0);
                    return (
                      <tr
                        key={item.id}
                        className="group hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="px-3 py-1 text-[10px] font-mono text-slate-600">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-1 text-[11px] font-bold text-slate-200 uppercase truncate max-w-xs">
                          {item.item_name}
                        </td>
                        <td className="px-3 py-1">
                          <span
                            className={`text-[9px] font-black px-2 py-0.5 rounded ${
                              item.item_type === 'GENERIC'
                                ? 'bg-slate-800 text-slate-400'
                                : 'bg-indigo-500/10 text-indigo-400'
                            }`}
                          >
                            {item.item_type || 'N/A'}
                          </span>
                        </td>
                        <td className="px-3 py-1 text-[10px] font-mono text-emerald-400">
                          ₱{Number(item.price_piece).toFixed(2)}
                        </td>
                        <td className="px-3 py-1 text-[10px] font-mono text-slate-400">
                          ₱{Number(item.buy_cost).toFixed(2)}
                        </td>
                        <td className="px-3 py-1 text-center text-[10px] font-bold text-slate-500">
                          {item.sold_weekly || 0}
                        </td>
                        <td className="px-3 py-1 text-center text-[10px] font-bold text-slate-500">
                          {item.sold_monthly || 0}
                        </td>
                        <td className="px-3 py-1 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {isCritical && (
                              <AlertTriangle
                                size={12}
                                className="text-red-500 animate-pulse"
                              />
                            )}
                            <span
                              className={`text-[11px] font-black font-mono ${
                                isCritical ? 'text-red-500' : 'text-slate-200'
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

            {filteredInventory.length === 0 && (
              <div className="p-20 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  No matching items found in records
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
