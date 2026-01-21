const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

async function testGemini() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  
  const result = await model.generateContent("Di hola y dime que Gemini ya está conectado y funcionando perfecto.");
  console.log("✅ GEMINI RESPONDE:");
  console.log(result.response.text());
}

testGemini().catch(console.error);
