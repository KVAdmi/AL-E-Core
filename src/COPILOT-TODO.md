PROMPT PARA COPILOT — AL-E Core + LiA v1 (Agenda, Brief, Diario)

Estás dentro de un proyecto Node + TypeScript llamado AL-E-Core.
Objetivo: crear un pequeño backend HTTP con Express que exponga el primer cerebro de LiA (asistente ejecutivo de un solo usuario “Luis”) usando OpenAI y Supabase.

1. Stack y supuestos

Node 20, TypeScript.

Ya corrí: npm init -y, npm install typescript ts-node nodemon express cors dotenv @supabase/supabase-js openai y npx tsc --init.

El servidor correrá como servicio en Linux (EC2) con PM2.

Variables de entorno (vendrán de un .env):

PORT (por defecto 3000)

OPENAI_API_KEY

SUPABASE_URL

SUPABASE_ANON_KEY

Crea la estructura mínima siguiente en /src:

src/
  index.ts
  config/env.ts
  services/openaiClient.ts
  services/supabaseClient.ts
  lia/liaRouter.ts
  lia/liaPrompt.ts
  lia/intents.ts
  types.ts

2. config/env.ts

Crea un helper para leer variables de entorno:

Cargar dotenv.config() al inicio.

Exportar un objeto env con:

export const env = {
  port: parseInt(process.env.PORT || "3000", 10),
  openaiApiKey: process.env.OPENAI_API_KEY!,
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
};


Si falta alguna variable crítica (openaiApiKey, supabaseUrl, supabaseAnonKey), lanza un error claro al arrancar.

3. services/openaiClient.ts

Importa OpenAI desde el SDK oficial.

Crea y exporta una instancia:

import OpenAI from "openai";
import { env } from "../config/env";

export const openai = new OpenAI({
  apiKey: env.openaiApiKey,
});

4. services/supabaseClient.ts

Usa @supabase/supabase-js:

import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey);


Más adelante se usarán tablas como life_notes para el diario; por ahora solo deja el cliente listo.

5. Tipos base en types.ts

Define interfaces simples para LiA:

export type LiaModule = "agenda" | "brief" | "diario" | "general";

export interface LiaChatRequest {
  userId: string;         // por ahora un string fijo "luis"
  message: string;
}

export interface LiaIntentResult {
  module: LiaModule;
  intent: string;
  entities?: Record<string, any>;
}

6. Router de LiA: lia/intents.ts

Crea una función sencilla de detección de intención rule-based (no ML todavía), que lea el texto del usuario y regrese un LiaIntentResult:

Si el mensaje contiene palabras tipo:

"agenda", "cita", "reunión", "meeting", "recordatorio" → módulo "agenda".

"noticias", "resumen del día", "brief", "bolsa", "tipo de cambio" → módulo "brief".

"diario", "anota", "apunta", "registra esto", "hoy me siento" → módulo "diario".

Si no matchea nada, módulo "general".

Exporta algo como:

export function detectLiaIntent(message: string): LiaIntentResult { ... }

7. System prompt de LiA: lia/liaPrompt.ts

Crea una función que arme el system prompt para OpenAI:

export function buildLiaSystemPrompt() {
  return `
Eres LiA, asistente ejecutivo y confidente personal de un solo usuario llamado Luis.
Rol:
- Organizar su agenda, recordatorios y pendientes.
- Darle un brief diario corto de noticias, mercados y contexto global.
- Registrar sus ideas, reflexiones y emociones en un diario estructurado.

Tono:
- Cercano pero profesional.
- Frases claras, máximo 3–4 párrafos.
- Puedes usar humor ligero, pero nunca pierdes el foco ejecutivo.

Reglas:
- Si la intención es de agenda, haz preguntas específicas de fecha, hora y contexto.
- Si es brief, entrega un resumen compacto y estructurado (titulares + impacto) aunque de momento uses texto genérico (sin consumir APIs reales de noticias).
- Si es diario, ayuda a que exprese emociones y genera un pequeño título y categoría para la nota (Negocios, Personal, Estrategia, Familia, Salud Mental, etc.).

Siempre responde en español neutro, orientado a México y negocios.
  `.trim();
}

8. lia/liaRouter.ts

Implementa un router de Express:

Importa Router, el openai, supabase, detectLiaIntent y buildLiaSystemPrompt.

Crea const liaRouter = Router();.

Endpoint principal:

liaRouter.post("/chat", async (req, res) => {
  const body = req.body as LiaChatRequest;
  if (!body?.message) {
    return res.status(400).json({ error: "message is required" });
  }

  const userId = body.userId || "luis";
  const intentResult = detectLiaIntent(body.message);

  // 1) Si el intent es "diario", guarda entrada en Supabase (tabla life_notes)
  //    Estructura sugerida: { user_id, content, intent, module, created_at }
  //    Maneja errores sin tirar el servidor: log y sigue.
  if (intentResult.module === "diario") {
    try {
      await supabase.from("life_notes").insert({
        user_id: userId,
        content: body.message,
        intent: intentResult.intent,
        module: intentResult.module,
      });
    } catch (e) {
      console.error("Error inserting life_note", e);
    }
  }

  // 2) Llamar a OpenAI (chat.completions o responses según SDK v4)
  //    Usa un solo mensaje de usuario y el system prompt de LiA.
});


Dentro del handler, arma la llamada a OpenAI algo así (Copilot debe completar):

const systemPrompt = buildLiaSystemPrompt();

const completion = await openai.chat.completions.create({
  model: "gpt-4.1-mini",
  messages: [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Intent detectado: ${intentResult.module} / ${intentResult.intent}. Mensaje original: ${body.message}`,
    },
  ],
  temperature: 0.7,
});

const reply = completion.choices[0]?.message?.content ?? "No pude generar respuesta.";


Respuesta final del endpoint:

return res.json({
  reply,
  intent: intentResult,
});


Exporta liaRouter como export { liaRouter };.

9. src/index.ts — bootstrap del servidor

Implementa el entrypoint:

Importa express, cors, env, y liaRouter.

Crea app:

const app = express();
app.use(cors());
app.use(express.json());


Endpoints:

GET /health → { status: "ok", service: "al-e-core", timestamp: new Date().toISOString() }

Monta LiA:

app.use("/lia", liaRouter);


Arranque:

app.listen(env.port, () => {
  console.log(`AL-E Core listening on port ${env.port}`);
});

10. Scripts en package.json

Asegúrate de agregar (si no existen):

"scripts": {
  "dev": "nodemon src/index.ts",
  "build": "tsc",
  "start": "node dist/index.js"
}

11. Requisitos de calidad

Todo debe compilar con TypeScript sin errores.

Usa async/await con try/catch y logs claros.

No uses ningún framework extra (ni Nest, ni Fastify), solo Express.

El código debe ser simple, legible y fácil de portar a producción con PM2.

Fin del prompt. Implementa TODO esto en los archivos indicados.