"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.liaRouter = void 0;
const express_1 = require("express");
const openaiClient_js_1 = require("../services/openaiClient.js");
const supabaseClient_js_1 = require("../services/supabaseClient.js");
const intents_js_1 = require("./intents.js");
const liaPrompt_js_1 = require("./liaPrompt.js");
const liaRouter = (0, express_1.Router)();
exports.liaRouter = liaRouter;
liaRouter.post("/chat", async (req, res) => {
    const body = req.body;
    if (!body?.message) {
        return res.status(400).json({ error: "message is required" });
    }
    const userId = body.userId || "luis";
    const intentResult = (0, intents_js_1.detectLiaIntent)(body.message);
    // Si el intent es "diario", guarda entrada en Supabase (tabla life_notes)
    if (intentResult.module === "diario") {
        try {
            await supabaseClient_js_1.supabase.from("life_notes").insert({
                user_id: userId,
                content: body.message,
                intent: intentResult.intent,
                module: intentResult.module,
            });
        }
        catch (e) {
            console.error("Error inserting life_note", e);
        }
    }
    // Llamar a OpenAI
    const systemPrompt = (0, liaPrompt_js_1.buildLiaSystemPrompt)();
    let reply = "No pude generar respuesta.";
    try {
        const completion = await openaiClient_js_1.openai.chat.completions.create({
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
    }
    catch (e) {
        console.error("Error llamando a OpenAI", e);
    }
    return res.json({
        reply,
        intent: intentResult,
    });
});
