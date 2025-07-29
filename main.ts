import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { staticPlugin } from '@elysiajs/static';
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
import { bookingReminderService } from './utils/booking-reminder';
import { cronManager } from './utils/cron-manager';

// Set default API secret key jika tidak ada di environment
if (!process.env.API_SECRET_KEY) {
  process.env.API_SECRET_KEY = 'gaadakey';
  console.log('API_SECRET_KEY not found in environment, using default value');
}

// Set default BACKEND_API_KEY for frontend communications
if (!process.env.BACKEND_API_KEY) {
  process.env.BACKEND_API_KEY = 'gaadakey';
  console.log('BACKEND_API_KEY not found in environment, using default value');
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
  .use(staticPlugin({
    assets: 'public',
    prefix: '/uploads'
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
  // File Upload Endpoint
  .post('/api/upload', async ({ body, headers, request }) => {
    try {
      // Verify authorization
      const authHeader = headers.authorization;
      const expectedKey = process.env.BACKEND_API_KEY || 'gaadakey';
      
      if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
        return {
          success: false,
          error: 'Unauthorized'
        };
      }

      // Parse FormData from request
      const formData = await request.formData();
      const fileEntry = formData.get('file');
      
      if (!fileEntry || typeof fileEntry === 'string') {
        return {
          success: false,
          error: 'No file provided'
        };
      }
      
      const file = fileEntry as unknown as File;

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        return {
          success: false,
          error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed.'
        };
      }

      // Validate file size (max 5MB)
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (file.size > maxSize) {
        return {
          success: false,
          error: 'File too large. Maximum size is 5MB.'
        };
      }

      // Generate unique filename
      const timestamp = Date.now();
      const extension = file.name.split('.').pop();
      const filename = `room_${timestamp}.${extension}`;
      const filepath = `./public/uploads/${filename}`;

      // Save file
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      await Bun.write(filepath, buffer);
      
      // Return URL
      const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
      const fileUrl = `${baseUrl}/uploads/${filename}`;
      
      console.log(`📷 Image uploaded: ${filename}`);
      
      return {
        success: true,
        message: 'File uploaded successfully',
        filename: filename,
        url: fileUrl
      };

    } catch (error: any) {
      console.error('Error uploading file:', error);
      return {
        success: false,
        error: 'Failed to upload file',
        message: error.message || 'Unknown error'
      };
    }
  })
  .post('/reminder/send', async ({ body }) => {
    const { phoneNumber, message } = body as any;
    
    if (!phoneNumber || !message) {
      return {
        success: false,
        message: 'phoneNumber and message are required'
      };
    }

    try {
      // Add message to queue for consistent delivery
      const messageId = messageQueue.enqueue(phoneNumber, message);
      
      return {
        success: true,
        message: 'Reminder queued successfully',
        messageId: messageId,
        queuedFor: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error queueing reminder:', error);
      return {
        success: false,
        message: (error as Error).message || 'Failed to queue reminder'
      };
    }
  })
  .post('/api/whatsapp/send-reminder', async ({ body, headers }) => {
    // Verify authorization
    const authHeader = headers.authorization;
    const expectedKey = process.env.BACKEND_API_KEY || 'gaadakey';
    
    if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
      return {
        success: false,
        error: 'Unauthorized'
      };
    }

    const data = body as any;

    // Validate required fields
    if (!data.type || !data.tenant || !data.booking) {
      return {
        success: false,
        error: 'Missing required fields: type, tenant, booking are required'
      };
    }

    try {
      let message = '';
      
      // Generate message based on type
      switch (data.type) {
        case 'contract_renewal_h15':
          message = generateH15Message(data);
          break;
        
        case 'payment_reminder_h1':
          message = generateH1Message(data);
          break;
        
        default:
          return {
            success: false,
            error: 'Invalid reminder type'
          };
      }

      // Send WhatsApp message using the message queue for consistent delivery
      const messageId = messageQueue.enqueue(data.tenant.phone, message);
      
      console.log(`📱 Reminder queued for ${data.tenant.name} (${data.tenant.phone}) with ID: ${messageId}`);
      return {
        success: true,
        message: 'Reminder queued successfully',
        messageId: messageId,
        recipient: {
          name: data.tenant.name,
          phone: data.tenant.phone
        },
        type: data.type,
        queuedAt: new Date().toISOString()
      };

    } catch (error: any) {
      console.error('Error sending reminder:', error);
      return {
        success: false,
        error: 'Failed to send reminder',
        message: error.message || 'Unknown error'
      };
    }
  })
  // Get bookings for a specific user (proxy to frontend)
  .get('/api/bookings/user/:userId', async ({ params }) => {
    try {
      const { userId } = params;

      if (!userId) {
        return {
          success: false,
          error: 'User ID is required'
        };
      }

      console.log(`🔍 API: Proxying booking request for user: ${userId}`);
      
      // Proxy request to frontend API
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const response = await fetch(`${frontendUrl}/api/bookings?userId=${userId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch from frontend');
      }
      
      const result = await response.json() as any;
      return {
        success: true,
        bookings: result.bookings || []
      };
    } catch (error: any) {
      console.error('Error proxying user bookings:', error);
      return {
        success: false,
        error: 'Failed to fetch user bookings',
        message: error.message || 'Unknown error'
      };
    }
  })
  // New H-15 Booking Reminder Endpoint (simplified for all booking types)
  .post('/api/cron/h15-reminders', async ({ headers }) => {
    // Verify authorization
    const authHeader = headers.authorization;
    const expectedKey = process.env.BACKEND_API_KEY || 'gaadakey';
    
    if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
      return {
        success: false,
        error: 'Unauthorized'
      };
    }

    try {
      console.log('🔄 Running H-15 reminder check for all booking types...');
      
      // Use our new dedicated booking reminder service
      await cronManager.runManually('booking-reminder-check');
      
      return {
        success: true,
        message: 'H-15 reminder check completed successfully',
        executedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Error in H-15 reminder check:', error);
      return {
        success: false,
        error: 'Failed to process H-15 reminders',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  })
  // Cron endpoint to check and send reminders based on duration type
  .post('/api/cron/check-reminders', async ({ body, headers }) => {
    try {
      // Verify authorization
      const authHeader = headers.authorization;
      const expectedKey = process.env.BACKEND_API_KEY || 'gaadakey';
      
      if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
        return {
          success: false,
          error: 'Unauthorized'
        };
      }

      const { reminderSchedule } = body as any;
      console.log('🔄 Processing automated reminders...', reminderSchedule);

      let totalProcessed = 0;
      let totalSent = 0;
      let totalErrors = 0;
      const details: any[] = [];

      // Get all active bookings from frontend
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const bookingsResponse = await fetch(`${frontendUrl}/api/bookings`);
      
      if (!bookingsResponse.ok) {
        throw new Error('Failed to fetch bookings from frontend');
      }
      
      const bookingsResult = await bookingsResponse.json() as any;
      const allBookings = bookingsResult.bookings || [];
      
      for (const schedule of reminderSchedule) {
        console.log(`📅 Processing ${schedule.durationType} reminders (H-${schedule.daysBefore})...`);
        
        // Filter bookings by duration type and check expiry date
        const now = new Date();
        const targetDate = new Date();
        targetDate.setDate(now.getDate() + schedule.daysBefore);
        
        const expiringBookings = allBookings.filter((booking: any) => {
          // Check if booking matches duration type
          const matchesDurationType = booking.rentalPeriod?.durationType === schedule.durationType;
          
          // Check if booking expires on target date (within 24 hours)
          const endDate = new Date(booking.rentalPeriod?.endDate);
          const timeDiff = Math.abs(endDate.getTime() - targetDate.getTime());
          const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
          const isExpiring = daysDiff <= 1; // Within 1 day of target
          
          // Only send reminders for approved bookings
          const isActive = booking.rentalStatus === 'APPROVED';
          
          return matchesDurationType && isExpiring && isActive;
        });

        console.log(`📊 Found ${expiringBookings.length} ${schedule.durationType} bookings expiring in ${schedule.daysBefore} days`);

        for (const booking of expiringBookings) {
          totalProcessed++;
          
          try {
            if (!booking.contactInfo?.phone && !booking.contactInfo?.whatsapp) {
              console.warn(`⚠️ No phone number found for booking ${booking.id}`);
              totalErrors++;
              continue;
            }

            const phoneNumber = booking.contactInfo.whatsapp || booking.contactInfo.phone;
            const tenantName = booking.contactInfo.name;

            // Generate reminder message based on duration type
            const message = generateReminderMessage({
              booking,
              tenantName,
              durationType: schedule.durationType,
              daysRemaining: schedule.daysBefore
            });

            // Send WhatsApp message using the message queue
            const messageId = messageQueue.enqueue(phoneNumber, message);
            totalSent++;

            details.push({
              bookingId: booking.id,
              tenantName: tenantName,
              phone: phoneNumber,
              durationType: schedule.durationType,
              daysRemaining: schedule.daysBefore,
              status: 'queued',
              messageId: messageId
            });

            console.log(`📱 Reminder queued for ${tenantName} (${phoneNumber}) - Booking: ${booking.id}`);

          } catch (error) {
            totalErrors++;
            console.error(`❌ Error processing booking ${booking.id}:`, error);
            
            details.push({
              bookingId: booking.id,
              tenantName: booking.contactInfo?.name || 'Unknown',
              durationType: schedule.durationType,
              daysRemaining: schedule.daysBefore,
              status: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      }

      console.log(`✅ Reminder cron job completed. Processed: ${totalProcessed}, Sent: ${totalSent}, Errors: ${totalErrors}`);

      return {
        success: true,
        message: 'Reminder check completed successfully',
        processed: totalProcessed,
        sent: totalSent,
        errors: totalErrors,
        details: details
      };

    } catch (error: any) {
      console.error('Error in cron reminder check:', error);
      return {
        success: false,
        error: 'Failed to process reminders',
        message: error.message || 'Unknown error'
      };
    }
  })
  // Cron Management Endpoints
  .get('/api/cron/status', async ({ headers }) => {
    // Verify authorization
    const authHeader = headers.authorization;
    const expectedKey = process.env.BACKEND_API_KEY || 'gaadakey';
    
    if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
      return {
        success: false,
        error: 'Unauthorized'
      };
    }

    try {
      const jobs = cronManager.getJobs();
      
      return {
        success: true,
        message: 'Cron status retrieved successfully',
        jobs: jobs,
        totalJobs: jobs.length,
        serviceInitialized: true
      };
    } catch (error) {
      console.error('Error getting cron status:', error);
      return {
        success: false,
        error: 'Failed to get cron status'
      };
    }
  })
  .post('/api/cron/test-reminders', async ({ headers }) => {
    // Verify authorization
    const authHeader = headers.authorization;
    const expectedKey = process.env.BACKEND_API_KEY || 'gaadakey';
    
    if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
      return {
        success: false,
        error: 'Unauthorized'
      };
    }

    try {
      console.log('🧪 Running test reminders manually...');
      const result = await bookingReminderService.sendTestReminders();
      
      return {
        ...result,
        message: result.success ? 'Test reminders executed successfully' : result.message
      };
    } catch (error) {
      console.error('Error in test reminders:', error);
      return {
        success: false,
        error: 'Failed to run test reminders',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  })
  .post('/api/cron/run-job', async ({ body, headers }) => {
    // Verify authorization
    const authHeader = headers.authorization;
    const expectedKey = process.env.BACKEND_API_KEY || 'gaadakey';
    
    if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
      return {
        success: false,
        error: 'Unauthorized'
      };
    }

    const { jobName } = body as any;
    
    if (!jobName) {
      return {
        success: false,
        error: 'Job name is required'
      };
    }

    try {
      await cronManager.runManually(jobName);
      
      return {
        success: true,
        message: `Job ${jobName} executed manually`,
        jobName: jobName,
        executedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error(`Error running job ${jobName}:`, error);
      return {
        success: false,
        error: `Failed to run job: ${jobName}`,
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  })
  .post('/api/cron/stop-all', async ({ headers }) => {
    // Verify authorization
    const authHeader = headers.authorization;
    const expectedKey = process.env.BACKEND_API_KEY || 'gaadakey';
    
    if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
      return {
        success: false,
        error: 'Unauthorized'
      };
    }

    try {
      cronManager.stopAll();
      
      return {
        success: true,
        message: 'All cron jobs stopped successfully'
      };
    } catch (error) {
      console.error('Error stopping cron jobs:', error);
      return {
        success: false,
        error: 'Failed to stop cron jobs'
      };
    }
  })
  // Upload document for booking
  .post('/api/admin/bookings/upload-document', async ({ body, headers, request }) => {
    try {
      // Verify authorization
      const authHeader = headers.authorization;
      const expectedKey = process.env.BACKEND_API_KEY || 'gaadakey';
      
      if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
        return {
          success: false,
          error: 'Unauthorized'
        };
      }

      // Parse FormData
      const formData = await request.formData();
      const fileEntry = formData.get('file');
      const bookingId = formData.get('bookingId') as string;
      const documentType = formData.get('documentType') as string;
      
      if (!fileEntry || typeof fileEntry === 'string') {
        return {
          success: false,
          error: 'No file provided'
        };
      }
      
      const file = fileEntry as unknown as File;

      if (!bookingId || !documentType) {
        return {
          success: false,
          error: 'Missing bookingId or documentType'
        };
      }

      // Validate document type
      const allowedTypes = ['BOOKING_SLIP', 'RECEIPT', 'SOP', 'INVOICE'];
      if (!allowedTypes.includes(documentType)) {
        return {
          success: false,
          error: `Invalid document type. Allowed: ${allowedTypes.join(', ')}`
        };
      }

      // Get booking to verify it exists (from frontend)
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const bookingResponse = await fetch(`${frontendUrl}/api/bookings/${bookingId}`);
      
      if (!bookingResponse.ok) {
        return {
          success: false,
          error: 'Booking not found'
        };
      }
      
      const bookingResult = await bookingResponse.json() as any;
      const booking = bookingResult.booking;

      // Create filename with timestamp
      const timestamp = Date.now();
      const fileExtension = file.name.split('.').pop();
      const fileName = `${bookingId}_${documentType}_${timestamp}.${fileExtension}`;
      
      // Save file to uploads directory
      const uploadDir = 'public/uploads/documents';
      const filePath = `${uploadDir}/${fileName}`;
      
      try {
        // Create directory if it doesn't exist
        await Bun.write(filePath, file);
        
        // Create document object
        const document = {
          id: `doc_${timestamp}`,
          type: documentType as 'BOOKING_SLIP' | 'RECEIPT' | 'SOP' | 'INVOICE',
          fileName: file.name,
          fileUrl: `/uploads/documents/${fileName}`,
          createdAt: new Date()
        };

        // Update booking with new document (via frontend API)
        const updatedDocuments = booking.documents ? [...booking.documents, document] : [document];
        
        const updateResponse = await fetch(`${frontendUrl}/api/bookings/${bookingId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            documents: updatedDocuments
          })
        });

        if (!updateResponse.ok) {
          console.error('Failed to update booking via frontend');
          // Continue anyway since file was saved
        }

        console.log(`📄 Document uploaded for booking ${bookingId}: ${documentType}`);

        return {
          success: true,
          message: 'Document uploaded successfully',
          document: document
        };

      } catch (fileError) {
        console.error('Error saving file:', fileError);
        return {
          success: false,
          error: 'Failed to save file'
        };
      }

    } catch (error: any) {
      console.error('Error uploading document:', error);
      return {
        success: false,
        error: 'Failed to upload document',
        message: error.message || 'Unknown error'
      };
    }
  })
  .listen(8080, ({ hostname, port }) => {
    // Aktifkan domain untuk debugging
    process.env.DEBUG = 'queues,*';
    console.log(`🦊 Server is running at ${hostname}:${port}`);
    console.log('🔄 WhatsApp message queue initialized with random delay (2-4 seconds)');
    
    // Initialize booking reminder service
    try {
      bookingReminderService.init();
      console.log('✅ Booking reminder cron service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize booking reminder service:', error);
    }
  });

