const { VertexAI } = require('@google-cloud/vertexai');

async function testVertex() {
const vertexAI = new VertexAI({
  project: 'al-eon',
  location: 'us-central1'
});

  const model = vertexAI.getGenerativeModel({
    model: 'gemini-1.0-pro',
  });

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [{text: '¡Hola! Di que Gemini vía Vertex AI está funcionando perfecto.'}]
    }],
  });

  console.log('✅ GEMINI (VERTEX AI) RESPONDE:');
  console.log(result.response.candidates[0].content.parts[0].text);
}

testVertex().catch(console.error);
