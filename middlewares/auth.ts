import { Elysia } from 'elysia';

export const authMiddleware = new Elysia()
  .derive({ as: 'global' }, ({ request }) => {
    const apiKey = request.headers.get('x-api-key');
    const secretKey = process.env.API_SECRET_KEY || 'default-secret-key-for-development';
    console.log('[Auth Middleware] API Key:', apiKey);
    
    if (!apiKey || apiKey !== secretKey) {
      throw new Error('Invalid or missing API key');
    }
    
    return {};
  });
