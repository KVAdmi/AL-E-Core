#!/bin/bash

# Script para consultar cuentas de email en Supabase

echo "🔍 Consultando cuentas de email en Supabase..."
echo ""

ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 << 'ENDSSH'
cd ~/AL-E-Core

# Cargar variables de entorno
export $(grep -v '^#' .env | xargs)

# Ejecutar consulta con Node
node << 'EONODE'
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkAccounts() {
  console.log('📧 Consultando email_accounts...\n');
  
  const { data, error } = await supabase
    .from('email_accounts')
    .select('*')
    .limit(10);
  
  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }
  
  if (!data || data.length === 0) {
    console.log('⚠️  No hay cuentas de email configuradas');
    return;
  }
  
  console.log(`✅ Encontradas ${data.length} cuenta(s):\n`);
  
  data.forEach((acc, i) => {
    console.log(`${i + 1}. ID: ${acc.id}`);
    console.log(`   Email: ${acc.from_email}`);
    console.log(`   Provider: ${acc.provider_label || acc.provider || 'N/A'}`);
    console.log(`   Activa: ${acc.is_active}`);
    console.log(`   Usuario: ${acc.owner_user_id}`);
    console.log(`   Creada: ${acc.created_at}`);
    console.log('');
  });
}

checkAccounts().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
EONODE

ENDSSH
