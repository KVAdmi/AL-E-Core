/**
 * =====================================================
 * CONTACTS API - Gestión de contactos de email
 * =====================================================
 * 
 * Endpoints:
 * - GET /api/contacts: Listar contactos del usuario
 * - POST /api/contacts: Crear nuevo contacto
 * - POST /api/contacts/import-vcard: Importar vCard (base64)
 * - PUT /api/contacts/:id: Actualizar contacto
 * - DELETE /api/contacts/:id: Eliminar contacto
 * 
 * IMPORTANTE:
 * - Usa tabla email_contacts
 * - Registra email_count y last_interaction
 * - Soporta vCard import
 * =====================================================
 */

import express from 'express';
import { supabase } from '../db/supabase';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// GET /api/contacts
// ═══════════════════════════════════════════════════════════════

router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { search, limit = 100 } = req.query;

    console.log('[CONTACTS] Listando contactos - User:', userId);

    let query = supabase
      .from('email_contacts')
      .select('*')
      .eq('owner_user_id', userId)
      .order('last_interaction', { ascending: false })
      .limit(parseInt(limit as string));

    // Filtro de búsqueda opcional
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data: contacts, error } = await query;

    if (error) {
      console.error('[CONTACTS] Error obteniendo contactos:', error);
      return res.status(500).json({
        success: false,
        error: 'DB_ERROR',
        message: 'Error obteniendo contactos'
      });
    }

    console.log('[CONTACTS] Contactos obtenidos:', contacts?.length || 0);

    return res.json({
      success: true,
      contacts: contacts?.map(c => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        company: c.company,
        notes: c.notes,
        emailCount: c.email_count || 0,
        lastInteraction: c.last_interaction,
        createdAt: c.created_at
      })) || []
    });

  } catch (error: any) {
    console.error('[CONTACTS] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/contacts
// ═══════════════════════════════════════════════════════════════

router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { name, email, phone, company, notes } = req.body;

    console.log('[CONTACTS] Creando contacto:', email);

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELDS',
        message: 'name y email son requeridos'
      });
    }

    // Validar que no exista ya
    const { data: existing } = await supabase
      .from('email_contacts')
      .select('id')
      .eq('owner_user_id', userId)
      .eq('email', email)
      .single();

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'DUPLICATE',
        message: `Ya existe un contacto con el email ${email}`
      });
    }

    // Crear contacto
    const { data: contact, error } = await supabase
      .from('email_contacts')
      .insert({
        owner_user_id: userId,
        name: name,
        email: email,
        phone: phone,
        company: company,
        notes: notes,
        email_count: 0,
        last_interaction: new Date().toISOString()
      })
      .select('*')
      .single();

    if (error) {
      console.error('[CONTACTS] Error creando contacto:', error);
      return res.status(500).json({
        success: false,
        error: 'DB_ERROR',
        message: 'Error creando contacto'
      });
    }

    console.log('[CONTACTS] Contacto creado:', contact.id);

    return res.json({
      success: true,
      contact: {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        company: contact.company,
        notes: contact.notes,
        emailCount: contact.email_count,
        lastInteraction: contact.last_interaction
      }
    });

  } catch (error: any) {
    console.error('[CONTACTS] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/contacts/import-vcard
// ═══════════════════════════════════════════════════════════════

router.post('/import-vcard', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { vcardData } = req.body; // Base64 o texto plano

    console.log('[CONTACTS] Importando vCard');

    if (!vcardData) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_VCARD',
        message: 'vcardData es requerido'
      });
    }

    // Decodificar si viene en base64
    let vcard = vcardData;
    if (vcardData.match(/^[A-Za-z0-9+/=]+$/)) {
      try {
        vcard = Buffer.from(vcardData, 'base64').toString('utf-8');
      } catch (e) {
        // Si falla el decode, asumir que ya es texto plano
      }
    }

    // Parsear vCard simple (formato básico)
    const contacts: any[] = [];
    const vcardEntries = vcard.split('BEGIN:VCARD');

    for (const entry of vcardEntries) {
      if (!entry.trim()) continue;

      const lines = entry.split('\n');
      const contact: any = {};

      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();

        if (key.startsWith('FN')) {
          contact.name = value;
        } else if (key.startsWith('EMAIL')) {
          contact.email = value;
        } else if (key.startsWith('TEL')) {
          contact.phone = value;
        } else if (key.startsWith('ORG')) {
          contact.company = value;
        } else if (key.startsWith('NOTE')) {
          contact.notes = value;
        }
      }

      if (contact.email && contact.name) {
        contacts.push(contact);
      }
    }

    if (contacts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'NO_CONTACTS_FOUND',
        message: 'No se encontraron contactos válidos en el vCard'
      });
    }

    // Insertar contactos (skip duplicados)
    const imported: any[] = [];
    const skipped: string[] = [];

    for (const contact of contacts) {
      // Validar duplicado
      const { data: existing } = await supabase
        .from('email_contacts')
        .select('id')
        .eq('owner_user_id', userId)
        .eq('email', contact.email)
        .single();

      if (existing) {
        skipped.push(contact.email);
        continue;
      }

      // Crear contacto
      const { data: newContact, error } = await supabase
        .from('email_contacts')
        .insert({
          owner_user_id: userId,
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          company: contact.company,
          notes: contact.notes,
          vcard_data: vcard, // Guardar vCard original
          email_count: 0,
          last_interaction: new Date().toISOString()
        })
        .select('*')
        .single();

      if (!error && newContact) {
        imported.push(newContact);
      }
    }

    console.log('[CONTACTS] vCard importado:', imported.length, 'importados,', skipped.length, 'duplicados');

    return res.json({
      success: true,
      imported: imported.length,
      skipped: skipped.length,
      contacts: imported.map(c => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        company: c.company
      }))
    });

  } catch (error: any) {
    console.error('[CONTACTS] Error importando vCard:', error);
    return res.status(500).json({
      success: false,
      error: 'IMPORT_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/contacts/:id
// ═══════════════════════════════════════════════════════════════

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { id } = req.params;
    const { name, email, phone, company, notes } = req.body;

    console.log('[CONTACTS] Actualizando contacto:', id);

    const updateData: any = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (company !== undefined) updateData.company = company;
    if (notes !== undefined) updateData.notes = notes;

    const { data: contact, error } = await supabase
      .from('email_contacts')
      .update(updateData)
      .eq('id', id)
      .eq('owner_user_id', userId)
      .select('*')
      .single();

    if (error) {
      console.error('[CONTACTS] Error actualizando:', error);
      return res.status(500).json({
        success: false,
        error: 'DB_ERROR',
        message: 'Error actualizando contacto'
      });
    }

    console.log('[CONTACTS] Contacto actualizado:', contact.id);

    return res.json({
      success: true,
      contact: {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        company: contact.company,
        notes: contact.notes,
        emailCount: contact.email_count,
        lastInteraction: contact.last_interaction
      }
    });

  } catch (error: any) {
    console.error('[CONTACTS] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/contacts/:id
// ═══════════════════════════════════════════════════════════════

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { id } = req.params;

    console.log('[CONTACTS] Eliminando contacto:', id);

    const { error } = await supabase
      .from('email_contacts')
      .delete()
      .eq('id', id)
      .eq('owner_user_id', userId);

    if (error) {
      console.error('[CONTACTS] Error eliminando:', error);
      return res.status(500).json({
        success: false,
        error: 'DB_ERROR',
        message: 'Error eliminando contacto'
      });
    }

    console.log('[CONTACTS] Contacto eliminado:', id);

    return res.json({
      success: true,
      message: 'Contacto eliminado exitosamente'
    });

  } catch (error: any) {
    console.error('[CONTACTS] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error.message
    });
  }
});

export default router;
