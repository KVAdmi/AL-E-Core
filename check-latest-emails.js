require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getLatestEmails() {
  // Buscar cuenta de infinitykode
  const { data: account, error: accountError } = await supabase
    .from('email_accounts')
    .select('id, from_email')
    .ilike('from_email', '%infinitykode%')
    .single();
  
  if (accountError || !account) {
    console.log('❌ No se encontró cuenta de infinitykode');
    console.log('Error:', accountError?.message);
    return;
  }
  
  console.log('📧 Cuenta:', account.from_email);
  console.log('');
  
  // Obtener últimos 10 mensajes
  const { data: messages, error: messagesError } = await supabase
    .from('email_messages')
    .select('*')
    .eq('account_id', account.id)
    .order('date', { ascending: false })
    .limit(10);
  
  if (messagesError) {
    console.log('❌ Error obteniendo mensajes:', messagesError.message);
    return;
  }
  
  if (!messages || messages.length === 0) {
    console.log('❌ No hay mensajes sincronizados');
    return;
  }
  
  console.log(`✅ Últimos ${messages.length} correos:\n`);
  
  messages.forEach((msg, i) => {
    const date = new Date(msg.date).toLocaleString('es-MX');
    console.log(`${i + 1}. [${date}]`);
    console.log(`   De: ${msg.from_address}`);
    console.log(`   Asunto: ${msg.subject}`);
    console.log(`   Preview: ${msg.body_preview?.substring(0, 150) || 'Sin preview'}...`);
    console.log('');
  });
  
  // Mostrar el más reciente con más detalle
  console.log('\n📌 ÚLTIMO CORREO (detalle):');
  console.log('═══════════════════════════════════════════════════════');
  const latest = messages[0];
  console.log(`Fecha: ${new Date(latest.date).toLocaleString('es-MX')}`);
  console.log(`De: ${latest.from_address}`);
  console.log(`Para: ${latest.to_address}`);
  console.log(`Asunto: ${latest.subject}`);
  console.log(`\nContenido:`);
  console.log(latest.body_text?.substring(0, 500) || latest.body_preview || 'Sin contenido');
}

getLatestEmails().catch(console.error);
