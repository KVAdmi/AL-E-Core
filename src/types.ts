export type LiaModule = "agenda" | "brief" | "diario" | "general";

export interface LiaChatRequest {
	userId: string; // por ahora un string fijo "luis"
	message: string;
}

export interface LiaIntentResult {
	module: LiaModule;
	intent: string;
	entities?: Record<string, any>;
}
