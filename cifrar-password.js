#!/usr/bin/env node

/**
 * Script para cifrar contraseñas de email
 * Uso: node cifrar-password.js "tu_contraseña_aqui"
 */

const crypto = require('crypto');

// Obtener contraseña del argumento
const password = process.argv[2];

if (!password) {
  console.error('❌ Error: Debes proporcionar la contraseña');
  console.log('\n📖 Uso:');
  console.log('  node cifrar-password.js "tu_contraseña_aqui"');
  console.log('\n📝 Ejemplo:');
  console.log('  node cifrar-password.js "MiPasswordSeguro123"');
  process.exit(1);
}

// Obtener clave de cifrado del ambiente
const ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  console.error('❌ Error: No se encontró EMAIL_ENCRYPTION_KEY en .env');
  console.log('\n📝 Configura la variable de ambiente:');
  console.log('  export EMAIL_ENCRYPTION_KEY="tu_clave_de_64_caracteres"');
  process.exit(1);
}

// Validar longitud de clave
if (ENCRYPTION_KEY.length !== 64) {
  console.error('❌ Error: EMAIL_ENCRYPTION_KEY debe tener 64 caracteres hexadecimales');
  console.log(`   Longitud actual: ${ENCRYPTION_KEY.length}`);
  process.exit(1);
}

// Cifrar contraseña (mismo algoritmo que emailEncryption.ts)
function encryptCredential(text) {
  const algorithm = 'aes-256-cbc';
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Retornar: iv:encrypted
  return iv.toString('hex') + ':' + encrypted;
}

// Cifrar y mostrar resultado
try {
  const encrypted = encryptCredential(password);
  
  console.log('\n✅ Contraseña cifrada exitosamente:');
  console.log('\n' + '='.repeat(80));
  console.log(encrypted);
  console.log('='.repeat(80) + '\n');
  
  console.log('📋 Copia este valor cifrado y úsalo en Supabase:');
  console.log(`   Columna: smtp_pass_enc`);
  console.log(`   Valor: ${encrypted}\n`);
  
  console.log('🔐 IMPORTANTE: Nunca compartas este valor cifrado públicamente');
  console.log('   Solo guárdalo en Supabase (tabla email_accounts)\n');
  
} catch (error) {
  console.error('❌ Error al cifrar:', error.message);
  process.exit(1);
}
