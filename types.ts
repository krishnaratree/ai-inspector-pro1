
export interface DamageDetection {
  id: string;
  type: 'scratch' | 'dent' | 'reflection' | 'other';
  confidence: number;
  boundingBox: [number, number, number, number]; // [ymin, xmin, ymax, xmax] in normalized 0-1000
  description: string;
  zoomAnalysis?: string;
  isConfirmedDamage: boolean;
}

export interface AnalysisState {
  isAnalyzing: boolean;
  detections: DamageDetection[];
  error?: string;
}

export interface InspectionImage {
  id: string;
  url: string;
  analysis: AnalysisState;
  name: string;
}
