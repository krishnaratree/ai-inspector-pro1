import { GoogleGenAI, Type } from "@google/genai";
import { DamageDetection } from "../types";

// แนะนำ: ถ้า model นี้ยัง error ให้ลองเปลี่ยนเป็น "gemini-2.0-flash" ชั่วคราวเพื่อเทสให้ผ่านก่อน
const MODEL_NAME = "gemini-3-flash-preview";

/**
 * Get Gemini API key from Vite env.
 * NOTE: This exposes the key to the browser bundle.
 * For production, move this call to a backend / serverless function.
 */
function getApiKey(): string {
  const key = (import.meta.env.VITE_GEMINI_API_KEY as string) || "";
  if (!key) {
    // ทำให้ error ชัดเจนว่าปัญหาเป็นเรื่อง env
    throw new Error(
      "Missing VITE_GEMINI_API_KEY. Please set it in .env.local and restart `npm run dev`."
    );
  }
  return key;
}

function getClient(): GoogleGenAI {
  const apiKey = getApiKey();
  return new GoogleGenAI({ apiKey });
}

export async function analyzeImage(base64Image: string): Promise<DamageDetection[]> {
  const ai = getClient();

  const prompt = `
Analyze this car image for scratches, dents, or paint damage.
AGENTIC FINGER FOCUS: Look specifically for fingers or hands pointing at parts of the car.
If a finger is pointing at a surface, treat the area near the fingertip as a high-priority inspection zone.

Identify all suspicious areas. For each area, provide normalized coordinates [ymin, xmin, ymax, xmax] (0-1000 scale).
If an area is near a pointing finger, categorize it with high confidence if damage is visible.
If you find a spot that might be a reflection but it's not 100% clear, mark it for further zoom analysis by setting 'isConfirmedDamage' to false.

Return the result strictly as a JSON array of objects.
`.trim();

  // ป้องกันเคสส่ง data URL ทั้งเส้น
  const imageData = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: imageData,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: {
                type: Type.STRING,
                description: "Type of anomaly detected: 'scratch', 'dent', 'reflection', or 'other'",
              },
              confidence: { type: Type.NUMBER },
              boundingBox: {
                type: Type.ARRAY,
                items: { type: Type.NUMBER },
                description: "[ymin, xmin, ymax, xmax] coordinates (0-1000 scale)",
              },
              description: { type: Type.STRING },
              isConfirmedDamage: {
                type: Type.BOOLEAN,
                description: "True if definitively damage, False if it needs a high-detail zoom check",
              },
            },
            required: ["type", "confidence", "boundingBox", "description", "isConfirmedDamage"],
          },
        },
      },
    });

    const text = response.text || "[]";

    let results: any[] = [];
    try {
      results = JSON.parse(text);
      if (!Array.isArray(results)) results = [];
    } catch (e) {
      console.error("Failed to parse JSON from model:", text);
      results = [];
    }

    return results.map((r: any, index: number) => ({
      ...r,
      id: `det-${index}-${Date.now()}`,
    }));
  } catch (error) {
    console.error("Gemini Detection Error:", error);
    throw error;
  }
}

export async function zoomAnalysis(
  originalBase64: string,
  zoomedBase64: string,
  initialDescription: string
): Promise<string> {
  const ai = getClient();

  const prompt = `
This is a high-resolution zoomed-in view of a suspicious area on a car.
Often, a finger is pointing to this specific area in the original context.

Examine the surface texture, edges, and light refraction carefully.
Identify if this is a physical scratch (depth/irregular edges), a dent, or just a reflection of the surroundings.

Provide a professional, concise technical conclusion (2-3 sentences).
`.trim();

  const zoomedData = zoomedBase64.includes(",") ? zoomedBase64.split(",")[1] : zoomedBase64;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: zoomedData,
              },
            },
          ],
        },
      ],
    });

    return response.text || "Detailed analysis inconclusive.";
  } catch (error) {
    console.error("Gemini Zoom Error:", error);
    return "Failed to complete detailed zoom analysis.";
  }
}

