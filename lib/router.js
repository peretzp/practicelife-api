// Minimal router — no framework, just pattern matching
// Mirrors life-dashboard's zero-dependency philosophy

class Router {
  constructor() {
    this.routes = [];
  }

  get(pattern, handler) {
    this.routes.push({ method: 'GET', pattern, handler });
  }

  post(pattern, handler) {
    this.routes.push({ method: 'POST', pattern, handler });
  }

  match(method, url) {
    const pathname = new URL(url, 'http://localhost').pathname;
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = matchPattern(route.pattern, pathname);
      if (params !== null) return { handler: route.handler, params };
    }
    return null;
  }
}

// Simple pattern matching: /api/atlas/:id → { id: '...' }
function matchPattern(pattern, pathname) {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

module.exports = { Router };
