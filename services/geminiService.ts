import { GoogleGenerativeAI } from "@google/generative-ai";
import { ThrottleQueue } from "./rateLimit";
import type { DamageDetection } from "../types";

const MODEL = "gemini-3-flash-preview";

// 1 req / 13s ตามเดิม (คุณปรับได้)
const limiter = new ThrottleQueue(1, 13000);

// ✅ กันยิงซ้ำ: in-flight dedupe + cache
const inFlight = new Map<string, Promise<DamageDetection[]>>();
const cache = new Map<string, { at: number; data: DamageDetection[] }>();
const CACHE_TTL_MS = 60_000; // 60s

let modelSingleton: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null = null;

function getModel() {
  if (modelSingleton) return modelSingleton;

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI API KEY");

  const genAI = new GoogleGenerativeAI(apiKey);
  modelSingleton = genAI.getGenerativeModel({ model: MODEL });
  return modelSingleton;
}

// ✅ key จากรูป (เบา + เร็ว): ใช้ส่วนหัว/ท้าย + length กันชนกัน
function makeImageKey(base64Image: string) {
  const s = base64Image;
  const head = s.slice(0, 120);
  const tail = s.slice(-120);
  return `${s.length}:${head}:${tail}`;
}

function stripDataUrl(base64Image: string) {
  return base64Image.replace(/^data:image\/\w+;base64,/, "");
}

// ✅ retry เฉพาะ 429 + backoff
async function withRetry429<T>(fn: () => Promise<T>, maxRetry = 3): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      const is429 =
        e?.status === 429 ||
        msg.includes("429") ||
        msg.toLowerCase().includes("too many requests") ||
        msg.toLowerCase().includes("rate limit");

      if (!is429 || attempt >= maxRetry) throw e;

      // exponential backoff + jitter (คุมไม่ให้ยิงถี่)
      const base = 1500 * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 400);
      const waitMs = Math.min(15000, base + jitter);

      await new Promise((r) => setTimeout(r, waitMs));
      attempt++;
    }
  }
}

export async function analyzeImage(base64Image: string): Promise<DamageDetection[]> {
  const key = makeImageKey(base64Image);

  // ✅ cache hit
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  // ✅ in-flight dedupe
  const existing = inFlight.get(key);
  if (existing) return existing;

  const p = (async () => {
    const model = getModel();

    // ✅ prompt สั้นลง เพื่อลด token
    const prompt =
      'Return ONLY a JSON array. No markdown, no extra text.\n' +
      'Each item schema:\n' +
      '{"id":"string","type":"Scratch|Dent|Crack|PaintDamage|Other","description":"string","confidence":0-1,"isConfirmedDamage":true|false,"boundingBox":[ymin,xmin,ymax,xmax]}\n' +
      "Rules:\n" +
      "- boundingBox values are integers 0..1000\n" +
      "- If no damage, return []\n" +
      "- Max 20 items\n";

    const imageData = stripDataUrl(base64Image);

    const result = await limiter.schedule(() =>
      withRetry429(() =>
        model.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    data: imageData,
                    mimeType: "image/jpeg",
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 160, // ✅ ลด token output
            // ถ้า SDK/รุ่นรองรับ ให้เปิดใช้ จะช่วยคุมรูปแบบ output:
            // responseMimeType: "application/json",
          },
        })
      )
    );

    const text = result.response.text();

    let parsed: DamageDetection[] = [];
    try {
      const json = text.match(/\[[\s\S]*\]/)?.[0] ?? "[]";
      parsed = JSON.parse(json);
    } catch {
      parsed = [];
    }

    cache.set(key, { at: Date.now(), data: parsed });
    return parsed;
  })();

  inFlight.set(key, p);

  try {
    return await p;
  } finally {
    inFlight.delete(key);
  }
}
