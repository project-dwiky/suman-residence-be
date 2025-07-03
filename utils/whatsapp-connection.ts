import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

// Global state
let sock: ReturnType<typeof makeWASocket> | null = null;
let connectionReady = false;
let qrCode: string | null = null;

/**
 * Connects to WhatsApp via Baileys
 * @returns Promise that resolves when connection process is started
 */
async function connectToWhatsApp() {
  // Selalu gunakan direktori auth yang sama
  const { state, saveCreds } = await useMultiFileAuthState('whatsapp-auth');
  const { version } = await fetchLatestBaileysVersion();
  
  console.log(`Using WA v${version.join('.')}`);
  
  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys)
    },
    qrTimeout: 60000 * 2, // 2 menit timeout untuk QR code
    connectTimeoutMs: 60000 * 2, // 2 menit timeout untuk koneksi
    getMessage: async () => {
      return { conversation: 'hello' };
    }
  });
  
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      // Save QR code to variable for API access
      qrCode = qr;
      console.log('New QR code generated');
    }
    
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting: ', shouldReconnect);
      
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('Connected to WhatsApp');
      connectionReady = true;
      // Clear QR code once connected
      qrCode = null;
    }
  });
  
  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('messages.upsert', async (m) => {
    console.log(JSON.stringify(m, undefined, 2));
    
    if (m.messages && m.messages.length > 0) {
      const msg = m.messages[0];
      if (msg && !msg.key.fromMe && m.type === 'notify') {
        console.log('Received message:', msg.message);
      }
    }
  });
}

/**
 * Reset WhatsApp connection dan credentials
 * Ini akan memaksa pembuatan QR code baru
 */
async function resetWhatsAppConnection() {
  // Reset QR code
  qrCode = null;
  
  // Disconnect existing connection if any
  if (sock) {
    // Hapus semua event listeners untuk mencegah memory leak
    sock.ev.removeAllListeners('connection.update');
    sock.ev.removeAllListeners('creds.update');
    sock.ev.removeAllListeners('messages.upsert');
    sock = null;
    connectionReady = false;
  }
  
  // Reset auth state untuk memaksa QR code baru
  try {
    const { state, saveCreds } = await useMultiFileAuthState('whatsapp-auth');
    // Reset credentials untuk memaksa QR code baru
    state.creds.me = undefined;
    state.creds.registered = false;
    await saveCreds();
    console.log('WhatsApp credentials reset for new connection');
  } catch (err) {
    console.error('Failed to reset credentials:', err);
  }
  
  // Mulai koneksi baru yang akan menghasilkan QR code baru
  await connectToWhatsApp();
}

/**
 * Kirim pesan WhatsApp ke nomor telepon tertentu
 * @returns Object dengan status success dan message
 */
async function sendWhatsAppMessage(phoneNumber: string, message: string): Promise<{ success: boolean; message: string }> {
  if (!connectionReady || !sock) {
    return {
      success: false,
      message: 'WhatsApp connection not ready'
    };
  }
  
  try {
    // Format nomor telepon untuk WhatsApp
    const formattedPhone = `${phoneNumber}@s.whatsapp.net`;
    
    // Kirim pesan dan tunggu hasilnya
    const result = await sock.sendMessage(formattedPhone, { text: message });
    
    // Jika berhasil mengirim, kembalikan success
    if (result) {
      return {
        success: true,
        message: 'Message sent successfully'
      };
    } else {
      return {
        success: false,
        message: 'Failed to send message (empty result)'
      };
    }
  } catch (error) {
    // Tangkap error dan kembalikan pesan yang sesuai
    console.error('Error sending WhatsApp message:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error sending message'
    };
  }
}

// Exports
export {
  connectToWhatsApp,
  resetWhatsAppConnection,
  sendWhatsAppMessage,
  sock,
  connectionReady,
  qrCode
};
