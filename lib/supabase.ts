import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://euiplkmilfhujuprzifd.supabase.co';
const supabaseAnonKey = 'sb_publishable_DnFrjA2Nb8WcJIFg1irhqQ_DRQqv0Vc';

// This is a singleton client to prevent memory leaks on mobile browsers
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
