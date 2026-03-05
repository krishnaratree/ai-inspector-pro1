// services/geminiService.ts
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { ThrottleQueue, withRetry } from "./rateLimit";
import type { DamageDetection } from "../types";

/**
 * Token/Cost Control Strategy
 * - Force sequential: concurrency=1
 * - Keep small gap to avoid RPM burst
 * - Retry minimal to avoid burning RPD/RPM on failures
 */
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
      maxRetries: 1, // 🔻 ลดการเผา quota จาก retry
      baseDelayMs: 800,
      maxDelayMs: 2500,
      jitterRatio: 0.2,
    })
  );
}

function stripDataUrlPrefix(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/\w+;base64,/, "");
}

/**
 * Parse JSON array strictly.
 * If model returns extra text, we try to extract first [...] block.
 */
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

/**
 * Main: detect damages on car image.
 * HARD token reduction:
 * - ultra-short prompt
 * - low maxOutputTokens
 * - thinkingBudget 0 (if supported)
 */
export async function analyzeImage(base64Image: string): Promise<DamageDetection[]> {
  const model = getModel();

  // 🔻 Prompt สั้นมาก ลด TEXT token
  const prompt =
    'Return ONLY JSON array. Detect car damage. ' +
    'Each: {"id":"d#","type":"Scratch|Dent|Crack|PaintDamage|Other","description":"short","confidence":0-1,"isConfirmedDamage":true|false,"boundingBox":[ymin,xmin,ymax,xmax]} ' +
    "bbox scale 0..1000. No markdown.";

  const imageData = stripDataUrlPrefix(base64Image);

  const result = await runGemini(() =>
    model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, { inlineData: { data: imageData, mimeType: "image/jpeg" } }],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 160, // 🔻 ต่ำลงอีก
        // ถ้า SDK/Model รองรับ จะช่วยบังคับ output เป็น JSON จริงๆ
        // @ts-expect-error - optional field in some versions
        responseMimeType: "application/json",
      },
      // 🔻 ลด thinking
      // @ts-expect-error - some models/SDK versions support this
      thinkingConfig: { thinkingBudget: 0 },
    })
  );

  const text = result.response.text();
  return safeParseJsonArray<DamageDetection>(text);
}

/**
 * Zoom verify: ใช้ “ภาพซูม” + hint สั้นๆ
 * HARD token reduction:
 * - short prompt
 * - maxOutputTokens ต่ำ
 * - thinkingBudget 0
 */
export async function zoomAnalysis(
  _originalBase64: string, // (ยังรับไว้เพื่อไม่ต้องแก้ signature ใน App.tsx)
  zoomedBase64: string,
  hint: string
): Promise<string> {
  const model = getModel();

  // 🔻 สั้นมาก
  const prompt = `Verify damage. Hint: ${hint}. Reply 1 sentence.`;

  const imageData = stripDataUrlPrefix(zoomedBase64);

  const result = await runGemini(() =>
    model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, { inlineData: { data: imageData, mimeType: "image/jpeg" } }],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 60, // 🔻 สั้นมากพอสำหรับ 1 ประโยค
        // @ts-expect-error - optional field in some versions
        responseMimeType: "text/plain",
      },
      // @ts-expect-error - some models/SDK versions support this
      thinkingConfig: { thinkingBudget: 0 },
    })
  );

  return result.response.text().trim();
}
