# Booking Reminder Cron System

This document explains the booking reminder cron system implementation for Suman Residence.

## Overview

The system automatically sends WhatsApp reminders to tenants 15 days before their rental period expires, regardless of the rental type (Weekly, Monthly, Semester, Yearly).

## Components

### 1. Cron Manager (`utils/cron-manager.ts`)
- Manages scheduled jobs
- Supports basic cron expressions
- Provides manual job execution for testing
- Singleton instance for global access

### 2. Booking Reminder Service (`utils/booking-reminder.ts`)
- Main business logic for reminder processing
- Fetches bookings from frontend API
- Generates WhatsApp messages
- Tracks sent reminders to avoid duplicates

### 3. Integration with Main Server (`main.ts`)
- Auto-initializes cron service on server start
- Provides API endpoints for management and testing

## API Endpoints

### Cron Management

#### Get Cron Status
```
GET /api/cron/status
Authorization: Bearer {BACKEND_API_KEY}
```

Response:
```json
{
  "success": true,
  "message": "Cron status retrieved successfully",
  "jobs": ["booking-reminder-check"],
  "totalJobs": 1,
  "serviceInitialized": true
}
```

#### Test Reminders
```
POST /api/cron/test-reminders
Authorization: Bearer {BACKEND_API_KEY}
```

Response:
```json
{
  "success": true,
  "message": "Test reminders sent successfully",
  "count": 3,
  "bookings": [
    {
      "bookingId": "booking123",
      "phoneNumber": "081234567890",
      "endDate": "2024-02-15T00:00:00.000Z"
    }
  ]
}
```

#### Run Job Manually
```
POST /api/cron/run-job
Authorization: Bearer {BACKEND_API_KEY}
Content-Type: application/json

{
  "jobName": "booking-reminder-check"
}
```

#### Stop All Jobs
```
POST /api/cron/stop-all
Authorization: Bearer {BACKEND_API_KEY}
```

## How It Works

### 1. Automatic Scheduling
- Cron job runs every 15 minutes checking for bookings
- Looks for bookings expiring exactly 15 days from current date
- Only processes active bookings (rentalStatus: 'SETUJUI')

### 2. Reminder Logic
The system:
1. Fetches all bookings from frontend API
2. Calculates which bookings expire in 15 days
3. Checks if reminder already sent (to avoid duplicates)
4. Generates appropriate WhatsApp message
5. Queues message for delivery via WhatsApp integration
6. Marks reminder as sent

### 3. Message Format
All booking types receive the same H-15 reminder format:

```
🏠 *Pengingat Sewa Kamar - Suman Residence*

Halo [Customer Name]! 👋

Kami ingin mengingatkan bahwa masa sewa kamar Anda akan berakhir dalam *15 hari*.

📋 *Detail Sewa:*
• Kamar: [Room Type]
• Periode: [Duration Type in Indonesian]
• Berakhir: [End Date]

⏰ Untuk memperpanjang sewa atau mengatur check-out, silakan hubungi kami segera.

📞 Kontak: 
• WhatsApp: 081234567890
• Email: admin@sumanresidence.com

Terima kasih atas kepercayaan Anda! 🙏

_Pesan otomatis - Suman Residence_
```

## Environment Variables

```env
BACKEND_API_KEY=your-secret-key
FRONTEND_URL=http://localhost:3000
```

## Testing

### Manual Test
1. Start the backend server
2. Call the test endpoint:
```bash
curl -X POST http://localhost:8080/api/cron/test-reminders \
  -H "Authorization: Bearer gaadakey"
```

### Check Cron Status
```bash
curl -X GET http://localhost:8080/api/cron/status \
  -H "Authorization: Bearer gaadakey"
```

### Run Job Manually
```bash
curl -X POST http://localhost:8080/api/cron/run-job \
  -H "Authorization: Bearer gaadakey" \
  -H "Content-Type: application/json" \
  -d '{"jobName": "booking-reminder-check"}'
```

## Features

### ✅ Implemented
- H-15 reminder for all booking types
- Automatic cron scheduling (every 15 minutes)
- Manual testing endpoints
- WhatsApp message queuing
- Duplicate prevention system
- Multi-language support (Indonesian)
- Integration with existing WhatsApp system

### 🔄 Future Enhancements
- Firebase integration for reminder tracking
- Additional reminder schedules (H-7, H-1)
- Email notifications as backup
- Advanced cron expressions
- Booking renewal automation
- Payment reminder integration

## Deployment Notes

1. Ensure WhatsApp connection is active
2. Set proper environment variables
3. Frontend API must be accessible
4. Message queue should be functioning
5. Monitor cron job logs for issues

## Troubleshooting

### Common Issues
1. **No reminders sent**: Check WhatsApp connection status
2. **Duplicate reminders**: Verify reminder tracking system
3. **Wrong dates**: Ensure timezone configuration
4. **API errors**: Check frontend URL and connectivity

### Debug Commands
```bash
# Check WhatsApp status
curl http://localhost:8080/whatsapp/status

# Check message queue
curl http://localhost:8080/whatsapp/queue-status

# Check cron jobs
curl -H "Authorization: Bearer gaadakey" http://localhost:8080/api/cron/status
```

## Implementation Status
✅ **COMPLETE** - Ready for production use with H-15 reminder functionality for all booking types.
