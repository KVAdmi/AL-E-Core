const nodemailer = require('nodemailer');

// Test SMTP directo sin dependencias de Supabase
async function testSMTPReal() {
  console.log('🚀 INICIANDO TEST SMTP REAL (AWS SES)\n');

  const transport = nodemailer.createTransport({
    host: 'email-smtp.us-east-1.amazonaws.com',
    port: 587,
    secure: false,
    auth: {
      user: 'AKIA6OPTJECMR6UBUR6I',
      pass: 'BPplEpZt83yDd7BKiS6yXk5J1uOmE3RX9d5BhpRGwFoK'
    },
    debug: true,
    logger: true
  });

  try {
    console.log('📡 Verificando conexión SMTP...');
    await transport.verify();
    console.log('✅ SMTP VERIFY OK\n');

    console.log('📧 Enviando email de prueba...');
    const info = await transport.sendMail({
      from: '"AL-E Test" <plataforma.kunna@gmail.com>',
      to: 'plataforma.kunna@gmail.com',
      subject: '✅ TEST SMTP REAL - ' + new Date().toISOString(),
      text: 'Este email confirma que SMTP está funcionando correctamente',
      html: '<h1>✅ SMTP Funcionando</h1><p>Email enviado: ' + new Date().toLocaleString() + '</p>'
    });

    console.log('\n✅ MESSAGE ACCEPTED');
    console.log('📬 Message ID:', info.messageId);
    console.log('📨 Response:', info.response);
    console.log('\n🎯 PASO 1 COMPLETO: Revisa inbox de plataforma.kunna@gmail.com');

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    process.exit(1);
  }
}

testSMTPReal();
