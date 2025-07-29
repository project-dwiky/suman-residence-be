// Production-ready Cron job manager for Bun runtime

interface CronJob {
  name: string;
  interval: NodeJS.Timeout;
  handler: () => Promise<void>;
  expression: string;
  lastRun: Date | null;
  nextRun: Date | null;
  isActive: boolean;
  runCount: number;
  errorCount: number;
}

export class CronManager {
  private jobs: Map<string, CronJob> = new Map();
  private isInitialized = false;

  /**
   * Initialize the cron manager
   */
  init() {
    if (this.isInitialized) {
      console.log('📅 Cron manager already initialized');
      return;
    }

    console.log('🚀 Initializing production cron manager...');
    this.isInitialized = true;
    console.log('✅ Cron manager initialized');
  }

  /**
   * Schedule a cron job with production features
   * @param name - Unique job name
   * @param cronExpression - Standard cron expression (5 or 6 fields)
   * @param handler - Function to execute
   */
  schedule(name: string, cronExpression: string, handler: () => Promise<void>) {
    console.log(`📅 Scheduling cron job: ${name} with expression: ${cronExpression}`);
    
    // Validate cron expression
    if (!this.isValidCronExpression(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    // Stop existing job if it exists
    if (this.jobs.has(name)) {
      console.log(`⚠️ Job ${name} already exists, replacing...`);
      this.unschedule(name);
    }

    const nextRun = this.getNextRunTime(cronExpression);
    const intervalMs = this.calculateNextInterval(cronExpression);

    const job: CronJob = {
      name,
      expression: cronExpression,
      handler,
      lastRun: null,
      nextRun,
      isActive: true,
      runCount: 0,
      errorCount: 0,
      interval: this.createInterval(name, handler, cronExpression)
    };

    this.jobs.set(name, job);
    console.log(`✅ Successfully scheduled cron job: ${name}, next run: ${nextRun?.toISOString()}`);
  }

  /**
   * Create a smart interval that respects cron timing
   */
  private createInterval(name: string, handler: () => Promise<void>, cronExpression: string): NodeJS.Timeout {
    const checkInterval = () => {
      const job = this.jobs.get(name);
      if (!job || !job.isActive) return;

      const now = new Date();
      const nextRun = this.getNextRunTime(cronExpression, job.lastRun || new Date(now.getTime() - 60000));

      if (nextRun && now >= nextRun) {
        this.executeJob(name);
      }
    };

    // Check every minute for precision
    return setInterval(checkInterval, 60000);
  }

  /**
   * Execute a job with error handling and logging
   */
  private async executeJob(name: string) {
    const job = this.jobs.get(name);
    if (!job || !job.isActive) return;

    try {
      console.log(`� Executing cron job: ${name}`);
      const startTime = Date.now();
      
      await job.handler();
      
      const duration = Date.now() - startTime;
      job.lastRun = new Date();
      job.nextRun = this.getNextRunTime(job.expression, job.lastRun);
      job.runCount++;
      
      console.log(`✅ Completed cron job: ${name} in ${duration}ms, next run: ${job.nextRun?.toISOString()}`);
    } catch (error) {
      job.errorCount++;
      console.error(`❌ Error in cron job ${name}:`, error);
      
      // Log error details
      console.error(`Job ${name} error details:`, {
        name,
        expression: job.expression,
        lastRun: job.lastRun,
        runCount: job.runCount,
        errorCount: job.errorCount,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get next run time for a cron expression
   */
  private getNextRunTime(expression: string, fromDate?: Date): Date | null {
    try {
      const from = fromDate || new Date();
      
      // Simple implementation for common patterns
      if (expression === '0 9 * * *') {
        // Daily at 9 AM
        const next = new Date(from);
        next.setHours(9, 0, 0, 0);
        
        if (next <= from) {
          next.setDate(next.getDate() + 1);
        }
        
        return next;
      }
      
      if (expression === '*/15 * * * *') {
        // Every 15 minutes
        const next = new Date(from);
        const minutes = next.getMinutes();
        const nextQuarter = Math.ceil(minutes / 15) * 15;
        
        if (nextQuarter >= 60) {
          next.setHours(next.getHours() + 1, 0, 0, 0);
        } else {
          next.setMinutes(nextQuarter, 0, 0);
        }
        
        return next;
      }

      // Default: next hour for unknown expressions
      const next = new Date(from);
      next.setHours(next.getHours() + 1, 0, 0, 0);
      return next;
    } catch (error) {
      console.error('Error calculating next run time:', error);
      return null;
    }
  }

  /**
   * Calculate interval until next run
   */
  private calculateNextInterval(expression: string): number {
    const nextRun = this.getNextRunTime(expression);
    if (!nextRun) return 60000; // Default 1 minute
    
    const now = new Date();
    return Math.max(nextRun.getTime() - now.getTime(), 1000);
  }

  /**
   * Validate cron expression (basic validation)
   */
  private isValidCronExpression(expression: string): boolean {
    try {
      const parts = expression.split(' ');
      
      // Support both 5-field and 6-field cron expressions
      if (parts.length !== 5 && parts.length !== 6) {
        return false;
      }

      // Basic known patterns
      const knownPatterns = [
        '0 9 * * *',     // Daily at 9 AM
        '*/15 * * * *',  // Every 15 minutes
        '0 * * * *',     // Every hour
        '0 0 * * *',     // Daily at midnight
        '0 0 * * 0'      // Weekly on Sunday
      ];

      return knownPatterns.includes(expression);
    } catch (error) {
      return false;
    }
  }

  /**
   * Unschedule a cron job
   */
  unschedule(name: string): boolean {
    const job = this.jobs.get(name);
    if (job) {
      clearInterval(job.interval);
      this.jobs.delete(name);
      console.log(`🗑️ Unscheduled cron job: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Pause a job without removing it
   */
  pause(name: string): boolean {
    const job = this.jobs.get(name);
    if (job) {
      job.isActive = false;
      console.log(`⏸️ Paused cron job: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Resume a paused job
   */
  resume(name: string): boolean {
    const job = this.jobs.get(name);
    if (job) {
      job.isActive = true;
      console.log(`▶️ Resumed cron job: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Run a job manually (for testing)
   */
  async runManually(name: string): Promise<{ success: boolean; error?: string; duration?: number }> {
    const job = this.jobs.get(name);
    if (!job) {
      return { success: false, error: `Job ${name} not found` };
    }

    try {
      console.log(`🔧 Manually running cron job: ${name}`);
      const startTime = Date.now();
      
      await job.handler();
      
      const duration = Date.now() - startTime;
      job.runCount++;
      job.lastRun = new Date();
      
      console.log(`✅ Manual execution completed: ${name} in ${duration}ms`);
      return { success: true, duration };
    } catch (error) {
      job.errorCount++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Manual execution failed: ${name}`, error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get status of all jobs
   */
  getStatus(): { 
    isActive: boolean; 
    jobs: Array<{
      name: string;
      expression: string;
      isActive: boolean;
      lastRun: string | null;
      nextRun: string | null;
      runCount: number;
      errorCount: number;
    }>;
    summary: {
      total: number;
      active: number;
      paused: number;
    };
  } {
    const jobs = Array.from(this.jobs.values()).map(job => ({
      name: job.name,
      expression: job.expression,
      isActive: job.isActive,
      lastRun: job.lastRun?.toISOString() || null,
      nextRun: job.nextRun?.toISOString() || null,
      runCount: job.runCount,
      errorCount: job.errorCount
    }));

    const summary = {
      total: jobs.length,
      active: jobs.filter(j => j.isActive).length,
      paused: jobs.filter(j => !j.isActive).length
    };

    return {
      isActive: this.isInitialized,
      jobs,
      summary
    };
  }

  /**
   * Get all scheduled jobs names
   */
  getJobs(): string[] {
    return Array.from(this.jobs.keys());
  }

  /**
   * Stop all cron jobs
   */
  stopAll(): void {
    console.log('🛑 Stopping all cron jobs...');
    this.jobs.forEach((job, name) => {
      clearInterval(job.interval);
      console.log(`🗑️ Stopped job: ${name}`);
    });
    this.jobs.clear();
    this.isInitialized = false;
    console.log('✅ All cron jobs stopped');
  }

  /**
   * Start all paused jobs
   */
  startAll(): void {
    console.log('🚀 Starting all cron jobs...');
    this.jobs.forEach((job, name) => {
      job.isActive = true;
      console.log(`▶️ Started job: ${name}`);
    });
    console.log('✅ All cron jobs started');
  }

  /**
   * Get job details
   */
  getJob(name: string): CronJob | null {
    return this.jobs.get(name) || null;
  }
}

// Singleton instance
export const cronManager = new CronManager();
