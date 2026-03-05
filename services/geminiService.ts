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
    withRetry(call, {
      maxRetries: 1,
      baseDelayMs: 800,
      maxDelayMs: 3000,
      jitterRatio: 0.2,
    })
  );
}

function stripDataUrlPrefix(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/\w+;base64,/, "");
}

// ----------------------------
// analyzeImage
// ----------------------------
export async function analyzeImage(base64Image: string): Promise<DamageDetection[]> {
  const model = getModel();

  // สั้นสุด + บังคับ JSON array only
  const prompt =
    'Detect car damages. Output ONLY a JSON array. ' +
    'Schema: [{"id":"...","type":"Scratch|Dent|Crack|PaintDamage|Other","description":"...","confidence":0-1,' +
    '"isConfirmedDamage":true|false,"boundingBox":[ymin,xmin,ymax,xmax]}]. ' +
    "boundingBox is 0..1000. No markdown, no extra text.";

  const imageData = stripDataUrlPrefix(base64Image);

  const result = await runGemini(() =>
    model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { data: imageData, mimeType: "image/jpeg" } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 180, // ลด output เพิ่มเติม
      },
      // ❌ ห้ามส่ง thinkingConfig เพราะ backend ไม่รับ -> 400
    })
  );

  const text = result.response.text();
  return safeParseJsonArray<DamageDetection>(text);
}

// ----------------------------
// zoomAnalysis (ถ้าคุณยังใช้ใน App.tsx)
// ----------------------------
export async function zoomAnalysis(
  _originalBase64: string,
  zoomedBase64: string,
  hint: string
): Promise<string> {
  const model = getModel();

  const prompt =
    `Verify if the highlighted area is real damage. Hint: ${hint}\n` +
    "Reply with ONE short sentence only.";

  const zoomData = stripDataUrlPrefix(zoomedBase64);

  const result = await runGemini(() =>
    model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { data: zoomData, mimeType: "image/jpeg" } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 60,
      },
    })
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
  } catch {
    return [];
  }
}
