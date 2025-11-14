export type LiaModule = "agenda" | "brief" | "diario" | "general";
export interface LiaChatRequest {
    userId: string;
    message: string;
}
export interface LiaIntentResult {
    module: LiaModule;
    intent: string;
    entities?: Record<string, any>;
}
//# sourceMappingURL=types.d.ts.map