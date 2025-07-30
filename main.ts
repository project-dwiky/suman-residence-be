import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import * as cron from 'node-cron';
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

// Set default cron time jika tidak ada di environment (default: daily at 9 AM)
if (!process.env.CRON_TIME) {
  process.env.CRON_TIME = '0 9 * * *'; // Daily at 9:00 AM
  console.log('CRON_TIME not found in environment, using default value: 0 9 * * *');
}

// Set default main service URL jika tidak ada di environment
if (!process.env.MAIN_SERVICE_URL) {
  process.env.MAIN_SERVICE_URL = 'http://localhost:3000';
  console.log('MAIN_SERVICE_URL not found in environment, using default value');
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

// Fungsi untuk melakukan HTTP request ke booking endpoint
async function executeBookingProcess(source: string = 'whatsapp-backend-cron') {
  const mainServiceUrl = process.env.MAIN_SERVICE_URL || 'http://localhost:3000';
  
  console.log(`🔄 [${source.toUpperCase()}] Starting cron booking process...`);
  
  try {
    const response = await fetch(`${mainServiceUrl}/api/cron/handler`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Suman-Residence-WhatsApp-Backend/1.0',
        'x-api-key': process.env.API_SECRET_KEY || 'default-secret-key-for-development'
      },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        source: source
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`✅ [${source.toUpperCase()}] Cron booking process completed successfully:`, result);
      return { success: true, result };
    } else {
      console.error(`❌ [${source.toUpperCase()}] Cron booking process failed with status:`, response.status, response.statusText);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      return { success: false, error: errorText, status: response.status };
    }
  } catch (error) {
    console.error(`💥 [${source.toUpperCase()}] Error during booking process:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Setup cron job untuk booking reminder
const cronTime = process.env.CRON_TIME || '0 9 * * *';
const mainServiceUrl = process.env.MAIN_SERVICE_URL || 'http://localhost:3000';

console.log(`⏰ Setting up cron job with schedule: ${cronTime}`);
console.log(`🎯 Target service URL: ${mainServiceUrl}/cron/handler`);

const bookingCronJob = cron.schedule(cronTime, async () => {
  await executeBookingProcess('whatsapp-backend-cron');
}, {
  timezone: 'Asia/Jakarta'
});

// Start the cron job
bookingCronJob.start();

console.log('✅ Cron job initialized and scheduled');
console.log(`⏰ Next execution: ${bookingCronJob.getStatus()}`);

// Graceful shutdown untuk cron job
process.on('SIGINT', () => {
  console.log('\n🛑 Gracefully shutting down cron job...');
  bookingCronJob.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Gracefully shutting down cron job...');
  bookingCronJob.stop();
  process.exit(0);
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
  // Cron job management endpoints
  .get('/cron/status', () => {
    try {
      const status = bookingCronJob.getStatus();
      return {
        success: true,
        cronTime: cronTime,
        mainServiceUrl: mainServiceUrl,
        status: status,
        timezone: 'Asia/Jakarta',
        nextRun: 'Check cron schedule for next execution'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to get cron status'
      };
    }
  })
  .post('/cron/trigger', async () => {
    const result = await executeBookingProcess('whatsapp-backend-manual-trigger');
    
    if (result.success) {
      return {
        success: true,
        message: 'Booking process triggered successfully',
        result: result.result
      };
    } else {
      return {
        success: false,
        message: 'Booking process failed',
        error: result.error,
        status: result.status
      };
    }
  })
  .post('/cron/test', async () => {
    console.log('🧪 [TEST CRON] Setting up test cron job for 1 minutes from now...');
    
    try {
      // Calculate time 1 minutes from now
      const oneMinutesFromNow = new Date(Date.now() + 1 * 60 * 1000);
      const testCronTime = `${oneMinutesFromNow.getMinutes()} ${oneMinutesFromNow.getHours()} * * *`;
      
      console.log(`⏰ Test cron scheduled for: ${oneMinutesFromNow.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
      console.log(`📅 Cron expression: ${testCronTime}`);
      
      // Create test cron job
      const testCronJob = cron.schedule(testCronTime, async () => {
        console.log('🎯 [TEST CRON] Executing test booking process...');
        await executeBookingProcess('whatsapp-backend-test-cron');
        
        // Stop the test cron after execution
        testCronJob.stop();
        console.log('🛑 [TEST CRON] Test cron job stopped after execution');
      }, {
        timezone: 'Asia/Jakarta'
      });
      
      // Start the test cron job
      testCronJob.start();
      
      return {
        success: true,
        message: 'Test cron job created successfully',
        scheduledFor: oneMinutesFromNow.toISOString(),
        cronExpression: testCronTime,
        localTime: oneMinutesFromNow.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
        note: 'Cron job will execute once in 1 minutes and then stop automatically'
      };
    } catch (error) {
      console.error('💥 [TEST CRON] Error creating test cron:', error);
      return {
        success: false,
        message: 'Failed to create test cron job',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  })
  .listen(8080, ({ hostname, port }) => {
    // Aktifkan domain untuk debugging
    process.env.DEBUG = 'queues,*';
    console.log(`🦊 Server is running at ${hostname}:${port}`);
    console.log('🔄 WhatsApp message queue initialized with random delay (2-4 seconds)');
  });

console.log('CORS enabled for all origins (*)');
console.log('WhatsApp client initializing...')