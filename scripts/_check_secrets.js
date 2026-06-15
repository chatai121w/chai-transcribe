import { createClient } from '@supabase/supabase-js';
const s = createClient('https://pycryoyipkymaqorgpjy.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5Y3J5b3lpcGt5bWFxb3JncGp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTY4MDcsImV4cCI6MjA5NjY3MjgwN30.KRCp-SoyxzvGb9BHLwa-yTAN1A95TjRFAQHTOD1qEzg');
async function t() {
  await s.auth.signInWithPassword({email:'jj1212t@gmail.com',password:'543211'});
  
  // Test the DB proxy directly with google API approach
  const {data, error} = await s.rpc('edit_transcript_proxy', {
    p_text: 'שלום עולם, זה בדיקה',
    p_action: 'summarize',
  });
  console.log('PROXY RESULT:', JSON.stringify(data));
  if (error) console.log('PROXY ERROR:', error.message);
}
t();
