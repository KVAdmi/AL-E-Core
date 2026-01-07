/**
 * Deterministic Rule Engine para KUNNA
 * NO usa IA, solo reglas duras y configurables
 */

export interface EventContext {
  user_id: string;
  event_id?: string;
  current_risk_level?: 'normal' | 'alert' | 'risk' | 'critical';
  last_checkin_at?: string;
  inactivity_minutes?: number;
  recent_events?: any[];
}

export interface Action {
  type: 'send_silent_verification' | 'alert_trust_circle' | 'escalate_full_sos' | 'start_evidence_recording';
  priority: number;
  reason: string;
  payload: Record<string, any>;
}

export interface RuleResult {
  matched: boolean;
  actions: Action[];
  rule_name: string;
}

/**
 * RULE 1: checkin_failed_twice
 * Si 2 checkin_failed en ventana de 120 min => silent verification
 */
export function rule_checkin_failed_twice(events: any[]): RuleResult {
  const result: RuleResult = {
    matched: false,
    actions: [],
    rule_name: 'checkin_failed_twice',
  };

  // Filtrar eventos de tipo checkin_failed en últimas 2 horas
  const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000);
  const checkinFailures = events.filter(e => 
    e.event_type === 'checkin_failed' &&
    new Date(e.timestamp) >= twoHoursAgo
  );

  if (checkinFailures.length >= 2) {
    result.matched = true;
    result.actions.push({
      type: 'send_silent_verification',
      priority: 1,
      reason: 'rule:checkin_failed_twice',
      payload: {
        failure_count: checkinFailures.length,
        window_minutes: 120,
      },
    });
  }

  return result;
}

/**
 * RULE 2: inactivity_plus_risk
 * Si inactividad >= 240 min Y risk_level en [risk, critical] => alert circle
 */
export function rule_inactivity_plus_risk(context: EventContext): RuleResult {
  const result: RuleResult = {
    matched: false,
    actions: [],
    rule_name: 'inactivity_plus_risk',
  };

  const inactivity = context.inactivity_minutes || 0;
  const riskLevel = context.current_risk_level || 'normal';

  if (inactivity >= 240 && (riskLevel === 'risk' || riskLevel === 'critical')) {
    result.matched = true;
    result.actions.push({
      type: 'alert_trust_circle',
      priority: 1,
      reason: 'rule:inactivity_plus_risk',
      payload: {
        inactivity_minutes: inactivity,
        risk_level: riskLevel,
      },
    });
  }

  return result;
}

/**
 * RULE 3: manual_sos_or_critical
 * Si sos_manual O risk_level == critical => full SOS + evidence
 */
export function rule_manual_sos_or_critical(context: EventContext, currentEvent?: any): RuleResult {
  const result: RuleResult = {
    matched: false,
    actions: [],
    rule_name: 'manual_sos_or_critical',
  };

  const isManualSOS = currentEvent?.event_type === 'sos_manual';
  const isCritical = context.current_risk_level === 'critical';

  if (isManualSOS || isCritical) {
    result.matched = true;
    
    result.actions.push({
      type: 'escalate_full_sos',
      priority: 1,
      reason: 'rule:manual_sos_or_critical',
      payload: {
        trigger: isManualSOS ? 'manual_sos' : 'critical_risk_level',
        risk_level: context.current_risk_level,
      },
    });

    result.actions.push({
      type: 'start_evidence_recording',
      priority: 2,
      reason: 'rule:manual_sos_or_critical',
      payload: {
        trigger: isManualSOS ? 'manual_sos' : 'critical_risk_level',
      },
    });
  }

  return result;
}

/**
 * Ejecutar todas las reglas y consolidar acciones
 */
export function evaluateRules(context: EventContext, currentEvent?: any, recentEvents: any[] = []): Action[] {
  const allActions: Action[] = [];
  const matchedRules: string[] = [];

  // Ejecutar reglas
  const r1 = rule_checkin_failed_twice(recentEvents);
  if (r1.matched) {
    allActions.push(...r1.actions);
    matchedRules.push(r1.rule_name);
  }

  const r2 = rule_inactivity_plus_risk(context);
  if (r2.matched) {
    allActions.push(...r2.actions);
    matchedRules.push(r2.rule_name);
  }

  const r3 = rule_manual_sos_or_critical(context, currentEvent);
  if (r3.matched) {
    allActions.push(...r3.actions);
    matchedRules.push(r3.rule_name);
  }

  console.log(`[RULE ENGINE] Matched rules: ${matchedRules.join(', ') || 'none'}`);
  console.log(`[RULE ENGINE] Total actions: ${allActions.length}`);

  // Ordenar por prioridad
  allActions.sort((a, b) => a.priority - b.priority);

  return allActions;
}