console.log('CORS enabled for all origins (*)');
console.log('WhatsApp client initializing...');

// Helper functions for generating reminder messages
function generateH15Message(data: any): string {
  const checkOutDate = new Date(data.booking.checkOut).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const monthlyAmount = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(data.booking.monthlyAmount);

  return `🏠 *SUMAN RESIDENCE* 🏠

Halo ${data.tenant.name}!

⏰ *KONFIRMASI PERPANJANGAN KONTRAK*

Kontrak sewa Anda akan berakhir dalam *15 hari* pada tanggal *${checkOutDate}*.

📋 *Detail Kontrak:*
• Room ID: ${data.booking.roomId}
• Biaya Bulanan: ${monthlyAmount}
• Berakhir: ${checkOutDate}

❓ *Apakah Anda ingin memperpanjang sewa?*

✅ *Jika YA:*
- Reply pesan ini dengan "YA PERPANJANG"
- Tim kami akan kirimkan invoice pembayaran
- Lakukan pembayaran sebelum tanggal berakhir

❌ *Jika TIDAK:*
- Reply dengan "TIDAK PERPANJANG"
- Siapkan untuk check-out

📞 *Butuh bantuan?*
Hubungi admin: wa.me/6281234567890

Terima kasih! 🙏`;
}

function generateH1Message(data: any): string {
  const checkOutDate = new Date(data.booking.checkOut).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const monthlyAmount = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(data.booking.monthlyAmount);

  return `🏠 *SUMAN RESIDENCE* 🏠

Halo ${data.tenant.name}!

⚠️ *REMINDER PEMBAYARAN URGENT* ⚠️

Kontrak sewa Anda akan berakhir *BESOK* tanggal *${checkOutDate}*.

💰 *BELUM LUNAS?*
Segera lakukan pembayaran untuk perpanjangan:

💳 *Detail Pembayaran:*
• Room ID: ${data.booking.roomId}
• Jumlah: ${monthlyAmount}
• Deadline: ${checkOutDate}

🏦 *Transfer ke:*
BCA: 1234567890
A/N: SUMAN RESIDENCE

📤 *Setelah Transfer:*
1. Screenshot bukti transfer
2. Kirim ke admin: wa.me/6281234567890
3. Cantumkan Room ID: ${data.booking.roomId}

⏰ *PENTING:*
Jika tidak ada konfirmasi pembayaran sampai ${checkOutDate}, kontrak akan berakhir otomatis.

📞 Admin: wa.me/6281234567890`;
}

