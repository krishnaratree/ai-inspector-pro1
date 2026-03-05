import { GoogleGenerativeAI } from "@google/generative-ai";
import { ThrottleQueue } from "./rateLimit";
import type { DamageDetection } from "../types";

const limiter = new ThrottleQueue(1, 13000); // 1 request / 13s

const MODEL = "gemini-3-flash-preview";

function getModel() {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GEMINI API KEY");
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  return genAI.getGenerativeModel({
    model: MODEL,
  });
}

export async function analyzeImage(base64Image: string): Promise<DamageDetection[]> {
  const model = getModel();

  const prompt = `
Return ONLY JSON array.

Schema:
{
"id":"string",
"type":"Scratch|Dent|Crack|PaintDamage|Other",
"description":"string",
"confidence":0-1,
"isConfirmedDamage":true|false,
"boundingBox":[ymin,xmin,ymax,xmax]
}

bbox range 0..1000
`;

  const imageData = base64Image.replace(/^data:image\/\w+;base64,/, "");

  const result = await limiter.schedule(() =>
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
        maxOutputTokens: 200,
      },
    })
  );

  const text = result.response.text();

  try {
    const json = text.match(/\[[\s\S]*\]/)?.[0] ?? "[]";
    return JSON.parse(json);
  } catch {
    return [];
  }
}
