// TEST: Listar voces Polly en español mexicano
const { PollyClient, DescribeVoicesCommand } = require('@aws-sdk/client-polly');

async function listMexicanVoices() {
  console.log('═══════════════════════════════════════');
  console.log('🎙️ VOCES POLLY - ESPAÑOL MEXICANO');
  console.log('═══════════════════════════════════════');
  
  try {
    const client = new PollyClient({ region: 'us-east-1' });
    
    const command = new DescribeVoicesCommand({
      LanguageCode: 'es-MX'
    });
    
    const response = await client.send(command);
    
    console.log(`\n✅ ${response.Voices.length} voces encontradas:\n`);
    
    response.Voices.forEach(voice => {
      console.log(`🎤 ${voice.Name}`);
      console.log(`   Género: ${voice.Gender}`);
      console.log(`   Neural: ${voice.SupportedEngines.includes('neural') ? 'SÍ ✅' : 'NO'}`);
      console.log(`   Engine: ${voice.SupportedEngines.join(', ')}`);
      console.log('');
    });
    
    // Recomendaciones
    console.log('═══════════════════════════════════════');
    console.log('📌 RECOMENDACIONES:');
    console.log('');
    console.log('👩 MUJER (default):');
    const mujer = response.Voices.find(v => v.Gender === 'Female' && v.SupportedEngines.includes('neural'));
    console.log(`   VoiceId: "${mujer?.Name || 'Mia'}"`);
    console.log(`   Engine: "neural"`);
    console.log('');
    console.log('👨 HOMBRE (opcional):');
    const hombre = response.Voices.find(v => v.Gender === 'Male' && v.SupportedEngines.includes('neural'));
    console.log(`   VoiceId: "${hombre?.Name || 'Andrés'}"`);
    console.log(`   Engine: "neural"`);
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    
    if (error.message.includes('Could not load credentials')) {
      console.error('');
      console.error('CAUSA: No hay credenciales AWS');
      console.error('SOLUCIÓN: Ejecutar en EC2 con IAM Role');
    }
    
    process.exit(1);
  }
}

listMexicanVoices();
