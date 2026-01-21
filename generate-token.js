const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://gptwzuqmuvzttajgjrry.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwdHd6dXFtdXZ6dHRhamdqcnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjUwNTU3MCwiZXhwIjoyMDY4MDgxNTcwfQ.IKpBhVtP2aP28iTr_0EKUfblpmpvF2R2UT5RcSpwowY'
);

async function generateToken() {
  // Obtener cuenta activa
  const { data: accounts } = await supabase
    .from('email_accounts')
    .select('owner_user_id')
    .eq('is_active', true)
    .limit(1);
  
  if (!accounts || accounts.length === 0) {
    console.error('❌ Sin cuentas');
    process.exit(1);
  }
  
  const userId = accounts[0].owner_user_id;
  console.log('User ID:', userId);
  
  // Generar magic link para obtener token
  const { data: user } = await supabase.auth.admin.getUserById(userId);
  
  if (!user || !user.user) {
    console.error('❌ Usuario no encontrado');
    process.exit(1);
  }
  
  console.log('Email:', user.user.email);
  
  // Crear sesión temporal
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: user.user.email || 'test@test.com'
  });
  
  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }
  
  // Extraer token de la URL
  const url = new URL(data.properties.action_link);
  const token = url.searchParams.get('token');
  
  // Ahora usar ese token para crear sesión
  const { data: session, error: sessionError } = await supabase.auth.verifyOtp({
    token_hash: token,
    type: 'magiclink'
  });
  
  if (sessionError || !session.session) {
    // Plan B: Crear usuario de test y obtener JWT
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: user.user.email,
      password: 'temporal123' // Password temporal
    });
    
    if (signInError) {
      // Crear usuario nuevo
      const { data: newUser, error: newUserError } = await supabase.auth.admin.createUser({
        email: user.user.email,
        password: 'temporal123',
        email_confirm: true,
        user_metadata: { user_id: userId }
      });
      
      if (newUserError) {
        console.error('❌ Error creando usuario:', newUserError);
        process.exit(1);
      }
      
      // Ahora sí hacer sign in
      const { data: finalSignIn } = await supabase.auth.signInWithPassword({
        email: user.user.email,
        password: 'temporal123'
      });
      
      console.log('\n🔑 JWT TOKEN:');
      console.log(finalSignIn.session.access_token);
      console.log('\nUser ID:', userId);
      return;
    }
    
    console.log('\n🔑 JWT TOKEN:');
    console.log(signInData.session.access_token);
    console.log('\nUser ID:', userId);
    return;
  }
  
  console.log('\n🔑 JWT TOKEN:');
  console.log(session.session.access_token);
  console.log('\nUser ID:', userId);
}

generateToken();
