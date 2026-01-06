#!/usr/bin/env node
/**
 * DEBUG EMAIL SYNC - Diagnóstico completo
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('==========================================');
  console.log('DEBUG: Email Sync System');
  console.log('==========================================\n');

  // 1. Cuentas activas
  console.log('1️⃣ CUENTAS ACTIVAS:');
  const { data: accounts, error: accountsError } = await supabase
    .from('email_accounts')
    .select('id, from_email, imap_host, imap_port, imap_user, created_at')
    .not('owner_user_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);

  if (accountsError) {
    console.error('❌ Error:', accountsError.message);
  } else {
    console.table(accounts);
  }

  // 2. Folders por cuenta
  console.log('\n2️⃣ FOLDERS POR CUENTA:');
  for (const account of accounts || []) {
    const { data: folders, error: foldersError } = await supabase
      .from('email_folders')
      .select('id, folder_name, folder_type, imap_path, created_at')
      .eq('account_id', account.id)
      .order('sort_order');

    console.log(`\n📧 ${account.from_email} (${account.id}):`);
    if (foldersError) {
      console.error('  ❌ Error:', foldersError.message);
    } else if (!folders || folders.length === 0) {
      console.error('  ⚠️ NO TIENE FOLDERS (Trigger no funcionó)');
    } else {
      console.table(folders);
    }
  }

  // 3. Últimos sync logs
  console.log('\n3️⃣ ÚLTIMOS SYNC LOGS:');
  const { data: logs, error: logsError } = await supabase
    .from('email_sync_log')
    .select('account_id, sync_type, status, messages_fetched, messages_new, errors, started_at, completed_at')
    .order('started_at', { ascending: false })
    .limit(10);

  if (logsError) {
    console.error('❌ Error:', logsError.message);
  } else {
    console.table(logs);
  }

  // 4. Mensajes recibidos
  console.log('\n4️⃣ MENSAJES EN DB:');
  const { data: messages, error: messagesError } = await supabase
    .from('email_messages')
    .select('account_id, from_address, subject, date')
    .order('date', { ascending: false })
    .limit(10);

  if (messagesError) {
    console.error('❌ Error:', messagesError.message);
  } else {
    console.table(messages);
  }

  console.log('\n==========================================');
  console.log('FIN DEBUG');
  console.log('==========================================');
}

main().catch(console.error);
