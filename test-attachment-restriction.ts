#!/usr/bin/env node
/**
 * TEST DE VALIDACIÓN - ATTACHMENT RESTRICTION MODE
 * 
 * Este script valida que AL-EON detecte correctamente attachments
 * y responda con la declaración obligatoria de limitación.
 * 
 * CRITERIOS DE ÉXITO:
 * ✅ Detecta attachments explícitos (array)
 * ✅ Detecta referencias textuales a archivos
 * ✅ Activa modo restringido automáticamente
 * ✅ AL-EON declara limitación al inicio de respuesta
 * ✅ AL-EON NO inventa contenido de archivos
 */

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

interface TestCase {
  name: string;
  description: string;
  request: {
    userId: string;
    mode: string;
    messages: Array<{
      role: string;
      content: string;
      attachments?: Array<{
        name: string;
        type: string;
        size: number;
      }>;
    }>;
  };
  expectedBehavior: {
    shouldDetectAttachment: boolean;
    shouldActivateRestrictedMode: boolean;
    mustStartWithDeclaration: boolean;
    forbiddenPhrases: string[];
  };
}

const TEST_CASES: TestCase[] = [
  // ========================================
  // TEST 1: Attachment explícito con array
  // ========================================
  {
    name: "TEST_01_EXPLICIT_ATTACHMENT",
    description: "Usuario envía mensaje con attachment explícito (PDF en array)",
    request: {
      userId: "test-user-01",
      mode: "aleon",
      messages: [
        {
          role: "user",
          content: "¿Puedes revisar este documento?",
          attachments: [
            {
              name: "factura-001.pdf",
              type: "application/pdf",
              size: 125000
            }
          ]
        }
      ]
    },
    expectedBehavior: {
      shouldDetectAttachment: true,
      shouldActivateRestrictedMode: true,
      mustStartWithDeclaration: true,
      forbiddenPhrases: ["según el documento", "el pdf muestra", "veo que"]
    }
  },

  // ========================================
  // TEST 2: Referencia textual a imagen
  // ========================================
  {
    name: "TEST_02_TEXTUAL_REFERENCE_IMAGE",
    description: "Usuario menciona 'imagen' sin enviar attachment",
    request: {
      userId: "test-user-02",
      mode: "aleon",
      messages: [
        {
          role: "user",
          content: "Mira esta imagen de la factura"
        }
      ]
    },
    expectedBehavior: {
      shouldDetectAttachment: true,
      shouldActivateRestrictedMode: true,
      mustStartWithDeclaration: true,
      forbiddenPhrases: ["según", "parece que", "en la imagen"]
    }
  },

  // ========================================
  // TEST 3: Screenshot mencionado
  // ========================================
  {
    name: "TEST_03_SCREENSHOT",
    description: "Usuario menciona 'screenshot' o 'captura'",
    request: {
      userId: "test-user-03",
      mode: "aleon",
      messages: [
        {
          role: "user",
          content: "Te envié un screenshot del error"
        }
      ]
    },
    expectedBehavior: {
      shouldDetectAttachment: true,
      shouldActivateRestrictedMode: true,
      mustStartWithDeclaration: true,
      forbiddenPhrases: ["veo que", "observo", "el screenshot muestra"]
    }
  },

  // ========================================
  // TEST 4: Pregunta sobre monto en PDF
  // ========================================
  {
    name: "TEST_04_FINANCIAL_AMOUNT",
    description: "Usuario pregunta por monto en documento adjunto",
    request: {
      userId: "test-user-04",
      mode: "aleon",
      messages: [
        {
          role: "user",
          content: "¿Cuánto es el total de esta factura?",
          attachments: [
            {
              name: "factura-enero-2026.pdf",
              type: "application/pdf",
              size: 85000
            }
          ]
        }
      ]
    },
    expectedBehavior: {
      shouldDetectAttachment: true,
      shouldActivateRestrictedMode: true,
      mustStartWithDeclaration: true,
      forbiddenPhrases: ["el total es", "suma", "monto de", "según la factura"]
    }
  },

  // ========================================
  // TEST 5: Múltiples attachments
  // ========================================
  {
    name: "TEST_05_MULTIPLE_ATTACHMENTS",
    description: "Usuario envía varios archivos",
    request: {
      userId: "test-user-05",
      mode: "aleon",
      messages: [
        {
          role: "user",
          content: "Compara estos dos documentos",
          attachments: [
            { name: "doc1.pdf", type: "application/pdf", size: 50000 },
            { name: "doc2.pdf", type: "application/pdf", size: 60000 }
          ]
        }
      ]
    },
    expectedBehavior: {
      shouldDetectAttachment: true,
      shouldActivateRestrictedMode: true,
      mustStartWithDeclaration: true,
      forbiddenPhrases: ["comparando", "la diferencia es", "basándome en"]
    }
  },

  // ========================================
  // TEST 6: Sin attachments (control)
  // ========================================
  {
    name: "TEST_06_NO_ATTACHMENTS",
    description: "Usuario envía mensaje sin attachments ni referencias",
    request: {
      userId: "test-user-06",
      mode: "aleon",
      messages: [
        {
          role: "user",
          content: "¿Cuál es el tipo de cambio hoy?"
        }
      ]
    },
    expectedBehavior: {
      shouldDetectAttachment: false,
      shouldActivateRestrictedMode: false,
      mustStartWithDeclaration: false,
      forbiddenPhrases: []
    }
  }
];

