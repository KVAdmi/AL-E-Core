import OpenAI from "openai";
import { env } from "../config/env.js";
export const openai = new OpenAI({
    apiKey: env.openaiApiKey,
});
//# sourceMappingURL=openaiClient.js.map