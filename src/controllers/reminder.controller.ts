import { Request, Response } from 'express';

interface ReminderRequest {
  type: 'contract_renewal_h15' | 'payment_reminder_h1';
  tenant: {
    id: string;
    name: string;
    phone: string;
    email: string;
  };
  booking: {
    id: string;
    roomId: string;
    checkOut: string;
    monthlyAmount: number;
    totalAmount: number;
  };
  daysRemaining: number;
  scheduledAt: string;
}

export const sendReminder = async (req: Request, res: Response) => {
  try {
    // Verify authorization
    const authHeader = req.headers.authorization;
    const expectedKey = process.env.BACKEND_API_KEY || 'gaadakey';
    
    if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const data: ReminderRequest = req.body;

    // Validate required fields
    if (!data.type || !data.tenant || !data.booking) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let message = '';
    let messageType = '';

    // Generate message based on type
    switch (data.type) {
      case 'contract_renewal_h15':
        messageType = 'Contract Renewal Reminder (H-15)';
        message = generateH15Message(data);
        break;
      
      case 'payment_reminder_h1':
        messageType = 'Payment Reminder (H-1)';
        message = generateH1Message(data);
        break;
      
      default:
        return res.status(400).json({ error: 'Invalid reminder type' });
    }

    // Send WhatsApp message using your existing WhatsApp connection
    const whatsappResult = await sendWhatsAppMessage(data.tenant.phone, message);

    // Log the reminder for tracking
    console.log(`📱 ${messageType} sent to ${data.tenant.name} (${data.tenant.phone})`);
    console.log(`📝 Message: ${message.substring(0, 100)}...`);

    // Store reminder in database/log (optional)
    await logReminder({
      type: data.type,
      tenantId: data.tenant.id,
      bookingId: data.booking.id,
      phone: data.tenant.phone,
      message: message,
      status: whatsappResult.success ? 'sent' : 'failed',
      messageId: whatsappResult.messageId,
      sentAt: new Date()
    });

    res.json({
      success: true,
      message: `${messageType} sent successfully`,
      messageId: whatsappResult.messageId,
      recipient: {
        name: data.tenant.name,
        phone: data.tenant.phone
      },
      type: data.type,
      sentAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error sending reminder:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send reminder',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Generate H-15 contract renewal message
function generateH15Message(data: ReminderRequest): string {
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

// Generate H-1 payment reminder message
function generateH1Message(data: ReminderRequest): string {
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

// Send WhatsApp message (integrate with your existing WhatsApp service)
async function sendWhatsAppMessage(phone: string, message: string) {
  try {
    // TODO: Integrate with your existing WhatsApp connection logic
    // This should use your existing whatsapp-connection.ts or similar
    
    // For now, return a mock success response
    // Replace this with actual WhatsApp API call
    console.log(`📱 Sending WhatsApp to ${phone}:`);
    console.log(message);
    
    return {
      success: true,
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
  } catch (error) {
    console.error('WhatsApp send error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send WhatsApp'
    };
  }
}

// Log reminder for tracking purposes
async function logReminder(reminderData: any) {
  try {
    // TODO: Store in your database or logging system
    console.log('📝 Logging reminder:', {
      type: reminderData.type,
      tenantId: reminderData.tenantId,
      bookingId: reminderData.bookingId,
      status: reminderData.status,
      sentAt: reminderData.sentAt
    });
  } catch (error) {
    console.error('Error logging reminder:', error);
  }
}
