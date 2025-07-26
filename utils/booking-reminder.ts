import { cronManager } from './cron-manager';

export interface BookingReminderData {
  bookingId: string;
  userId: string;
  phoneNumber: string;
  roomType: string;
  orderType: 'WEEKLY' | 'MONTHLY' | 'SEMESTER' | 'YEARLY';
  startDate: Date;
  endDate: Date;
  amount: number;
  customerName: string;
}

interface ReminderStats {
  h15Count: number;
  h1Count: number;
  successful: number;
  failed: number;
  details: string[];
}

export class BookingReminderService {
  private isInitialized = false;
  private sentReminders = new Set<string>(); // Track sent reminders to avoid duplicates
  private stats: ReminderStats = {
    h15Count: 0,
    h1Count: 0,
    successful: 0,
    failed: 0,
    details: []
  };

  /**
   * Initialize the reminder service and start cron jobs
   */
  init() {
    if (this.isInitialized) {
      console.log('📅 Booking reminder service already initialized');
      return;
    }

    console.log('🚀 Initializing production booking reminder service...');

    // Initialize cron manager first
    cronManager.init();

    // Schedule H-15 reminder check (daily at 9:00 AM)
    cronManager.schedule(
      'booking-reminder-h15',
      '0 9 * * *', // Daily at 9:00 AM
      () => this.checkH15Reminders()
    );

    // Schedule H-1 reminder check (daily at 9:00 AM)  
    cronManager.schedule(
      'booking-reminder-h1',
      '0 9 * * *', // Daily at 9:00 AM
      () => this.checkH1Reminders()
    );

    // Clear stats daily at midnight
    cronManager.schedule(
      'booking-reminder-reset-stats',
      '0 0 * * *', // Daily at midnight
      () => this.resetDailyStats()
    );

    this.isInitialized = true;
    console.log('✅ Booking reminder service initialized with production cron jobs');
  }

  /**
   * Reset daily statistics at midnight
   */
  private async resetDailyStats() {
    console.log('🔄 Resetting daily reminder statistics...');
    this.stats = {
      h15Count: 0,
      h1Count: 0,
      successful: 0,
      failed: 0,
      details: []
    };
    // Clear sent reminders cache (optional - you might want to persist this)
    this.sentReminders.clear();
    console.log('✅ Daily stats reset completed');
  }

  /**
   * Check for H-15 reminders (15 days before expiry)
   */
  private async checkH15Reminders() {
    try {
      console.log('🔍 Checking for H-15 reminders (15 days before expiry)...');
      
      const bookings = await this.getBookingsExpiringSoon(15);
      
      if (bookings.length === 0) {
        console.log('📭 No H-15 reminders needed');
        return;
      }

      console.log(`📬 Found ${bookings.length} bookings needing H-15 reminders`);

      for (const booking of bookings) {
        const reminderKey = `h15-${booking.bookingId}`;
        
        if (!this.sentReminders.has(reminderKey)) {
          await this.sendReminderMessage(booking, 'H-15');
          this.sentReminders.add(reminderKey);
          this.stats.h15Count++;
        }
      }

      console.log('✅ H-15 reminder check completed');
    } catch (error) {
      console.error('❌ Error in H-15 reminder check:', error);
      this.stats.details.push(`H-15 check error: ${error}`);
    }
  }

  /**
   * Check for H-1 reminders (1 day before expiry)
   */
  private async checkH1Reminders() {
    try {
      console.log('🔍 Checking for H-1 reminders (1 day before expiry)...');
      
      const bookings = await this.getBookingsExpiringSoon(1);
      
      if (bookings.length === 0) {
        console.log('📭 No H-1 reminders needed');
        return;
      }

      console.log(`📬 Found ${bookings.length} bookings needing H-1 reminders`);

      for (const booking of bookings) {
        const reminderKey = `h1-${booking.bookingId}`;
        
        if (!this.sentReminders.has(reminderKey)) {
          await this.sendReminderMessage(booking, 'H-1');
          this.sentReminders.add(reminderKey);
          this.stats.h1Count++;
        }
      }

      console.log('✅ H-1 reminder check completed');
    } catch (error) {
      console.error('❌ Error in H-1 reminder check:', error);
      this.stats.details.push(`H-1 check error: ${error}`);
    }
  }

