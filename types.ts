// types.ts
export type DamageDetection = {
  id: string;
  type: "Scratch" | "Dent" | "Crack" | "PaintDamage" | "Other";
  description: string;
  confidence: number; // 0..1
  isConfirmedDamage: boolean;
  boundingBox: [number, number, number, number]; // [ymin,xmin,ymax,xmax] 0..1000
  zoomAnalysis?: string;
};

export type InspectionImage = {
  id: string;
  url: string;
  name: string;
  analysis: {
    isAnalyzing: boolean;
    detections: DamageDetection[];
    error?: string;

    /**
     * ✅ สำคัญ: กันคิวหยิบภาพเดิมซ้ำ แม้ detections = []
     * - false = ยังไม่เคยลองวิเคราะห์
     * - true  = เคยวิเคราะห์แล้ว (สำเร็จหรือ error)
     */
    hasAnalyzed?: boolean;
  };
};
