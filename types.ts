export type DamageDetection = {
  id: string;

  type:
    | "Scratch"
    | "Dent"
    | "Crack"
    | "PaintDamage"
    | "Other";

  description: string;

  // 0..1 confidence
  confidence: number;

  isConfirmedDamage: boolean;

  // [ymin, xmin, ymax, xmax] range 0..1000
  boundingBox: [number, number, number, number];

  // Optional analysis from zoom / finger focus
  zoomAnalysis?: string;
};

export type InspectionImage = {
  id: string;

  url: string;

  name: string;

  analysis: {
    isAnalyzing: boolean;

    detections: DamageDetection[];

    // ใช้คุม queue และ UI state
    hasAnalyzed: boolean;

    error?: string;
  };
};
