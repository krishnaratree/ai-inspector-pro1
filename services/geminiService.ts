// services/geminiService.ts
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { ThrottleQueue, withRetry } from "./rateLimit";
import type { DamageDetection } from "../types";

// ✅ Free tier RPM=5 → เว้นอย่างน้อย ~12s ต่อ 1 request (กัน 429)
const limiter = new ThrottleQueue(1, 13000);

// --- config ---
const MODEL_NAME = "gemini-3-flash-preview";

function getApiKey(): string {
  const key = (import.meta.env.VITE_GEMINI_API_KEY as string) || "";
  if (!key) {
    throw new Error(
      "Missing VITE_GEMINI_API_KEY. Please set it in .env.local (local) and Vercel Environment Variables (prod)."
    );
  }
  return key;
}

// ✅ cache model (ไม่สร้าง client/model ใหม่ทุกครั้ง)
let cachedModel: GenerativeModel | null = null;

function getModel(): GenerativeModel {
  if (cachedModel) return cachedModel;
  const apiKey = getApiKey();
  const ai = new GoogleGenerativeAI(apiKey);
  cachedModel = ai.getGenerativeModel({ model: MODEL_NAME });
  return cachedModel;
}

function isDailyQuotaExceeded(err: unknown): boolean {
  const msg = String((err as any)?.message ?? "");
  // เจอคำพวกนี้ใน error 429 แบบ "quota per day" → retry ก็ไม่ช่วย
  return (
    msg.includes("GenerateRequestsPerDay") ||
    msg.includes("quota") ||
    msg.includes("Quota exceeded")
  );
}

/**
 * helper: run a Gemini call via throttle + retry
 */
async function runGemini<T>(call: () => Promise<T>): Promise<T> {
  return limiter.schedule(() =>
    withRetry(call, {
      // ✅ ลด retry เพราะ retry ทำให้กิน RPD/RPM ไว
      maxRetries: 2,
      baseDelayMs: 1500,
      maxDelayMs: 15000,
      jitterRatio: 0.25,
      onRetry: ({ attempt, delayMs, err }) => {
        // ✅ ถ้าเป็นโควต้าต่อวันหมด ไม่ต้อง retry
        if (isDailyQuotaExceeded(err)) {
          throw err;
        }
        console.warn(
          `[Gemini retry] attempt=${attempt} delayMs=${delayMs} err=`,
          err
        );
      },
    })
  );
}

// ----------------------------
// analyzeImage
// ----------------------------
export async function analyzeImage(
  base64Image: string
): Promise<DamageDetection[]> {
  const model = getModel();

  const prompt = `
Analyze this car image for scratches, dents, or paint damage.
Return JSON array with:
[
  {
    "id": "unique",
    "type": "Scratch|Dent|Crack|PaintDamage|Other",
    "description": "...",
    "confidence": 0-1,
    "isConfirmedDamage": true|false,
    "boundingBox": [ymin, xmin, ymax, xmax] // 0..1000
  }
]
No markdown. JSON only.
`.trim();

  const imageData = base64Image.replace(/^data:image\/\w+;base64,/, "");

  const result = await runGemini(() =>
    model.generateContent([
      { text: prompt },
      {
        inlineData: {
          data: imageData,
          mimeType: "image/jpeg",
        },
      },
    ])
  );

  const text = result.response.text();
  return safeParseJsonArray<DamageDetection>(text);
}

// ----------------------------
// zoomAnalysis
// ----------------------------
export async function zoomAnalysis(
  originalBase64: string,
  zoomedBase64: string,
  hint: string
): Promise<string> {
  const model = getModel();

  const prompt = `
You are verifying whether the highlighted area is real damage.
Hint: ${hint}
Return a short sentence report (no JSON).
`.trim();

  const zoomed = zoomedBase64.replace(/^data:image\/\w+;base64,/, "");

  const result = await runGemini(() =>
    model.generateContent([
      { text: prompt },
      {
        inlineData: {
          data: zoomed,
          mimeType: "image/jpeg",
        },
      },
    ])
  );

  return result.response.text().trim();
}

// ----------------------------
// Utilities
// ----------------------------
function safeParseJsonArray<T>(raw: string): T[] {
  const match = raw.match(/\[[\s\S]*\]/);
  const jsonText = match ? match[0] : raw;

  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (e) {
    console.error("JSON parse failed:", e, { raw });
    return [];
  }
}
