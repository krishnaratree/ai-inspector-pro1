// services/rateLimit.ts
type AnyFn<T> = () => Promise<T>;

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Simple throttling queue:
 * - concurrency = จำนวนงานที่รันพร้อมกัน
 * - minTimeMs = เว้นระยะขั้นต่ำระหว่าง "เริ่ม" งานแต่ละครั้ง
 */
export class ThrottleQueue {
  private running = 0;
  private lastStartAt = 0;
  private queue: Array<{
    fn: AnyFn<any>;
    resolve: (v: any) => void;
    reject: (e: any) => void;
  }> = [];

  constructor(
    private readonly concurrency: number = 1,
    private readonly minTimeMs: number = 1200
  ) {}

  schedule<T>(fn: AnyFn<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.pump();
    });
  }

  private async pump() {
    if (this.running >= this.concurrency) return;
    const job = this.queue.shift();
    if (!job) return;

    this.running++;

    try {
      const now = Date.now();
      const waitMs = Math.max(0, this.minTimeMs - (now - this.lastStartAt));
      if (waitMs > 0) await sleep(waitMs);
      this.lastStartAt = Date.now();

      const result = await job.fn();
      job.resolve(result);
    } catch (e) {
      job.reject(e);
    } finally {
      this.running--;
      // run next
      this.pump();
    }
  }
}

/**
 * Retry with exponential backoff:
 * - supports 429 + RetryDelay parsing from error message (e.g. "RetryDelay: 14s")
 * - supports quota errors (RESOURCE_EXHAUSTED / "quota")
 */
export async function withRetry<T>(
  fn: AnyFn<T>,
  opts?: {
    maxRetries?: number;      // default 5
    baseDelayMs?: number;     // default 1200
    maxDelayMs?: number;      // default 20000
    jitterRatio?: number;     // default 0.25
    onRetry?: (info: { attempt: number; delayMs: number; err: unknown }) => void;
  }
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 5;
  const baseDelayMs = opts?.baseDelayMs ?? 1200;
  const maxDelayMs = opts?.maxDelayMs ?? 20000;
  const jitterRatio = opts?.jitterRatio ?? 0.25;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      const status = extractStatusCode(err);
      const msg = String(err?.message ?? err);

      // ถ้าไม่ใช่เคสที่ควร retry ให้ throw เลย
      if (!shouldRetry(status, msg, err)) throw err;

      attempt++;
      if (attempt > maxRetries) throw err;

      // ถ้ามี RetryDelay: 14s ให้เคารพ
      const serverDelayMs = parseRetryDelayMs(msg);

      // exponential backoff
      const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));

      // เลือก delay ที่มากกว่า ระหว่าง serverDelay กับ exp
      let delayMs = Math.max(serverDelayMs ?? 0, exp);

      // jitter (สุ่ม +-)
      const jitter = delayMs * jitterRatio * (Math.random() * 2 - 1);
      delayMs = Math.max(250, Math.round(delayMs + jitter));

      opts?.onRetry?.({ attempt, delayMs, err });

      await sleep(delayMs);
      continue;
    }
  }
}

function shouldRetry(status?: number, msg?: string, err?: any) {
  const text = (msg ?? "").toLowerCase();

  // 429 rate limit / quota
  if (status === 429) return true;

  // Gemini/Google APIs มักโยน RESOURCE_EXHAUSTED หรือข้อความ quota
  if (text.includes("resource_exhausted")) return true;
  if (text.includes("quota")) return true;
  if (text.includes("rate limit")) return true;

  // เผื่อ network flake
  if (text.includes("network") || text.includes("fetch")) return true;
  if (text.includes("timeout")) return true;

  // บางที status อยู่ใน err.response.status
  const respStatus = err?.response?.status;
  if (respStatus === 429) return true;

  return false;
}

function extractStatusCode(err: any): number | undefined {
  // รองรับหลายรูปแบบ
  if (typeof err?.status === "number") return err.status;
  if (typeof err?.code === "number") return err.code;
  if (typeof err?.response?.status === "number") return err.response.status;

  // บางที message มี "(429)"
  const m = String(err?.message ?? "").match(/\b(429|500|502|503|504)\b/);
  if (m) return Number(m[1]);
  return undefined;
}

function parseRetryDelayMs(message: string): number | undefined {
  // ตัวอย่างที่คุณเจอ: "RetryDelay: 14s"
  const m = message.match(/RetryDelay:\s*([0-9]+)\s*s/i);
  if (m) return Number(m[1]) * 1000;

  // เผื่อรูปแบบ "retry after 14s" หรือ "retryAfter: 14000"
  const m2 = message.match(/retry\s*after\s*([0-9]+)\s*s/i);
  if (m2) return Number(m2[1]) * 1000;

  const m3 = message.match(/retryAfter:\s*([0-9]+)/i);
  if (m3) return Number(m3[1]);

  return undefined;
}
