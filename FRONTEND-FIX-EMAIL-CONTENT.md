# 🚨 URGENTE: Fix Email Content Display

## PROBLEMA

El módulo de correo muestra "Sin contenido" en TODOS los correos, pero el backend SÍ tiene el contenido completo.

**Root Cause:** El frontend NO está llamando el endpoint correcto para obtener el body del correo.

---

## ❌ LO QUE ESTÁN HACIENDO MAL (ACTUAL)

```typescript
// Frontend solo obtiene la LISTA de correos
GET /api/mail/messages?accountId=xxx

// Respuesta incluye SOLO body_preview (150 caracteres)
{
  "messages": [
    {
      "id": "abc-123",
      "subject": "Prueba",
      "from_address": "x@example.com",
      "body_preview": "Primeros 150 chars...",  // ← SOLO ESTO
      "body_text": null,  // ← NO viene en la lista
      "body_html": null   // ← NO viene en la lista
    }
  ]
}
```

**POR ESO MUESTRA "SIN CONTENIDO"** - ¡No están pidiendo el contenido completo!

---

## ✅ SOLUCIÓN: Llamar endpoint de mensaje individual

Cuando el usuario **HACE CLIC** en un correo para leerlo, DEBEN llamar:

```typescript
GET /api/mail/messages/:messageId
```

Esto retorna el correo completo con `body_html` y `body_text`.

---

## 📋 IMPLEMENTACIÓN PASO A PASO

### 1. Agregar función para obtener mensaje completo

```typescript
// src/services/emailService.ts (o donde tengan las llamadas API)

export async function getEmailById(messageId: string): Promise<EmailMessage> {
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session) {
    throw new Error('Usuario no autenticado');
  }
  
  const response = await fetch(`http://100.27.201.233:3000/api/mail/messages/${messageId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error('Error al obtener correo');
  }
  
  return response.json();
}
```

---

### 2. Actualizar componente de visualización de correo

```typescript
// En tu componente EmailViewer.tsx o EmailDetail.tsx

import { useState, useEffect } from 'react';
import DOMPurify from 'dompurify'; // ← INSTALAR: npm install dompurify @types/dompurify

export default function EmailViewer({ messageId }: { messageId: string }) {
  const [email, setEmail] = useState<EmailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    async function loadEmail() {
      try {
        setLoading(true);
        
        // ✅ LLAMAR ENDPOINT CORRECTO
        const emailData = await getEmailById(messageId);
        setEmail(emailData);
        
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    
    if (messageId) {
      loadEmail();
    }
  }, [messageId]);
  
  if (loading) return <div>Cargando correo...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!email) return <div>No se encontró el correo</div>;
  
  // ✅ RENDERIZAR HTML SANITIZADO
  const sanitizedHtml = email.body_html 
    ? DOMPurify.sanitize(email.body_html)
    : null;
  
  return (
    <div className="email-viewer">
      <div className="email-header">
        <h2>{email.subject || '(Sin asunto)'}</h2>
        <p><strong>De:</strong> {email.from_name || email.from_address}</p>
        <p><strong>Fecha:</strong> {new Date(email.date).toLocaleString('es-MX')}</p>
      </div>
      
      <div className="email-body">
        {sanitizedHtml ? (
          // ✅ Renderizar HTML del correo
          <div 
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
            className="email-html-content"
          />
        ) : email.body_text ? (
          // Fallback a texto plano
          <pre className="email-text-content">{email.body_text}</pre>
        ) : (
          <p>Sin contenido</p>
        )}
      </div>
      
      {email.has_attachments && (
        <div className="email-attachments">
          <p>📎 Este correo tiene {email.attachment_count} adjunto(s)</p>
        </div>
      )}
    </div>
  );
}
```

---

### 3. Instalar dependencia para sanitizar HTML

```bash
npm install dompurify @types/dompurify
```

**¿Por qué?** Los correos HTML pueden contener scripts maliciosos. DOMPurify limpia el HTML antes de renderizarlo.

---

### 4. Agregar estilos CSS para correos HTML

```css
/* src/styles/email.css */

.email-html-content {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  line-height: 1.6;
  color: #333;
  max-width: 100%;
  overflow-x: auto;
}

