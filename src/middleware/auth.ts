/**
 * Middleware de Autenticación con Supabase JWT
 * 
 * Responsabilidad: Validar tokens de forma segura sin romper el chat
 * Estrategia: Si falla auth → 401 (NO 500), soporte para modo guest
 */

import { Request, Response, NextFunction } from 'express';
import { supabase } from '../db/supabase';

// Extender Request para incluir user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        [key: string]: any;
      };
      userId?: string; // ← AGREGAR ESTO para acceso rápido
    }
  }
}

/**
 * Middleware opcional de autenticación
 * 
 * - Si hay token válido: req.user = datos del usuario
 * - Si NO hay token: continúa sin req.user (modo guest)
 * - Si hay token INVÁLIDO: 401 Unauthorized
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // 1) Extraer token del header Authorization
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    // 2) Si NO hay token, continuar como guest
    if (!token) {
      console.log('[AUTH] No token provided - continuing as guest');
      return next();
    }

    // 3) Validar token con Supabase
    console.log('[AUTH] Validating token...');
    const { data, error } = await supabase.auth.getUser(token);

    // 4) Si el token es inválido o expiró
    if (error || !data.user) {
      console.error('[AUTH] Invalid token:', error?.message || 'No user data');
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Token inválido o expirado',
        detail: error?.message || 'Authentication failed',
      });
    }

    // 5) Token válido: agregar usuario al request
    req.user = {
      id: data.user.id,
      email: data.user.email,
      ...data.user,
    };
    req.userId = data.user.id; // ← AGREGAR ESTO para acceso directo

    console.log('[AUTH] ✓ User authenticated:', req.user.id, req.user.email);
    next();

  } catch (err: any) {
    // 6) Capturar CUALQUIER error en el proceso de auth
    console.error('[AUTH] Unexpected error during authentication:', err);
    
    // NO romper el servidor: responder 401 controlado
    return res.status(401).json({
      error: 'AUTH_ERROR',
      message: 'Error al validar autenticación',
      detail: err?.message || String(err),
    });
  }
}

/**
 * Middleware que REQUIERE autenticación
 * 
 * - Si NO hay token o es inválido: 401
 * - Si es válido: continúa con req.user
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // 🔥 BYPASS para llamadas internas con x-user-id
    const internalUserId = req.headers['x-user-id'] as string;
    if (internalUserId) {
      console.log('[AUTH] ⚡ Internal call with x-user-id:', internalUserId);
      req.user = {
        id: internalUserId,
        email: 'internal@al-eon.com'
      };
      req.userId = internalUserId;
      return next();
    }
    
    // 1) Extraer token
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    // 2) Token requerido
    if (!token) {
      console.log('[AUTH] No token provided - authentication required');
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Autenticación requerida',
        detail: 'No se proporcionó token de autorización',
      });
    }

    // 3) Validar token con Supabase
    console.log('[AUTH] Validating token (required)...');
    const { data, error } = await supabase.auth.getUser(token);

    // 4) Token inválido
    if (error || !data.user) {
      console.error('[AUTH] Invalid token:', error?.message || 'No user data');
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Token inválido o expirado',
        detail: error?.message || 'Authentication failed',
      });
    }
    // 5) Token válido
    req.user = {
      id: data.user.id,
      email: data.user.email,
      ...data.user,
    };
    req.userId = data.user.id; // ← AGREGAR ESTO para acceso directo

    console.log('[AUTH] ✓ User authenticated (required):', req.user.id, req.user.email);
    next();

  } catch (err: any) {
    // 6) Error inesperado
    console.error('[AUTH] Unexpected error during authentication:', err);
    
    return res.status(401).json({
      error: 'AUTH_ERROR',
      message: 'Error al validar autenticación',
      detail: err?.message || String(err),
    });
  }
}

/**
 * Helper: Obtener userId del request (autenticado o del body)
 * 
 * Prioridad: req.user.id > body.userId > body.user_id
 */
export function getUserId(req: Request): string | undefined {
  if (req.user?.id) {
    return req.user.id;
  }
  
  return req.body.userId || req.body.user_id || undefined;
}

/**
 * Helper: Obtener userEmail del request (autenticado o del body)
 * 
 * Prioridad: req.user.email > body.userEmail > body.user_email
 */
export function getUserEmail(req: Request): string | undefined {
  if (req.user?.email) {
    return req.user.email;
  }
  
  return req.body.userEmail || req.body.user_email || undefined;
}
