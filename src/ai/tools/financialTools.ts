/**
 * =====================================================
 * FINANCIAL ANALYSIS TOOLS - AL-E CORE
 * =====================================================
 * 
 * Herramientas para que AL-E pueda:
 * - Calcular proyecciones financieras
 * - Estimar costos CAPEX/OPEX
 * - Calcular ROI y payback period
 * - Generar escenarios (conservador/base/agresivo)
 * - Analizar viabilidad de proyectos
 * 
 * =====================================================
 */

export interface FinancialProjection {
  success: boolean;
  project: string;
  scenarios: {
    conservative: ScenarioResult;
    base: ScenarioResult;
    aggressive: ScenarioResult;
  };
  recommendation: string;
  risks: string[];
  opportunities: string[];
}

export interface ScenarioResult {
  name: string;
  capex: number;
  opex_monthly: number;
  opex_annual: number;
  revenue_monthly: number;
  revenue_annual: number;
  profit_annual: number;
  roi_percent: number;
  payback_months: number;
  break_even_month: number;
  projection_3_years: Array<{
    year: number;
    revenue: number;
    costs: number;
    profit: number;
    cumulative_profit: number;
  }>;
}

/**
 * Calcula proyección financiera completa para un proyecto
 */
export async function calculateFinancialProjection(
  projectData: {
    name: string;
    initial_investment: number;  // CAPEX
    monthly_costs: number;       // OPEX mensual
    monthly_revenue_base: number; // Ingresos mensuales base
    growth_rate?: number;        // Tasa de crecimiento mensual (default: 0.05)
  }
): Promise<FinancialProjection> {
  try {
    console.log('[FINANCIAL TOOLS] 💰 Calculando proyección para:', projectData.name);
    
    const { name, initial_investment, monthly_costs, monthly_revenue_base } = projectData;
    const growth_rate = projectData.growth_rate || 0.05; // 5% default
    
    // Escenario CONSERVADOR (70% revenue, +30% costs, +50% CAPEX)
    const conservative = calculateScenario({
      name: 'Conservador',
      capex: initial_investment * 1.5,
      opex_monthly: monthly_costs * 1.3,
      revenue_monthly: monthly_revenue_base * 0.7,
      growth_rate: growth_rate * 0.5 // mitad del crecimiento
    });
    
    // Escenario BASE (100% según input)
    const base = calculateScenario({
      name: 'Base',
      capex: initial_investment,
      opex_monthly: monthly_costs,
      revenue_monthly: monthly_revenue_base,
      growth_rate
    });
    
    // Escenario AGRESIVO (130% revenue, -20% costs)
    const aggressive = calculateScenario({
      name: 'Agresivo',
      capex: initial_investment * 0.9, // 10% menos por eficiencias
      opex_monthly: monthly_costs * 0.8,
      revenue_monthly: monthly_revenue_base * 1.3,
      growth_rate: growth_rate * 1.5 // más crecimiento
    });
    
    // Análisis y recomendación
    const recommendation = generateRecommendation(conservative, base, aggressive);
    const risks = identifyRisks(conservative, base);
    const opportunities = identifyOpportunities(aggressive, base);
    
    return {
      success: true,
      project: name,
      scenarios: {
        conservative,
        base,
        aggressive
      },
      recommendation,
      risks,
      opportunities
    };
    
  } catch (error: any) {
    console.error('[FINANCIAL TOOLS] ❌ Error en proyección:', error);
    return {
      success: false,
      project: projectData.name,
      scenarios: {} as any,
      recommendation: 'Error al calcular proyección',
      risks: [error.message],
      opportunities: []
    };
  }
}

/**
 * Calcula un escenario específico
 */
