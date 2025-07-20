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
import { getAllRooms, getRoomById, createRoom, updateRoom, deleteRoom } from './repositories/room.repository';
import { getAllBookings, getBookingById, getBookingsByUserId, createBooking, updateBooking, deleteBooking } from './repositories/booking.repository';

// Set default API secret key jika tidak ada di environment
if (!process.env.API_SECRET_KEY) {
  process.env.API_SECRET_KEY = 'gaadakey';
  console.log('API_SECRET_KEY not found in environment, using default value');
}

// Set default BACKEND_API_KEY for frontend communications
if (!process.env.KEY) {
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
  // Rooms Management Endpoints
  .get('/api/rooms', async () => {
    try {
      const rooms = await getAllRooms();
      
      return {
        success: true,
        rooms: rooms
      };
    } catch (error: any) {
      console.error('Error fetching rooms:', error);
      return {
        success: false,
        error: 'Failed to fetch rooms',
        message: error.message || 'Unknown error'
      };
    }
  })
  .get('/api/rooms/:id', async ({ params }) => {
    try {
      const { id } = params;
      
      const room = await getRoomById(id);
      
      if (!room) {
        return {
          success: false,
          room: null,
          message: 'Room not found'
        };
      }
      
      return {
        success: true,
        room: room
      };
    } catch (error: any) {
      console.error('Error fetching room:', error);
      return {
        success: false,
        error: 'Failed to fetch room',
        message: error.message || 'Unknown error'
      };
    }
  })
  .post('/api/admin/rooms', async ({ body, headers }) => {
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

      const roomData = body as any;

      // Validate required fields
      if (!roomData.name || !roomData.monthlyPrice || !roomData.size) {
        return {
          success: false,
          error: 'Missing required fields: name, monthlyPrice, size'
        };
      }

      // Prepare room data for Firestore
      const newRoomData = {
        name: roomData.name,
        status: 'Available' as const,
        type: roomData.type || 'Standard',
        price: roomData.monthlyPrice, // For compatibility
        monthlyPrice: roomData.monthlyPrice,
        pricing: roomData.pricing || {
          weekly: Math.round(roomData.monthlyPrice * 0.3),
          monthly: roomData.monthlyPrice,
          semester: Math.round(roomData.monthlyPrice * 5.5), // 6 months with discount
          yearly: Math.round(roomData.monthlyPrice * 10) // 12 months with discount
        },
        description: roomData.description || '',
        facilities: roomData.facilities || [],
        images: roomData.images || [],
        maxOccupancy: roomData.maxOccupancy || 1,
        size: roomData.size
      };

      // Create room in Firestore
      const roomId = await createRoom(newRoomData);
      
      // Fetch the created room to return complete data
      const createdRoom = await getRoomById(roomId);
      
      return {
        success: true,
        message: 'Room created successfully',
        roomId: roomId,
        room: createdRoom
      };

    } catch (error: any) {
      console.error('Error creating room:', error);
      return {
        success: false,
        error: 'Failed to create room',
        message: error.message || 'Unknown error'
      };
    }
  })
  .delete('/api/admin/rooms/:id', async ({ params, headers }) => {
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

      const { id } = params;
      
      // Check if room exists
      const existingRoom = await getRoomById(id);
      if (!existingRoom) {
        return {
          success: false,
          error: 'Room not found'
        };
      }
      
      // Delete room from Firestore
      await deleteRoom(id);
      
      return {
        success: true,
        message: 'Room deleted successfully'
      };

    } catch (error: any) {
      console.error('Error deleting room:', error);
      return {
        success: false,
        error: 'Failed to delete room',
        message: error.message || 'Unknown error'
      };
    }
  })
  .put('/api/admin/rooms/:id', async ({ params, body, headers }) => {
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

      const { id } = params;
      const updateData = body as any;
      
      // Check if room exists
      const existingRoom = await getRoomById(id);
      if (!existingRoom) {
        return {
          success: false,
          error: 'Room not found'
        };
      }
      
      // Prepare update data
      const dataToUpdate: any = {
        ...(updateData.name && { name: updateData.name }),
        ...(updateData.description && { description: updateData.description }),
        ...(updateData.facilities && { facilities: updateData.facilities }),
        ...(updateData.images && { images: updateData.images }),
        ...(updateData.maxOccupancy && { maxOccupancy: updateData.maxOccupancy }),
        ...(updateData.size && { size: updateData.size }),
        ...(updateData.type && { type: updateData.type }),
        ...(updateData.status && { status: updateData.status })
      };

      // Handle pricing structure
      if (updateData.monthlyPrice) {
        dataToUpdate.monthlyPrice = updateData.monthlyPrice;
        dataToUpdate.price = updateData.monthlyPrice; // For compatibility
        
        // Update or generate pricing structure
        if (updateData.pricing) {
          dataToUpdate.pricing = updateData.pricing;
        } else {
          dataToUpdate.pricing = {
            weekly: Math.round(updateData.monthlyPrice * 0.3),
            monthly: updateData.monthlyPrice,
            semester: Math.round(updateData.monthlyPrice * 5.5), // 6 months with discount
            yearly: Math.round(updateData.monthlyPrice * 10) // 12 months with discount
          };
        }
      } else if (updateData.pricing) {
        dataToUpdate.pricing = updateData.pricing;
      }
      
      // Update room in Firestore
      await updateRoom(id, dataToUpdate);
      
      // Fetch updated room to return complete data
      const updatedRoom = await getRoomById(id);
      
      return {
        success: true,
        message: 'Room updated successfully',
        room: updatedRoom
      };

    } catch (error: any) {
      console.error('Error updating room:', error);
      return {
        success: false,
        error: 'Failed to update room',
        message: error.message || 'Unknown error'
      };
    }
  })
  // Booking Management Endpoints
  .get('/api/bookings', async ({ query, headers }) => {
    try {
      // Verify authorization for admin
      const authHeader = headers.authorization;
      const expectedKey = process.env.BACKEND_API_KEY || 'gaadakey';
      
      if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
        return {
          success: false,
          error: 'Unauthorized'
        };
      }

      const { userId } = query;

      let bookings;
      if (userId) {
        // Get bookings for specific user
        bookings = await getBookingsByUserId(userId as string);
      } else {
        // Get all bookings (admin only)
        bookings = await getAllBookings();
      }
      
      return {
        success: true,
        bookings: bookings
      };
    } catch (error: any) {
      console.error('Error fetching bookings:', error);
      return {
        success: false,
        error: 'Failed to fetch bookings',
        message: error.message || 'Unknown error'
      };
    }
  })
  .get('/api/bookings/:id', async ({ params }) => {
    try {
      const { id } = params;
      
      const booking = await getBookingById(id);
      
      if (!booking) {
        return {
          success: false,
          booking: null,
          message: 'Booking not found'
        };
      }
      
      return {
        success: true,
        booking: booking
      };
    } catch (error: any) {
      console.error('Error fetching booking:', error);
      return {
        success: false,
        error: 'Failed to fetch booking',
        message: error.message || 'Unknown error'
      };
    }
  })
  .post('/api/bookings', async ({ body }) => {
    try {
      const bookingData = body as any;

      // Validate required fields
      if (!bookingData.room || !bookingData.rentalPeriod || !bookingData.contactInfo) {
        return {
          success: false,
          error: 'Missing required fields: room, rentalPeriod, contactInfo are required'
        };
      }

      // Prepare booking data for Firestore
      const newBookingData = {
        userId: bookingData.userId || 'guest',
        room: {
          id: bookingData.room.id,
          roomNumber: bookingData.room.roomNumber || bookingData.room.name,
          type: bookingData.room.type || 'Standard',
          floor: bookingData.room.floor || 1,
          size: bookingData.room.size || 'Standard',
          description: bookingData.room.description || '',
          facilities: bookingData.room.facilities || [],
          imagesGallery: bookingData.room.images || bookingData.room.imagesGallery || []
        },
        rentalStatus: 'PENDING' as const,
        rentalPeriod: {
          startDate: new Date(bookingData.rentalPeriod.startDate),
          endDate: new Date(bookingData.rentalPeriod.endDate),
          durationType: bookingData.rentalPeriod.durationType || 'MONTHLY'
        },
        documents: [],
        notes: bookingData.notes || '',
        contactInfo: {
          name: bookingData.contactInfo.name,
          email: bookingData.contactInfo.email,
          phone: bookingData.contactInfo.phone,
          whatsapp: bookingData.contactInfo.whatsapp || bookingData.contactInfo.phone
        }
      };

      // Create booking in Firestore
      const bookingId = await createBooking(newBookingData);
      
      console.log(`📋 New booking created: ${bookingId} for user ${bookingData.userId}`);
      
      // Fetch the created booking to return complete data
      const createdBooking = await getBookingById(bookingId);
      
      return {
        success: true,
        message: 'Booking created successfully',
        bookingId: bookingId,
        booking: createdBooking
      };

    } catch (error: any) {
      console.error('Error creating booking:', error);
      return {
        success: false,
        error: 'Failed to create booking',
        message: error.message || 'Unknown error'
      };
    }
  })
  .post('/api/admin/bookings/:id/action', async ({ params, body, headers }) => {
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

      const { id } = params;
      const { action } = body as any;
      
      if (!action || !['approve', 'reject', 'confirm'].includes(action)) {
        return {
          success: false,
          error: 'Invalid action. Must be: approve, reject, or confirm'
        };
      }

      // Get current booking
      const booking = await getBookingById(id);
      if (!booking) {
        return {
          success: false,
          error: 'Booking not found'
        };
      }

      let newStatus: 'PENDING' | 'SETUJUI' | 'CANCEL';
      let statusMessage: string;

      switch (action) {
        case 'approve':
          if (booking.rentalStatus !== 'PENDING') {
            return {
              success: false,
              error: 'Only pending bookings can be approved'
            };
          }
          newStatus = 'SETUJUI';
          statusMessage = 'approved';
          break;

        case 'reject':
        case 'cancel':
          newStatus = 'CANCEL';
          statusMessage = action === 'reject' ? 'rejected' : 'cancelled';
          break;

        default:
          return {
            success: false,
            error: 'Invalid action. Use: approve, reject, or cancel'
          };
      }

      // Update booking status
      await updateBooking(id, {
        rentalStatus: newStatus,
        updatedAt: new Date()
      });

      // Fetch updated booking
      const updatedBooking = await getBookingById(id);

      console.log(`📋 Booking ${id} ${statusMessage} by admin`);

      return {
        success: true,
        booking: updatedBooking,
        message: `Booking ${statusMessage} successfully`
      };

    } catch (error: any) {
      console.error('Error updating booking status:', error);
      return {
        success: false,
        error: 'Failed to update booking status',
        message: error.message || 'Unknown error'
      };
    }
  })
  .put('/api/admin/bookings/:id', async ({ params, body, headers }) => {
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

      const { id } = params;
      const updateData = body as any;
      
      // Check if booking exists
      const existingBooking = await getBookingById(id);
      if (!existingBooking) {
        return {
          success: false,
          error: 'Booking not found'
        };
      }
      
      // Prepare update data
      const dataToUpdate: any = {};
      
      if (updateData.rentalStatus) dataToUpdate.rentalStatus = updateData.rentalStatus;
      if (updateData.notes !== undefined) dataToUpdate.notes = updateData.notes;
      
      if (updateData.rentalPeriod) {
        dataToUpdate.rentalPeriod = {
          startDate: new Date(updateData.rentalPeriod.startDate),
          endDate: new Date(updateData.rentalPeriod.endDate),
          durationType: updateData.rentalPeriod.durationType
        };
      }

      if (updateData.documents) {
        dataToUpdate.documents = updateData.documents.map((doc: any) => ({
          ...doc,
          createdAt: new Date(doc.createdAt || Date.now())
        }));
      }
      
      // Update booking in Firestore
      await updateBooking(id, dataToUpdate);
      
      // Fetch updated booking to return complete data
      const updatedBooking = await getBookingById(id);
      
      return {
        success: true,
        message: 'Booking updated successfully',
        booking: updatedBooking
      };

    } catch (error: any) {
      console.error('Error updating booking:', error);
      return {
        success: false,
        error: 'Failed to update booking',
        message: error.message || 'Unknown error'
      };
    }
  })
  .delete('/api/admin/bookings/:id', async ({ params, headers }) => {
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

      const { id } = params;
      
      // Check if booking exists
      const existingBooking = await getBookingById(id);
      if (!existingBooking) {
        return {
          success: false,
          error: 'Booking not found'
        };
      }
      
      // Delete booking from Firestore
      await deleteBooking(id);
      
      return {
        success: true,
        message: 'Booking deleted successfully'
      };

    } catch (error: any) {
      console.error('Error deleting booking:', error);
      return {
        success: false,
        error: 'Failed to delete booking',
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
  // Get bookings for a specific user (public endpoint for user dashboard)
  .get('/api/bookings/user/:userId', async ({ params }) => {
    try {
      const { userId } = params;

      if (!userId) {
        return {
          success: false,
          error: 'User ID is required'
        };
      }

      console.log(`🔍 API: Fetching bookings for user: ${userId}`);
      const bookings = await getBookingsByUserId(userId);
      
      return {
        success: true,
        bookings: bookings
      };
    } catch (error: any) {
      console.error('Error fetching user bookings:', error);
      return {
        success: false,
        error: 'Failed to fetch user bookings',
        message: error.message || 'Unknown error'
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

      // Get all active bookings
      const allBookings = await getAllBookings();
      
      for (const schedule of reminderSchedule) {
        console.log(`📅 Processing ${schedule.durationType} reminders (H-${schedule.daysBefore})...`);
        
        // Filter bookings by duration type and check expiry date
        const now = new Date();
        const targetDate = new Date();
        targetDate.setDate(now.getDate() + schedule.daysBefore);
        
        const expiringBookings = allBookings.filter(booking => {
          // Check if booking matches duration type
          const matchesDurationType = booking.rentalPeriod?.durationType === schedule.durationType;
          
          // Check if booking expires on target date (within 24 hours)
          const endDate = new Date(booking.rentalPeriod?.endDate);
          const timeDiff = Math.abs(endDate.getTime() - targetDate.getTime());
          const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
          const isExpiring = daysDiff <= 1; // Within 1 day of target
          
          // Only send reminders for approved bookings
          const isActive = booking.rentalStatus === 'SETUJUI';
          
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

      // Get booking to verify it exists
      const booking = await getBookingById(bookingId);
      if (!booking) {
        return {
          success: false,
          error: 'Booking not found'
        };
      }

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

        // Update booking with new document
        const updatedDocuments = booking.documents ? [...booking.documents, document] : [document];
        
        await updateBooking(bookingId, {
          documents: updatedDocuments
        });

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