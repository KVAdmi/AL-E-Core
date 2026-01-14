#!/usr/bin/env node
/**
 * =====================================================
 * POPULATE EMAIL FOLDERS - SCRIPT
 * =====================================================
 * 
 * Descubre y pobla folders IMAP para cuentas existentes
 * 
 * Uso:
 *   npm run populate-folders [userId]
 * 
 * Si no se proporciona userId, pobla TODAS las cuentas
 * =====================================================
 */

import { populateFoldersForUser, populateFoldersForAllAccounts } from './src/services/emailFoldersService';

async function main() {
  const userId = process.argv[2];
  
  try {
    if (userId) {
      console.log('🔍 Poblando folders para usuario:', userId);
      await populateFoldersForUser(userId);
    } else {
      console.log('🌐 Poblando folders para TODAS las cuentas activas...');
      await populateFoldersForAllAccounts();
    }
    
    console.log('✅ Proceso completado exitosamente');
    process.exit(0);
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
