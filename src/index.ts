import express from "express";
import cors from "cors";
import multer from "multer";
import { env } from "./config/env";
import chatRouter from "./api/chat"; // NUEVO endpoint con guardado garantizado
import filesRouter from "./api/files"; // Endpoint de ingesta estructural
import { voiceRouter } from "./api/voice";
import { sessionsRouter } from "./api/sessions";
import memoryRouter from "./api/memory"; // Memoria explícita
import profileRouter from "./api/profile"; // Personalización de usuario
import healthRouter from "./api/health"; // Health checks
import emailRouter from "./api/email"; // Email accounts (SMTP/IMAP manual)
import mailRouter from "./api/mail"; // Mail send/inbox
import systemMailRouter from "./api/systemMail"; // System mail (SES ONLY - correos transaccionales)
import mailWebhookRouter from "./api/mail-webhook"; // AWS SES webhook
import mailInboundRouter from "./api/mail-inbound"; // Mail inbound (SES→S3→Lambda→Core)
import emailHubRouter from "./api/emailHub"; // Email Hub Universal (IMAP/SMTP cualquier proveedor)
import knowledgeRouter from "./api/knowledge"; // Knowledge Core (RAG)
import visionRouter from "./api/vision"; // Google Vision OCR
import calendarRouter from "./api/calendar"; // Calendario interno
import telegramRouter from "./api/telegram"; // Telegram bot por usuario
import runtimeCapabilitiesRouter from "./api/runtime-capabilities"; // Runtime capabilities
import p0Router from "./api/p0"; // P0 internal testing endpoint
import { extractTextFromFiles, documentsToContext } from "./utils/documentText";
import { startNotificationWorker } from "./workers/notificationWorker";
import { startEmailSyncWorker } from "./workers/emailSyncWorker";

const app = express();

// Configurar multer para subida de archivos en memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 15 * 1024 * 1024, // 15MB por archivo
    files: 5 // Máximo 5 archivos
  },
});

// CORS configurado usando ALE_ALLOWED_ORIGINS
const allowedOrigins = process.env.ALE_ALLOWED_ORIGINS
  ? process.env.ALE_ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [
      'https://al-eon.com',
      'http://localhost:3000', 
      'http://localhost:3001'
    ];

const netlifyRegex = /^https:\/\/.+\.netlify\.app$/;

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
    
    // Verificar si es un dominio de Netlify
    if (netlifyRegex.test(origin)) {
      console.log('[CORS] Origin Netlify - PERMITIDO:', origin);
      return callback(null, true);
    }
    
    console.log('[CORS] Origin BLOQUEADO:', origin);
    console.log('[CORS] Lista de permitidos:', allowedOrigins);
    callback(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Configurar CORS globalmente
app.use(cors(corsOptions));

// Middleware específico para manejar preflight OPTIONS en todas las rutas
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    console.log('[OPTIONS] Handling preflight for:', req.path, 'from origin:', origin);
    
    if (!origin || allowedOrigins.includes(origin) || (origin && netlifyRegex.test(origin))) {
      res.header('Access-Control-Allow-Origin', origin || '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, DELETE');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      return res.sendStatus(200);
    }
    return res.sendStatus(403);
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

// Middleware para procesar archivos en /api/ai/chat
app.use('/api/ai/chat', upload.array('files', 5), async (req, res, next) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    
    if (files.length > 0) {
      console.log(`[UPLOAD] ${files.length} archivo(s) recibido(s)`);
      
      // Extraer texto de los archivos
      const docs = await extractTextFromFiles(files);
      
      // Parsear messages si viene como string (multipart/form-data)
      let messages = req.body.messages;
      if (typeof messages === 'string') {
        messages = JSON.parse(messages);
      }
      
      // Inyectar documentos como contexto en el primer mensaje del sistema
      if (docs.length && Array.isArray(messages)) {
        const docsBlock = documentsToContext(docs);
        
        messages = [
          {
            role: "system",
            content:
              "Tienes documentos adjuntos. Analízalos y responde basándote en su contenido.\n" +
              docsBlock,
          },
          ...messages,
        ];
        
        req.body.messages = messages;
        console.log(`[UPLOAD] ${docs.length} documento(s) procesado(s) e inyectados en el contexto`);
      }
    }
    
    // Normalizar campos que pueden venir como string en multipart
    if (req.body.workspaceId) req.body.workspaceId = String(req.body.workspaceId);
    if (req.body.workspace_id) req.body.workspace_id = String(req.body.workspace_id);
    if (req.body.userId) req.body.userId = String(req.body.userId);
    if (req.body.user_id) req.body.user_id = String(req.body.user_id);
    if (req.body.mode) req.body.mode = String(req.body.mode);
    if (req.body.sessionId) req.body.sessionId = String(req.body.sessionId);
    if (req.body.session_id) req.body.session_id = String(req.body.session_id);
    
    next();
  } catch (err) {
    console.error('[UPLOAD] Error procesando archivos:', err);
    res.status(500).json({ 
      error: 'FILE_PROCESSING_ERROR', 
      detail: err instanceof Error ? err.message : String(err) 
    });
  }
});

