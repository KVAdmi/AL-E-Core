/**
 * =====================================================
 * OAUTH CALLBACKS - AL-E CORE
 * =====================================================
 * 
 * P0 CRÍTICO: EL INTERCAMBIO code → tokens DEBE vivir en BACKEND
 * 
 * ❌ PROHIBIDO: Hacer intercambio en frontend (client_secret no puede vivir ahí)
 * ✅ CORRECTO: Backend recibe code, intercambia con Google, guarda tokens
 * 
 * FLUJO REAL:
 * 1. Frontend redirige a Google OAuth
 * 2. Google vuelve a: /api/auth/google/callback (CORE)
 * 3. CORE intercambia code → tokens usando client_secret
 * 4. CORE guarda tokens en Supabase (user_integrations)
 * 5. CORE responde OK al frontend
 */

import express from 'express';
import { supabase } from '../db/supabase';
import { env } from '../config/env';
import axios from 'axios';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string; // ⚠️ Puede ser undefined si ya autorizó antes
  expires_in: number;
  scope: string;
  token_type: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name?: string;
  picture?: string;
}

// ═══════════════════════════════════════════════════════════════
// POST /api/auth/google/callback
// ═══════════════════════════════════════════════════════════════

/**
 * P0 CRÍTICO: Intercambio code → tokens
 * 
 * PAYLOAD:
 * {
 *   code: string,             // Authorization code desde Google
 *   userId: string,           // Usuario de AL-EON
 *   integrationType: 'gmail' | 'google_calendar' | 'google_meet'
 * }
 */
