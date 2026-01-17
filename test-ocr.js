const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  'https://gptwzuqmuvzttajgjrry.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwdHd6dXFtdXZ6dHRhamdqcnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjUwNTU3MCwiZXhwIjoyMDY4MDgxNTcwfQ.IKpBhVtP2aP28iTr_0EKUfblpmpvF2R2UT5RcSpwowY'
);

async function uploadTestImage() {
  // Descargar imagen de Google Forms screenshot que me pasaste
  const imageUrl = 'https://docs.google.com/forms/d/1X9UeTe7gQB5F7lC6EojPwUGaqCAKsgIxDh_wA8WMngI/viewform?edit_requested=true';
  
  console.log('No podemos descargar directo de Google Forms. Usando imagen de prueba simple...');
  
  // Crear imagen de prueba con texto
  const testText = 'PRUEBA OCR - Este es un texto de prueba para validar extracción';
  const { data, error } = await supabase.storage
    .from('attachments')
    .upload(`test/ocr-test-${Date.now()}.txt`, testText, {
      contentType: 'text/plain',
      upsert: true
    });
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  const { data: { publicUrl } } = supabase.storage
    .from('attachments')
    .getPublicUrl(data.path);
  
  console.log('✅ URL pública:', publicUrl);
}

uploadTestImage();