.email-html-content img {
  max-width: 100%;
  height: auto;
}

.email-html-content a {
  color: #0066cc;
  text-decoration: underline;
}

.email-text-content {
  white-space: pre-wrap;
  font-family: monospace;
  background: #f5f5f5;
  padding: 1rem;
  border-radius: 4px;
}
```

---

## 🔥 CAMBIOS MÍNIMOS REQUERIDOS

Si no quieren refactorizar mucho, al menos:

### OPCIÓN RÁPIDA: Fetch en click

```typescript
// Cuando hacen clic en un correo de la lista:

async function handleEmailClick(messageId: string) {
  const { data: { session } } = await supabase.auth.getSession();
  
  // ✅ Fetch mensaje completo
  const response = await fetch(
    `http://100.27.201.233:3000/api/mail/messages/${messageId}`,
    {
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    }
  );
  
  const fullEmail = await response.json();
  
  // ✅ Renderizar body_html o body_text
  setSelectedEmail(fullEmail);
}
```

Luego en el render:

```tsx
{selectedEmail && (
  <div dangerouslySetInnerHTML={{ 
    __html: DOMPurify.sanitize(selectedEmail.body_html || selectedEmail.body_text)
  }} />
)}
```

---

## 🧪 TESTING

1. **Abrir DevTools** → Network tab
2. **Hacer clic en un correo**
3. **Verificar** que se llama: `GET /api/mail/messages/{id}`
4. **Ver Response** → debe incluir `body_html` y `body_text` completos
5. **Verificar DOM** → el HTML del correo debe renderizarse

---

## ⚠️ ERRORES COMUNES

### Error: "No autorizado"
**Causa:** No están enviando el token JWT.
**Fix:** Agregar `Authorization: Bearer ${token}` en TODOS los fetch.

### Error: "body_html es null"
**Causa:** Ese correo específico NO tiene HTML, solo texto.
**Fix:** Usar fallback: `body_html || body_text || 'Sin contenido'`

### Error: "XSS vulnerability warning"
**Causa:** Renderizar HTML sin sanitizar.
**Fix:** SIEMPRE usar `DOMPurify.sanitize()` antes de `dangerouslySetInnerHTML`.

---

## 📊 VERIFICACIÓN BACKEND (ya está funcionando)

Backend YA retorna el contenido correcto:

```bash
# Test manual
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://100.27.201.233:3000/api/mail/messages/abc-123

# Respuesta incluye:
{
  "id": "abc-123",
  "subject": "Prueba",
  "body_text": "Contenido completo del correo en texto...",
  "body_html": "<html><body>Contenido completo en HTML...</body></html>",
  "body_preview": "Primeros 150 chars..."
}
```

**EL BACKEND FUNCIONA.** El problema es que el frontend NO está llamando este endpoint.

---

## 🎯 RESUMEN EJECUTIVO

**Problema:** Frontend muestra "Sin contenido" porque solo llama `/api/mail/messages` (lista) que NO incluye `body_html`/`body_text`.

**Solución:** 
1. Cuando usuario hace clic en correo → llamar `/api/mail/messages/:id`
2. Renderizar `body_html` usando `DOMPurify.sanitize()`
3. Fallback a `body_text` si no hay HTML
4. Incluir token JWT en TODAS las llamadas

**Tiempo estimado:** 30 minutos

**Archivos a modificar:**
- `emailService.ts` (agregar `getEmailById`)
- `EmailViewer.tsx` (usar nuevo endpoint)
- `package.json` (instalar `dompurify`)

---

## 🚀 DEPLOY CHECKLIST

- [ ] Instalar `dompurify`
- [ ] Crear función `getEmailById()`
- [ ] Actualizar componente de visualización
- [ ] Agregar estilos CSS
- [ ] Testing: click en correo → ver contenido completo
- [ ] Verificar que NO hay XSS vulnerabilities

---

**NOTA FINAL:** El backend está funcionando PERFECTAMENTE. Patricia (yo) pudo leer los correos completos desde la base de datos. El único problema es que el frontend NO está pidiendo el contenido completo.

¡IMPLEMENTEN ESTO AHORA! 🔥
