// services/geminiService.ts
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { ThrottleQueue, withRetry } from "./rateLimit";
import type { DamageDetection } from "../types";

// ✅ ปรับเลขตามที่คุณต้องการ
// - minTimeMs: เว้นระยะขั้นต่ำระหว่าง request
// - concurrency: 1 = ยิงทีละ 1 เพื่อไม่ชน rate limit ง่าย
const limiter = new ThrottleQueue(1, 1400);

// --- your existing config ---
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

function getModel(): GenerativeModel {
  const apiKey = getApiKey();
  const ai = new GoogleGenerativeAI(apiKey);
  return ai.getGenerativeModel({ model: MODEL_NAME });
}

/**
 * helper: run a Gemini call via throttle + retry
 */
async function runGemini<T>(call: () => Promise<T>): Promise<T> {
  return limiter.schedule(() =>
    withRetry(call, {
      maxRetries: 5,
      baseDelayMs: 1200,
      maxDelayMs: 20000,
      jitterRatio: 0.25,
      onRetry: ({ attempt, delayMs, err }) => {
        console.warn(
          `[Gemini retry] attempt=${attempt} delayMs=${delayMs} err=`,
          err
        );
      },
    })
  );
}

// ----------------------------
// Example: analyzeImage
// ----------------------------
export async function analyzeImage(base64Image: string): Promise<DamageDetection[]> {
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

  // ✅ ครอบ generateContent ด้วย runGemini
  const result = await runGemini(async () => {
    return model.generateContent([
      { text: prompt },
      {
        inlineData: {
          data: base64Image.replace(/^data:image\/\w+;base64,/, ""),
          mimeType: "image/jpeg",
        },
      },
    ]);
  });

  const text = result.response.text();

  // parse JSON ตามของเดิมคุณ
  const detections = safeParseJsonArray<DamageDetection>(text);
  return detections;
}

// ----------------------------
// Example: zoomAnalysis
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

  const result = await runGemini(async () => {
    return model.generateContent([
      { text: prompt },
      {
        inlineData: {
          data: zoomedBase64.replace(/^data:image\/\w+;base64,/, ""),
          mimeType: "image/jpeg",
        },
      },
    ]);
  });

  return result.response.text().trim();
}

// ----------------------------
// Utilities
// ----------------------------
function safeParseJsonArray<T>(raw: string): T[] {
  // ดึง JSON ก้อนแรกที่เป็น array ออกมา เผื่อโมเดลพ่นข้อความอื่น
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
