/**
 * Multi-App Authentication Middleware
 * Valida service-to-service authentication para apps como KUNNA
 */

import { Request, Response, NextFunction } from 'express';

// Service tokens por app/workspace (en producción usar env vars o DB)
const SERVICE_TOKENS = new Map<string, Set<string>>([
  ['kunna', new Set([
    process.env.SERVICE_TOKEN_KUNNA || 'kunna-dev-token-12345',
  ])],
  ['aleon', new Set([
    process.env.SERVICE_TOKEN_ALEON || 'aleon-dev-token-67890',
  ])],
]);

export interface MultiAppRequest extends Request {
  appId?: string;
  workspaceId?: string;
  serviceAuth?: boolean;
}

/**
 * Middleware para validar multi-app service auth
 */
export function validateMultiAppAuth(req: MultiAppRequest, res: Response, next: NextFunction) {
  try {
    // 1. Validar headers requeridos
    const appId = req.headers['x-app-id'] as string;
    const workspaceId = req.headers['x-workspace-id'] as string;
    const authHeader = req.headers.authorization;

    if (!appId) {
      return res.status(400).json({ 
        error: 'Missing required header: X-App-Id',
        code: 'MISSING_APP_ID' 
      });
    }

    if (!workspaceId) {
      return res.status(400).json({ 
        error: 'Missing required header: X-Workspace-Id',
        code: 'MISSING_WORKSPACE_ID' 
      });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Missing or invalid Authorization header',
        code: 'INVALID_AUTH_HEADER' 
      });
    }

    // 2. Extraer token
    const token = authHeader.replace('Bearer ', '');

    // 3. Validar que el token es válido para esta app
    const validTokens = SERVICE_TOKENS.get(appId.toLowerCase());
    
    if (!validTokens) {
      return res.status(403).json({ 
        error: `Unknown app_id: ${appId}`,
        code: 'UNKNOWN_APP' 
      });
    }

    if (!validTokens.has(token)) {
      return res.status(401).json({ 
        error: 'Invalid service token for this app',
        code: 'INVALID_TOKEN' 
      });
    }

    // 4. Attach validated data to request
    req.appId = appId.toLowerCase();
    req.workspaceId = workspaceId;
    req.serviceAuth = true;

    console.log(`[MULTI-APP AUTH] ✓ Validated: app=${appId}, workspace=${workspaceId}`);

    next();
  } catch (error: any) {
    console.error('[MULTI-APP AUTH] Error:', error);
    return res.status(500).json({ 
      error: 'Internal authentication error',
      code: 'AUTH_ERROR' 
    });
  }
}

/**
 * Helper para agregar nuevo app/token (admin only)
 */
export function registerAppToken(appId: string, token: string) {
  const normalizedAppId = appId.toLowerCase();
  
  if (!SERVICE_TOKENS.has(normalizedAppId)) {
    SERVICE_TOKENS.set(normalizedAppId, new Set());
  }
  
  SERVICE_TOKENS.get(normalizedAppId)!.add(token);
  
  console.log(`[MULTI-APP AUTH] Registered token for app: ${normalizedAppId}`);
}