router.post('/google/callback', async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('\n[OAUTH] ==================== GOOGLE CALLBACK ====================');
    
    const { code, userId, integrationType } = req.body;
    
    // ============================================
    // 1. VALIDAR PAYLOAD
    // ============================================
    
    if (!code || typeof code !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_CODE',
        message: 'Campo "code" es requerido'
      });
    }
    
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_USER_ID',
        message: 'Campo "userId" es requerido'
      });
    }
    
    const validTypes = ['gmail', 'google_calendar', 'google_meet'];
    if (!integrationType || !validTypes.includes(integrationType)) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_INTEGRATION_TYPE',
        message: `integrationType debe ser uno de: ${validTypes.join(', ')}`
      });
    }
    
    console.log(`[OAUTH] Code received for user: ${userId}, type: ${integrationType}`);
    
    // ============================================
    // 2. VERIFICAR CREDENCIALES DE GOOGLE
    // ============================================
    
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';
    
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      console.error('[OAUTH] ❌ CRITICAL: Google credentials not configured');
      return res.status(500).json({
        ok: false,
        error: 'OAUTH_NOT_CONFIGURED',
        message: 'Google OAuth no está configurado en el servidor'
      });
    }
    
    console.log(`[OAUTH] ✓ Credentials found - Client ID: ${GOOGLE_CLIENT_ID.substring(0, 20)}...`);
    
    // ============================================
    // 3. INTERCAMBIAR CODE → TOKENS (P0 CRÍTICO)
    // ============================================
    
    console.log('[OAUTH] 🔄 Exchanging code for tokens with Google...');
    
    let tokenResponse: GoogleTokenResponse;
    
    try {
      const response = await axios.post<GoogleTokenResponse>(
        'https://oauth2.googleapis.com/token',
        {
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_REDIRECT_URI,
          grant_type: 'authorization_code'
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      
      tokenResponse = response.data;
      console.log(`[OAUTH] ✓ Token exchange successful`);
      console.log(`[OAUTH] - Access token: ${!!tokenResponse.access_token}`);
      console.log(`[OAUTH] - Refresh token: ${!!tokenResponse.refresh_token}`);
      console.log(`[OAUTH] - Expires in: ${tokenResponse.expires_in}s`);
      console.log(`[OAUTH] - Scopes: ${tokenResponse.scope}`);
      
    } catch (error: any) {
      console.error('[OAUTH] ❌ Token exchange failed:', error.response?.data || error.message);
      
      return res.status(400).json({
        ok: false,
        error: 'TOKEN_EXCHANGE_FAILED',
        message: 'No se pudo obtener tokens de Google',
        details: error.response?.data?.error_description || error.message
      });
    }
    
    // ============================================
    // 4. GUARDRAIL: VERIFICAR REFRESH TOKEN (P0)
    // ============================================
    
    if (!tokenResponse.refresh_token) {
      console.error('[OAUTH] ⚠️ CRITICAL: Google did NOT return refresh_token');
      console.error('[OAUTH] Posibles causas:');
      console.error('[OAUTH]   - Usuario ya autorizó antes y no revocó');
      console.error('[OAUTH]   - Falta prompt=consent en URL de autorización');
      console.error('[OAUTH]   - Falta access_type=offline en URL de autorización');
      
      return res.status(400).json({
        ok: false,
        error: 'OAUTH_REFRESH_TOKEN_MISSING',
        message: 'Google no devolvió refresh_token. Debes revocar el acceso previo y reconectar.',
        instructions: [
          '1. Ve a https://myaccount.google.com/permissions',
          '2. Revoca acceso a AL-E/AL-EON',
          '3. Vuelve a conectar tu cuenta',
          '4. Asegúrate de aprobar TODOS los permisos'
        ]
      });
    }
    
    // ============================================
    // 5. OBTENER INFO DEL USUARIO (email)
    // ============================================
    
    console.log('[OAUTH] 📧 Fetching user info from Google...');
    
    let userEmail = 'unknown@gmail.com';
    
    try {
      const userInfoResponse = await axios.get<GoogleUserInfo>(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: {
            Authorization: `Bearer ${tokenResponse.access_token}`
          }
        }
      );
      
      userEmail = userInfoResponse.data.email;
      console.log(`[OAUTH] ✓ User email: ${userEmail}`);
      
    } catch (error) {
      console.warn('[OAUTH] ⚠️ Could not fetch user info, using default');
    }
    
    // ============================================
    // 6. GUARDAR TOKENS EN SUPABASE (P0 CRÍTICO)
    // ============================================
    
    console.log('[OAUTH] 💾 Saving tokens to Supabase...');
    
    const expiresAt = new Date(Date.now() + (tokenResponse.expires_in * 1000)).toISOString();
    
    // Verificar si ya existe una integración para este usuario
    const { data: existingIntegration } = await supabase
      .from('user_integrations')
      .select('id')
      .eq('user_id', userId)
      .eq('integration_type', integrationType)
      .maybeSingle();
    
    if (existingIntegration) {
      // UPDATE: Actualizar tokens existentes
      console.log(`[OAUTH] Updating existing integration: ${existingIntegration.id}`);
      
      const { error: updateError } = await supabase
        .from('user_integrations')
        .update({
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token,
          expires_at: expiresAt,
          scopes: tokenResponse.scope,
          connected_at: new Date().toISOString(),
          email: userEmail,
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('id', existingIntegration.id);
      
      if (updateError) {
        console.error('[OAUTH] ❌ Error updating integration:', updateError);
        throw new Error('Failed to update integration in database');
      }
      
      console.log(`[OAUTH] ✓ Integration updated successfully`);
      
    } else {
      // INSERT: Crear nueva integración
      console.log(`[OAUTH] Creating new integration for user: ${userId}`);
      
      const { error: insertError } = await supabase
        .from('user_integrations')
        .insert({
          user_id: userId,
          integration_type: integrationType,
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token,
          expires_at: expiresAt,
          scopes: tokenResponse.scope,
          connected_at: new Date().toISOString(),
          email: userEmail,
          status: 'active'
        });
      
      if (insertError) {
        console.error('[OAUTH] ❌ Error inserting integration:', insertError);
        throw new Error('Failed to save integration in database');
      }
      
      console.log(`[OAUTH] ✓ Integration created successfully`);
    }
    
    // ============================================
    // 7. RESPONDER AL FRONTEND (P0)
    // ============================================
    
    const elapsed = Date.now() - startTime;
    console.log(`[OAUTH] ✓ OAuth callback completed in ${elapsed}ms`);
    console.log('[OAUTH] ==================== END CALLBACK ====================\n');
    
    // Redirigir al frontend con estado de éxito
    const frontendUrl = process.env.FRONTEND_URL || 'https://al-eon.com';
    const redirectUrl = `${frontendUrl}/integrations/oauth-callback?success=true&type=${integrationType}&email=${encodeURIComponent(userEmail)}`;
    
    console.log(`[OAUTH] 🔄 Redirecting to: ${redirectUrl}`);
    
    return res.redirect(redirectUrl);
    
  } catch (error: any) {
    console.error('[OAUTH] ❌ CRITICAL ERROR:', error);
    
    // Redirigir al frontend con estado de error
    const frontendUrl = process.env.FRONTEND_URL || 'https://al-eon.com';
    const errorUrl = `${frontendUrl}/integrations/oauth-callback?success=false&error=${encodeURIComponent(error.message)}`;
    
    return res.redirect(errorUrl);
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/auth/google/disconnect
// ═══════════════════════════════════════════════════════════════

/**
 * P0: Desconectar integración de Google
 * 
 * PAYLOAD:
 * {
 *   userId: string,
 *   integrationType: 'gmail' | 'google_calendar' | 'google_meet'
 * }
 */
router.post('/google/disconnect', async (req, res) => {
  try {
    console.log('\n[OAUTH] ==================== GOOGLE DISCONNECT ====================');
    
    const { userId, integrationType } = req.body;
    
    if (!userId || !integrationType) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_PARAMS',
        message: 'userId y integrationType son requeridos'
      });
    }
    
    console.log(`[OAUTH] Disconnecting ${integrationType} for user: ${userId}`);
    
    // Marcar como disconnected (no borrar, para auditoría)
    const { error } = await supabase
      .from('user_integrations')
      .update({
        status: 'disconnected',
        disconnected_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('integration_type', integrationType);
    
    if (error) {
      console.error('[OAUTH] ❌ Error disconnecting:', error);
      throw new Error('Failed to disconnect integration');
    }
    
    console.log(`[OAUTH] ✓ Integration disconnected successfully`);
    console.log('[OAUTH] ==================== END DISCONNECT ====================\n');
    
    return res.json({
      ok: true,
      message: 'Integración desconectada exitosamente'
    });
    
  } catch (error: any) {
    console.error('[OAUTH] ❌ ERROR:', error);
    
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/auth/google/status
// ═══════════════════════════════════════════════════════════════

/**
 * Verificar estado de integraciones de Google para un usuario
 * 
 * QUERY:
 * ?userId=xxx
 */
router.get('/google/status', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_USER_ID',
        message: 'userId es requerido'
      });
    }
    
    console.log(`[OAUTH] Checking status for user: ${userId}`);
    
    const { data: integrations, error } = await supabase
      .from('user_integrations')
      .select('integration_type, email, status, connected_at, expires_at, scopes')
      .eq('user_id', userId)
      .eq('status', 'active');
    
    if (error) {
      console.error('[OAUTH] Error fetching status:', error);
      throw new Error('Failed to fetch integration status');
    }
    
    return res.json({
      ok: true,
      integrations: integrations || []
    });
    
  } catch (error: any) {
    console.error('[OAUTH] ERROR:', error);
    
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

export default router;
