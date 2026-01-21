// TEST: Validar Bedrock access desde EC2
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

async function testBedrock() {
  console.log('═══════════════════════════════════════');
  console.log('🧪 TEST: Bedrock Claude 3 Sonnet');
  console.log('═══════════════════════════════════════');
  
  try {
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });
    
    const command = new InvokeModelCommand({
      modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: 'Di solo: Bedrock funciona correctamente'
        }]
      })
    });
    
    console.log('📡 Llamando a Bedrock...');
    const response = await client.send(command);
    const result = JSON.parse(Buffer.from(response.body).toString());
    
    console.log('✅ BEDROCK FUNCIONA');
    console.log('Respuesta:', result.content[0].text);
    
  } catch (error) {
    console.error('❌ BEDROCK FALLO:', error.message);
    
    if (error.message.includes('Could not load credentials')) {
      console.error('');
      console.error('CAUSA: No hay IAM Role en la EC2');
      console.error('SOLUCIÓN: Attach AL-E-Core-EC2-Role a la instancia');
    }
    
    if (error.message.includes('AccessDeniedException')) {
      console.error('');
      console.error('CAUSA: IAM Role sin permisos Bedrock');
      console.error('SOLUCIÓN: Agregar AmazonBedrockFullAccess al role');
    }
    
    process.exit(1);
  }
}

testBedrock();
