import { Router } from "express";
import type { Request, Response } from "express";
import { openai } from "../services/openaiClient.js";
import { supabase } from "../services/supabaseClient.js";
import { detectLiaIntent } from "./intents.js";
import { buildLiaSystemPrompt } from "./liaPrompt.js";
import type { LiaChatRequest } from "../types.js";

const liaRouter = Router();

liaRouter.post("/chat", async (req: Request, res: Response) => {
	const body = req.body as LiaChatRequest;
	if (!body?.message) {
		return res.status(400).json({ error: "message is required" });
	}

	const userId = body.userId || "luis";
	const intentResult = detectLiaIntent(body.message);

	// Si el intent es "diario", guarda entrada en Supabase (tabla life_notes)
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

	// Llamar a OpenAI
	const systemPrompt = buildLiaSystemPrompt();
	let reply = "No pude generar respuesta.";
	try {
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
		reply = completion.choices[0]?.message?.content ?? reply;
	} catch (e) {
		console.error("Error llamando a OpenAI", e);
	}

	return res.json({
		reply,
		intent: intentResult,
	});
});

export { liaRouter };
