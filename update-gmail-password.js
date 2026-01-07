#!/usr/bin/env node
/**
 * Script para actualizar el App Password de Gmail de kodigovivo
 * 
 * USO:
 * node update-gmail-password.js "abcd efgh ijkl mnop"
 * 
 * Donde "abcd efgh ijkl mnop" es el App Password de 16 caracteres de Gmail
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function encryptCredential(plaintext) {
  try {
    const key = Buffer.from(process.env.EMAIL_CRED_ENC_KEY, 'hex');
    const iv = crypto.randomBytes(IV_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Formato: iv:authTag:encrypted (todo en hex)
    const combined = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    
    // Retornar en base64
    return Buffer.from(combined).toString('base64');
  } catch (error) {
    console.error('❌ Error al cifrar:', error.message);
    throw error;
  }
}

async function main() {
  const appPassword = process.argv[2];
  
  if (!appPassword) {
    console.error('❌ Error: Debes proporcionar el App Password de Gmail');
    console.log('\nUso:');
    console.log('  node update-gmail-password.js "abcd efgh ijkl mnop"');
    console.log('\nDonde "abcd efgh ijkl mnop" es el App Password de 16 caracteres');
    console.log('generado en: https://myaccount.google.com/apppasswords');
    process.exit(1);
  }
  
  // Limpiar espacios (Gmail genera con espacios)
  const cleanPassword = appPassword.replace(/\s+/g, '');
  
  console.log('🔐 Encriptando App Password...');
  console.log('Password length:', cleanPassword.length);
  
  if (cleanPassword.length !== 16) {
    console.error('⚠️  Advertencia: App Password de Gmail debería tener 16 caracteres');
    console.log('Longitud actual:', cleanPassword.length);
  }
  
  const encryptedImap = encryptCredential(cleanPassword);
  const encryptedSmtp = encryptCredential(cleanPassword);
  
  console.log('✅ Encriptación exitosa');
  console.log('Encrypted length:', encryptedImap.length);
  
  // Conectar a Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  console.log('\n📝 Actualizando cuenta en Supabase...');
  
  const { data, error } = await supabase
    .from('email_accounts')
    .update({
      imap_pass_enc: encryptedImap,
      smtp_pass_enc: encryptedSmtp,
      updated_at: new Date().toISOString()
    })
    .eq('from_email', 'kodigovivo@gmail.com')
    .select();
  
  if (error) {
    console.error('❌ Error al actualizar:', error);
    process.exit(1);
  }
  
  console.log('✅ Cuenta actualizada exitosamente');
  console.log('Cuenta:', data[0].from_email);
  console.log('Account ID:', data[0].id);
  
  console.log('\n🎯 SIGUIENTE PASO:');
  console.log('Espera 5 minutos y verifica los logs de sync:');
  console.log('ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233');
  console.log('pm2 logs al-e-core --lines 50 | grep kodigovivo');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
