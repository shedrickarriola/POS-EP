'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { FileUp, Database, Loader2, LayoutDashboard } from 'lucide-react';

export default function DataManagement() {
  const router = useRouter();
  const [selectedBranch, setSelectedBranch] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [logStatus, setLogStatus] = useState('SYSTEM_READY');

  useEffect(() => {
    async function init() {
      const savedBranch = localStorage.getItem('active_branch');
      if (savedBranch) setSelectedBranch(JSON.parse(savedBranch));

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();
        setUserProfile(data);
      }
    }
    init();
  }, []);

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!selectedBranch?.id || !file || !userProfile) return;

    setIsImporting(true);
    setLogStatus(`CALCULATING_SEQUENCE...`);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        // 1. GET THE GLOBAL SEQUENCE COUNT
        // We count all rows in purchase_orders to determine the next number
        const { count, error: countErr } = await supabase
          .from('purchase_orders')
          .select('*', { count: 'exact', head: true });

        if (countErr) throw countErr;

        const nextSequence = (count || 0) + 1;
        const poNumber = `PO${nextSequence}`; // Format: PO1, PO2, PO3...

        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wsname], {
          header: 1,
        });

        const dataRows = rows.slice(1).filter((row) => row[1]);

        // 2. AGGREGATE DUPLICATES
        const aggregatedMap = new Map();
        dataRows.forEach((row) => {
          const type = String(row[0] || 'GENERIC');
          const name = String(row[1]).trim();
          const price = parseFloat(row[2] || 0);
          const qty = parseInt(row[3] || 0);

          if (aggregatedMap.has(name)) {
            const existing = aggregatedMap.get(name);
            existing.stock += qty;
            existing.price = Math.max(existing.price, price);
          } else {
            aggregatedMap.set(name, {
              branch_id: selectedBranch.id,
              item_type: type,
              item_name: name,
              buy_cost: 0,
              price: price,
              stock: qty,
              updated_by: userProfile.id,
            });
          }
        });

        const inventoryUpserts = Array.from(aggregatedMap.values());

        // 3. CREATE PURCHASE ORDER HEADER
        const { data: poHeader, error: poErr } = await supabase
          .from('purchase_orders')
          .insert([
            {
              branch_id: selectedBranch.id,
              invoice_id: file.name,
              po_number: poNumber,
              created_by: userProfile.id,
              status: 'completed',
              total_amount: inventoryUpserts.reduce(
                (acc, item) => acc + item.price * item.stock,
                0
              ),
            },
          ])
          .select()
          .single();

        if (poErr) throw poErr;

        // 4. PREPARE PO ITEMS
        const poItems = inventoryUpserts.map((item) => ({
          purchase_order_id: poHeader.id,
          item_name: item.item_name,
          quantity: item.stock,
          unit_cost: item.price,
        }));

        // 5. SYNC TO DATABASE
        const { error: invErr } = await supabase
          .from('inventory')
          .upsert(inventoryUpserts, { onConflict: 'branch_id,item_name' });
        if (invErr) throw invErr;

        const { error: itemsErr } = await supabase
          .from('purchase_order_items')
          .insert(poItems);
        if (itemsErr) throw itemsErr;

        setLogStatus(`SUCCESS: ASSIGNED ${poNumber}`);
        alert(`Stock Sync Complete. Order Logged as: ${poNumber}`);
      } catch (err: any) {
        setLogStatus(`ERROR: ${err.message}`);
        alert(`Import Failed: ${err.message}`);
      } finally {
        setIsImporting(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 font-sans">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-10">
          <button
            onClick={() => router.push('/staff')}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-white/5 rounded-xl text-slate-400 hover:text-white transition-all"
          >
            <LayoutDashboard size={16} />
            <span className="text-[10px] font-black uppercase tracking-widest text-white">
              Back to Hub
            </span>
          </button>
          <div className="text-right">
            <h1 className="text-xl font-black italic uppercase tracking-tighter">
              Data_<span className="text-emerald-500">Logistics</span>
            </h1>
            <p className="text-[10px] font-mono text-slate-400 uppercase tracking-widest mt-1">
              Node: {selectedBranch?.branch_name}
            </p>
          </div>
        </div>

        <div className="bg-slate-900/40 border border-white/5 p-12 rounded-[40px] text-center backdrop-blur-sm">
          <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-8 border border-emerald-500/20">
            {isImporting ? (
              <Loader2 className="animate-spin text-emerald-500" />
            ) : (
              <FileUp className="text-emerald-500" />
            )}
          </div>
          <h2 className="text-2xl font-black uppercase tracking-tight mb-2 italic">
            Sequential Stock Import
          </h2>

          <label
            className={`inline-flex items-center gap-4 px-10 py-5 rounded-2xl text-xs font-black uppercase tracking-[0.3em] transition-all cursor-pointer shadow-2xl ${
              isImporting
                ? 'bg-slate-800 text-slate-500'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20'
            }`}
          >
            <Database size={18} />
            {isImporting ? 'Fetching Count...' : 'Upload Excel Invoice'}
            <input
              type="file"
              accept=".xlsx, .xls"
              className="hidden"
              onChange={handleImportExcel}
              disabled={isImporting}
            />
          </label>

          <div className="mt-16 bg-black/40 border border-white/5 rounded-2xl p-4 text-left font-mono">
            <p className="text-[10px] text-emerald-500/80 leading-relaxed uppercase tracking-widest italic">
              &gt; {logStatus}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
