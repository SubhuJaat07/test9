import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// BATCH ASSIGNMENTS - Each repo gets unique prefix, NO OVERLAP
// ============================================================
const REPO_BATCHES: Record<string, { prefix: string; start: number; end: number }> = {
  test1:  { prefix: '61', start: 6100000000, end: 6199999999 },
  test2:  { prefix: '62', start: 6200000000, end: 6299999999 },
  test3:  { prefix: '63', start: 6300000000, end: 6399999999 },
  test4:  { prefix: '64', start: 6400000000, end: 6499999999 },
  test5:  { prefix: '65', start: 6500000000, end: 6599999999 },
  test6:  { prefix: '66', start: 6600000000, end: 6699999999 },
  test7:  { prefix: '67', start: 6700000000, end: 6799999999 },
  test8:  { prefix: '68', start: 6800000000, end: 6899999999 },
  test9:  { prefix: '69', start: 6900000000, end: 6999999999 },
  test10: { prefix: '70', start: 7000000000, end: 7099999999 },
};

// ============================================================
// TYPES
// ============================================================
interface EngineConfig {
  repoId: string;
  workerCount: number;
  selfPingUrl?: string;
}

interface VerifyResult {
  mobile: string;
  status: 'verified' | 'not_found' | 'rate_limited' | 'error';
  statusCode?: number;
}

interface EngineStats {
  repoId: string;
  batchPrefix: string;
  running: boolean;
  cursor: number;
  startNumber: number;
  endNumber: number;
  progressPercent: string;
  verified: number;
  notFound: number;
  rateLimited: number;
  errors: number;
  skipped: number;
  totalProcessed: number;
  totalInDb: number;
  startTime: number;
  elapsedSeconds: number;
  ratePerSecond: string;
  ratePerHour: number;
  workersActive: number;
  last429Time: number | null;
  currentBackoff: number;
}

// ============================================================
// USER AGENTS POOL
// ============================================================
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0',
];

// ============================================================
// VERIFY ENGINE - SINGLETON
// ============================================================
let engine: VerifyEngine | null = null;

class VerifyEngine {
  private repoId: string;
  private batchPrefix: string;
  private startNumber: number;
  private endNumber: number;
  private cursor: number;
  private running = false;
  private workerCount: number;

  // Dedup set - stores already-processed mobile numbers
  private existingNumbers: Set<string> = new Set();

  // Stats
  private verified = 0;
  private notFound = 0;
  private rateLimited = 0;
  private errors = 0;
  private skipped = 0;
  private totalProcessed = 0;
  private startTime = 0;

  // Rate limit state
  private last429Time: number | null = null;
  private currentBackoff = 0;
  private globalRateLimitUntil = 0; // timestamp - all workers pause

  // Workers
  private activeWorkers = 0;
  private workers: Promise<void>[] = [];

  // Self-ping
  private selfPingInterval?: ReturnType<typeof setInterval>;

  // Supabase
  private supabase: SupabaseClient;

  // Batch insert buffer
  private insertBuffer: any[] = [];
  private readonly INSERT_BATCH_SIZE = 25;

  // Log throttle
  private lastLogTime = 0;
  private logCounter = 0;

  constructor(config: EngineConfig) {
    const batch = REPO_BATCHES[config.repoId];
    if (!batch) {
      throw new Error(`Unknown repoId: ${config.repoId}. Must be one of: ${Object.keys(REPO_BATCHES).join(', ')}`);
    }

    this.repoId = config.repoId;
    this.batchPrefix = batch.prefix;
    this.startNumber = batch.start;
    this.endNumber = batch.end;
    this.workerCount = Math.min(config.workerCount || 100, 500);
    this.cursor = batch.start;

    // Init Supabase
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();

    // Load existing numbers from Supabase
    await this.loadExistingNumbers();

    // Resume from last processed number
    await this.resumeCursor();

    // Start self-ping
    this.startSelfPing();

    // Start workers
    for (let i = 0; i < this.workerCount; i++) {
      this.workers.push(this.runWorker(i));
    }

    this.log(`🚀 [${this.repoId}] Started ${this.workerCount} workers | Range: ${this.startNumber}-${this.endNumber} | Prefix: ${this.batchPrefix} | Already in DB: ${this.existingNumbers.size}`);
  }

