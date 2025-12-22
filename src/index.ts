import express from "express";
import cors from "cors";
import { env } from "./config/env";
import chatRouter from "./api/chat"; // NUEVO endpoint con guardado garantizado
import { voiceRouter } from "./api/voice";
import { sessionsRouter } from "./api/sessions";

const app = express();

// CORS configurado usando ALE_ALLOWED_ORIGINS
const allowedOrigins = process.env.ALE_ALLOWED_ORIGINS
  ? process.env.ALE_ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001'];

console.log('[CORS] Orígenes permitidos:', allowedOrigins);

// Configuración CORS exacta como se especificó
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    console.log('[CORS] Verificando origin:', origin);
    
    // Permitir requests sin origin (mobile apps, Postman, etc.)
    if (!origin) {
      console.log('[CORS] Origin sin definir - PERMITIDO');
      return callback(null, true);
    }
    
    // Verificar si el origin está en la lista de permitidos
    if (allowedOrigins.includes(origin)) {
      console.log('[CORS] Origin en lista permitida - PERMITIDO:', origin);
      return callback(null, true);
    }
    
    console.log('[CORS] Origin BLOQUEADO:', origin);
    console.log('[CORS] Lista de permitidos:', allowedOrigins);
    callback(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Configurar CORS globalmente
app.use(cors(corsOptions));

// Middleware específico para manejar preflight OPTIONS en todas las rutas
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    console.log('[OPTIONS] Handling preflight for:', req.path, 'from origin:', origin);
    
    if (!origin || allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin || '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      return res.sendStatus(200);
    }
    return res.sendStatus(403);
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

app.get("/health", (req, res) => {
	res.json({ status: "ok", service: "al-e-core", timestamp: new Date().toISOString() });
});

// app.use("/lia", liaRouter);
app.use("/api/ai", chatRouter); // Nuevo endpoint con guardado garantizado en Supabase
app.use("/api/voice", voiceRouter);
app.use("/api/sessions", sessionsRouter);

// Log simple de verificación
console.log("[DEBUG] chatRouter (v2) montado en /api/ai");
console.log("[DEBUG] voiceRouter montado en /api/voice");
console.log("[DEBUG] sessionsRouter montado en /api/sessions");

const PORT = env.port || 4000;

app.listen(PORT, "0.0.0.0", () => {
	console.log(`[AL-E CORE] Servidor iniciado en puerto ${PORT}`);
	console.log(`[AL-E CORE] Iniciado en http://localhost:${PORT}`);
	console.log("[AL-E CORE] Servidor iniciado en:", "0.0.0.0", "puerto:", PORT);
	console.log("[AL-E CORE] URL base:", process.env.ALE_CORE_URL || "localhost");
	console.log(`AL-E Core listening on port ${PORT}`);
});
