'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function AddInventoryItem() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<any>(null);

  // Form State matching your 'inventory' table columns
  const [formData, setFormData] = useState({
    item_name: '',
    stock_quantity: 0,
    price: 0,
    expiry_date: '',
  });

  useEffect(() => {
    async function getProfile() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push('/login');
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      setProfile(data);
    }
    getProfile();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from('inventory').insert([
      {
        ...formData,
        branch_id: profile.branch_id, // Automatically link to current branch
        updated_at: new Date().toISOString(),
      },
    ]);

    if (error) {
      alert(error.message);
    } else {
      alert('Product Registered Successfully');
      router.push('/staff');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 flex justify-center items-center">
      <div className="bg-slate-900 border border-white/10 p-8 rounded-3xl w-full max-w-md shadow-2xl">
        <h1 className="text-2xl font-black italic mb-6 text-purple-400">
          REGISTER_NEW_PRODUCT
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
              Item Name / Generic
            </label>
            <input
              required
              className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 outline-none focus:border-purple-500"
              onChange={(e) =>
                setFormData({ ...formData, item_name: e.target.value })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
                Initial Qty
              </label>
              <input
                type="number"
                className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 outline-none"
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    stock_quantity: parseInt(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
                Base Price
              </label>
              <input
                type="number"
                step="0.01"
                className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 outline-none"
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    price: parseFloat(e.target.value),
                  })
                }
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
              Expiry Date
            </label>
            <input
              type="date"
              className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 outline-none"
              onChange={(e) =>
                setFormData({ ...formData, expiry_date: e.target.value })
              }
            />
          </div>

          <button
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-500 py-4 rounded-xl font-black uppercase italic mt-4 transition-all"
          >
            {loading ? 'PROCESSING...' : 'ADD TO INVENTORY'}
          </button>
        </form>
      </div>
    </div>
  );
}