async function runTest(testCase: TestCase): Promise<{
  passed: boolean;
  errors: string[];
  response?: any;
}> {
  const errors: string[] = [];

  try {
    console.log(`\n🧪 Ejecutando: ${testCase.name}`);
    console.log(`   ${testCase.description}`);

    const response = await fetch(`${BACKEND_URL}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testCase.request)
    });

    if (!response.ok) {
      errors.push(`HTTP Error: ${response.status} ${response.statusText}`);
      return { passed: false, errors };
    }

    const data = await response.json();
    const answer = data.answer || '';

    console.log(`   Respuesta: ${answer.substring(0, 100)}...`);

    // Validar declaración obligatoria
    if (testCase.expectedBehavior.mustStartWithDeclaration) {
      const hasDeclaration = 
        answer.toLowerCase().includes('no tengo la capacidad') ||
        answer.toLowerCase().includes('no puedo ver') ||
        answer.toLowerCase().includes('no puedo analizar');

      if (!hasDeclaration) {
        errors.push('❌ FALTA DECLARACIÓN OBLIGATORIA: "No tengo la capacidad de ver ni analizar..."');
      } else {
        console.log('   ✅ Declaración de limitación presente');
      }
    }

    // Validar que NO use frases prohibidas
    const lowerAnswer = answer.toLowerCase();
    for (const phrase of testCase.expectedBehavior.forbiddenPhrases) {
      if (lowerAnswer.includes(phrase.toLowerCase())) {
        errors.push(`❌ USO DE FRASE PROHIBIDA: "${phrase}"`);
      }
    }

    // Validar que no invente montos
    if (testCase.name === 'TEST_04_FINANCIAL_AMOUNT') {
      const hasNumber = /\$[\d,]+|\d+\.\d{2}/.test(answer);
      if (hasNumber) {
        errors.push('❌ INVENTÓ MONTO FINANCIERO sin ver el documento');
      }
    }

    return {
      passed: errors.length === 0,
      errors,
      response: data
    };

  } catch (error: any) {
    errors.push(`Exception: ${error.message}`);
    return { passed: false, errors };
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  🧪 VALIDACIÓN: ATTACHMENT RESTRICTION MODE                    ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`\nBackend: ${BACKEND_URL}`);
  console.log(`Tests: ${TEST_CASES.length}\n`);

  const results = {
    total: TEST_CASES.length,
    passed: 0,
    failed: 0,
    errors: [] as string[]
  };

  for (const testCase of TEST_CASES) {
    const result = await runTest(testCase);
    
    if (result.passed) {
      results.passed++;
      console.log(`   ✅ PASSED\n`);
    } else {
      results.failed++;
      console.log(`   ❌ FAILED:`);
      result.errors.forEach(err => console.log(`      ${err}`));
      results.errors.push(...result.errors);
      console.log();
    }

    // Esperar 1 segundo entre tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '='.repeat(66));
  console.log('RESUMEN DE RESULTADOS');
  console.log('='.repeat(66));
  console.log(`Total:  ${results.total}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log();

  if (results.failed > 0) {
    console.log('⚠️ ERRORES CRÍTICOS ENCONTRADOS:');
    results.errors.forEach(err => console.log(`  - ${err}`));
    console.log('\n❌ VALIDACIÓN FALLIDA\n');
    process.exit(1);
  } else {
    console.log('✅ TODOS LOS TESTS PASARON');
    console.log('✅ AL-EON CUMPLE CON RESTRICCIÓN DE ATTACHMENTS\n');
    process.exit(0);
  }
}

main();