function calculateScenario(params: {
  name: string;
  capex: number;
  opex_monthly: number;
  revenue_monthly: number;
  growth_rate: number;
}): ScenarioResult {
  const { name, capex, opex_monthly, revenue_monthly, growth_rate } = params;
  
  // Cálculos anuales
  const opex_annual = opex_monthly * 12;
  const revenue_annual = revenue_monthly * 12;
  const profit_annual = revenue_annual - opex_annual;
  
  // ROI = (Ganancia Anual / Inversión Inicial) * 100
  const roi_percent = (profit_annual / capex) * 100;
  
  // Payback = Inversión Inicial / Ganancia Mensual Promedio
  const monthly_profit = revenue_monthly - opex_monthly;
  const payback_months = monthly_profit > 0 ? Math.ceil(capex / monthly_profit) : 999;
  
  // Break-even point
  const break_even_month = monthly_profit > 0 ? Math.ceil(capex / monthly_profit) : 999;
  
  // Proyección 3 años
  const projection_3_years = [];
  let cumulative = -capex; // Empieza con inversión negativa
  
  for (let year = 1; year <= 3; year++) {
    let year_revenue = 0;
    let year_costs = 0;
    
    for (let month = 1; month <= 12; month++) {
      const month_number = (year - 1) * 12 + month;
      const growth_factor = Math.pow(1 + growth_rate, month_number - 1);
      
      const month_rev = revenue_monthly * growth_factor;
      const month_cost = opex_monthly; // Costos constantes
      
      year_revenue += month_rev;
      year_costs += month_cost;
    }
    
    const year_profit = year_revenue - year_costs;
    cumulative += year_profit;
    
    projection_3_years.push({
      year,
      revenue: Math.round(year_revenue),
      costs: Math.round(year_costs),
      profit: Math.round(year_profit),
      cumulative_profit: Math.round(cumulative)
    });
  }
  
  return {
    name,
    capex: Math.round(capex),
    opex_monthly: Math.round(opex_monthly),
    opex_annual: Math.round(opex_annual),
    revenue_monthly: Math.round(revenue_monthly),
    revenue_annual: Math.round(revenue_annual),
    profit_annual: Math.round(profit_annual),
    roi_percent: Math.round(roi_percent * 100) / 100,
    payback_months,
    break_even_month,
    projection_3_years
  };
}

/**
 * Genera recomendación ejecutiva
 */
function generateRecommendation(
  conservative: ScenarioResult,
  base: ScenarioResult,
  aggressive: ScenarioResult
): string {
  let recommendation = '';
  
  // Análisis de viabilidad
  if (base.roi_percent < 0) {
    recommendation = '⚠️ PROYECTO NO VIABLE: ROI negativo incluso en escenario base. No se recomienda proceder sin revisar el modelo de negocio.';
  } else if (base.payback_months > 36) {
    recommendation = '⚠️ ALTO RIESGO: Payback superior a 3 años. Requiere capital paciente y análisis detallado de sostenibilidad.';
  } else if (conservative.roi_percent > 20 && conservative.payback_months < 24) {
    recommendation = '✅ PROYECTO ATRACTIVO: ROI positivo incluso en escenario conservador con payback < 2 años. Se recomienda proceder.';
  } else if (base.roi_percent > 30 && base.payback_months < 18) {
    recommendation = '🚀 PROYECTO EXCELENTE: ROI > 30% con payback < 18 meses. Excelente oportunidad de inversión.';
  } else {
    recommendation = '⚡ PROYECTO VIABLE: ROI positivo pero requiere ejecución disciplinada. Monitorear métricas clave mensualmente.';
  }
  
  // Añadir detalles
  recommendation += `\n\nROI Base: ${base.roi_percent}% | Payback: ${base.payback_months} meses | Break-even: Mes ${base.break_even_month}`;
  
  return recommendation;
}

/**
 * Identifica riesgos clave
 */
function identifyRisks(
  conservative: ScenarioResult,
  base: ScenarioResult
): string[] {
  const risks: string[] = [];
  
  if (conservative.roi_percent < 10) {
    risks.push('Margen de seguridad bajo: ROI conservador < 10%');
  }
  
  if (base.payback_months > 24) {
    risks.push(`Recuperación lenta: Payback de ${base.payback_months} meses`);
  }
  
  if (base.capex > base.revenue_annual * 2) {
    risks.push('Inversión inicial alta: CAPEX > 2x ingresos anuales');
  }
  
  if (conservative.projection_3_years[2].cumulative_profit < 0) {
    risks.push('Rentabilidad a largo plazo incierta: acumulado negativo en año 3 (escenario conservador)');
  }
  
  return risks;
}

/**
 * Identifica oportunidades
 */
