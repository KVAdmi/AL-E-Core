import dotenv from "dotenv";
import path from "path";

// Cargar .env desde la raíz del proyecto (no desde dist/)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function ensure<T>(value: T | undefined, name: string): T {
	if (value === undefined || value === "") {
		throw new Error(`Falta la variable de entorno crítica: ${name}`);
	}
	return value;
}

export const env = {
	port: parseInt(process.env.PORT || "3000", 10),
	openaiApiKey: process.env.OPENAI_API_KEY || "", // OPCIONAL: No usamos OpenAI, usamos Groq/Fireworks/Together
	supabaseUrl: ensure(process.env.SUPABASE_URL, "SUPABASE_URL"),
	supabaseAnonKey: ensure(process.env.SUPABASE_ANON_KEY, "SUPABASE_ANON_KEY"),
	supabaseServiceRoleKey: ensure(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
	assistantId: process.env.ASSISTANT_ID || "al-e",
	defaultWorkspaceId: process.env.DEFAULT_WORKSPACE_ID || "default",
	defaultMode: process.env.DEFAULT_MODE || "universal",
	
	// Feature Flags - Post-migración Google → Manual
	enableGoogle: process.env.ENABLE_GOOGLE === "true", // false por defecto
	enableOcr: process.env.ENABLE_OCR !== "false", // true por defecto
	enableTelegram: process.env.ENABLE_TELEGRAM !== "false", // true por defecto
	enableImap: process.env.ENABLE_IMAP !== "false", // true por defecto
	
	// Encryption
	encryptionKey: process.env.ENCRYPTION_KEY || "", // OBLIGATORIO para credenciales
};
