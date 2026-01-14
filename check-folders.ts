import { supabase } from './src/db/supabase';

async function checkFolders() {
  const userId = '56bc3448-6af0-4468-99b9-78779bf84ae8';
  
  console.log('🔍 Verificando folders para usuario:', userId);
  
  const { data, error } = await supabase
    .from('email_folders')
    .select('id, account_id, folder_name, folder_type, imap_path, owner_user_id')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
  
  console.log(`\n📊 Total folders encontrados: ${data.length}\n`);
  
  if (data.length === 0) {
    console.log('⚠️ NO HAY FOLDERS EN LA BASE DE DATOS');
  } else {
    data.forEach(f => {
      console.log(`- ${f.folder_name.padEnd(15)} (type: ${f.folder_type.padEnd(8)}) → ${f.imap_path.padEnd(30)} [account: ${f.account_id.substring(0,8)}...]`);
    });
  }
  
  console.log('\n🔍 Verificando cuentas:');
  const { data: accounts } = await supabase
    .from('email_accounts')
    .select('id, from_email, is_active')
    .eq('owner_user_id', userId);
  
  accounts?.forEach(a => {
    console.log(`- ${a.from_email} (${a.is_active ? 'ACTIVA' : 'INACTIVA'}) [${a.id.substring(0,8)}...]`);
  });
  
  process.exit(0);
}

checkFolders();
