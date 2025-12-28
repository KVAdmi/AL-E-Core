/**
 * Diagnóstico Completo de Google OAuth
 * 
 * Verifica:
 * - Qué cuenta Gmail está conectada
 * - Qué permisos (scopes) tiene el token
 * - Si puede leer Gmail
 * - Si puede acceder a Calendar
 * - Si puede acceder a People/Contacts
 */

const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

// Cargar env
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function diagnose() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  🔍 DIAGNÓSTICO COMPLETO DE GOOGLE OAUTH                      ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // 1. Buscar integración de Gmail en Supabase
  console.log('📋 PASO 1: Buscando integración de Gmail en Supabase...\n');
  
  const { data: integrations, error } = await supabase
    .from('user_integrations')
    .select('*')
    .eq('integration_type', 'gmail');

  if (error || !integrations || integrations.length === 0) {
    console.log('❌ ERROR: No se encontró integración de Gmail');
    console.log('Posibles causas:');
    console.log('  - No has conectado Gmail desde AL-EON');
    console.log('  - La tabla user_integrations no existe');
    console.log('  - El tipo de integración es diferente\n');
    return;
  }

  console.log(`✅ Encontrada ${integrations.length} integración(es) de Gmail\n`);

  // 2. Para cada integración, diagnosticar
  for (const integration of integrations) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`👤 Usuario: ${integration.user_id}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Verificar tokens
    if (!integration.access_token) {
      console.log('❌ ERROR: access_token es NULL');
      console.log('⚠️  Necesitas reconectar Gmail desde AL-EON\n');
      continue;
    }

    if (!integration.refresh_token) {
      console.log('⚠️  WARNING: refresh_token es NULL (no podrá renovar automáticamente)');
    }

    console.log('✅ Tokens presentes\n');

    // Crear cliente OAuth
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: integration.access_token,
      refresh_token: integration.refresh_token
    });

    // 3. Obtener info del token (scopes, email, etc.)
    console.log('📋 PASO 2: Verificando información del token...\n');

    try {
      const tokenInfo = await oauth2Client.getTokenInfo(integration.access_token);
      
      console.log('📧 Email de la cuenta:', tokenInfo.email);
      console.log('🆔 User ID:', tokenInfo.sub);
      console.log('📅 Expira:', new Date(tokenInfo.expiry_date).toLocaleString('es-MX'));
      console.log('\n🔐 Scopes (permisos) otorgados:');
      
      if (tokenInfo.scopes && Array.isArray(tokenInfo.scopes)) {
        tokenInfo.scopes.forEach(scope => {
          const emoji = getScopeEmoji(scope);
          console.log(`  ${emoji} ${scope}`);
        });
      } else if (typeof tokenInfo.scopes === 'string') {
        tokenInfo.scopes.split(' ').forEach(scope => {
          const emoji = getScopeEmoji(scope);
          console.log(`  ${emoji} ${scope}`);
        });
      }
      console.log('');

      // Verificar scopes críticos
      const scopesStr = Array.isArray(tokenInfo.scopes) 
        ? tokenInfo.scopes.join(' ') 
        : tokenInfo.scopes || '';

      console.log('✅ Análisis de permisos:\n');
      checkScope(scopesStr, 'gmail.readonly', '📬 Leer Gmail');
      checkScope(scopesStr, 'gmail.send', '📤 Enviar Gmail');
      checkScope(scopesStr, 'calendar', '📅 Acceso completo a Calendar');
      checkScope(scopesStr, 'calendar.events', '📆 Eventos de Calendar');
      checkScope(scopesStr, 'contacts', '👥 Acceso a Contacts');
      checkScope(scopesStr, 'userinfo.email', '📧 Email del usuario');
      checkScope(scopesStr, 'userinfo.profile', '👤 Perfil del usuario');
      console.log('');

    } catch (tokenError) {
      console.log('❌ ERROR obteniendo info del token:', tokenError.message);
      console.log('⚠️  El token puede estar expirado o inválido\n');
      continue;
    }

    // 4. Probar Gmail API
    console.log('📋 PASO 3: Probando Gmail API...\n');

    try {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      
      console.log('✅ Gmail API funciona correctamente');
      console.log(`   Email: ${profile.data.emailAddress}`);
      console.log(`   Total mensajes: ${profile.data.messagesTotal}`);
      console.log(`   Total hilos: ${profile.data.threadsTotal}\n`);

      // Intentar leer mensajes
      const messages = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 5,
        q: 'is:unread'
      });

      if (messages.data.messages && messages.data.messages.length > 0) {
        console.log(`✅ Puede leer mensajes (${messages.data.messages.length} no leídos encontrados)\n`);
      } else {
        console.log('ℹ️  No hay mensajes no leídos\n');
      }

    } catch (gmailError) {
      console.log('❌ ERROR con Gmail API:', gmailError.message);
      console.log('⚠️  Verifica que Gmail API esté habilitada en Google Cloud Console\n');
    }

    // 5. Probar Calendar API
    console.log('📋 PASO 4: Probando Calendar API...\n');

    try {
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const calendarList = await calendar.calendarList.list();

      console.log('✅ Calendar API funciona correctamente');
      console.log(`   Calendarios encontrados: ${calendarList.data.items.length}`);
      
      calendarList.data.items.slice(0, 3).forEach(cal => {
        console.log(`   - ${cal.summary}`);
      });
      console.log('');

    } catch (calendarError) {
      console.log('❌ ERROR con Calendar API:', calendarError.message);
      console.log('⚠️  Verifica que Calendar API esté habilitada en Google Cloud Console\n');
    }

    // 6. Probar People API (Contacts)
    console.log('📋 PASO 5: Probando People API (Contacts)...\n');

    try {
      const people = google.people({ version: 'v1', auth: oauth2Client });
      const connections = await people.people.connections.list({
        resourceName: 'people/me',
        pageSize: 10,
        personFields: 'names,emailAddresses'
      });

      if (connections.data.connections && connections.data.connections.length > 0) {
        console.log('✅ People API funciona correctamente');
        console.log(`   Contactos encontrados: ${connections.data.connections.length}`);
        console.log('');
      } else {
        console.log('ℹ️  People API funciona pero no hay contactos\n');
      }

    } catch (peopleError) {
      console.log('❌ ERROR con People API:', peopleError.message);
      console.log('⚠️  Verifica que People API esté habilitada en Google Cloud Console');
      console.log('⚠️  O que el scope "contacts.readonly" esté en OAuth Consent Screen\n');
    }
  }

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  ✅ DIAGNÓSTICO COMPLETADO                                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
}

function getScopeEmoji(scope) {
  if (scope.includes('gmail')) return '📧';
  if (scope.includes('calendar')) return '📅';
  if (scope.includes('contacts')) return '👥';
  if (scope.includes('userinfo')) return '👤';
  return '🔐';
}

function checkScope(scopesStr, scopeName, description) {
  const has = scopesStr.includes(scopeName);
  const emoji = has ? '✅' : '❌';
  console.log(`  ${emoji} ${description}: ${has ? 'SÍ' : 'NO'}`);
}

// Ejecutar
diagnose().catch(err => {
  console.error('\n❌ ERROR FATAL:', err.message);
  console.error(err);
  process.exit(1);
});
