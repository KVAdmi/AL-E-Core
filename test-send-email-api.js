const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testEmailSend() {
  console.log('🔍 PASO 1: Obteniendo cuenta SMTP activa...\n');
  
  const { data: accounts, error } = await supabase
    .from('email_accounts')
    .select('id, from_email, owner_user_id, smtp_host, smtp_port')
    .eq('is_active', true)
    .limit(1);
  
  if (error || !accounts || accounts.length === 0) {
    console.error('❌ No hay cuentas SMTP activas');
    process.exit(1);
  }
  
  const account = accounts[0];
  console.log('✅ Cuenta encontrada:');
  console.log('   Email:', account.from_email);
  console.log('   Account ID:', account.id);
  console.log('   User ID:', account.owner_user_id);
  console.log('   SMTP:', account.smtp_host + ':' + account.smtp_port);
  console.log('');
  
  // Generar JWT token para el usuario
  console.log('🔑 PASO 2: Generando JWT token...\n');
  const { data: { session }, error: authError } = await supabase.auth.admin.createUser({
    email: account.from_email,
    email_confirm: true
  });
  
  // Obtener token existente o crear uno
  const { data: userData } = await supabase.auth.admin.getUserById(account.owner_user_id);
  
  if (!userData || !userData.user) {
    console.error('❌ No se pudo obtener usuario');
    process.exit(1);
  }
  
  // Crear sesión temporal
  const { data: sessionData } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: account.from_email
  });
  
  console.log('✅ Usuario autenticado\n');
  
  // Enviar email de prueba
  console.log('📧 PASO 3: Enviando email de prueba...\n');
  console.log('═══════════════════════════════════════');
  
  try {
    const response = await axios.post(
      'http://localhost:3000/api/mail/send',
      {
        accountId: account.id,
        to: account.from_email, // Enviarse a sí mismo para probar
        subject: '✅ TEST SMTP REAL - ' + new Date().toISOString(),
        body: 'Este email confirma que nodemailer + SMTP está funcionando.\n\nEnviado: ' + new Date().toLocaleString()
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': account.owner_user_id // Usar middleware simplificado
        }
      }
    );
    
    console.log('═══════════════════════════════════════\n');
    console.log('✅ EMAIL ENVIADO EXITOSAMENTE');
    console.log('📬 Message ID:', response.data.messageId);
    console.log('');
    console.log('🎯 PASO 1 COMPLETADO');
    console.log('   Revisa inbox de:', account.from_email);
    
  } catch (error) {
    console.log('═══════════════════════════════════════\n');
    console.error('❌ ERROR:', error.response?.data || error.message);
    process.exit(1);
  }
}

testEmailSend();
