const { createClient } = require('@supabase/supabase-js');

// Supabase configuration - using environment variables only
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required Supabase environment variables: SUPABASE_URL and SUPABASE_ANON_KEY');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = {
  supabase,
  supabaseUrl,
  supabaseKey
};
