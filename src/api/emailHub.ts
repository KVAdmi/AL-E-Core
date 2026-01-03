/**
 * =====================================================
 * EMAIL HUB UNIVERSAL - API ROUTES
 * =====================================================
 * 
 * Endpoints para gestionar cuentas de correo IMAP/SMTP
 * de cualquier proveedor (Gmail, Outlook, etc.)
 * 
 * NO depende de SES inbound - MVP funcional
 * =====================================================
 */

import express from 'express';
import { requireAuth } from '../middleware/auth';
import { encryptCredential, validateEncryptionKey } from '../utils/emailEncryption';
import {
  testIMAPConnection,
  listIMAPFolders,
  syncIMAPMessages,
  markIMAPMessageAsRead,
  setIMAPMessageFlag
} from '../services/imapService';
import {
  testSMTPConnection,
  sendEmailViaSMTP,
  isValidEmail,
  sanitizeSubject,
  checkSendRateLimit
} from '../services/smtpService';
import * as accountsRepo from '../repositories/emailAccountsRepo';
import * as messagesRepo from '../repositories/emailMessagesRepo';
import * as foldersRepo from '../repositories/emailFoldersRepo';
import * as syncLogRepo from '../repositories/emailSyncLogRepo';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/email/accounts - Crear y conectar nueva cuenta
// ═══════════════════════════════════════════════════════════════
router.post('/accounts', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const {
      provider_label,
      from_name,
      from_email,
      smtp_host,
      smtp_port,
      smtp_secure,
      smtp_user,
      smtp_pass,
      imap_host,
      imap_port,
      imap_secure,
      imap_user,
      imap_pass
    } = req.body;
    
    // Validaciones
    if (!provider_label || !from_name || !from_email) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'provider_label, from_name, from_email son requeridos'
      });
    }
    
    if (!smtp_host || !smtp_port || !smtp_user || !smtp_pass) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_SMTP_CONFIG',
        message: 'Configuración SMTP incompleta'
      });
    }
    
    // Validar email
    if (!isValidEmail(from_email)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_EMAIL',
        message: 'El email proporcionado no es válido'
      });
    }
    
    // Validar clave de cifrado configurada
    if (!validateEncryptionKey()) {
      return res.status(500).json({
        success: false,
        error: 'ENCRYPTION_KEY_NOT_CONFIGURED',
        message: 'Clave de cifrado no configurada. Contacta al administrador.'
      });
    }
    
    console.log('[EMAIL HUB] 🔐 Cifrando credenciales...');
    
    // Cifrar passwords
    const smtp_pass_enc = encryptCredential(smtp_pass);
    const imap_pass_enc = imap_pass ? encryptCredential(imap_pass) : undefined;
    
    // Test SMTP
    console.log('[EMAIL HUB] 📤 Probando conexión SMTP...');
    const smtpTest = await testSMTPConnection({
      host: smtp_host,
      port: smtp_port,
      secure: smtp_secure || false,
      user: smtp_user,
      pass_enc: smtp_pass_enc
    });
    
    if (!smtpTest.success) {
      return res.status(400).json({
        success: false,
        error: 'SMTP_CONNECTION_FAILED',
        message: `Error al conectar SMTP: ${smtpTest.error}`,
        details: smtpTest
      });
    }
    
    // Test IMAP (si se proporciona)
    let imapTest: { success: boolean; error?: string } = { success: true };
    if (imap_host && imap_port && imap_user && imap_pass) {
      console.log('[EMAIL HUB] 📥 Probando conexión IMAP...');
      imapTest = await testIMAPConnection({
        host: imap_host,
        port: imap_port,
        secure: imap_secure !== false, // Default true
        user: imap_user,
        pass_enc: imap_pass_enc!
      });
      
      if (!imapTest.success) {
        return res.status(400).json({
          success: false,
          error: 'IMAP_CONNECTION_FAILED',
          message: `Error al conectar IMAP: ${imapTest.error}`,
          details: imapTest
        });
      }
    }
    
    // Crear cuenta en DB
    console.log('[EMAIL HUB] 💾 Guardando cuenta en DB...');
    const account = await accountsRepo.createEmailAccount({
      owner_user_id: userId,
      provider_label,
      from_name,
      from_email,
      smtp_host,
      smtp_port,
      smtp_secure: smtp_secure || false,
      smtp_user,
      smtp_pass_enc,
      imap_host: imap_host || undefined,
      imap_port: imap_port || undefined,
      imap_secure: imap_secure !== false,
      imap_user: imap_user || undefined,
      imap_pass_enc
    });
    
    // Si hay IMAP, sincronizar folders
    let folders = [];
    if (imap_host) {
      console.log('[EMAIL HUB] 📁 Sincronizando folders...');
      try {
        const imapFolders = await listIMAPFolders({
          host: imap_host,
          port: imap_port,
          secure: imap_secure !== false,
          user: imap_user,
          pass_enc: imap_pass_enc!
        });
        
        folders = await foldersRepo.syncFoldersFromIMAP(
          account.id,
          userId,
          imapFolders
        );
      } catch (error: any) {
        console.error('[EMAIL HUB] ⚠️ Error al sincronizar folders:', error.message);
      }
    }
    
    console.log('[EMAIL HUB] ✅ Cuenta creada exitosamente');
    
    return res.json({
      success: true,
      account: {
        ...account,
        smtp_pass_enc: undefined, // No enviar passwords al frontend
        imap_pass_enc: undefined
      },
      folders,
      smtp_test: smtpTest,
      imap_test: imapTest
    });
  } catch (error: any) {
    console.error('[EMAIL HUB] ❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/email/accounts/:id/test - Probar conexión
// ═══════════════════════════════════════════════════════════════
router.post('/accounts/:id/test', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { id } = req.params;
    const { test_type } = req.body; // 'smtp' | 'imap' | 'both'
    
    const account = await accountsRepo.getEmailAccountById(id, userId);
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta no encontrada'
      });
    }
    
    const results: any = {};
    
    // Test SMTP
    if (test_type === 'smtp' || test_type === 'both' || !test_type) {
      results.smtp = await testSMTPConnection({
        host: account.smtp_host,
        port: account.smtp_port,
        secure: account.smtp_secure,
        user: account.smtp_user,
        pass_enc: account.smtp_pass_enc
      });
    }
    
    // Test IMAP
    if ((test_type === 'imap' || test_type === 'both' || !test_type) && account.imap_host) {
      results.imap = await testIMAPConnection({
        host: account.imap_host,
        port: account.imap_port!,
        secure: account.imap_secure,
        user: account.imap_user!,
        pass_enc: account.imap_pass_enc!
      });
    }
    
    return res.json({
      success: true,
      results
    });
  } catch (error: any) {
    console.error('[EMAIL HUB] ❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/email/accounts/:id/sync - Forzar sincronización
// ═══════════════════════════════════════════════════════════════
router.post('/accounts/:id/sync', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { id } = req.params;
    const { folder_path } = req.body; // Opcional, default INBOX
    
    const account = await accountsRepo.getEmailAccountById(id, userId);
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta no encontrada'
      });
    }
    
    if (!account.imap_host) {
      return res.status(400).json({
        success: false,
        error: 'IMAP_NOT_CONFIGURED',
        message: 'Esta cuenta no tiene IMAP configurado'
      });
    }
    
    // Crear sync log
    const logId = await syncLogRepo.createSyncLog({
      account_id: account.id,
      sync_type: 'manual'
    });
    
    console.log('[EMAIL HUB] 🔄 Iniciando sync manual...');
    
    try {
      const folderPath = folder_path || 'INBOX';
      
      // Obtener folder
      const folder = await foldersRepo.getEmailFolderByPath(account.id, folderPath);
      if (!folder) {
        throw new Error(`Folder ${folderPath} no encontrado. Ejecuta sync de folders primero.`);
      }
      
      // Obtener último UID sincronizado
      const lastUid = await messagesRepo.getLastSyncedUid(account.id, folder.id);
      
      console.log('[EMAIL HUB] 📬 Último UID:', lastUid);
      
      // Sincronizar mensajes
      const imapMessages = await syncIMAPMessages(
        {
          host: account.imap_host,
          port: account.imap_port!,
          secure: account.imap_secure,
          user: account.imap_user!,
          pass_enc: account.imap_pass_enc!
        },
        folderPath,
        lastUid,
        100 // Límite
      );
      
      console.log('[EMAIL HUB] 📨 Mensajes obtenidos:', imapMessages.length);
      
      // Guardar en DB
      let newCount = 0;
      for (const msg of imapMessages) {
        const created = await messagesRepo.createEmailMessage({
          account_id: account.id,
          owner_user_id: userId,
          folder_id: folder.id,
          message_uid: msg.uid.toString(),
          message_id: msg.messageId,
          from_address: msg.from.email,
          from_name: msg.from.name,
          to_addresses: msg.to.map(t => t.email),
          cc_addresses: msg.cc?.map(c => c.email),
          subject: msg.subject,
          body_text: msg.bodyText,
          body_html: msg.bodyHtml,
          body_preview: msg.bodyPreview,
          has_attachments: msg.hasAttachments,
          attachment_count: msg.attachments.length,
          date: msg.date,
          in_reply_to: msg.inReplyTo,
          size_bytes: msg.size
        });
        
        if (created) newCount++;
      }
      
      // Completar sync log
      await syncLogRepo.completeSyncLog(logId, {
        status: 'success',
        messages_fetched: imapMessages.length,
        messages_new: newCount,
        messages_updated: 0
      });
      
      console.log('[EMAIL HUB] ✅ Sync completado:', newCount, 'mensajes nuevos');
      
      return res.json({
        success: true,
        sync: {
          folder: folderPath,
          messages_fetched: imapMessages.length,
          messages_new: newCount,
          last_uid: lastUid
        }
      });
    } catch (error: any) {
      // Error en sync
      await syncLogRepo.completeSyncLog(logId, {
        status: 'failed',
        messages_fetched: 0,
        messages_new: 0,
        messages_updated: 0,
        errors: error.message
      });
      
      throw error;
    }
  } catch (error: any) {
    console.error('[EMAIL HUB] ❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'SYNC_FAILED',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/email/accounts/:id/inbox - Listar mensajes
// ═══════════════════════════════════════════════════════════════
router.get('/accounts/:id/inbox', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { id } = req.params;
    const { 
      folder_id, 
      limit = '50', 
      offset = '0',
      unread_only = 'false',
      starred_only = 'false'
    } = req.query;
    
    const account = await accountsRepo.getEmailAccountById(id, userId);
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta no encontrada'
      });
    }
    
    const result = await messagesRepo.listEmailMessages(account.id, userId, {
      folderId: folder_id as string | undefined,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      onlyUnread: unread_only === 'true',
      isStarred: starred_only === 'true'
    });
    
    return res.json({
      success: true,
      messages: result.messages,
      total: result.total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    });
  } catch (error: any) {
    console.error('[EMAIL HUB] ❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/email/messages/:msgId - Detalle de mensaje
// ═══════════════════════════════════════════════════════════════
router.get('/messages/:msgId', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { msgId } = req.params;
    
    const message = await messagesRepo.getEmailMessageById(msgId, userId);
    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'MESSAGE_NOT_FOUND',
        message: 'Mensaje no encontrado'
      });
    }
    
    return res.json({
      success: true,
      message
    });
  } catch (error: any) {
    console.error('[EMAIL HUB] ❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/email/send - Enviar correo
// ═══════════════════════════════════════════════════════════════
router.post('/send', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const {
      account_id,
      to, // Array de emails o string
      cc,
      bcc,
      subject,
      body_text,
      body_html,
      reply_to,
      in_reply_to
    } = req.body;
    
    // Validaciones
    if (!account_id) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_ACCOUNT_ID',
        message: 'account_id es requerido'
      });
    }
    
    if (!to || (Array.isArray(to) && to.length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_RECIPIENT',
        message: 'Debe especificar al menos un destinatario'
      });
    }
    
    if (!subject) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_SUBJECT',
        message: 'El asunto es requerido'
      });
    }
    
    if (!body_text && !body_html) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_BODY',
        message: 'Debe incluir body_text o body_html'
      });
    }
    
    // Obtener cuenta
    const account = await accountsRepo.getEmailAccountById(account_id, userId);
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta no encontrada'
      });
    }
    
    // Rate limit
    if (!checkSendRateLimit(account.id, 10)) {
      return res.status(429).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Máximo 10 correos por minuto'
      });
    }
    
    // Normalizar destinatarios
    const toArray = Array.isArray(to) ? to : [to];
    const ccArray = cc ? (Array.isArray(cc) ? cc : [cc]) : undefined;
    const bccArray = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined;
    
    // Enviar
    const result = await sendEmailViaSMTP(
      {
        host: account.smtp_host,
        port: account.smtp_port,
        secure: account.smtp_secure,
        user: account.smtp_user,
        pass_enc: account.smtp_pass_enc
      },
      {
        from: {
          email: account.from_email,
          name: account.from_name
        },
        to: toArray.map((email: string) => ({ email })),
        cc: ccArray?.map((email: string) => ({ email })),
        bcc: bccArray?.map((email: string) => ({ email })),
        subject: sanitizeSubject(subject),
        bodyText: body_text,
        bodyHtml: body_html,
        replyTo: reply_to,
        inReplyTo: in_reply_to
      }
    );
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error,
        message: 'Error al enviar correo'
      });
    }
    
    console.log('[EMAIL HUB] ✅ Correo enviado:', result.messageId);
    
    return res.json({
      success: true,
      message_id: result.messageId
    });
  } catch (error: any) {
    console.error('[EMAIL HUB] ❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/email/messages/:msgId/actions - Acciones sobre mensaje
// ═══════════════════════════════════════════════════════════════
router.post('/messages/:msgId/actions', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { msgId } = req.params;
    const { action } = req.body; // mark_read, mark_unread, star, unstar, archive
    
    const message = await messagesRepo.getEmailMessageById(msgId, userId);
    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'MESSAGE_NOT_FOUND',
        message: 'Mensaje no encontrado'
      });
    }
    
    switch (action) {
      case 'mark_read':
        await messagesRepo.markMessageAsRead(msgId, userId, true);
        break;
      case 'mark_unread':
        await messagesRepo.markMessageAsRead(msgId, userId, false);
        break;
      case 'star':
        await messagesRepo.markMessageAsStarred(msgId, userId, true);
        break;
      case 'unstar':
        await messagesRepo.markMessageAsStarred(msgId, userId, false);
        break;
      case 'archive':
        // TODO: Mover a folder archive
        return res.status(501).json({
          success: false,
          error: 'NOT_IMPLEMENTED',
          message: 'Archivar no implementado aún'
        });
      default:
        return res.status(400).json({
          success: false,
          error: 'INVALID_ACTION',
          message: 'Acción no válida'
        });
    }
    
    return res.json({
      success: true,
      message: `Acción ${action} ejecutada`
    });
  } catch (error: any) {
    console.error('[EMAIL HUB] ❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/email/accounts - Listar cuentas del usuario
// ═══════════════════════════════════════════════════════════════
router.get('/accounts', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    
    const accounts = await accountsRepo.listEmailAccounts(userId);
    
    // No enviar passwords cifrados al frontend
    const sanitized = accounts.map(acc => ({
      ...acc,
      smtp_pass_enc: undefined,
      imap_pass_enc: undefined
    }));
    
    return res.json({
      success: true,
      accounts: sanitized
    });
  } catch (error: any) {
    console.error('[EMAIL HUB] ❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/email/accounts/:id/folders - Listar folders
// ═══════════════════════════════════════════════════════════════
router.get('/accounts/:id/folders', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { id } = req.params;
    
    const account = await accountsRepo.getEmailAccountById(id, userId);
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta no encontrada'
      });
    }
    
    const folders = await foldersRepo.listEmailFolders(id, userId);
    
    return res.json({
      success: true,
      folders
    });
  } catch (error: any) {
    console.error('[EMAIL HUB] ❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

export default router;
