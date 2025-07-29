import { Elysia } from 'elysia';

export const authMiddleware = new Elysia()
  .derive({ as: 'global' }, ({ request }) => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    
    // Skip auth for basic endpoints and admin endpoints (they have their own auth)
    if (
      pathname === '/' || 
      pathname === '/whatsapp/status' || 
      pathname === '/whatsapp/qrcode' ||
      pathname.startsWith('/api/admin/') ||
      pathname.startsWith('/api/rooms') ||
      pathname.startsWith('/api/bookings') ||
      pathname.startsWith('/api/upload') ||
      pathname.startsWith('/api/cron/') ||  // Skip auth for cron endpoints (they have their own auth)
      pathname.startsWith('/api/whatsapp/')  // Skip auth for whatsapp endpoints (they have their own auth)
    ) {
      return {};
    }
    
    const apiKey = request.headers.get('x-api-key');
    const secretKey = process.env.API_SECRET_KEY || 'bukanSecretBeneran';
    console.log('[Auth Middleware] Checking auth for path:', pathname);
    console.log('[Auth Middleware] API Key:', apiKey ? 'provided' : 'missing');
    
    if (!apiKey || apiKey !== secretKey) {
      console.log('[Auth Middleware] Authentication failed');
      throw new Error('Invalid or missing API key');
    }
    
    console.log('[Auth Middleware] Authentication successful');
    return {};
  });
