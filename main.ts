import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { ensureAuthDir } from './utils/ensure-auth-dir';
import { authMiddleware } from './middlewares/auth';
import {
  connectToWhatsApp,
  resetWhatsAppConnection,
  sendWhatsAppMessage,
  connectionReady,
  qrCode
} from './utils/whatsapp-connection';
import { InMemoryMessageQueue, QueueItem } from './utils/message-queue';

// Set default API secret key jika tidak ada di environment
if (!process.env.API_SECRET_KEY) {
  process.env.API_SECRET_KEY = 'suman-residence-whatsapp-secret-2025';
  console.log('API_SECRET_KEY not found in environment, using default value');
}

// Inisialisasi message queue dengan delay acak 2-4 detik
const messageQueue = new InMemoryMessageQueue(
  async (item: QueueItem) => {
    try {
      if (!connectionReady) {
        return {
          success: false,
          itemId: item.id,
          error: 'WhatsApp not connected'
        };
      }
      
      console.log(`[WhatsApp Queue] Sending message to ${item.phoneNumber}: ${item.message.substring(0, 20)}...`);
      // sendWhatsAppMessage sekarang mengembalikan {success, message} dengan penanganan error internal
      const result = await sendWhatsAppMessage(item.phoneNumber, item.message);
      
      return {
        success: result.success,
        itemId: item.id,
        error: result.success ? undefined : result.message
      };
    } catch (error) {
      console.error('[WhatsApp Queue] Error sending message:', error);
      return {
        success: false,
        itemId: item.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  },
  {
    minDelayMs: 2000, // 2 detik
    maxDelayMs: 4000  // 4 detik
  }
);

// Only initialize automatically if we have auth data
ensureAuthDir().then(() => {
  console.log('Auth directory is ready');
  connectToWhatsApp()
});

// API routes
const app = new Elysia()
  .use(
    cors({
      origin: '*', // Allow all origins
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true
    }))
  .use(authMiddleware)
  .get('/', () => ({ hello: 'Bun👋' }))
  .get('/whatsapp/status', () => ({
    connected: connectionReady,
    hasQrCode: qrCode !== null,
    timestamp: new Date().toISOString()
  }))
  .get('/whatsapp/qrcode', () => {
    console.log('[WhatsApp QR Code] QR Code:', qrCode);
    if (qrCode) {
      return {
        success: true,
        qrCode: qrCode
      };
    } else {
      return {
        success: false,
        message: connectionReady ? 'Already connected' : 'QR code not available'
      };
    }
  })
  .post('/whatsapp/reset-connection', async () => {
    try {
      await resetWhatsAppConnection();
      
      return {
        success: true,
        message: 'WhatsApp connection reset. Check /whatsapp/qrcode for new QR code',
        hasQrCode: qrCode !== null
      };
    } catch (error) {
      console.error('Failed to reset WhatsApp connection:', error);
      return {
        success: false,
        message: 'Failed to reset WhatsApp connection',
        error: String(error)
      };
    }
  })
  .post('/whatsapp/send', async ({ body }) => {
    if (!connectionReady) {
      return {
        success: false,
        message: 'WhatsApp not connected, please scan QR code first'
      };
    }

    const { phoneNumber, message } = body as any;
    
    if (!phoneNumber || !message) {
      return {
        success: false,
        message: 'phoneNumber and message are required'
      };
    }

    try {
      // Tambahkan pesan ke queue alih-alih mengirim langsung
      const messageId = messageQueue.enqueue(phoneNumber, message);
      
      return {
        success: true,
        message: 'Message added to queue',
        messageId: messageId
      };
    } catch (error: any) {
      console.error('Error queueing WhatsApp message:', error);
      return {
        success: false,
        message: error.message || 'Failed to queue message'
      };
    }
  })
  .get('/whatsapp/queue-status', () => {
    return messageQueue.getStatus();
  })
  .listen(8080, ({ hostname, port }) => {
    // Aktifkan domain untuk debugging
    process.env.DEBUG = 'queues,*';
    console.log(`🦊 Server is running at ${hostname}:${port}`);
    console.log('🔄 WhatsApp message queue initialized with random delay (2-4 seconds)');
  });

console.log('CORS enabled for all origins (*)');
console.log('WhatsApp client initializing...')
