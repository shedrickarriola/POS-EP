'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import {
  FileUp,
  Database,
  Loader2,
  LayoutDashboard,
  Table,
} from 'lucide-react';

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

  // EXACT same PO number logic as your RPC (handles 656+ records)
  const getNextPoNumber = useCallback(async () => {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('po_number')
      .order('id', { ascending: false })
      .limit(2000); // ← Increased to safely cover all your records

    if (error || !data || data.length === 0) return 'PO1';

    let maxNum = 0;

    data.forEach((row) => {
      if (row.po_number) {
        // Exact same cleaning as the RPC: remove everything except numbers
        const numStr = row.po_number.replace(/[^0-9]/g, '');
        if (numStr) {
          const num = parseInt(numStr, 10);
          if (num > maxNum) maxNum = num;
        }
      }
    });

    return `PO${maxNum + 1}`;
  }, []);

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!selectedBranch?.id || !file || !userProfile) return;

    setIsImporting(true);
    setLogStatus(`GENERATING_PO_NUMBER...`);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      let poNumber = await getNextPoNumber();
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
        try {
          setLogStatus(
            `CALCULATING_SEQUENCE... ${poNumber} (attempt ${
              attempts + 1
            }/${maxAttempts})`
          );

          const bstr = evt.target?.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wsname], {
            header: 1,
          });

          const dataRows = rows.slice(1).filter((row) => row[1]);

          const aggregatedMap = new Map();
          dataRows.forEach((row) => {
            const type = String(row[0] || 'GENERIC');
            const name = String(row[1]).trim();
            const buy_cost = parseFloat(row[2] || 0);
            const price = parseFloat(row[3] || 0);
            const qty = parseInt(row[4] || 0);

            if (aggregatedMap.has(name)) {
              const existing = aggregatedMap.get(name);
              existing.stock += qty;
              existing.buy_cost = Math.max(existing.buy_cost, buy_cost);
              existing.price = Math.max(existing.price, price);
            } else {
              aggregatedMap.set(name, {
                branch_id: selectedBranch.id,
                item_type: type,
                item_name: name,
                buy_cost,
                price,
                stock: qty,
                updated_by: userProfile.id,
              });
            }
          });

          const inventoryUpserts = Array.from(aggregatedMap.values());

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
                  (acc, item) => acc + item.buy_cost * item.stock,
                  0
                ),
              },
            ])
            .select()
            .single();

          if (poErr) throw poErr;

          const poItems = inventoryUpserts.map((item) => ({
            purchase_order_id: poHeader.id,
            item_name: item.item_name,
            quantity: item.stock,
            unit_cost: item.buy_cost,
          }));

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
          return;
        } catch (err: any) {
          attempts++;

          const isDuplicate =
            err.code === '23505' ||
            err.message?.includes('unique_po_number') ||
            err.message?.includes('duplicate key');

          if (isDuplicate && attempts < maxAttempts) {
            const num = parseInt(poNumber.replace(/[^0-9]/g, ''), 10) || 0;
            poNumber = `PO${num + 1}`;
            setLogStatus(`DUPLICATE — TRYING NEXT: ${poNumber}`);
            await new Promise((resolve) => setTimeout(resolve, 300));
            continue;
          }

          setLogStatus(`ERROR: ${err.message || 'Unknown error'}`);
          alert(`Import Failed: ${err.message || 'Unknown error'}`);
          break;
        }
      }
    };

    reader.readAsBinaryString(file);

    setIsImporting(false);
    if (e.target) e.target.value = '';
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

          <div className="max-w-lg mx-auto mb-8 bg-slate-900/70 border border-white/10 rounded-3xl p-6 text-left">
            <div className="flex items-center gap-2 mb-4">
              <Table className="text-emerald-400" size={18} />
              <h3 className="font-black uppercase tracking-widest text-emerald-400 text-sm">
                EXPECTED EXCEL FORMAT
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="py-2 px-3 text-left text-slate-400">
                      Column
                    </th>
                    <th className="py-2 px-3 text-left text-slate-400">
                      Field
                    </th>
                    <th className="py-2 px-3 text-left text-slate-400">
                      Required?
                    </th>
                    <th className="py-2 px-3 text-left text-slate-400">
                      Notes
                    </th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  <tr className="border-b border-white/10">
                    <td className="py-2 px-3 font-bold">A</td>
                    <td className="py-2 px-3">item_type</td>
                    <td className="py-2 px-3 text-emerald-400">Optional</td>
                    <td className="py-2 px-3 text-xs">Defaults to GENERIC</td>
                  </tr>
                  <tr className="border-b border-white/10">
                    <td className="py-2 px-3 font-bold">B</td>
                    <td className="py-2 px-3">item_name</td>
                    <td className="py-2 px-3 text-red-400">Required</td>
                    <td className="py-2 px-3 text-xs">
                      Rows without name are skipped
                    </td>
                  </tr>
                  <tr className="border-b border-white/10">
                    <td className="py-2 px-3 font-bold">C</td>
                    <td className="py-2 px-3">buy_cost</td>
                    <td className="py-2 px-3 text-emerald-400">Required</td>
                    <td className="py-2 px-3 text-xs">Purchase cost</td>
                  </tr>
                  <tr className="border-b border-white/10">
                    <td className="py-2 px-3 font-bold">D</td>
                    <td className="py-2 px-3">price</td>
                    <td className="py-2 px-3 text-emerald-400">Required</td>
                    <td className="py-2 px-3 text-xs">Selling price</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-bold">E</td>
                    <td className="py-2 px-3">qty / stock</td>
                    <td className="py-2 px-3 text-emerald-400">Required</td>
                    <td className="py-2 px-3 text-xs">Quantity to add</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[10px] text-slate-400 font-mono leading-tight">
              Row 1 = headers (ignored)
              <br />
              Duplicates by item_name are automatically merged
            </p>
          </div>

          <label
            className={`inline-flex items-center gap-4 px-10 py-5 rounded-2xl text-xs font-black uppercase tracking-[0.3em] transition-all cursor-pointer shadow-2xl ${
              isImporting
                ? 'bg-slate-800 text-slate-500'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20'
            }`}
          >
            <Database size={18} />
            {isImporting ? 'Processing...' : 'Upload Excel Invoice'}
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
