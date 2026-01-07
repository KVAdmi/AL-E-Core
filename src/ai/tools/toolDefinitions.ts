/**
 * Tool Definitions para Function Calling
 * 
 * JSON schemas que se pasan al LLM para que sepa qué herramientas tiene disponibles.
 * Compatible con OpenAI/Groq Function Calling format.
 */

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

// ═══════════════════════════════════════════════════════════════
// EMAIL TOOLS
// ═══════════════════════════════════════════════════════════════

export const LIST_EMAILS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_emails',
    description: 'Lista los correos electrónicos del usuario. Usa esto cuando el usuario pida: "revisa mis correos", "¿tengo emails?", "checa mi inbox", "correos nuevos", "emails no leídos", etc.',
    parameters: {
      type: 'object',
      properties: {
        unreadOnly: {
          type: 'boolean',
          description: 'Si true, solo muestra correos no leídos. Usar cuando el usuario diga "no leídos" o "sin leer".'
        },
        limit: {
          type: 'number',
          description: 'Número máximo de correos a retornar. Default: 10',
          default: 10
        },
        accountEmail: {
          type: 'string',
          description: 'Email de la cuenta específica a revisar (opcional)'
        }
      },
      required: []
    }
  }
};

export const READ_EMAIL_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_email',
    description: 'Lee el contenido completo de un correo específico. Usa esto cuando el usuario pida leer un correo en particular o analizar el contenido de un email.',
    parameters: {
      type: 'object',
      properties: {
        emailId: {
          type: 'string',
          description: 'ID del correo a leer'
        }
      },
      required: ['emailId']
    }
  }
};

export const SEND_EMAIL_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'send_email',
    description: 'Envía un correo electrónico. Usa esto cuando el usuario diga: "envía un email a...", "manda un correo...", "responde a...", etc.',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Dirección de email del destinatario'
        },
        subject: {
          type: 'string',
          description: 'Asunto del correo'
        },
        body: {
          type: 'string',
          description: 'Contenido del correo (texto plano o HTML)'
        },
        inReplyTo: {
          type: 'string',
          description: 'ID del correo al que se está respondiendo (opcional)'
        }
      },
      required: ['to', 'subject', 'body']
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// WEB SEARCH TOOLS
// ═══════════════════════════════════════════════════════════════

export const WEB_SEARCH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Busca información actualizada en internet usando Tavily. USA ESTO OBLIGATORIAMENTE cuando el usuario pregunte por: empresas externas, productos comerciales, precios actuales, noticias, eventos recientes, información que cambia con el tiempo, verificación de existencia de sitios web, servicios de terceros, comparaciones de mercado, APIs de terceros, etc. NUNCA inventes información sobre entidades externas sin buscar primero. Si el usuario pregunta "existe X empresa", "cuánto cuesta Y", "qué es Z" donde X/Y/Z no son parte de Infinity Kode, DEBES usar web_search.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Query de búsqueda en lenguaje natural. Incluye el año actual si es relevante para precios o info actualizada.'
        },
        maxResults: {
          type: 'number',
          description: 'Número máximo de resultados (default: 5)',
          default: 5
        }
      },
      required: ['query']
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// CALENDAR TOOLS
// ═══════════════════════════════════════════════════════════════

export const LIST_EVENTS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_events',
    description: 'Lista eventos del calendario interno de AL-E. Usa esto cuando el usuario pregunte: "qué tengo hoy", "mi agenda", "eventos de mañana", "qué tengo programado", "reuniones de esta semana", etc.',
    parameters: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'Fecha de inicio en formato ISO 8601 (ej: 2026-01-08T00:00:00Z). Si el usuario dice "hoy", usar fecha actual.'
        },
        endDate: {
          type: 'string',
          description: 'Fecha de fin en formato ISO 8601. Si no se especifica, usar 7 días desde startDate.'
        }
      },
      required: []
    }
  }
};

export const CREATE_EVENT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'create_event',
    description: 'Crea un evento en el calendario interno. Usa esto cuando el usuario diga: "agrega reunión", "pon una cita", "recordatorio para...", "agenda llamada con...", etc.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Título del evento'
        },
        startTime: {
          type: 'string',
          description: 'Fecha y hora de inicio en formato ISO 8601 (ej: 2026-01-08T14:00:00Z)'
        },
        endTime: {
          type: 'string',
          description: 'Fecha y hora de fin en formato ISO 8601. Si no se especifica, asume 1 hora después de startTime.'
        },
        description: {
          type: 'string',
          description: 'Descripción detallada del evento (opcional)'
        },
        location: {
          type: 'string',
          description: 'Ubicación o link de Zoom/Meet (opcional)'
        }
      },
      required: ['title', 'startTime']
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// MEMORY TOOLS
// ═══════════════════════════════════════════════════════════════

export const SAVE_MEMORY_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'save_memory',
    description: 'Guarda información importante para recordar más tarde. Usa esto cuando el usuario comparta: decisiones de negocio, acuerdos, preferencias personales, hechos sobre su negocio/proyecto, datos técnicos importantes, etc. NO uses esto para información temporal o transaccional.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Contenido de la memoria a guardar. Debe ser claro y autocontenido.'
        },
        memoryType: {
          type: 'string',
          enum: ['fact', 'preference', 'decision', 'project_info'],
          description: 'Tipo de memoria: fact (hecho confirmado), preference (preferencia del usuario), decision (decisión tomada), project_info (info del proyecto)'
        },
        importance: {
          type: 'number',
          description: 'Importancia de 0 a 1 (0.3 = baja, 0.7 = alta, 1.0 = crítica)',
          minimum: 0,
          maximum: 1,
          default: 0.7
        }
      },
      required: ['content', 'memoryType']
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// DOCUMENT ANALYSIS TOOLS
// ═══════════════════════════════════════════════════════════════

