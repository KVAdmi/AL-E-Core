"use strict";
/**
 * Módulo de integración con servicios externos
 * Proporciona datos en tiempo real desde APIs públicas
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExchangeRateUSDToMXN = getExchangeRateUSDToMXN;
exports.getWeatherByCity = getWeatherByCity;
exports.getGenericSearch = getGenericSearch;
exports.getNewsByTopic = getNewsByTopic;
exports.getCryptoPrice = getCryptoPrice;
/**
 * Obtiene el tipo de cambio USD a MXN desde exchangerate.host
 * @returns Tipo de cambio o null si falla
 */
async function getExchangeRateUSDToMXN() {
    try {
        const response = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=MXN');
        if (!response.ok) {
            console.error('[EXTERNAL_DATA] Error en API de tipo de cambio:', response.status, response.statusText);
            return null;
        }
        const data = await response.json();
        if (data.success && data.rates && data.rates.MXN) {
            const rate = parseFloat(data.rates.MXN);
            console.log('[EXTERNAL_DATA] Tipo de cambio USD/MXN obtenido:', rate);
            return rate;
        }
        console.error('[EXTERNAL_DATA] Respuesta de API no tiene el formato esperado:', data);
        return null;
    }
    catch (error) {
        console.error('[EXTERNAL_DATA] Error obteniendo tipo de cambio:', error);
        return null;
    }
}
/**
 * Obtiene el clima de una ciudad (preparado para implementar)
 * @param city Nombre de la ciudad
 * @returns Datos del clima o null si falla
 */
async function getWeatherByCity(city) {
    // TODO: Implementar integración con API de clima (ej: OpenWeatherMap, WeatherAPI)
    console.log('[EXTERNAL_DATA] getWeatherByCity no implementado aún:', city);
    return null;
}
/**
 * Realiza una búsqueda genérica en la web (preparado para implementar)
 * @param query Consulta de búsqueda
 * @returns Resultados o null si falla
 */
async function getGenericSearch(query) {
    // TODO: Implementar búsqueda web (ej: SerpAPI, Google Custom Search)
    console.log('[EXTERNAL_DATA] getGenericSearch no implementado aún:', query);
    return null;
}
/**
 * Obtiene noticias recientes sobre un tema (preparado para implementar)
 * @param topic Tema de las noticias
 * @returns Noticias o null si falla
 */
async function getNewsByTopic(topic) {
    // TODO: Implementar integración con API de noticias (ej: NewsAPI)
    console.log('[EXTERNAL_DATA] getNewsByTopic no implementado aún:', topic);
    return null;
}
/**
 * Obtiene precio de criptomoneda (preparado para implementar)
 * @param symbol Símbolo de la cripto (BTC, ETH, etc)
 * @returns Precio o null si falla
 */
async function getCryptoPrice(symbol) {
    // TODO: Implementar integración con API de cripto (ej: CoinGecko, CoinMarketCap)
    console.log('[EXTERNAL_DATA] getCryptoPrice no implementado aún:', symbol);
    return null;
}
