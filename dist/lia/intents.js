"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectLiaIntent = detectLiaIntent;
const agendaKeywords = ["agenda", "cita", "reunión", "meeting", "recordatorio"];
const briefKeywords = ["noticias", "resumen del día", "brief", "bolsa", "tipo de cambio"];
const diarioKeywords = ["diario", "anota", "apunta", "registra esto", "hoy me siento"];
function detectLiaIntent(message) {
    const lowerMsg = message.toLowerCase();
    let module = "general";
    let intent = "general";
    if (agendaKeywords.some(k => lowerMsg.includes(k))) {
        module = "agenda";
        intent = "agenda";
    }
    else if (briefKeywords.some(k => lowerMsg.includes(k))) {
        module = "brief";
        intent = "brief";
    }
    else if (diarioKeywords.some(k => lowerMsg.includes(k))) {
        module = "diario";
        intent = "diario";
    }
    return { module, intent };
}
