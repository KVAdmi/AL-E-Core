const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSMTPAccounts() {
  console.log('🔍 Verificando cuentas SMTP configuradas...\n');
  
  const { data, error } = await supabase
    .from('email_accounts')
    .select('id, from_email, provider, status, is_active, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass_enc')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  if (!data || data.length === 0) {
    console.log('⚠️ No hay cuentas SMTP activas configuradas');
    return;
  }
  
  console.log(`✅ ${data.length} cuenta(s) encontrada(s):\n`);
  
  data.forEach((acc, i) => {
    console.log(`[${i + 1}] ${acc.from_email}`);
    console.log(`    ID: ${acc.id}`);
    console.log(`    Provider: ${acc.provider}`);
    console.log(`    Status: ${acc.status}`);
    console.log(`    SMTP Host: ${acc.smtp_host || 'NOT SET'}`);
    console.log(`    SMTP Port: ${acc.smtp_port || 'NOT SET'}`);
    console.log(`    SMTP Secure: ${acc.smtp_secure}`);
    console.log(`    SMTP User: ${acc.smtp_user || 'NOT SET'}`);
    console.log(`    SMTP Pass: ${acc.smtp_pass_enc ? 'ENCRYPTED (PRESENT)' : 'MISSING'}`);
    console.log('');
  });
}

checkSMTPAccounts();
