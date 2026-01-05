/**
 * =====================================================
 * TESTS - SES VALIDATION
 * =====================================================
 * 
 * Tests mínimos para verificar que las REGLAS ABSOLUTAS
 * de SES funcionan correctamente.
 * 
 * npm test -- sesValidation.test.ts
 * =====================================================
 */

import {
  validateSESAbsoluteRules,
  blockUserEmailsInSES,
  isSystemDomain,
  canUseSES,
  SES_SIMULATOR
} from '../utils/sesValidation';

describe('SES Validation - REGLAS ABSOLUTAS', () => {
  
  // ═══════════════════════════════════════════════════════════
  // TEST 1: SES permite dominios del sistema
  // ═══════════════════════════════════════════════════════════
  
  test('✅ SES permite from=@al-eon.com', () => {
    const result = validateSESAbsoluteRules({
      from: 'notificaciones@al-eon.com',
      to: 'user@example.com',
      type: 'password_reset'
    });
    
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });
  
  test('✅ SES permite from=@infinitykode.com', () => {
    const result = validateSESAbsoluteRules({
      from: 'soporte@infinitykode.com',
      to: 'user@example.com',
      type: 'system_notification'
    });
    
    expect(result.valid).toBe(true);
  });
  
  // ═══════════════════════════════════════════════════════════
  // TEST 2: SES bloquea dominios ajenos
  // ═══════════════════════════════════════════════════════════
  
  test('🚫 SES bloquea from=@gmail.com', () => {
    const result = validateSESAbsoluteRules({
      from: 'usuario@gmail.com',
      to: 'destinatario@example.com',
      type: 'password_reset'
    });
    
    expect(result.valid).toBe(false);
    expect(result.error).toContain('REGLA_ABSOLUTA_VIOLATED');
    expect(result.error).toContain('gmail.com');
  });
  
  test('🚫 SES bloquea from=@outlook.com', () => {
    const result = validateSESAbsoluteRules({
      from: 'usuario@outlook.com',
      to: 'destinatario@example.com',
      type: 'password_reset'
    });
    
    expect(result.valid).toBe(false);
    expect(result.error).toContain('REGLA_ABSOLUTA_VIOLATED');
  });
  
  test('🚫 SES bloquea from=@example.com', () => {
    const result = validateSESAbsoluteRules({
      from: 'test@example.com',
      to: 'destinatario@real.com',
      type: 'password_reset'
    });
    
    expect(result.valid).toBe(false);
    expect(result.error).toContain('REGLA_ABSOLUTA_VIOLATED');
  });
  
  // ═══════════════════════════════════════════════════════════
  // TEST 3: blockUserEmailsInSES rechaza correos de usuario
  // ═══════════════════════════════════════════════════════════
  
  test('🚫 SES rechaza si hay accountId (correo de usuario)', () => {
    const result = blockUserEmailsInSES({
      provider: 'SES',
      from: 'notificaciones@al-eon.com',
      accountId: 'user-account-123'
    });
    
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('SES_USER_EMAIL_BLOCKED');
  });
  
  test('✅ SES permite si NO hay accountId (correo del sistema)', () => {
    const result = blockUserEmailsInSES({
      provider: 'SES',
      from: 'notificaciones@al-eon.com'
    });
    
    expect(result.blocked).toBe(false);
  });
  
  test('✅ SMTP permite accountId (correo de usuario normal)', () => {
    const result = blockUserEmailsInSES({
      provider: 'SMTP',
      from: 'usuario@gmail.com',
      accountId: 'user-account-123'
    });
    
    expect(result.blocked).toBe(false); // SMTP NO se bloquea
  });
  
  // ═══════════════════════════════════════════════════════════
  // TEST 4: SES Simulator no rompe ejecución
  // ═══════════════════════════════════════════════════════════
  
  test('✅ SES_SIMULATOR.SUCCESS está definido', () => {
    expect(SES_SIMULATOR.SUCCESS).toBe('success@simulator.amazonses.com');
  });
  
  test('✅ SES_SIMULATOR.BOUNCE está definido', () => {
    expect(SES_SIMULATOR.BOUNCE).toBe('bounce@simulator.amazonses.com');
  });
  
  test('✅ SES_SIMULATOR.COMPLAINT está definido', () => {
    expect(SES_SIMULATOR.COMPLAINT).toBe('complaint@simulator.amazonses.com');
  });
  
  test('✅ canUseSES permite SES Simulator', () => {
    const result = canUseSES('password_reset', SES_SIMULATOR.SUCCESS);
    
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('SES_SIMULATOR');
  });
  
  // ═══════════════════════════════════════════════════════════
  // TEST 5: isSystemDomain funciona correctamente
  // ═══════════════════════════════════════════════════════════
  
  test('✅ isSystemDomain reconoce @al-eon.com', () => {
    expect(isSystemDomain('notificaciones@al-eon.com')).toBe(true);
  });
  
  test('✅ isSystemDomain reconoce @infinitykode.com', () => {
    expect(isSystemDomain('soporte@infinitykode.com')).toBe(true);
  });
  
  test('🚫 isSystemDomain rechaza @gmail.com', () => {
    expect(isSystemDomain('usuario@gmail.com')).toBe(false);
  });
  
  test('🚫 isSystemDomain rechaza @outlook.com', () => {
    expect(isSystemDomain('usuario@outlook.com')).toBe(false);
  });
  
  // ═══════════════════════════════════════════════════════════
  // TEST 6: Validación de dominios blacklisted
  // ═══════════════════════════════════════════════════════════
  
  test('🚫 SES bloquea to=test@example.com (blacklisted)', () => {
    const result = validateSESAbsoluteRules({
      from: 'notificaciones@al-eon.com',
      to: 'test@example.com',
      type: 'password_reset'
    });
    
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Dominio prohibido');
    expect(result.error).toContain('example.com');
  });
  
  test('🚫 SES bloquea to=fake@test.com (blacklisted)', () => {
    const result = validateSESAbsoluteRules({
      from: 'notificaciones@al-eon.com',
      to: 'fake@test.com',
      type: 'password_reset'
    });
    
    expect(result.valid).toBe(false);
    expect(result.error).toContain('test.com');
  });
  
  test('✅ SES permite to=real@gmail.com (dominio real)', () => {
    const result = validateSESAbsoluteRules({
      from: 'notificaciones@al-eon.com',
      to: 'real@gmail.com',
      type: 'password_reset'
    });
    
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// RESUMEN DE TESTS
// ═══════════════════════════════════════════════════════════
/**
 * TOTAL: 17 tests
 * 
 * Cobertura:
 * ✅ Dominios del sistema permitidos (2 tests)
 * 🚫 Dominios ajenos bloqueados (3 tests)
 * 🚫 Correos de usuario bloqueados en SES (3 tests)
 * ✅ SES Simulator funcional (4 tests)
 * ✅ isSystemDomain correcto (4 tests)
 * 🚫 Dominios blacklisted bloqueados (3 tests)
 * 
 * Ejecutar:
 * npm test -- sesValidation.test.ts
 */
