'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Eye, EyeOff } from 'lucide-react'; // ← added for password toggle

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false); // ← new state
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus('idle');
    setMessage('');

    // 1. Login with Supabase Auth
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setStatus('error');
      setMessage(authError.message);
      setLoading(false);
      return;
    }

    // 2. Check if account is ACTIVE in profiles table
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('status')
        .eq('id', user.id)
        .single();

      if (profile && profile.status !== 'ACTIVE') {
        await supabase.auth.signOut();
        setStatus('error');
        setMessage(
          'Your account has been deactivated. Please contact the administrator.'
        );
        setLoading(false);
        return;
      }
    }

    // 3. All good → success
    setStatus('success');

    setTimeout(() => {
      router.push('/gatekeeper');
    }, 1500);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020617] relative overflow-hidden font-sans">
      {/* SUCCESS NOTIFICATION */}
      {status === 'success' && (
        <div className="absolute top-5 right-5 bg-emerald-500 text-white px-6 py-3 rounded-lg shadow-2xl flex items-center gap-3 animate-bounce z-50">
          <span className="text-xl">🚀</span>
          <div>
            <p className="font-bold uppercase text-xs tracking-widest">
              Access Granted
            </p>
            <p className="text-[10px] opacity-90">Running Identity Check...</p>
          </div>
        </div>
      )}

      <div className="max-w-md w-full bg-slate-900 p-10 rounded-[2rem] shadow-2xl border border-white/5">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-black text-white italic tracking-tighter">
            ECONO<span className="text-emerald-500">_DRUGSTORE</span>
          </h1>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-2">
            Secure Terminal Login
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          {/* Email */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
              Email Address
            </label>
            <input
              type="email"
              required
              placeholder="admin@pharma.com"
              className="w-full p-3 bg-slate-950 border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all placeholder:text-slate-700"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {/* Password with toggle */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="••••••••"
                className="w-full p-3 bg-slate-950 border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all placeholder:text-slate-700 pr-12"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {/* Error message */}
          {status === 'error' && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-red-500 text-[10px] text-center font-black uppercase tracking-widest">
                {message}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || status === 'success'}
            className={`w-full py-4 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] transition-all active:scale-95 text-white ${
              status === 'success'
                ? 'bg-emerald-400 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/20'
            }`}
          >
            {loading
              ? 'Verifying...'
              : status === 'success'
              ? 'Authorized'
              : 'Initialize Session'}
          </button>
        </form>
      </div>
    </div>
  );
}