export const ANALYZE_DOCUMENT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'analyze_document',
    description: 'Analiza un documento subido por el usuario (PDF, Excel, Word, etc.). Usa esto cuando el usuario pida analizar un archivo, extraer información de un documento, o revisar contenido de archivos.',
    parameters: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'ID del documento a analizar'
        },
        analysisType: {
          type: 'string',
          enum: ['summary', 'financial', 'technical', 'full'],
          description: 'Tipo de análisis requerido',
          default: 'summary'
        }
      },
      required: ['documentId']
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// FINANCIAL TOOLS
// ═══════════════════════════════════════════════════════════════

export const CALCULATE_PROJECTION_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'calculate_financial_projection',
    description: 'Calcula proyecciones financieras basadas en parámetros dados. Usa esto cuando el usuario pida: estimar ROI, calcular punto de equilibrio, proyectar ingresos/gastos, analizar viabilidad financiera.',
    parameters: {
      type: 'object',
      properties: {
        initialInvestment: {
          type: 'number',
          description: 'Inversión inicial en USD'
        },
        monthlyRevenue: {
          type: 'number',
          description: 'Ingreso mensual estimado en USD'
        },
        monthlyCosts: {
          type: 'number',
          description: 'Costos mensuales en USD'
        },
        growthRate: {
          type: 'number',
          description: 'Tasa de crecimiento mensual (ej: 0.05 = 5%)',
          default: 0
        },
        months: {
          type: 'number',
          description: 'Número de meses a proyectar',
          default: 12
        }
      },
      required: ['initialInvestment', 'monthlyRevenue', 'monthlyCosts']
    }
  }
};

export const ESTIMATE_PROJECT_COST_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'estimate_project_cost',
    description: 'Estima el costo de desarrollo de un proyecto. Usa esto cuando el usuario pida: cotizar un proyecto, estimar horas de desarrollo, calcular costo de implementación.',
    parameters: {
      type: 'object',
      properties: {
        projectDescription: {
          type: 'string',
          description: 'Descripción del proyecto a estimar'
        },
        complexity: {
          type: 'string',
          enum: ['simple', 'medium', 'complex'],
          description: 'Complejidad del proyecto',
          default: 'medium'
        },
        includeInfra: {
          type: 'boolean',
          description: 'Si incluir costos de infraestructura mensual',
          default: true
        }
      },
      required: ['projectDescription']
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// EXPORT ALL TOOLS
// ═══════════════════════════════════════════════════════════════

export const ALL_TOOLS: ToolDefinition[] = [
  // Email (prioridad alta)
  LIST_EMAILS_TOOL,
  READ_EMAIL_TOOL,
  SEND_EMAIL_TOOL,
  
  // Web (prioridad alta)
  WEB_SEARCH_TOOL,
  
  // Calendar (prioridad media)
  LIST_EVENTS_TOOL,
  CREATE_EVENT_TOOL,
  
  // Memory (prioridad media)
  SAVE_MEMORY_TOOL,
  
  // Documents (prioridad baja - opcional)
  ANALYZE_DOCUMENT_TOOL,
  
  // Financial (prioridad baja - opcional)
  CALCULATE_PROJECTION_TOOL,
  ESTIMATE_PROJECT_COST_TOOL
];

/**
 * Get tools basado en contexto
 * Esto permite limitar qué herramientas se pasan al LLM según el caso
 */
export function getToolsForContext(context: {
  hasEmailAccess: boolean;
  hasCalendarAccess: boolean;
  hasWebAccess: boolean;
  userMessage?: string;
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  
  // Email tools - solo si usuario tiene cuenta configurada
  if (context.hasEmailAccess) {
    tools.push(LIST_EMAILS_TOOL, READ_EMAIL_TOOL, SEND_EMAIL_TOOL);
  }
  
  // Web search - SIEMPRE disponible (crítico para evitar alucinaciones)
  if (context.hasWebAccess) {
    tools.push(WEB_SEARCH_TOOL);
  }
  
  // Calendar - SIEMPRE disponible (calendario interno)
  if (context.hasCalendarAccess) {
    tools.push(LIST_EVENTS_TOOL, CREATE_EVENT_TOOL);
  }
  
  // Memory - SIEMPRE disponible
  tools.push(SAVE_MEMORY_TOOL);
  
  // Document/Financial tools - solo si mensaje sugiere necesidad
  if (context.userMessage) {
    const msg = context.userMessage.toLowerCase();
    
    if (msg.includes('documento') || msg.includes('pdf') || msg.includes('archivo') || msg.includes('analiz')) {
      tools.push(ANALYZE_DOCUMENT_TOOL);
    }
    
    if (msg.includes('costo') || msg.includes('precio') || msg.includes('presupuesto') || 
        msg.includes('roi') || msg.includes('proyecc') || msg.includes('estim')) {
      tools.push(CALCULATE_PROJECTION_TOOL, ESTIMATE_PROJECT_COST_TOOL);
    }
  }
  
  return tools;
}

/**
 * Get minimal tools for fast responses
 * Usa esto cuando necesites respuesta rápida sin funcionalidad completa
 */
export function getMinimalTools(): ToolDefinition[] {
  return [
    WEB_SEARCH_TOOL,  // Crítico para evitar alucinaciones
    SAVE_MEMORY_TOOL  // Crítico para aprendizaje
  ];
}
