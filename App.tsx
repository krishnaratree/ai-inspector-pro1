import React, { useState, useEffect, useRef } from "react";
import { analyzeImage } from "./services/geminiService";
import type { InspectionImage } from "./types";

const MAX_IMAGES = 20;

async function compressImage(dataUrl: string): Promise<string> {
  const img = new Image();
  img.src = dataUrl;

  await new Promise((r) => (img.onload = r));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  const max = 1024;

  let w = img.width;
  let h = img.height;

  if (w > h && w > max) {
    h *= max / w;
    w = max;
  }

  if (h > max) {
    w *= max / h;
    h = max;
  }

  canvas.width = w;
  canvas.height = h;

  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL("image/jpeg", 0.75);
}

export default function App() {
  const [images, setImages] = useState<InspectionImage[]>([]);
  const retryRef = useRef<Record<string, number>>({});

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);

    files.slice(0, MAX_IMAGES).forEach((file) => {
      const reader = new FileReader();

      reader.onload = async (ev) => {
        const raw = ev.target?.result as string;

        const compressed = await compressImage(raw);

        const newImg: InspectionImage = {
          id: crypto.randomUUID(),
          url: compressed,
          name: file.name,
          analysis: {
            isAnalyzing: false,
            detections: [],
            hasAnalyzed: false,
          },
        };

        retryRef.current[newImg.id] = 0;

        setImages((prev) => [...prev, newImg]);
      };

      reader.readAsDataURL(file);
    });
  };

  useEffect(() => {
    const running = images.some((i) => i.analysis.isAnalyzing);
    if (running) return;

    const next = images.find((i) => !i.analysis.hasAnalyzed);

    if (!next) return;

    analyze(next.id);
  }, [images]);

  async function analyze(id: string) {
    setImages((prev) =>
      prev.map((img) =>
        img.id === id
          ? { ...img, analysis: { ...img.analysis, isAnalyzing: true } }
          : img
      )
    );

    try {
      const img = images.find((i) => i.id === id)!;

      const result = await analyzeImage(img.url);

      setImages((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                analysis: {
                  ...i.analysis,
                  detections: result,
                  isAnalyzing: false,
                  hasAnalyzed: true,
                },
              }
            : i
        )
      );
    } catch (e) {
      setImages((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                analysis: {
                  ...i.analysis,
                  isAnalyzing: false,
                  hasAnalyzed: true,
                  error: "analysis failed",
                },
              }
            : i
        )
      );
    }
  }

  return (
    <div style={{ padding: 40 }}>
      <h2>AI Inspector</h2>

      <input type="file" multiple accept="image/*" onChange={handleUpload} />

      <div style={{ marginTop: 20 }}>
        {images.map((img) => (
          <div key={img.id} style={{ marginBottom: 20 }}>
            <img src={img.url} width={200} />

            <pre>{JSON.stringify(img.analysis.detections, null, 2)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
