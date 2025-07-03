/**
 * Interface untuk item dalam queue
 */
export interface QueueItem {
  id: string;
  phoneNumber: string;
  message: string;
  timestamp: Date;
}

/**
 * Interface untuk hasil eksekusi item queue
 */
export interface QueueResult {
  success: boolean;
  itemId: string;
  error?: string;
}

/**
 * Tipe untuk callback processor yang memproses item queue
 */
export type QueueProcessor = (item: QueueItem) => Promise<QueueResult>;

/**
 * Class untuk mengelola message queue dengan delay acak
 */
export class InMemoryMessageQueue {
  private queue: QueueItem[] = [];
  private isProcessing: boolean = false;
  private processor: QueueProcessor;
  private minDelayMs: number;
  private maxDelayMs: number;
  
  /**
   * Membuat instance InMemoryMessageQueue baru
   * 
   * @param processor - Fungsi untuk memproses item queue
   * @param options - Opsi konfigurasi queue
   */
  constructor(processor: QueueProcessor, options?: {
    minDelayMs?: number,
    maxDelayMs?: number
  }) {
    this.processor = processor;
    this.minDelayMs = options?.minDelayMs ?? 2000; // Default 2 detik
    this.maxDelayMs = options?.maxDelayMs ?? 4000; // Default 4 detik
  }

  /**
   * Menambahkan item baru ke queue
   * 
   * @param phoneNumber - Nomor telepon penerima
   * @param message - Pesan yang akan dikirim
   * @returns ID item dalam queue
   */
  public enqueue(phoneNumber: string, message: string): string {
    const id = this.generateId();
    const item: QueueItem = {
      id,
      phoneNumber,
      message,
      timestamp: new Date()
    };

    this.queue.push(item);
    console.log(`[Queue] Item added: ${id}, Total items: ${this.queue.length}`);
    
    // Mulai proses queue jika belum berjalan
    if (!this.isProcessing) {
      this.processQueue();
    }

    return id;
  }

  /**
   * Menghapus item dari queue berdasarkan ID
   * 
   * @param id - ID item yang akan dihapus
   * @returns true jika berhasil dihapus, false jika tidak ditemukan
   */
  public remove(id: string): boolean {
    const initialLength = this.queue.length;
    this.queue = this.queue.filter(item => item.id !== id);
    return this.queue.length < initialLength;
  }

  /**
   * Mendapatkan status queue saat ini
   */
  public getStatus() {
    return {
      itemCount: this.queue.length,
      isProcessing: this.isProcessing,
      nextItems: this.queue.slice(0, 3).map(item => ({
        id: item.id,
        phoneNumber: item.phoneNumber,
        timestamp: item.timestamp
      }))
    };
  }

  /**
   * Memproses queue secara sekuensial dengan delay acak
   */
  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      console.log('[Queue] Processing finished, queue is empty');
      return;
    }

    this.isProcessing = true;
    
    // Ambil item pertama dari queue (FIFO)
    const nextItem = this.queue[0];
    // Safety check - jika tidak ada item, restart proses
    if (!nextItem) {
      console.log('[Queue] No item found in queue, restarting process');
      setTimeout(() => this.processQueue(), 1000);
      return;
    }
    
    try {
      console.log(`[Queue] Processing item ${nextItem.id} for ${nextItem.phoneNumber}`);
      
      // Proses item dengan "try and forget" - tidak perlu retry
      const result = await this.processor(nextItem);
      
      if (result.success) {
        console.log(`[Queue] Item ${nextItem.id} processed successfully`);
      } else {
        console.log(`[Queue] Failed to process item ${nextItem.id}: ${result.error}`);
      }
    } catch (error) {
      console.error(`[Queue] Error processing item ${nextItem.id}:`, error);
    } finally {
      // Hapus item dari queue apapun hasilnya (try and forget)
      this.remove(nextItem.id);
      console.log(`[Queue] Removed item ${nextItem.id} from queue`);
    }
    
    // Hitung delay acak untuk item berikutnya
    const randomDelay = this.getRandomDelay();
    console.log(`[Queue] Waiting ${randomDelay}ms before processing next item`);
    
    // Proses item berikutnya setelah delay
    setTimeout(() => this.processQueue(), randomDelay);
  }

  /**
   * Generate random delay antara minDelayMs dan maxDelayMs
   */
  private getRandomDelay(): number {
    return Math.floor(Math.random() * (this.maxDelayMs - this.minDelayMs + 1)) + this.minDelayMs;
  }

  /**
   * Generate ID unik untuk item queue
   */
  private generateId(): string {
    return `msg_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }
}
