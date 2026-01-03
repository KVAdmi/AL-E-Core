/**
 * =====================================================
 * EMAIL ACCOUNTS API - AL-E CORE
 * =====================================================
 * 
 * Gestión de cuentas de email manuales (SMTP/IMAP)
 * Reemplaza Google Gmail API
 * 
 * Endpoints:
 * - POST /api/email/accounts - Crear cuenta
 * - GET /api/email/accounts - Listar cuentas del usuario
 * - PATCH /api/email/accounts/:id - Actualizar cuenta
 * - DELETE /api/email/accounts/:id - Desactivar cuenta
 * - POST /api/email/accounts/:id/test - Probar conexión
 * =====================================================
 */

import express from 'express';
import { supabase } from '../db/supabase';
import { encrypt, decrypt } from '../utils/encryption';
import nodemailer from 'nodemailer';
import Imap from 'imap';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/email/accounts - Crear cuenta de email
// ═══════════════════════════════════════════════════════════════

router.post('/accounts', async (req, res) => {
  try {
    const {
      ownerUserId,
      providerLabel,
      provider, // NUEVO: ses_inbound, ses, gmail, outlook, smtp, imap
      domain, // NUEVO: para AWS SES
      fromName,
      fromEmail,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPass,
      imapHost,
      imapPort,
      imapSecure,
      imapUser,
      imapPass,
      // NUEVO: AWS SES específico
      awsRegion,
      awsAccessKeyId,
      awsSecretAccessKey,
      s3Bucket,
      // NUEVO: Configuración extendida (firma, spam, banderas)
      config
    } = req.body;
    
    // Validaciones según proveedor
    const effectiveProvider = provider || 'smtp';
    
    if (!ownerUserId) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_OWNER_USER_ID',
        message: 'ownerUserId es requerido'
      });
    }
    
    // Validar campos según tipo de proveedor
    if (effectiveProvider === 'ses_inbound' || effectiveProvider === 'ses') {
      if (!domain || !awsRegion || !awsAccessKeyId || !awsSecretAccessKey) {
        return res.status(400).json({
          ok: false,
          error: 'MISSING_AWS_SES_FIELDS',
          message: 'Para AWS SES se requiere: domain, awsRegion, awsAccessKeyId, awsSecretAccessKey'
        });
      }
    } else {
      // SMTP/IMAP tradicional
      if (!fromName || !fromEmail || !smtpHost || !smtpPort || !smtpUser || !smtpPass) {
        return res.status(400).json({
          ok: false,
          error: 'MISSING_SMTP_FIELDS',
          message: 'Para SMTP se requiere: fromName, fromEmail, smtpHost, smtpPort, smtpUser, smtpPass'
        });
      }
    }
    
    console.log(`[EMAIL] Creando cuenta para user: ${ownerUserId}, provider: ${effectiveProvider}`);
    
    // Encriptar passwords
    const smtpPassEnc = smtpPass ? encrypt(smtpPass) : null;
    const imapPassEnc = imapPass ? encrypt(imapPass) : null;
    const awsSecretEnc = awsSecretAccessKey ? encrypt(awsSecretAccessKey) : null;
    
    // Construir objeto de inserción
    const insertData: any = {
      owner_user_id: ownerUserId,
      provider_label: providerLabel || effectiveProvider.toUpperCase(),
      from_name: fromName || null,
      from_email: fromEmail || null,
      is_active: true
    };
    
    // Campos SMTP (si aplica)
    if (smtpHost) {
      insertData.smtp_host = smtpHost;
      insertData.smtp_port = smtpPort;
      insertData.smtp_secure = smtpSecure || false;
      insertData.smtp_user = smtpUser;
      insertData.smtp_pass_enc = smtpPassEnc;
    }
    
    // Campos IMAP (si aplica)
    if (imapHost) {
      insertData.imap_host = imapHost;
      insertData.imap_port = imapPort;
      insertData.imap_secure = imapSecure || true;
      insertData.imap_user = imapUser;
      insertData.imap_pass_enc = imapPassEnc;
    }
    
    // Campos AWS SES (si aplica)
    if (effectiveProvider === 'ses_inbound' || effectiveProvider === 'ses') {
      insertData.domain = domain;
      insertData.aws_region = awsRegion;
      insertData.aws_access_key_id = awsAccessKeyId;
      insertData.aws_secret_access_key_enc = awsSecretEnc;
      insertData.s3_bucket = s3Bucket || null;
    }
    
    // Configuración adicional (firma, spam, banderas)
    if (config) {
      insertData.config = config;
    }
    
    // Campos de migración 018 (provider, status)
    // Agregar solo si la migración fue ejecutada, si no, Supabase los ignorará
    try {
      insertData.provider = effectiveProvider;
      insertData.status = 'active';
    } catch (e) {
      // Si las columnas no existen, continuar sin ellas
      console.log('[EMAIL] Nota: Columnas provider/status no disponibles (migración 018 pendiente)');
    }
    
    // Insertar en DB
    const { data, error } = await supabase
      .from('email_accounts')
      .insert(insertData)
      .select()
      .single();
    
    if (error) {
      console.error('[EMAIL] Error creating account:', error);
      return res.status(500).json({
        ok: false,
        error: 'DB_ERROR',
        message: error.message
      });
    }
    
    console.log(`[EMAIL] ✓ Cuenta creada: ${data.id}`);
    
    // Remover passwords encriptados de la respuesta
    const { smtp_pass_enc, imap_pass_enc, aws_secret_access_key_enc, ...safeData } = data;
    
    return res.json({
      ok: true,
      message: 'Cuenta de email creada exitosamente',
      account: safeData
    });
    
  } catch (error: any) {
    console.error('[EMAIL] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/email/accounts - Listar cuentas del usuario
// ═══════════════════════════════════════════════════════════════

router.get('/accounts', async (req, res) => {
  try {
    const { ownerUserId } = req.query;
    
    if (!ownerUserId || typeof ownerUserId !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_OWNER_USER_ID',
        message: 'ownerUserId es requerido'
      });
    }
    
    const { data, error } = await supabase
      .from('email_accounts')
      .select('id, provider_label, from_name, from_email, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, is_active, created_at, updated_at')
      .eq('owner_user_id', ownerUserId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('[EMAIL] Error fetching accounts:', error);
      return res.status(500).json({
        ok: false,
        error: 'DB_ERROR',
        message: error.message
      });
    }
    
    return res.json({
      ok: true,
      accounts: data || []
    });
    
  } catch (error: any) {
    console.error('[EMAIL] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// PATCH /api/email/accounts/:id - Actualizar cuenta
// ═══════════════════════════════════════════════════════════════

router.patch('/accounts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates: any = {};
    
    // Campos actualizables
    const allowedFields = [
      'provider_label', 'from_name', 'from_email',
      'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user',
      'imap_host', 'imap_port', 'imap_secure', 'imap_user'
    ];
    
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }
    
    // Passwords (encriptar si vienen)
    if (req.body.smtpPass) {
      updates.smtp_pass_enc = encrypt(req.body.smtpPass);
    }
    if (req.body.imapPass) {
      updates.imap_pass_enc = encrypt(req.body.imapPass);
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'NO_UPDATES',
        message: 'No se proporcionaron campos para actualizar'
      });
    }
    
    updates.updated_at = new Date().toISOString();
    
    const { data, error } = await supabase
      .from('email_accounts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('[EMAIL] Error updating account:', error);
      return res.status(500).json({
        ok: false,
        error: 'DB_ERROR',
        message: error.message
      });
    }
    
    if (!data) {
      return res.status(404).json({
        ok: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta no encontrada'
      });
    }
    
    const { smtp_pass_enc, imap_pass_enc, ...safeData } = data;
    
    return res.json({
      ok: true,
      message: 'Cuenta actualizada exitosamente',
      account: safeData
    });
    
  } catch (error: any) {
    console.error('[EMAIL] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/email/accounts/:id - Desactivar cuenta
// ═══════════════════════════════════════════════════════════════

router.delete('/accounts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from('email_accounts')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    
    if (error) {
      console.error('[EMAIL] Error deleting account:', error);
      return res.status(500).json({
        ok: false,
        error: 'DB_ERROR',
        message: error.message
      });
    }
    
    return res.json({
      ok: true,
      message: 'Cuenta desactivada exitosamente'
    });
    
  } catch (error: any) {
    console.error('[EMAIL] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/email/accounts/:id/test - Probar conexión SMTP/IMAP
// ═══════════════════════════════════════════════════════════════

router.post('/accounts/:id/test', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Obtener cuenta con credenciales
    const { data: account, error } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error || !account) {
      return res.status(404).json({
        ok: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta no encontrada'
      });
    }
    
    const results: any = {
      smtp: { ok: false, message: '' },
      imap: { ok: false, message: '' }
    };
    
    // Test SMTP
    try {
      const smtpPass = decrypt(account.smtp_pass_enc);
      
      const transporter = nodemailer.createTransport({
        host: account.smtp_host,
        port: account.smtp_port,
        secure: account.smtp_secure,
        auth: {
          user: account.smtp_user,
          pass: smtpPass
        }
      });
      
      await transporter.verify();
      results.smtp = { ok: true, message: 'Conexión SMTP exitosa' };
      console.log(`[EMAIL] ✓ SMTP test passed for account ${id}`);
      
    } catch (error: any) {
      results.smtp = { ok: false, message: error.message };
      console.error(`[EMAIL] ✗ SMTP test failed for account ${id}:`, error.message);
    }
    
    // Test IMAP (si está configurado)
    if (account.imap_host && account.imap_user && account.imap_pass_enc) {
      try {
        const imapPass = decrypt(account.imap_pass_enc);
        
        const imap = new Imap({
          user: account.imap_user,
          password: imapPass,
          host: account.imap_host,
          port: account.imap_port || 993,
          tls: account.imap_secure !== false,
          tlsOptions: { rejectUnauthorized: false }
        });
        
        await new Promise((resolve, reject) => {
          imap.once('ready', () => {
            imap.end();
            resolve(true);
          });
          imap.once('error', (err: Error) => {
            reject(err);
          });
          imap.connect();
        });
        
        results.imap = { ok: true, message: 'Conexión IMAP exitosa' };
        console.log(`[EMAIL] ✓ IMAP test passed for account ${id}`);
        
      } catch (error: any) {
        results.imap = { ok: false, message: error.message };
        console.error(`[EMAIL] ✗ IMAP test failed for account ${id}:`, error.message);
      }
    } else {
      results.imap = { ok: null, message: 'IMAP no configurado' };
    }
    
    return res.json({
      ok: true,
      message: 'Test de conexión completado',
      results
    });
    
  } catch (error: any) {
    console.error('[EMAIL] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

export default router;
