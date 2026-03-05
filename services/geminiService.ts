// services/geminiService.ts
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { ThrottleQueue, withRetry } from "./rateLimit";
import type { DamageDetection } from "../types";

const limiter = new ThrottleQueue(1, 1400);
const MODEL_NAME = "gemini-3-flash-preview";

function getApiKey(): string {
  const key = (import.meta.env.VITE_GEMINI_API_KEY as string) || "";
  if (!key) throw new Error("Missing VITE_GEMINI_API_KEY");
  return key;
}

let cachedModel: GenerativeModel | null = null;
function getModel(): GenerativeModel {
  if (cachedModel) return cachedModel;
  const ai = new GoogleGenerativeAI(getApiKey());
  cachedModel = ai.getGenerativeModel({ model: MODEL_NAME });
  return cachedModel;
}

async function runGemini<T>(call: () => Promise<T>): Promise<T> {
  return limiter.schedule(() =>
    withRetry(call, { maxRetries: 1, baseDelayMs: 800, maxDelayMs: 3000, jitterRatio: 0.2 })
  );
}

export async function analyzeImage(base64Image: string): Promise<DamageDetection[]> {
  const model = getModel();

  // ✅ prompt ให้สั้นที่สุด (ลด TEXT token)
  const prompt =
    `Detect car damages. Return ONLY JSON array.
Each item: {"id":"...","type":"Scratch|Dent|Crack|PaintDamage|Other","description":"...","confidence":0-1,"isConfirmedDamage":true|false,"boundingBox":[ymin,xmin,ymax,xmax]} (0..1000)`;

  const imageData = base64Image.replace(/^data:image\/\w+;base64,/, "");

  const result = await runGemini(() =>
    model.generateContent({
      // ✅ ใส่เป็น object เพื่อส่ง config ได้
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { data: imageData, mimeType: "image/jpeg" } },
          ],
        },
      ],

      // ✅ ลด output ให้สั้น
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 300,
      },

      // ✅ ลด thinking (ถ้าโมเดลรองรับ จะลด thoughtsTokenCount ชัดเจน)
      // ถ้าไม่รองรับ มันจะ ignore เฉยๆ ไม่พัง
      // @ts-expect-error - some models/SDK versions support this
      thinkingConfig: { thinkingBudget: 0 },
    })
  );

  const text = result.response.text();
  return safeParseJsonArray<DamageDetection>(text);
}

function safeParseJsonArray<T>(raw: string): T[] {
  const match = raw.match(/\[[\s\S]*\]/);
  const jsonText = match ? match[0] : raw;
  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
