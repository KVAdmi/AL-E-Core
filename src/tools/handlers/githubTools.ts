/**
 * =====================================================
 * TOOL HANDLERS - GitHub & Code
 * =====================================================
 * 
 * Implementaciones de herramientas para:
 * - Leer archivos de repositorios
 * - Buscar código
 * - Analizar repos
 * =====================================================
 */

import axios from 'axios';
import { ToolResult } from '../registry';

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API_BASE = 'https://api.github.com';

// ═══════════════════════════════════════════════════════════════
// GITHUB GET FILE
// ═══════════════════════════════════════════════════════════════

export async function githubGetFileHandler(args: {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
}): Promise<ToolResult> {
  const { owner, repo, path, ref = 'main' } = args;
  
  try {
    if (!GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN no configurado');
    }

    console.log(`[TOOL] github_get_file: ${owner}/${repo}/${path}`);

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      params: { ref },
      timeout: 10000
    });

    // Decodificar contenido (viene en base64)
    const content = Buffer.from(response.data.content, 'base64').toString('utf-8');

    const data = {
      owner,
      repo,
      path,
      ref,
      content,
      size: response.data.size,
      sha: response.data.sha,
      url: response.data.html_url
    };

    return {
      success: true,
      data,
      source: `GitHub: ${owner}/${repo}`,
      timestamp: new Date().toISOString(),
      provider: 'github'
    };
  } catch (error: any) {
    console.error('[TOOL] github_get_file error:', error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      timestamp: new Date().toISOString(),
      provider: 'github'
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// GITHUB SEARCH CODE
// ═══════════════════════════════════════════════════════════════

export async function githubSearchCodeHandler(args: {
  query: string;
  repo?: string;
  language?: string;
  limit?: number;
}): Promise<ToolResult> {
  const { query, repo, language, limit = 10 } = args;
  
  try {
    if (!GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN no configurado');
    }

    console.log(`[TOOL] github_search_code: "${query}"`);

    // Construir query con filtros
    let searchQuery = query;
    if (repo) searchQuery += ` repo:${repo}`;
    if (language) searchQuery += ` language:${language}`;

    const response = await axios.get(`${GITHUB_API_BASE}/search/code`, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      params: {
        q: searchQuery,
        per_page: limit
      },
      timeout: 15000
    });

    const data = {
      query: searchQuery,
      totalCount: response.data.total_count,
      results: response.data.items?.map((item: any) => ({
        name: item.name,
        path: item.path,
        repository: item.repository.full_name,
        url: item.html_url,
        sha: item.sha
      })) || []
    };

    return {
      success: true,
      data,
      source: 'GitHub Code Search',
      timestamp: new Date().toISOString(),
      provider: 'github'
    };
  } catch (error: any) {
    console.error('[TOOL] github_search_code error:', error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      timestamp: new Date().toISOString(),
      provider: 'github'
    };
  }
}
