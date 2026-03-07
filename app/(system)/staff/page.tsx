'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import {
  Package,
  Activity,
  ArrowRight,
  MapPin,
  ClipboardList,
  Plus,
  LayoutGrid,
  LogOut,
  Terminal,
  Database,
  Tag,
  X,
  Search,
  CheckCircle2,
  AlertCircle,
  FileDown,
  FileUp,
  RefreshCw,
} from 'lucide-react';

export default function StaffDashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [logStatus, setLogStatus] = useState<string>('');
  const [stats, setStats] = useState({ poCount: 0, salesCount: 0 });

  const [toast, setToast] = useState<{
    show: boolean;
    msg: string;
    type: 'success' | 'error';
  }>({
    show: false,
    msg: '',
    type: 'success',
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [showResetAuth, setShowResetAuth] = useState(false);
  const [authDetails, setAuthDetails] = useState({ email: '', password: '' });
  const [isWiping, setIsWiping] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: '',
    cost: 0,
    selling: 0,
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [updatePrices, setUpdatePrices] = useState({ cost: 0, selling: 0 });

  const triggerToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast((prev) => ({ ...prev, show: false })), 3000);
  };

  const refreshInventoryState = () => {
    setSearchTerm('');
    setSearchResults([]);
    setSelectedProduct(null);
  };

  useEffect(() => {
    async function getInitialData() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return router.push('/login');

        const { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        setProfile(profileData);

        if (profileData?.org_id) {
          const { data: branchData } = await supabase
            .from('branches')
            .select('*')
            .eq('org_id', profileData.org_id);

          setBranches(branchData || []);

          const savedBranch = localStorage.getItem('active_branch');
          if (savedBranch) {
            const parsedBranch = JSON.parse(savedBranch);
            setSelectedBranch(parsedBranch);
            fetchStats(parsedBranch.id);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    getInitialData();
  }, [router]);

  useEffect(() => {
    if (showPriceModal && selectedBranch && searchTerm.length > 1) {
      const delayDebounceFn = setTimeout(async () => {
        const { data } = await supabase
          .from('inventory')
          .select(`id, stock, item_name, price, buy_cost`)
          .eq('branch_id', selectedBranch.id)
          .ilike('item_name', `%${searchTerm}%`)
          .limit(5);

        setSearchResults(data || []);
      }, 300);
      return () => clearTimeout(delayDebounceFn);
    } else {
      setSearchResults([]);
    }
  }, [searchTerm, showPriceModal, selectedBranch]);

  async function fetchStats(branchId: string) {
    const [poRes, orderRes] = await Promise.all([
      supabase
        .from('purchase_orders')
        .select('id', { count: 'exact', head: true })
        .eq('branch_id', branchId),
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('branch_id', branchId),
    ]);
    setStats({ poCount: poRes.count || 0, salesCount: orderRes.count || 0 });
  }

  const handleBranchSelect = (branch: any) => {
    setSelectedBranch(branch);
    localStorage.setItem('active_branch', JSON.stringify(branch));
    fetchStats(branch.id);
  };

  const handleLogout = async () => {
    localStorage.removeItem('active_branch');
    await supabase.auth.signOut();
    router.push('/login');
  };

  const handleExportInventory = async () => {
    setLogStatus('QUERYING_DATABASE_FOR_EXPORT...');
    try {
      const { data, error } = await supabase
        .from('inventory')
        .select('item_name, stock, buy_cost, price')
        .eq('branch_id', selectedBranch.id);
      if (error) throw error;
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
      XLSX.writeFile(wb, `${selectedBranch.branch_name}_Inventory.xlsx`);
      setLogStatus('EXPORT_SUCCESSFUL');
      triggerToast('Inventory Exported');
    } catch (err: any) {
      setLogStatus(`EXPORT_ERR: ${err.message}`);
      triggerToast('Export Failed', 'error');
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogStatus('PARSING_EXCEL_DATA...');
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data: any[] = XLSX.utils.sheet_to_json(ws);
        const formattedData = data.map((item) => ({
          item_name: item.item_name,
          stock: item.stock || 0,
          buy_cost: item.buy_cost || 0,
          price: item.price || 0,
          branch_id: selectedBranch.id,
        }));
        const { error } = await supabase
          .from('inventory')
          .insert(formattedData);
        if (error) throw error;
        setLogStatus(`BULK_IMPORT_SUCCESS: ${data.length} ITEMS`);
        triggerToast(`Imported ${data.length} items`);
        fetchStats(selectedBranch.id);
      } catch (err: any) {
        setLogStatus(`IMPORT_ERR: ${err.message}`);
        triggerToast('Import Failed', 'error');
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleSecureReset = async () => {
    if (!selectedBranch) return;
    setIsWiping(true);
    setLogStatus('VERIFYING_MANAGEMENT_IDENTITY...');

    try {
      const ghostSupabase = createClient(
        (supabase as any).supabaseUrl,
        (supabase as any).supabaseKey,
        { auth: { persistSession: false } }
      );

      const { data: authData, error: authError } =
        await ghostSupabase.auth.signInWithPassword({
          email: authDetails.email,
          password: authDetails.password,
        });

      if (authError || !authData.user) throw new Error('AUTH_FAILED');

      const { data: mProf } = await ghostSupabase
        .from('profiles')
        .select('role')
        .eq('id', authData.user.id)
        .single();

      if (mProf?.role !== 'org_manager') throw new Error('NOT_A_MANAGER');

      setLogStatus(
        `IDENTITY_CONFIRMED: WIPING_${selectedBranch.branch_name.toUpperCase()}...`
      );
      const targetId = selectedBranch.id;

      // --- 1. PREPARE IDs FOR NESTED TABLES ---

      // Get PO IDs
      const { data: poRows } = await ghostSupabase
        .from('purchase_orders')
        .select('id')
        .eq('branch_id', targetId);
      const poIds = poRows?.map((r) => r.id) || [];

      // Get Sales Order IDs
      const { data: saleRows } = await ghostSupabase
        .from('orders')
        .select('id')
        .eq('branch_id', targetId);
      const saleIds = saleRows?.map((r) => r.id) || [];

      // --- 2. DELETE LEAF NODES (ITEMS) ---

      // Delete Purchase Items
      if (poIds.length > 0) {
        const { error: err } = await ghostSupabase
          .from('purchase_order_items')
          .delete()
          .in('purchase_order_id', poIds);
        if (err) throw new Error(`PO_Items: ${err.message}`);
      }

      // Delete Sales Items
      if (saleIds.length > 0) {
        const { error: err } = await ghostSupabase
          .from('order_items')
          .delete()
          .in('order_id', saleIds);
        if (err) throw new Error(`Sale_Items: ${err.message}`);
      }

      // --- 3. DELETE HEADERS ---

      // Delete Purchase Orders
      const { error: poErr } = await ghostSupabase
        .from('purchase_orders')
        .delete()
        .eq('branch_id', targetId);
      if (poErr) throw new Error(`POs: ${poErr.message}`);

      // Delete Sales Orders
      const { error: saleErr } = await ghostSupabase
        .from('orders')
        .delete()
        .eq('branch_id', targetId);
      if (saleErr) throw new Error(`Sales: ${saleErr.message}`);

      // --- 4. DELETE ROOT DATA (INVENTORY) ---

      const { error: invErr } = await ghostSupabase
        .from('inventory')
        .delete()
        .eq('branch_id', targetId);
      if (invErr) throw new Error(`Inventory: ${invErr.message}`);

      setLogStatus('WIPE_COMPLETE: NODE_PURGED');
      triggerToast('Branch Data Reset Successful');
      setShowResetAuth(false);
      setAuthDetails({ email: '', password: '' });

      window.location.reload();
    } catch (err: any) {
      setLogStatus(`ERROR: ${err.message}`);
      triggerToast(
        err.message === 'AUTH_FAILED' ? 'Invalid Credentials' : err.message,
        'error'
      );
    } finally {
      setIsWiping(false);
    }
  };

  const handleRegisterProduct = async () => {
    if (!newProduct.name) return triggerToast('Product Name Required', 'error');
    setLogStatus('EXECUTING_DB_INSERT...');
    try {
      const { error } = await supabase.from('inventory').insert([
        {
          item_name: newProduct.name,
          buy_cost: Number(newProduct.cost),
          price: Number(newProduct.selling),
          stock: 0,
          branch_id: selectedBranch.id,
        },
      ]);
      if (error) throw error;
      triggerToast(`${newProduct.name} Registered!`, 'success');
      setLogStatus(`ID_NEW_ITEM_CREATED: ${newProduct.name}`);
      setNewProduct({ name: '', cost: 0, selling: 0 });
      setShowAddModal(false);
    } catch (err: any) {
      setLogStatus(`ERR: ${err.message}`);
      triggerToast(err.message, 'error');
    }
  };

  const handleUpdatePrice = async () => {
    if (!selectedProduct) return;
    setLogStatus('PUSHING_CALIBRATION...');
    try {
      const { error } = await supabase
        .from('inventory')
        .update({ price: updatePrices.selling, buy_cost: updatePrices.cost })
        .eq('id', selectedProduct.id);
      if (error) throw error;
      triggerToast('Price Calibration Complete', 'success');
      refreshInventoryState();
      setShowPriceModal(false);
      setLogStatus('PRICES_SYNCHRONIZED');
    } catch (err: any) {
      setLogStatus(`ERR: ${err.message}`);
      triggerToast(err.message, 'error');
    }
  };

  if (loading)
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center font-mono text-emerald-500 text-[10px] tracking-[.4em]">
        AUTHENTICATING...
      </div>
    );

  if (!selectedBranch) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-10 text-center">
            <h1 className="text-3xl font-black italic text-white tracking-tighter uppercase">
              Assign Station
            </h1>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {branches.map((b) => (
              <button
                key={b.id}
                onClick={() => handleBranchSelect(b)}
                className="group p-6 bg-slate-900 border border-white/5 rounded-2xl flex items-center justify-between hover:border-emerald-500/50 transition-all"
              >
                <div className="flex items-center gap-4 text-left">
                  <div className="bg-slate-800 p-3 rounded-xl group-hover:bg-emerald-500 group-hover:text-black transition-all">
                    <MapPin size={20} />
                  </div>
                  <div>
                    <span className="block text-sm font-black text-white uppercase tracking-tight">
                      {b.branch_name}
                    </span>
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest block mt-1">
                      {b.location || 'Primary Node'}
                    </span>
                  </div>
                </div>
                <ArrowRight
                  size={18}
                  className="text-slate-700 group-hover:text-emerald-500 transition-all"
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Toast Notification */}
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

      {/* Navigation */}
      <nav className="border-b border-white/5 bg-slate-900/40 backdrop-blur-md px-6 py-4 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-lg font-black italic tracking-tighter text-white uppercase leading-none">
              ECONO_<span className="text-emerald-500">DRUGSTORE</span>
            </h1>
            <p className="text-[9px] font-bold text-slate-500 uppercase mt-1 tracking-widest">
              {selectedBranch.branch_name} | {profile?.role}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                localStorage.removeItem('active_branch');
                setSelectedBranch(null);
              }}
              className="p-2 hover:bg-white/5 rounded-lg text-slate-500 transition-colors"
            >
              <LayoutGrid size={18} />
            </button>
            <button
              onClick={handleLogout}
              className="p-2 hover:bg-red-500/10 rounded-lg text-slate-500 hover:text-red-500 transition-colors"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-6 lg:p-10 pb-24">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {[
            {
              label: 'Orders',
              val: stats.salesCount,
              color: 'text-emerald-400',
            },
            { label: 'Purchase', val: stats.poCount, color: 'text-blue-400' },
            { label: 'Status', val: 'ONLINE', color: 'text-slate-400' },
            {
              label: 'Branch',
              val: selectedBranch.branch_name,
              color: 'text-orange-400',
            },
          ].map((s, i) => (
            <div
              key={i}
              className="bg-slate-900/40 border border-white/5 p-5 rounded-2xl"
            >
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">
                {s.label}
              </span>
              <p
                className={`text-xl font-black uppercase tracking-tight ${s.color}`}
              >
                {s.val}
              </p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] px-1 italic">
              Retail_Ops
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => router.push('/staff/order/new')}
                className="flex items-center justify-between p-6 bg-emerald-600 hover:bg-emerald-500 rounded-2xl transition-all shadow-xl shadow-emerald-950/20"
              >
                <span className="text-sm font-black uppercase italic text-white">
                  New Sale
                </span>
                <Plus size={18} />
              </button>
              <button
                onClick={() => router.push('/staff/order/list')}
                className="flex items-center justify-between p-6 bg-slate-900 border border-white/5 rounded-2xl hover:bg-slate-800 transition-all"
              >
                <span className="text-sm font-black uppercase italic text-slate-300">
                  Order List
                </span>
                <ClipboardList size={18} className="text-slate-500" />
              </button>
              <button
                onClick={() => router.push('/staff/inventory/view')}
                className="flex items-center justify-between p-6 bg-slate-900 border border-white/5 rounded-2xl hover:bg-slate-800 transition-all"
              >
                <span className="text-sm font-black uppercase italic text-slate-300">
                  Inventory
                </span>
                <ClipboardList size={18} className="text-slate-500" />
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] px-1 italic">
              Supply_Chain
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() =>
                  router.push(
                    `/staff/purchase/new?branchName=${selectedBranch.branch_name}`
                  )
                }
                className="flex items-center justify-between p-6 bg-blue-600 hover:bg-blue-500 rounded-2xl transition-all shadow-xl shadow-blue-950/20"
              >
                <span className="text-sm font-black uppercase italic text-white">
                  New Purchase
                </span>
                <Package size={18} />
              </button>
              <button
                onClick={() => router.push('/staff/purchase/list')}
                className="flex items-center justify-between p-6 bg-slate-900 border border-white/5 rounded-2xl hover:bg-slate-800 transition-all"
              >
                <span className="text-sm font-black uppercase italic text-slate-300">
                  Purchase List
                </span>
                <Activity size={18} className="text-slate-500" />
              </button>
              <button
                onClick={() =>
                  router.push(
                    '/staff/purchase/update?branchName=${selectedBranch.branch_name}'
                  )
                }
                className="flex items-center justify-between p-6 bg-slate-900 border border-white/5 rounded-2xl hover:bg-slate-800 transition-all"
              >
                <span className="text-sm font-black uppercase italic text-slate-300">
                  Update PO
                </span>
                <Activity size={18} className="text-slate-500" />
              </button>
            </div>
          </div>

          {profile?.role === 'branch_admin' && (
            <>
              <div className="space-y-4 md:col-span-2 pt-6 border-t border-white/5 mt-6">
                <h3 className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.3em] px-1 italic">
                  Catalog_Authority (Admin)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center justify-between p-6 bg-slate-900 border border-emerald-500/30 rounded-2xl hover:border-emerald-500 transition-all group"
                  >
                    <div className="flex items-center gap-4 text-left">
                      <Database size={20} className="text-emerald-500" />
                      <div>
                        <span className="block text-sm font-black uppercase italic text-white leading-none">
                          Register Product
                        </span>
                        <span className="text-[9px] text-slate-500 uppercase mt-1 block tracking-widest font-bold">
                          Add to {selectedBranch.branch_name} node
                        </span>
                      </div>
                    </div>
                    <Plus
                      size={18}
                      className="text-slate-700 group-hover:text-emerald-500"
                    />
                  </button>
                  <button
                    onClick={() => setShowPriceModal(true)}
                    className="flex items-center justify-between p-6 bg-slate-900 border border-blue-500/30 rounded-2xl hover:border-blue-500 transition-all group"
                  >
                    <div className="flex items-center gap-4 text-left">
                      <Tag size={20} className="text-blue-500" />
                      <div>
                        <span className="block text-sm font-black uppercase italic text-white leading-none">
                          Update Stock Price
                        </span>
                        <span className="text-[9px] text-slate-500 uppercase mt-1 block tracking-widest font-bold">
                          Branch Calibration
                        </span>
                      </div>
                    </div>
                    <ArrowRight
                      size={18}
                      className="text-slate-700 group-hover:text-blue-500"
                    />
                  </button>
                </div>
              </div>

              <div className="space-y-4 md:col-span-2 pt-6 border-t border-white/5 mt-6">
                <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.3em] px-1 italic">
                  Data_Management_Authority
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <button
                    onClick={handleExportInventory}
                    className="flex items-center gap-4 p-4 bg-slate-900 border border-white/5 rounded-2xl hover:border-blue-500/50 transition-all text-left group"
                  >
                    <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400 group-hover:bg-blue-500 group-hover:text-black transition-all">
                      <FileDown size={18} />
                    </div>
                    <div>
                      <span className="block text-xs font-black uppercase text-white leading-none">
                        Export Excel
                      </span>
                      <span className="text-[9px] text-slate-500 uppercase mt-1 block">
                        Inventory Report
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={() => router.push('/staff/data-management')}
                    className="flex items-center gap-4 p-4 bg-slate-900 border border-white/5 rounded-2xl hover:border-emerald-500/50 transition-all text-left group"
                  >
                    <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400 group-hover:bg-emerald-500 group-hover:text-black transition-all">
                      <FileUp size={18} />
                    </div>
                    <div>
                      <span className="block text-xs font-black uppercase text-white leading-none">
                        Import Excel
                      </span>
                      <span className="text-[9px] text-slate-500 uppercase mt-1 block">
                        Bulk Stock Inject
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={() => setShowResetAuth(true)}
                    className="flex items-center gap-4 p-4 bg-slate-900 border border-red-500/20 rounded-2xl hover:bg-red-500/10 hover:border-red-500 transition-all text-left group"
                  >
                    <div className="p-2 bg-red-500/10 rounded-lg text-red-500 group-hover:bg-red-500 group-hover:text-black transition-all">
                      <RefreshCw
                        size={18}
                        className={isWiping ? 'animate-spin' : ''}
                      />
                    </div>
                    <div>
                      <span className="block text-xs font-black uppercase text-white leading-none text-red-500">
                        Reset Node
                      </span>
                      <span className="text-[9px] text-slate-500 uppercase mt-1 block">
                        Wipe {selectedBranch.branch_name} Items
                      </span>
                    </div>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* REGISTER PRODUCT MODAL */}
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setShowAddModal(false)}
            />
            <div className="relative bg-slate-900 border border-emerald-500/30 w-full max-w-md rounded-3xl p-8 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black italic text-white uppercase tracking-tighter">
                  New_Product_Entry
                </h2>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-slate-500 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4">
                <input
                  type="text"
                  value={newProduct.name}
                  onChange={(e) =>
                    setNewProduct({ ...newProduct, name: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none"
                  placeholder="Product Name"
                />
                <div className="grid grid-cols-2 gap-4">
                  <input
                    type="number"
                    value={newProduct.cost}
                    onChange={(e) =>
                      setNewProduct({
                        ...newProduct,
                        cost: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none"
                    placeholder="Cost"
                  />
                  <input
                    type="number"
                    value={newProduct.selling}
                    onChange={(e) =>
                      setNewProduct({
                        ...newProduct,
                        selling: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none"
                    placeholder="Selling"
                  />
                </div>
                <button
                  onClick={handleRegisterProduct}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-black uppercase tracking-widest text-white mt-4 transition-all"
                >
                  Execute Registration
                </button>
              </div>
            </div>
          </div>
        )}

        {/* UPDATE PRICE MODAL */}
        {showPriceModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => {
                setShowPriceModal(false);
                refreshInventoryState();
              }}
            />
            <div className="relative bg-slate-900 border border-blue-500/30 w-full max-w-md rounded-3xl p-8 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black italic text-white uppercase tracking-tighter">
                  Price_Calibration
                </h2>
                <button
                  onClick={() => {
                    setShowPriceModal(false);
                    refreshInventoryState();
                  }}
                  className="text-slate-500 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4">
                <div className="relative">
                  <Search
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
                    size={16}
                  />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-slate-950 border border-white/5 rounded-xl pl-12 pr-4 py-3 text-sm text-white outline-none"
                    placeholder="Search branch inventory..."
                  />
                </div>
                {!selectedProduct && searchResults.length > 0 && (
                  <div className="bg-slate-950 border border-white/5 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
                    {searchResults.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedProduct(p);
                          setUpdatePrices({
                            cost: p.buy_cost,
                            selling: p.price,
                          });
                        }}
                        className="w-full px-4 py-3 text-left border-b border-white/5 hover:bg-blue-500/10 group"
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-300 group-hover:text-white uppercase">
                            {p.item_name}
                          </span>
                          <span className="text-[10px] font-black text-emerald-500">
                            {p.stock} UNIT
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {selectedProduct && (
                  <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-2xl space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black text-white uppercase italic">
                        {selectedProduct.item_name}
                      </span>
                      <button
                        onClick={() => setSelectedProduct(null)}
                        className="text-[9px] text-slate-500 uppercase font-black"
                      >
                        Change
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="number"
                        value={updatePrices.cost}
                        onChange={(e) =>
                          setUpdatePrices({
                            ...updatePrices,
                            cost: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none"
                        placeholder="Cost"
                      />
                      <input
                        type="number"
                        value={updatePrices.selling}
                        onChange={(e) =>
                          setUpdatePrices({
                            ...updatePrices,
                            selling: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none"
                        placeholder="Price"
                      />
                    </div>
                    <button
                      onClick={handleUpdatePrice}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-black uppercase text-white transition-all"
                    >
                      Commit Adjustments
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SECURE RESET AUTH MODAL */}
        {showResetAuth && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-6">
            <div
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
              onClick={() => setShowResetAuth(false)}
            />
            <div className="relative bg-slate-900 border border-red-500/30 w-full max-w-md rounded-3xl p-8 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black italic text-red-500 uppercase tracking-tighter">
                  Manager_Auth_Required
                </h2>
                <button
                  onClick={() => setShowResetAuth(false)}
                  className="text-slate-500 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>
              <p className="text-[10px] text-slate-400 uppercase font-bold mb-6">
                Wiping Data for:{' '}
                <span className="text-white">{selectedBranch.branch_name}</span>
              </p>
              <div className="space-y-4">
                <input
                  type="email"
                  placeholder="MANAGER EMAIL"
                  value={authDetails.email}
                  onChange={(e) =>
                    setAuthDetails({ ...authDetails, email: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-red-500/50"
                />
                <input
                  type="password"
                  placeholder="MANAGER PASSWORD"
                  value={authDetails.password}
                  onChange={(e) =>
                    setAuthDetails({ ...authDetails, password: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-red-500/50"
                />
                <button
                  onClick={handleSecureReset}
                  disabled={isWiping}
                  className="w-full py-4 bg-red-600 hover:bg-red-500 rounded-xl text-sm font-black uppercase text-white mt-4"
                >
                  {isWiping ? 'Wiping Node...' : 'Confirm Node Reset'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="fixed bottom-6 left-6 right-6 max-w-6xl mx-auto">
          <div className="bg-black/80 backdrop-blur-xl border border-emerald-500/20 p-4 rounded-2xl flex items-center gap-4 shadow-2xl">
            <div className="bg-emerald-500/20 p-2 rounded-lg text-emerald-500">
              <Terminal size={16} />
            </div>
            <div>
              <p className="text-[8px] font-black text-emerald-500/50 uppercase tracking-[0.2em]">
                System_Log_Activity
              </p>
              <p className="text-[10px] font-bold text-emerald-100 uppercase tracking-wide">
                {logStatus || 'Ready for command...'}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
