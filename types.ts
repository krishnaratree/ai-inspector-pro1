export type DamageDetection = {
  id: string;
  type: "Scratch" | "Dent" | "Crack" | "PaintDamage" | "Other";
  description: string;
  confidence: number;
  isConfirmedDamage: boolean;
  boundingBox: [number, number, number, number];
};

export type InspectionImage = {
  id: string;
  url: string;
  name: string;
  analysis: {
    isAnalyzing: boolean;
    detections: DamageDetection[];
    error?: string;
    hasAnalyzed?: boolean;
  };
};
