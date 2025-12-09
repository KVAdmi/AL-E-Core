"use strict";
/**
 * Detector de intents para datos externos
 * Analiza mensajes del usuario para determinar si necesitan datos en tiempo real
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectExternalDataIntent = detectExternalDataIntent;
/**
 * Detecta si el mensaje del usuario requiere datos externos
 * @param message Mensaje del usuario
 * @returns Intent detectado con metadata
 */
function detectExternalDataIntent(message) {
    const text = message.toLowerCase().trim();
    // Intent: Tipo de cambio USD/MXN
    const exchangePatterns = [
        /tipo\s+de\s+cambio/i,
        /\bd[oó]lar(es)?\b/i,
        /\busd\b/i,
        /usd\s*\/?\s*mxn/i,
        /cotizaci[oó]n.*d[oó]lar/i,
        /cu[aá]nto.*d[oó]lar/i,
        /valor.*d[oó]lar/i,
        /precio.*d[oó]lar/i,
        /cambio.*peso/i
    ];
    if (exchangePatterns.some(pattern => pattern.test(text))) {
        console.log('[INTENT_DETECTOR] Detectado: EXCHANGE_RATE_USD_MXN');
        return { type: 'EXCHANGE_RATE_USD_MXN', query: message };
    }
    // Intent: Clima (preparado para expandir)
    const weatherPatterns = [
        /\bclima\b/i,
        /temperatura/i,
        /\btiempo\b.*\b(hoy|ma[ñn]ana)\b/i,
        /c[oó]mo.*est[aá].*clima/i,
        /pron[oó]stico/i
    ];
    if (weatherPatterns.some(pattern => pattern.test(text))) {
        // Extraer ciudad si es posible
        const cityMatch = text.match(/\b(?:en|de)\s+([A-Za-zÀ-ÿ\s]+?)(?:\s|$|\?|\.)/i);
        const city = cityMatch ? cityMatch[1].trim() : undefined;
        console.log('[INTENT_DETECTOR] Detectado: WEATHER', city ? `(ciudad: ${city})` : '');
        return { type: 'WEATHER', query: message, city };
    }
    // Intent: Noticias (preparado para expandir)
    const newsPatterns = [
        /noticias?\b/i,
        /qu[eé]\s+pas[oó]/i,
        /[uú]ltimas?\s+noticias?/i,
        /\bnovedades?\b/i,
        /actualidad/i
    ];
    if (newsPatterns.some(pattern => pattern.test(text))) {
        // Extraer tema si es posible
        const topicMatch = text.match(/(?:sobre|de|acerca\s+de)\s+([A-Za-zÀ-ÿ\s]+?)(?:\s|$|\?|\.)/i);
        const topic = topicMatch ? topicMatch[1].trim() : undefined;
        console.log('[INTENT_DETECTOR] Detectado: NEWS', topic ? `(tema: ${topic})` : '');
        return { type: 'NEWS', query: message, topic };
    }
    // Intent: Precio de criptomoneda (preparado para expandir)
    const cryptoPatterns = [
        /\bbitcoin\b/i,
        /\bbtc\b/i,
        /\bethereum\b/i,
        /\beth\b/i,
        /precio.*cripto/i,
        /cotizaci[oó]n.*cripto/i,
        /cu[aá]nto.*(?:bitcoin|btc|ethereum|eth)/i
    ];
    if (cryptoPatterns.some(pattern => pattern.test(text))) {
        // Extraer símbolo
        let symbol;
        if (/\bbitcoin\b|\bbtc\b/i.test(text))
            symbol = 'BTC';
        else if (/\bethereum\b|\beth\b/i.test(text))
            symbol = 'ETH';
        console.log('[INTENT_DETECTOR] Detectado: CRYPTO_PRICE', symbol ? `(symbol: ${symbol})` : '');
        return { type: 'CRYPTO_PRICE', query: message, symbol };
    }
    // No se detectó ningún intent de datos externos
    return { type: 'NONE' };
}