  /**
   * Combined method for manual triggers
   */
  async checkAndSendReminders() {
    console.log('🔍 Manual reminder check triggered...');
    
    const startTime = Date.now();
    const initialStats = { ...this.stats };

    try {
      // Run both H-15 and H-1 checks
      await Promise.all([
        this.checkH15Reminders(),
        this.checkH1Reminders()
      ]);

      const duration = Date.now() - startTime;
      const newH15 = this.stats.h15Count - initialStats.h15Count;
      const newH1 = this.stats.h1Count - initialStats.h1Count;

      console.log(`✅ Manual reminder check completed in ${duration}ms`);
      console.log(`📊 Results: H-15: ${newH15}, H-1: ${newH1}`);

      return {
        success: true,
        duration,
        summary: {
          h15Count: newH15,
          h1Count: newH1,
          successful: this.stats.successful - initialStats.successful,
          failed: this.stats.failed - initialStats.failed
        }
      };
    } catch (error) {
      console.error('❌ Error in manual reminder check:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get bookings that are expiring in specified days
   */
  private async getBookingsExpiringSoon(daysAhead: number = 15): Promise<BookingReminderData[]> {
    try {
      // For now, we'll use the frontend API to get bookings since Firebase is not configured
      // In production, you should set up Firebase Admin SDK properly
      
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      
      console.log(`🔍 Fetching bookings from frontend: ${frontendUrl}/api/bookings`);
      
      const response = await fetch(`${frontendUrl}/api/bookings`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch bookings: ${response.status}`);
      }
      
      const result = await response.json() as any;
      const allBookings = result.bookings || [];
      
      const now = new Date();
      const reminderDate = new Date();
      reminderDate.setDate(now.getDate() + daysAhead); // N days from now
      
      console.log(`🗓️ Looking for bookings expiring in ${daysAhead} days on: ${reminderDate.toISOString().split('T')[0]}`);

      const expiringSoonBookings: BookingReminderData[] = [];

      for (const booking of allBookings) {
        // Check if booking expires around reminder date (within 1 day)
        const endDate = new Date(booking.rentalPeriod?.endDate || booking.endDate);
        const timeDiff = Math.abs(endDate.getTime() - reminderDate.getTime());
        const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
        
        // Only process bookings expiring within 1 day of target and are active
        if (daysDiff <= 1 && booking.rentalStatus === 'APPROVED') {
          
          // Check if we already sent a reminder for this booking
          const reminderKey = `${daysAhead === 15 ? 'h15' : 'h1'}-${booking.id}`;
          if (this.sentReminders.has(reminderKey)) {
            console.log(`⏭️ Reminder already sent for booking: ${booking.id}`);
            continue;
          }

          const phoneNumber = booking.contactInfo?.whatsapp || booking.contactInfo?.phone;
          if (!phoneNumber) {
            console.log(`⚠️ No phone number for booking: ${booking.id}`);
            continue;
          }

          expiringSoonBookings.push({
            bookingId: booking.id,
            userId: booking.userId || 'unknown',
            phoneNumber: phoneNumber,
            roomType: booking.room?.type || booking.roomType || 'Unknown',
            orderType: booking.rentalPeriod?.durationType || 'MONTHLY',
            startDate: new Date(booking.rentalPeriod?.startDate || booking.startDate),
            endDate: endDate,
            amount: booking.totalAmount || 0,
            customerName: booking.contactInfo?.name || 'Customer'
          });
        }
      }

      console.log(`📊 Found ${expiringSoonBookings.length} bookings needing reminders`);
      return expiringSoonBookings;
    } catch (error) {
      console.error('❌ Error fetching expiring bookings:', error);
      return [];
    }
  }

  /**
   * Check if reminder has already been sent for this booking
   */
  private async hasReminderBeenSent(bookingId: string): Promise<boolean> {
    try {
      // Use in-memory cache for now - in production, use persistent storage
      return this.sentReminders.has(`h15-${bookingId}`) || this.sentReminders.has(`h1-${bookingId}`);
    } catch (error) {
      console.error('❌ Error checking reminder status:', error);
      return false;
    }
  }

  /**
   * Mark reminder as sent
   */
  private async markReminderAsSent(bookingId: string) {
    try {
      // For simplicity, we'll log this for now
      // In production, store this in Firebase or a proper database
      console.log(`✅ Marking reminder as sent for booking: ${bookingId}`);
      
      // You can implement file-based storage here if needed
    } catch (error) {
      console.error('❌ Error marking reminder as sent:', error);
    }
  }

  /**
   * Send reminder message via WhatsApp
   */
  private async sendReminderMessage(booking: BookingReminderData, reminderType: string = 'REMINDER') {
    try {
      console.log(`📱 Sending ${reminderType} reminder to ${booking.phoneNumber} for booking ${booking.bookingId}`);
      
      const message = this.formatReminderMessage(booking, reminderType);
      
      // Import message queue here to avoid circular imports
      const { messageQueue } = require('./message-queue');
      
      // Add message to queue
      await messageQueue.addMessage({
        to: booking.phoneNumber,
        message: message,
        type: 'booking-reminder'
      });

      // Mark reminder as sent
      await this.markReminderAsSent(booking.bookingId);
      this.stats.successful++;
      
      console.log(`✅ Reminder queued for ${booking.phoneNumber}`);
    } catch (error) {
      this.stats.failed++;
      this.stats.details.push(`Failed to send reminder for ${booking.bookingId}: ${error}`);
      console.error('❌ Error sending reminder:', error);
    }
  }

  /**
   * Get current service statistics
   */
  getStats(): ReminderStats & { isActive: boolean; sentToday: number } {
    return {
      ...this.stats,
      isActive: this.isInitialized,
      sentToday: this.stats.successful
    };
  }

  /**
   * Get cron manager status
   */
  getCronStatus() {
    return cronManager.getStatus();
  }

  /**
   * Stop the reminder service
   */
  stop() {
    cronManager.stopAll();
    this.isInitialized = false;
    console.log('🛑 Booking reminder service stopped');
  }

  /**
   * Start the reminder service
   */
  start() {
    if (!this.isInitialized) {
      this.init();
    } else {
      cronManager.startAll();
      console.log('🚀 Booking reminder service started');
    }
  }

  /**
   * Format reminder message based on order type and reminder type
   */
  private formatReminderMessage(booking: BookingReminderData, reminderType: string = 'REMINDER'): string {
    const endDateStr = booking.endDate.toLocaleDateString('id-ID');
    const orderTypeId = this.getOrderTypeInIndonesian(booking.orderType);
    const daysAhead = reminderType === 'H-15' ? '15 hari' : reminderType === 'H-1' ? '1 hari' : '15 hari';
    
    return `🏠 *${reminderType} Pengingat Sewa Kamar - Suman Residence*

Halo ${booking.customerName}! 👋

Kami ingin mengingatkan bahwa masa sewa kamar Anda akan berakhir dalam *${daysAhead}*.

📋 *Detail Sewa:*
• Kamar: ${booking.roomType}
• Periode: ${orderTypeId}
• Berakhir: ${endDateStr}

${reminderType === 'H-1' ? 
  '⚠️ *URGENT*: Sewa berakhir besok! Segera hubungi kami untuk perpanjangan atau check-out.' :
  '⏰ Untuk memperpanjang sewa atau mengatur check-out, silakan hubungi kami segera.'
}

📞 Kontak: 
• WhatsApp: 081234567890
• Email: admin@sumanresidence.com

Terima kasih atas kepercayaan Anda! 🙏

_Pesan otomatis - Suman Residence_`;
  }

  /**
   * Convert order type to Indonesian
   */
  private getOrderTypeInIndonesian(orderType: string): string {
    const translations = {
      'WEEKLY': 'Mingguan',
      'MONTHLY': 'Bulanan',
      'SEMESTER': 'Semester',
      'YEARLY': 'Tahunan'
    };
    
    return translations[orderType as keyof typeof translations] || orderType;
  }

  /**
   * Manual trigger for testing (sends reminders for bookings expiring in next 30 days)
   */
  async sendTestReminders() {
    try {
      console.log('🧪 Running test reminder check...');
      
      // Get bookings from frontend API
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      
      const response = await fetch(`${frontendUrl}/api/bookings`);
      
      if (!response.ok) {
        return { 
          success: false, 
          error: `Failed to fetch bookings: ${response.status}` 
        };
      }
      
      const result = await response.json() as any;
      const allBookings = result.bookings || [];

      if (allBookings.length === 0) {
        return { success: true, message: 'No test bookings found', count: 0 };
      }

      const now = new Date();
      const futureDate = new Date();
      futureDate.setDate(now.getDate() + 30); // Next 30 days for testing

      const testBookings: BookingReminderData[] = [];

      // Filter bookings expiring in next 30 days
      for (const booking of allBookings.slice(0, 5)) { // Limit to 5 for testing
        const endDate = new Date(booking.rentalPeriod?.endDate || booking.endDate);
        
        if (endDate > now && endDate <= futureDate) {
          const phoneNumber = booking.contactInfo?.whatsapp || booking.contactInfo?.phone;
          
          if (phoneNumber) {
            testBookings.push({
              bookingId: booking.id,
              userId: booking.userId || 'test-user',
              phoneNumber: phoneNumber,
              roomType: booking.room?.type || booking.roomType || 'Test Room',
              orderType: booking.rentalPeriod?.durationType || 'Monthly',
              startDate: new Date(booking.rentalPeriod?.startDate || booking.startDate),
              endDate: endDate,
              amount: booking.totalAmount || 0,
              customerName: booking.contactInfo?.name || 'Test Customer'
            });
          }
        }
      }

      if (testBookings.length === 0) {
        return { 
          success: true, 
          message: 'No suitable test bookings found', 
          count: 0 
        };
      }

      for (const booking of testBookings) {
        await this.sendReminderMessage(booking);
      }

      return { 
        success: true, 
        message: `Test reminders sent successfully`, 
        count: testBookings.length,
        bookings: testBookings.map(b => ({
          bookingId: b.bookingId,
          phoneNumber: b.phoneNumber,
          endDate: b.endDate
        }))
      };
    } catch (error) {
      console.error('❌ Error in test reminders:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      };
    }
  }
}

// Singleton instance
export const bookingReminderService = new BookingReminderService();
