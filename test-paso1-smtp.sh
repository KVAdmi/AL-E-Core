#!/bin/bash
# Test SMTP directo en EC2

echo "🚀 TEST PASO 1: EMAIL SMTP REAL"
echo "================================"
echo ""

# Conectar a EC2 y ejecutar test
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 << 'ENDSSH'

cd AL-E-Core

# Crear script de test
cat > test-smtp-now.js << 'EOF'
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://gptwzuqmuvzttajgjrry.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwdHd6dXFtdXZ6dHRhamdqcnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjUwNTU3MCwiZXhwIjoyMDY4MDgxNTcwfQ.IKpBhVtP2aP28iTr_0EKUfblpmpvF2R2UT5RcSpwowY'
);

async function test() {
  console.log('📧 Obteniendo cuenta SMTP...');
  
  const { data: accounts } = await supabase
    .from('email_accounts')
    .select('id, from_email, owner_user_id')
    .eq('is_active', true)
    .limit(1);
  
  if (!accounts || accounts.length === 0) {
    console.error('❌ Sin cuentas SMTP');
    process.exit(1);
  }
  
  const acc = accounts[0];
  console.log('✅ Cuenta:', acc.from_email);
  console.log('');
  console.log('📤 Enviando email...');
  console.log('════════════════════════════════════════');
  
  try {
    const res = await axios.post('http://localhost:3000/api/mail/send', {
      accountId: acc.id,
      to: acc.from_email,
      subject: '✅ SMTP TEST - ' + new Date().toISOString(),
      body: 'Email de prueba SMTP real con nodemailer'
    }, {
      headers: { 'x-user-id': acc.owner_user_id }
    });
    
    console.log('════════════════════════════════════════');
    console.log('✅ SMTP VERIFY OK');
    console.log('✅ MESSAGE ACCEPTED');
    console.log('📬 Message ID:', res.data.messageId);
    console.log('');
    console.log('🎯 PASO 1 COMPLETO - Revisa inbox:', acc.from_email);
    
  } catch (err) {
    console.log('════════════════════════════════════════');
    console.error('❌ ERROR:', err.response?.data || err.message);
    process.exit(1);
  }
}

test();
EOF

# Ejecutar test
node test-smtp-now.js

ENDSSH
