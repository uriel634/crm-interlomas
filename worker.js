import { onRequestGet, onRequestPost, onRequestOptions } from './functions/api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api') {
      const context = { request, env, params: {} };
      if (request.method === 'OPTIONS') return onRequestOptions(context);
      if (request.method === 'GET')     return onRequestGet(context);
      if (request.method === 'POST')    return onRequestPost(context);
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Serve static files (index.html, etc.)
    return env.ASSETS.fetch(request);
  },
};