function identifyOpportunities(
  aggressive: ScenarioResult,
  base: ScenarioResult
): string[] {
  const opportunities: string[] = [];
  
  if (aggressive.roi_percent > 50) {
    opportunities.push(`Alto potencial: ROI agresivo de ${aggressive.roi_percent}% si se captura mercado`);
  }
  
  if (base.projection_3_years[2].cumulative_profit > base.capex * 3) {
    opportunities.push('Escalabilidad atractiva: Ganancia acumulada > 3x inversión en 3 años');
  }
  
  if (aggressive.payback_months < 12) {
    opportunities.push('Recuperación rápida posible: Payback < 1 año en escenario optimista');
  }
  
  return opportunities;
}

/**
 * Calcula costo total de un proyecto (simple)
 */
export async function estimateProjectCost(
  projectType: 'web' | 'mobile' | 'api' | 'ai' | 'custom',
  complexity: 'low' | 'medium' | 'high',
  features: string[]
): Promise<{
  success: boolean;
  dev_hours: number;
  cost_usd: number;
  timeline_weeks: number;
  breakdown: any;
}> {
  try {
    console.log('[FINANCIAL TOOLS] 💵 Estimando costo:', projectType, complexity);
    
    // Costos base por tipo y complejidad
    const baseCosts = {
      web: { low: 80, medium: 200, high: 400 },      // horas
      mobile: { low: 120, medium: 300, high: 600 },
      api: { low: 60, medium: 150, high: 300 },
      ai: { low: 100, medium: 250, high: 500 },
      custom: { low: 100, medium: 250, high: 500 }
    };
    
    let dev_hours = baseCosts[projectType][complexity];
    
    // Añadir horas por features
    const featureCosts: Record<string, number> = {
      'auth': 20,
      'payment': 30,
      'chat': 40,
      'notifications': 15,
      'analytics': 25,
      'admin': 35,
      'api_integration': 25,
      'real_time': 40
    };
    
    features.forEach(feature => {
      const cost = featureCosts[feature.toLowerCase()] || 10;
      dev_hours += cost;
    });
    
    // Calcular costo ($50/hora promedio)
    const hourly_rate = 50;
    const cost_usd = dev_hours * hourly_rate;
    
    // Timeline (40 horas/semana)
    const timeline_weeks = Math.ceil(dev_hours / 40);
    
    return {
      success: true,
      dev_hours,
      cost_usd,
      timeline_weeks,
      breakdown: {
        base_hours: baseCosts[projectType][complexity],
        feature_hours: dev_hours - baseCosts[projectType][complexity],
        hourly_rate,
        features_included: features
      }
    };
    
  } catch (error: any) {
    return {
      success: false,
      dev_hours: 0,
      cost_usd: 0,
      timeline_weeks: 0,
      breakdown: { error: error.message }
    };
  }
}

/**
 * Definiciones de herramientas para el LLM
 */
export const FINANCIAL_TOOLS_DEFINITIONS = [
  {
    name: 'calculate_financial_projection',
    description: 'Calcula proyección financiera completa: CAPEX, OPEX, ROI, payback, break-even y proyección 3 años con 3 escenarios (conservador/base/agresivo).',
    parameters: {
      type: 'object',
      properties: {
        project_name: {
          type: 'string',
          description: 'Nombre del proyecto'
        },
        initial_investment: {
          type: 'number',
          description: 'Inversión inicial (CAPEX) en USD'
        },
        monthly_costs: {
          type: 'number',
          description: 'Costos operativos mensuales (OPEX) en USD'
        },
        monthly_revenue: {
          type: 'number',
          description: 'Ingresos mensuales esperados en USD'
        },
        growth_rate: {
          type: 'number',
          description: 'Tasa de crecimiento mensual (default: 0.05 = 5%)'
        }
      },
      required: ['project_name', 'initial_investment', 'monthly_costs', 'monthly_revenue']
    }
  },
  {
    name: 'estimate_project_cost',
    description: 'Estima el costo de desarrollo de un proyecto de software basado en tipo, complejidad y features.',
    parameters: {
      type: 'object',
      properties: {
        project_type: {
          type: 'string',
          enum: ['web', 'mobile', 'api', 'ai', 'custom'],
          description: 'Tipo de proyecto'
        },
        complexity: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Nivel de complejidad'
        },
        features: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de features: auth, payment, chat, notifications, analytics, admin, api_integration, real_time'
        }
      },
      required: ['project_type', 'complexity', 'features']
    }
  }
];
