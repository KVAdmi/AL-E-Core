/**
 * TEST SMTP REAL - PASO 1
 * 
 * Valida:
 * - nodemailer instalado
 * - transport.verify() funciona
 * - Envío real de correo
 * - Message accepted por servidor
 */

const nodemailer = require('nodemailer');
const { supabase } = require('./dist/db/supabase');
const { decryptCredential } = require('./dist/utils/emailEncryption');

async function testSMTPReal() {
  console.log('\n========================================');
  console.log('🧪 TEST SMTP REAL - PASO 1');
  console.log('========================================\n');

  try {
    // 1. Obtener cuenta de email configurada
    console.log('[1/5] 🔍 Buscando cuenta configurada...');
    const { data: accounts, error: accountError } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('is_active', true)
      .eq('status', 'active')
      .limit(1);

    if (accountError || !accounts || accounts.length === 0) {
      console.error('❌ NO HAY CUENTAS CONFIGURADAS');
      console.error('Error:', accountError);
      process.exit(1);
    }

    const account = accounts[0];
    console.log('✅ Cuenta encontrada:', account.from_email);
    console.log('   Provider:', account.provider);
    console.log('   SMTP Host:', account.smtp_host);
    console.log('   SMTP Port:', account.smtp_port);

    // 2. Descifrar password
    console.log('\n[2/5] 🔐 Descifrando credenciales...');
    const smtpPass = decryptCredential(account.smtp_pass_enc);
    console.log('✅ Password descifrado (longitud:', smtpPass.length, 'chars)');

    // 3. Crear transporter con nodemailer
    console.log('\n[3/5] 🔧 Creando transporter nodemailer...');
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_secure || false,
      auth: {
        user: account.smtp_user,
        pass: smtpPass
      }
    });
    console.log('✅ Transporter creado');

    // 4. VALIDAR SMTP con verify()
    console.log('\n[4/5] 🔍 Verificando conexión SMTP (transport.verify())...');
    try {
      await transporter.verify();
      console.log('✅ ✅ ✅ SMTP VERIFY OK - Conexión válida');
    } catch (verifyError) {
      console.error('❌ ❌ ❌ SMTP VERIFY FAILED');
      console.error('Error:', verifyError.message);
      throw verifyError;
    }

    // 5. ENVIAR CORREO REAL
    console.log('\n[5/5] 📤 Enviando correo de prueba...');
    const info = await transporter.sendMail({
      from: `"${account.from_name}" <${account.from_email}>`,
      to: account.from_email, // Enviar a sí mismo como prueba
      subject: `✅ TEST SMTP AL-E - ${new Date().toISOString()}`,
      text: `Este es un correo de prueba del sistema AL-E.\n\nValidación SMTP completada exitosamente.\n\nFecha: ${new Date().toLocaleString()}\nProvider: ${account.provider}\nHost: ${account.smtp_host}`,
      html: `<h2>✅ TEST SMTP AL-E</h2>
<p>Este es un correo de prueba del sistema AL-E.</p>
<p><strong>Validación SMTP completada exitosamente.</strong></p>
<hr>
<p><small>Fecha: ${new Date().toLocaleString()}<br>
Provider: ${account.provider}<br>
Host: ${account.smtp_host}</small></p>`
    });

    console.log('✅ ✅ ✅ MESSAGE ACCEPTED');
    console.log('📬 Message ID:', info.messageId);
    console.log('📨 Response:', info.response);

    console.log('\n========================================');
    console.log('✅ PASO 1 COMPLETADO EXITOSAMENTE');
    console.log('========================================');
    console.log('\n📋 EVIDENCIA:');
    console.log('   - nodemailer: INSTALADO Y FUNCIONANDO');
    console.log('   - transport.verify(): OK');
    console.log('   - Message accepted:', info.messageId);
    console.log('\n📸 Ahora verifica tu inbox:', account.from_email);
    console.log('   Busca el email con subject: "TEST SMTP AL-E"');
    
    process.exit(0);

  } catch (error) {
    console.error('\n❌ ERROR EN TEST SMTP');
    console.error('Mensaje:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Ejecutar test
testSMTPReal();