// Generate reminder message based on duration type and days remaining
function generateReminderMessage(data: {
  booking: any;
  tenantName: string;
  durationType: string;
  daysRemaining: number;
}): string {
  const endDate = new Date(data.booking.rentalPeriod.endDate).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const roomInfo = data.booking.room?.roomNumber || data.booking.room?.id || 'N/A';
  
  // Note: Price management removed from system

  // Get duration label in Indonesian
  const durationLabel = {
    'WEEKLY': 'Mingguan',
    'MONTHLY': 'Bulanan', 
    'SEMESTER': 'Semester',
    'YEARLY': 'Tahunan'
  }[data.durationType] || data.durationType;

  let urgencyLevel = '';
  let actionText = '';
  
  if (data.daysRemaining === 1) {
    urgencyLevel = '🚨 *URGENT - BESOK BERAKHIR* 🚨';
    actionText = 'Segera konfirmasi perpanjangan atau siapkan untuk check-out!';
  } else if (data.daysRemaining <= 7) {
    urgencyLevel = '⚠️ *PENTING* ⚠️';
    actionText = 'Mohon konfirmasi rencana perpanjangan sewa Anda.';
  } else {
    urgencyLevel = '📅 *REMINDER* 📅';
    actionText = 'Mohon konfirmasi apakah Anda ingin memperpanjang sewa.';
  }

  return `🏠 *SUMAN RESIDENCE* 🏠

Halo ${data.tenantName}!

${urgencyLevel}

Kontrak sewa ${durationLabel} Anda akan berakhir dalam *${data.daysRemaining} hari* pada tanggal *${endDate}*.

📋 *Detail Kontrak:*
• Kamar: ${roomInfo}
• Tipe Sewa: ${durationLabel}
• Berakhir: ${endDate}

💡 ${actionText}

✅ *Jika ingin PERPANJANG:*
- Reply "YA PERPANJANG"
- Tim akan kirim invoice pembayaran
- Lakukan pembayaran sebelum tanggal berakhir

❌ *Jika TIDAK perpanjang:*
- Reply "TIDAK PERPANJANG"
- Siapkan untuk check-out pada ${endDate}

📞 *Butuh bantuan?*
Hubungi admin: wa.me/6281234567890

Terima kasih! 🙏

---
📝 Booking ID: ${data.booking.id}`;
}