  async stop() {
    this.running = false;
    if (this.selfPingInterval) {
      clearInterval(this.selfPingInterval);
    }
    // Flush remaining insert buffer
    await this.flushInsertBuffer();
    this.log(`⏹ [${this.repoId}] Stopped. Total verified: ${this.verified}, not_found: ${this.notFound}`);
  }

  // ===================== DEDUP =====================

  private async loadExistingNumbers() {
    try {
      // Load in pages to handle large datasets
      let offset = 0;
      const pageSize = 5000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await this.supabase
          .from('referral_logs')
          .select('mobile_number')
          .gte('mobile_number', this.startNumber.toString())
          .lt('mobile_number', (this.endNumber + 1).toString())
          .range(offset, offset + pageSize - 1);

        if (error) {
          this.log(`⚠ [${this.repoId}] Supabase load error: ${error.message}`);
          break;
        }

        if (!data || data.length === 0) {
          hasMore = false;
        } else {
          data.forEach(row => this.existingNumbers.add(row.mobile_number));
          offset += pageSize;
          if (data.length < pageSize) hasMore = false;
        }
      }

      this.log(`✅ [${this.repoId}] Loaded ${this.existingNumbers.size} existing numbers from Supabase`);
    } catch (err: any) {
      this.log(`⚠ [${this.repoId}] Failed to load existing numbers: ${err.message}`);
    }
  }

  private async resumeCursor() {
    // Find the max mobile_number in our range to resume from there
    try {
      const { data, error } = await this.supabase
        .from('referral_logs')
        .select('mobile_number')
        .gte('mobile_number', this.startNumber.toString())
        .lt('mobile_number', (this.endNumber + 1).toString())
        .order('mobile_number', { ascending: false })
        .limit(1);

      if (!error && data && data.length > 0) {
        const maxNum = parseInt(data[0].mobile_number);
        if (maxNum >= this.cursor && maxNum < this.endNumber) {
          this.cursor = maxNum + 1;
          this.log(`📍 [${this.repoId}] Resuming cursor from ${this.cursor} (max in DB: ${maxNum})`);
        }
      }
    } catch (err: any) {
      this.log(`⚠ [${this.repoId}] Resume cursor error: ${err.message}`);
    }
  }

  // ===================== SELF-PING =====================

  private startSelfPing() {
    const pingUrl = this.selfPingUrl || process.env.SELF_PING_URL;
    if (!pingUrl) {
      this.log(`ℹ [${this.repoId}] No SELF_PING_URL set, skipping self-ping`);
      return;
    }

    const url = pingUrl.replace(/\/$/, '') + '/api/health';
    this.selfPingInterval = setInterval(async () => {
      try {
        await fetch(url);
      } catch {
        // Ignore ping errors
      }
    }, 4 * 60 * 1000); // Every 4 minutes (Render sleeps at 15 min)

    this.log(`🔄 [${this.repoId}] Self-ping enabled: ${url} (every 4 min)`);
  }

  // ===================== WORKER =====================

  private async runWorker(workerId: number) {
    this.activeWorkers++;
    let consecutive429s = 0;

    try {
      while (this.running) {
        // Check global rate limit pause
        if (Date.now() < this.globalRateLimitUntil) {
          await this.sleep(Math.min(this.globalRateLimitUntil - Date.now(), 5000));
          continue;
        }

        // Get next number
        const number = this.getNextNumber();
        if (!number) {
          this.log(`🏁 [${this.repoId}] Worker ${workerId}: Range exhausted`);
          break;
        }

        const mobile = number.toString();

        // Skip already-processed numbers
        if (this.existingNumbers.has(mobile)) {
          this.skipped++;
          continue;
        }

        // Verify
        const result = await this.verifyNumber(mobile, workerId);

        if (result.status === 'rate_limited') {
          consecutive429s++;
          this.last429Time = Date.now();

          // Exponential backoff: 2s, 4s, 8s, 16s, 32s, max 60s
          const backoff = Math.min(2000 * Math.pow(2, consecutive429s - 1), 60000);
          this.currentBackoff = backoff;

          // Set global pause so ALL workers back off together (same IP)
          this.globalRateLimitUntil = Date.now() + backoff;

          // Only log every 10th 429 to avoid log spam
          if (consecutive429s % 10 === 1) {
            this.log(`⚠ [${this.repoId}] 429 rate limit (x${consecutive429s}), backing off ${backoff}ms`);
          }

          await this.sleep(backoff);
          continue;
        }

        // Reset backoff on success
        consecutive429s = 0;
        this.currentBackoff = 0;

        // Store result
        if (result.status === 'verified' || result.status === 'not_found') {
          this.bufferInsert(mobile, result.status);
          this.existingNumbers.add(mobile);

          if (result.status === 'verified') this.verified++;
          else this.notFound++;
          this.totalProcessed++;
        } else {
          this.errors++;
        }

        // Small delay between requests (adaptive)
        const baseDelay = this.globalRateLimitUntil > Date.now() ? 200 : 50;
        await this.sleep(baseDelay + Math.random() * 50);
      }
    } catch (err: any) {
      this.log(`❌ [${this.repoId}] Worker ${workerId} crashed: ${err.message}`);
    } finally {
      this.activeWorkers--;
    }
  }

  private getNextNumber(): number | null {
    // Atomic increment - find next non-existing number
    let attempts = 0;
    while (this.cursor <= this.endNumber && attempts < 1000) {
      const num = this.cursor;
      this.cursor++;
      attempts++;

      // Skip if already in DB
      if (this.existingNumbers.has(num.toString())) {
        this.skipped++;
        continue;
      }

      return num;
    }
    return null;
  }

  // ===================== VERIFY API =====================

  private async verifyNumber(mobile: string, workerId: number): Promise<VerifyResult> {
    try {
      const ua = USER_AGENTS[workerId % USER_AGENTS.length];
      // Use same format as main repo: number in URL + body (no 91 prefix in query param)
      const url = `https://api.testbook.com/api/v2/otp/send?emailOrMobile=${mobile}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': ua,
          'Origin': 'https://testbook.com',
          'Referer': 'https://testbook.com/',
          'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          'sec-ch-ua-mobile': workerId % 3 === 0 ? '?1' : '?0',
          'sec-ch-ua-platform': workerId % 2 === 0 ? '"Windows"' : '"macOS"',
        },
        body: JSON.stringify({ emailOrMobile: mobile }),
      });

      if (response.status === 429) {
        this.rateLimited++;
        return { mobile, status: 'rate_limited', statusCode: 429 };
      }

      // Handle 400 — parse body to check if it's rate limit or genuine not_found
      if (response.status === 400) {
        let body400: any = {};
        try { body400 = await response.json(); } catch {}
        const msg400 = (body400.message || '').toLowerCase();
        
        // Check if 400 is rate limit in disguise
        if (msg400.includes('rate') || msg400.includes('limit') || msg400.includes('too many') || 
            msg400.includes('maximum') || msg400.includes('throttl') || msg400.includes('exceed')) {
          this.rateLimited++;
          return { mobile, status: 'rate_limited', statusCode: 400 };
        }
        
        // Log first 400 for debugging
        if (this.totalProcessed < 5) {
          this.log(`🔍 [${this.repoId}] First 400 for ${mobile}: ${JSON.stringify(body400).substring(0, 200)}`);
        }
        
        // 400 = not found (invalid number / no account)
        return { mobile, status: 'not_found', statusCode: 400 };
      }

      if (response.status === 200) {
        // CRITICAL: Must parse response body to determine verified vs not_found
        let data: any = {};
        try { data = await response.json(); } catch {}
        
        // OTP sent successfully = account exists = VERIFIED
        if (data.success === true) {
          return { mobile, status: 'verified', statusCode: 200 };
        }
        
        // 200 but success=false with specific messages = NOT FOUND
        if (data.success === false) {
          const msg = (data.message || '').toLowerCase();
          
          // Rate limit message in 200 body
          if (msg.includes('rate') || msg.includes('limit') || msg.includes('too many') || 
              msg.includes('maximum') || msg.includes('throttl')) {
            this.rateLimited++;
            return { mobile, status: 'rate_limited', statusCode: 200 };
          }
          
          // Not found messages
          if (msg.includes('invalid') || msg.includes('not found') || 
              msg.includes('no account') || msg.includes('unregistered')) {
            return { mobile, status: 'not_found', statusCode: 200 };
          }
        }
        
        // Unexpected 200 response — log it
        if (this.totalProcessed < 5) {
          this.log(`🔍 [${this.repoId}] Unexpected 200 for ${mobile}: ${JSON.stringify(data).substring(0, 200)}`);
        }
        
        // Default: if 200 and can't parse, treat as verified (optimistic)
        return { mobile, status: 'verified', statusCode: 200 };
      }

      // Any other status = not found / error
      if (response.status >= 400 && response.status < 500) {
        return { mobile, status: 'not_found', statusCode: response.status };
      }

      // Server errors - might be temporary
      return { mobile, status: 'error', statusCode: response.status };
    } catch (err: any) {
      return { mobile, status: 'error' };
    }
  }

  // ===================== SUPABASE BATCH INSERT =====================

  private bufferInsert(mobile: string, status: string) {
    this.insertBuffer.push({
      mobile_number: mobile,
      status: status,
      verified: status === 'verified',
      not_found: status === 'not_found',
      invitation_sent: false,
      accepted: false,
    });

    if (this.insertBuffer.length >= this.INSERT_BATCH_SIZE) {
      this.flushInsertBuffer();
    }
  }

  private async flushInsertBuffer() {
    if (this.insertBuffer.length === 0) return;

    const batch = [...this.insertBuffer];
    this.insertBuffer = [];

    try {
      const { error } = await this.supabase
        .from('referral_logs')
        .upsert(batch, { onConflict: 'mobile_number', ignoreDuplicates: true });

      if (error && !error.message?.includes('duplicate') && !error.message?.includes('constraint')) {
        // Only log real errors, not duplicate key violations
        if (Date.now() - this.lastLogTime > 10000) { // Throttle error logs
          this.log(`⚠ [${this.repoId}] Supabase insert error: ${error.message}`);
          this.lastLogTime = Date.now();
        }
      }
    } catch (err: any) {
      if (Date.now() - this.lastLogTime > 10000) {
        this.log(`⚠ [${this.repoId}] Supabase flush error: ${err.message}`);
        this.lastLogTime = Date.now();
      }
    }
  }

  // ===================== UTILS =====================

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private log(msg: string) {
    // Throttled logging to prevent Railway log rate limits
    this.logCounter++;
    const now = Date.now();
    // Always log important messages, throttle routine ones
    if (msg.includes('🚀') || msg.includes('🏁') || msg.includes('❌') || now - this.lastLogTime > 5000) {
      console.log(msg);
      this.lastLogTime = now;
    }
  }

  // ===================== STATUS =====================

  getStatus(): EngineStats {
    const elapsed = this.startTime > 0 ? (Date.now() - this.startTime) / 1000 : 0;
    const rate = elapsed > 0 ? this.totalProcessed / elapsed : 0;
    const totalRange = this.endNumber - this.startNumber;
    const covered = this.cursor - this.startNumber;

    return {
      repoId: this.repoId,
      batchPrefix: this.batchPrefix,
      running: this.running,
      cursor: this.cursor,
      startNumber: this.startNumber,
      endNumber: this.endNumber,
      progressPercent: totalRange > 0 ? (covered / totalRange * 100).toFixed(2) : '0',
      verified: this.verified,
      notFound: this.notFound,
      rateLimited: this.rateLimited,
      errors: this.errors,
      skipped: this.skipped,
      totalProcessed: this.totalProcessed,
      totalInDb: this.existingNumbers.size,
      startTime: this.startTime,
      elapsedSeconds: Math.round(elapsed),
      ratePerSecond: rate.toFixed(2),
      ratePerHour: Math.round(rate * 3600),
      workersActive: this.activeWorkers,
      last429Time: this.last429Time,
      currentBackoff: this.currentBackoff,
    };
  }
}

// ============================================================
// PUBLIC API
// ============================================================

export async function startVerifyEngine(config: EngineConfig) {
  if (engine) {
    console.log(`[${config.repoId}] Engine already running`);
    return engine;
  }

  engine = new VerifyEngine(config);
  await engine.start();
  return engine;
}

export function stopVerifyEngine() {
  if (engine) {
    engine.stop();
    engine = null;
  }
}

export function getEngineStatus(): EngineStats | null {
  return engine?.getStatus() ?? null;
}

export function isEngineRunning(): boolean {
  return engine !== null && (engine as any).running === true;
}

export function getRepoBatches() {
  return REPO_BATCHES;
}
