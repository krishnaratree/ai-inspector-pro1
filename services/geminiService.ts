// services/geminiService.ts
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { ThrottleQueue } from "./rateLimit";
import type { DamageDetection } from "../types";

/**
 * กัน 429 (Free tier RPM~5) => 1 request ต่อ ~13 วินาที
 * ถ้าคุณใช้โปรเจกต์ผูก Billing แล้ว ค่อยลดลงได้ (เช่น 2500-4000ms)
 */
const limiter = new ThrottleQueue(1, 13000);

// ใช้ชื่อโมเดลที่คุณใช้อยู่จริงใน AI Studio (จากภาพคือ gemini-3-flash-preview)
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

/**
 * ✅ สำคัญ: ไม่ retry ที่ service (กันยิงซ้ำซ้อน)
 * ให้ retry ไปคุมที่ App.tsx ที่เดียวพอ
 */
async function runGemini<T>(call: () => Promise<T>): Promise<T> {
  return limiter.schedule(() => call());
}

export async function analyzeImage(base64Image: string): Promise<DamageDetection[]> {
  const model = getModel();

  // ✅ prompt สั้นมาก ลด TEXT token
  const prompt =
    `Return ONLY JSON array of damages. ` +
    `Item schema: {"id":"...","type":"Scratch|Dent|Crack|PaintDamage|Other","description":"...","confidence":0-1,"isConfirmedDamage":true|false,"boundingBox":[ymin,xmin,ymax,xmax]} ` +
    `bbox range 0..1000. No markdown.`;

  const imageData = base64Image.replace(/^data:image\/\w+;base64,/, "");

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
        maxOutputTokens: 200, // ✅ ตัด output ให้สั้นลงอีก
      },
      // ❌ ห้ามส่ง thinkingConfig เพราะจาก error ของคุณ: Unknown name "thinkingConfig"
    })
  );

  const text = result.response.text();
  return safeParseJsonArray<DamageDetection>(text);
}

/**
 * ✅ ปิดไว้ก่อนเพื่อ “ลด request + token หนัก ๆ”
 * ถ้าจะกลับมาเปิด ค่อยใช้ทีหลัง (ใน App.tsx มี flag)
 */
export async function zoomAnalysis(
  _originalBase64: string,
  _zoomedBase64: string,
  _hint: string
): Promise<string> {
  // return สั้น ๆ เพื่อไม่ทำอะไรตอนนี้
  return "";
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