app.get("/health", async (req, res) => {
	try {
		const status: any = { 
			status: "ok", 
			service: "al-e-core", 
			timestamp: new Date().toISOString(),
			uptime: process.uptime(),
			memory: {
				used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
				total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
			}
		};

		// Test DB opcional (comentado para evitar delay en health checks)
		// try {
		//   await supabase.from('ae_sessions').select('id').limit(1);
		//   status.database = 'connected';
		// } catch (err) {
		//   status.database = 'error';
		// }

		res.json(status);
	} catch (error) {
		res.status(503).json({
			status: 'error',
			service: 'al-e-core',
			timestamp: new Date().toISOString(),
			error: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

// app.use("/lia", liaRouter);
app.use("/_health", healthRouter); // Health checks protegidos
app.use("/api/ai", chatRouter); // Nuevo endpoint con guardado garantizado en Supabase
app.use("/api/files", filesRouter); // Endpoint de ingesta estructural de documentos
app.use("/api/voice", voiceRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/memory", memoryRouter); // Memoria explícita (acuerdos/decisiones/hechos)
app.use("/api/profile", profileRouter); // Personalización de usuario
app.use("/api/system/mail", systemMailRouter); // System mail (SES ONLY - correos transaccionales)
app.use("/api/knowledge", knowledgeRouter); // Knowledge Core (RAG)
app.use("/api/vision", visionRouter); // Google Vision OCR
app.use("/api/email", emailRouter); // Email accounts (SMTP/IMAP manual)
app.use("/api/mail", mailRouter); // Mail send/inbox
app.use("/api/mail", mailWebhookRouter); // AWS SES webhook (same prefix)
app.use("/api/mail", mailInboundRouter); // Mail inbound (SES+S3)
app.use("/api/email", mailRouter); // Mail send/inbox TAMBIÉN en /api/email (para compatibilidad frontend)
app.use("/api/email", emailHubRouter); // Email Hub Universal (IMAP/SMTP cualquier proveedor)
app.use("/api/mail", emailHubRouter); // Email Hub Universal TAMBIÉN en /api/mail (compatibilidad frontend)
app.use("/api/calendar", calendarRouter); // Calendario interno
app.use("/api/telegram", telegramRouter); // Telegram bot por usuario
app.use("/api/runtime-capabilities", runtimeCapabilitiesRouter); // Runtime capabilities
app.use("/api/p0", p0Router); // P0 internal testing (service role only)

// Log simple de verificación
console.log("[DEBUG] healthRouter montado en /_health");
console.log("[DEBUG] chatRouter (v2) montado en /api/ai");
console.log("[DEBUG] filesRouter (ingest) montado en /api/files");
console.log("[DEBUG] voiceRouter montado en /api/voice");
console.log("[DEBUG] sessionsRouter montado en /api/sessions");
console.log("[DEBUG] memoryRouter montado en /api/memory");
console.log("[DEBUG] profileRouter montado en /api/profile");
console.log("[DEBUG] systemMailRouter (SES ONLY) montado en /api/system/mail");
console.log("[DEBUG] knowledgeRouter (RAG) montado en /api/knowledge");
console.log("[DEBUG] visionRouter (Google Vision OCR) montado en /api/vision");
console.log("[DEBUG] emailRouter montado en /api/email");
console.log("[DEBUG] mailRouter montado en /api/mail");
console.log("[DEBUG] emailHubRouter (Universal IMAP/SMTP) montado en /api/email");
console.log("[DEBUG] emailHubRouter (Universal IMAP/SMTP) montado en /api/mail");
console.log("[DEBUG] calendarRouter montado en /api/calendar");
console.log("[DEBUG] runtimeCapabilitiesRouter montado en /api/runtime-capabilities");
console.log("[DEBUG] telegramRouter montado en /api/telegram");

const PORT = env.port || 4000;

app.listen(PORT, "0.0.0.0", () => {
	console.log(`[AL-E CORE] Servidor iniciado en puerto ${PORT}`);
	console.log(`[AL-E CORE] Iniciado en http://localhost:${PORT}`);
	console.log("[AL-E CORE] Servidor iniciado en:", "0.0.0.0", "puerto:", PORT);
	console.log("[AL-E CORE] URL base:", process.env.ALE_CORE_URL || "localhost");
	console.log(`AL-E Core listening on port ${PORT}`);
	
	// Iniciar notification worker
	console.log('[AL-E CORE] Iniciando notification worker...');
	startNotificationWorker();
	
	// Iniciar email sync worker
	console.log('[AL-E CORE] Iniciando email sync worker...');
	startEmailSyncWorker();
});
