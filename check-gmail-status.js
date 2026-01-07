require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkGmailAccount() {
  const { data: account } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('from_email', 'kodigovivo@gmail.com')
    .single();
  
  if (!account) {
    console.log('❌ Cuenta no encontrada');
    return;
  }
  
  console.log('📧 Cuenta Gmail:');
  console.log('  Email:', account.from_email);
  console.log('  Status:', account.sync_status);
  console.log('  Last sync:', account.last_sync_at);
  console.log('  Error:', account.sync_error);
  console.log('');
  
  const { data: messages, count } = await supabase
    .from('email_messages')
    .select('*', { count: 'exact' })
    .eq('account_id', account.id)
    .order('date', { ascending: false })
    .limit(10);
  
  console.log(`📬 Total mensajes sincronizados: ${count}`);
  console.log('');
  
  if (messages && messages.length > 0) {
    console.log('Últimos 10 correos:');
    messages.forEach((msg, i) => {
      const date = msg.date ? new Date(msg.date).toLocaleString('es-MX') : 'Sin fecha';
      console.log(`${i + 1}. [${date}]`);
      console.log(`   De: ${msg.from_address || 'Unknown'}`);
      console.log(`   Asunto: ${msg.subject || '(Sin asunto)'}`);
      console.log(`   Preview: ${msg.body_preview?.substring(0, 80) || 'Sin preview'}`);
      console.log('');
    });
  } else {
    console.log('⚠️  No hay mensajes sincronizados aún');
  }
}

checkGmailAccount().catch(console.error);
