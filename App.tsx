
import React, { useState, useRef, useEffect } from 'react';
import { Upload, AlertCircle, CheckCircle2, Search, Car, RotateCcw, ZoomIn, Info, Plus, X, Image as ImageIcon, Loader2, Fingerprint } from 'lucide-react';
import { analyzeImage, zoomAnalysis } from './services/geminiService';
import { DamageDetection, InspectionImage } from './types';

const MAX_IMAGES = 20;

export default function App() {
  const [images, setImages] = useState<InspectionImage[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [zoomingId, setZoomingId] = useState<string | null>(null);
  
  const imageRef = useRef<HTMLImageElement>(null);
  const currentImage = images[activeIndex] || null;

  // --- Queue Processing Logic ---
  useEffect(() => {
    const processNextInQueue = async () => {
      const nextToProcessIndex = images.findIndex(img => 
        img.analysis.detections.length === 0 && 
        !img.analysis.isAnalyzing && 
        !img.analysis.error
      );

      const isAnythingAnalyzing = images.some(img => img.analysis.isAnalyzing);

      if (nextToProcessIndex !== -1 && !isAnythingAnalyzing) {
        await runAnalysisForIndex(nextToProcessIndex);
      }
    };

    processNextInQueue();
  }, [images]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const remainingSlots = MAX_IMAGES - images.length;
    const filesToProcess = files.slice(0, remainingSlots);

    filesToProcess.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const newImg: InspectionImage = {
          id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          url: event.target?.result as string,
          name: file.name,
          analysis: { isAnalyzing: false, detections: [] }
        };
        setImages(prev => {
          if (prev.some(p => p.name === file.name && p.url.length === newImg.url.length)) return prev;
          return [...prev, newImg];
        });
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const indexToRemove = images.findIndex(img => img.id === id);
    const newImages = images.filter(img => img.id !== id);
    setImages(newImages);
    
    if (activeIndex >= newImages.length) {
      setActiveIndex(Math.max(0, newImages.length - 1));
    } else if (indexToRemove < activeIndex) {
      setActiveIndex(activeIndex - 1);
    }
  };

  const updateImageAnalysis = (index: number, updates: Partial<InspectionImage['analysis']>) => {
    setImages(prev => prev.map((img, idx) => 
      idx === index 
        ? { ...img, analysis: { ...img.analysis, ...updates } }
        : img
    ));
  };

  const runAnalysisForIndex = async (index: number) => {
    const targetImage = images[index];
    if (!targetImage) return;

    updateImageAnalysis(index, { isAnalyzing: true, error: undefined });
    
    try {
      const results = await analyzeImage(targetImage.url);
      
      setImages(prev => prev.map((img, idx) => 
        idx === index 
          ? { ...img, analysis: { isAnalyzing: false, detections: results } }
          : img
      ));
      
      for (const det of results) {
        if (!det.isConfirmedDamage) {
          await performZoomAnalysisForImage(index, det);
        }
      }
    } catch (err) {
      updateImageAnalysis(index, { 
        isAnalyzing: false, 
        detections: [], 
        error: "Analysis failed. Retrying..." 
      });
    }
  };

  const performZoomAnalysisForImage = async (imgIndex: number, detection: DamageDetection) => {
    const targetImage = images[imgIndex];
    if (!targetImage) return;
    
    setZoomingId(detection.id);

    const img = new Image();
    img.src = targetImage.url;
    
    await new Promise(resolve => img.onload = resolve);

    const tempCanvas = document.createElement('canvas');
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return;

    const [ymin, xmin, ymax, xmax] = detection.boundingBox;
    
    const sx = (xmin / 1000) * img.naturalWidth;
    const sy = (ymin / 1000) * img.naturalHeight;
    const sw = ((xmax - xmin) / 1000) * img.naturalWidth;
    const sh = ((ymax - ymin) / 1000) * img.naturalHeight;

    const padding = Math.min(sw, sh) * 0.7; // Slightly more padding for finger context
    const finalSx = Math.max(0, sx - padding);
    const finalSy = Math.max(0, sy - padding);
    const finalSw = Math.min(img.naturalWidth - finalSx, sw + padding * 2);
    const finalSh = Math.min(img.naturalHeight - finalSy, sh + padding * 2);

    tempCanvas.width = 512;
    tempCanvas.height = 512;
    ctx.drawImage(img, finalSx, finalSy, finalSw, finalSh, 0, 0, 512, 512);

    const zoomedDataUrl = tempCanvas.toDataURL('image/jpeg');

    try {
      const report = await zoomAnalysis(targetImage.url, zoomedDataUrl, detection.description);
      
      setImages(prev => prev.map((img, idx) => {
        if (idx === imgIndex) {
          return {
            ...img,
            analysis: {
              ...img.analysis,
              detections: img.analysis.detections.map(d => 
                d.id === detection.id ? { ...d, zoomAnalysis: report } : d
              )
            }
          };
        }
        return img;
      }));
    } catch (err) {
      console.error(err);
    } finally {
      setZoomingId(null);
    }
  };

  const resetAll = () => {
    setImages([]);
    setActiveIndex(0);
  };

  const isAnyProcessing = images.some(img => img.analysis.isAnalyzing);
  const processedCount = images.filter(img => img.analysis.detections.length > 0 || img.analysis.error).length;
  const progressPercent = images.length > 0 ? (processedCount / images.length) * 100 : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center p-4 md:p-8 selection:bg-blue-500/30">
      {/* Header */}
      <header className="w-full max-w-7xl mb-6 text-center space-y-3">
        <div className="inline-flex items-center justify-center p-4 bg-blue-600 rounded-3xl shadow-2xl shadow-blue-900/40 mb-2 border border-blue-400/20">
          <Car className="text-white w-8 h-8" />
        </div>
        <h1 className="text-4xl font-black text-white tracking-tight uppercase">
          Inspector <span className="text-blue-500">Pro</span>
        </h1>
        <div className="flex items-center justify-center gap-2 text-slate-400 text-sm">
          <Fingerprint size={14} className="text-blue-400" />
          <p>Batch Processing • Upload up to 20 photos • Agentic Finger Focus</p>
        </div>
      </header>

      {/* Batch Progress Section */}
      {images.length > 0 && (
        <div className="w-full max-w-7xl mb-6 bg-slate-900/50 border border-slate-800 rounded-3xl p-4 shadow-xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-3">
            <div className="flex items-center gap-3">
              {isAnyProcessing ? (
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-green-400" />
              )}
              <span className="text-sm font-bold tracking-wide">
                {isAnyProcessing ? `BATCH ANALYZING: ${processedCount + 1}/${images.length}` : `SCAN COMPLETED: ${images.length} PHOTOS`}
              </span>
            </div>
            <span className="text-xs font-mono text-slate-500 bg-slate-800 px-3 py-1 rounded-full border border-slate-700">
              {Math.round(progressPercent)}% PROGRESS
            </span>
          </div>
          <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700 p-[2px]">
            <div 
              className="h-full bg-gradient-to-r from-blue-600 to-indigo-500 rounded-full transition-all duration-700 ease-out shadow-[0_0_10px_rgba(37,99,235,0.4)]" 
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Gallery Sidebar / Bottom Row */}
        <div className="lg:col-span-3 lg:h-[700px] flex flex-col gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 flex flex-col h-full shadow-2xl">
            <div className="flex items-center justify-between mb-4 px-2">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">Gallery ({images.length}/{MAX_IMAGES})</h3>
              {images.length > 0 && (
                <button onClick={resetAll} className="text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors uppercase">Clear All</button>
              )}
            </div>
            
            <div className="flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto pb-2 lg:pb-0 custom-scrollbar pr-1 flex-1">
              {images.map((img, idx) => (
                <div 
                  key={img.id}
                  onClick={() => setActiveIndex(idx)}
                  className={`relative flex-shrink-0 w-20 h-20 lg:w-full lg:h-24 rounded-2xl cursor-pointer transition-all duration-300 border-2 overflow-hidden group ${
                    idx === activeIndex ? 'border-blue-500 bg-blue-500/10 scale-[1.02] shadow-lg shadow-blue-500/20' : 'border-slate-800 hover:border-slate-600'
                  }`}
                >
                  <img src={img.url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt={`Inspection ${idx}`} />
                  
                  {/* Overlay for status */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={(e) => removeImage(img.id, e)}
                      className="p-1.5 bg-red-600 rounded-full text-white shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="absolute bottom-2 right-2">
                    {img.analysis.detections.length > 0 ? (
                      <div className="bg-green-500 w-4 h-4 rounded-full border-2 border-slate-900 shadow-xl flex items-center justify-center">
                         <CheckCircle2 size={10} className="text-white" />
                      </div>
                    ) : img.analysis.isAnalyzing ? (
                      <div className="bg-blue-500 w-4 h-4 rounded-full border-2 border-slate-900 shadow-xl animate-pulse" />
                    ) : img.analysis.error ? (
                      <div className="bg-red-500 w-4 h-4 rounded-full border-2 border-slate-900 shadow-xl" />
                    ) : (
                      <div className="bg-slate-700 w-4 h-4 rounded-full border-2 border-slate-900 shadow-xl" />
                    )}
                  </div>
                </div>
              ))}
              
              {images.length < MAX_IMAGES && (
                <label className="flex-shrink-0 w-20 h-20 lg:w-full lg:h-24 rounded-2xl border-2 border-dashed border-slate-800 flex flex-col items-center justify-center text-slate-500 hover:border-blue-500/50 hover:text-blue-400 cursor-pointer transition-all bg-slate-900/40 hover:bg-slate-800/40">
                  <Plus size={24} />
                  <span className="text-[10px] font-black mt-1 uppercase tracking-tighter">Add Photo</span>
                  <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
                </label>
              )}
            </div>
          </div>
        </div>

        {/* Center: Viewer */}
        <div className="lg:col-span-6 space-y-4">
          <div className="relative bg-slate-900 rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-800 aspect-video flex items-center justify-center group ring-1 ring-white/5">
            {!currentImage ? (
              <label className="flex flex-col items-center justify-center cursor-pointer w-full h-full hover:bg-slate-800/40 transition-all p-12 text-center group">
                <div className="w-24 h-24 bg-slate-800 text-blue-500 rounded-[2rem] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-inner border border-slate-700">
                  <Upload className="w-10 h-10" />
                </div>
                <h3 className="text-2xl font-black text-white mb-2 tracking-tight">START BATCH INSPECTION</h3>
                <p className="text-slate-500 text-sm max-w-xs font-medium">Upload up to 20 photos. Point your finger at damage for prioritized AI analysis.</p>
                <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
              </label>
            ) : (
              <>
                <img 
                  ref={imageRef}
                  src={currentImage.url} 
                  className="w-full h-full object-contain" 
                  alt={currentImage.name} 
                />
                
                {/* Bounding Box Overlays */}
                {currentImage.analysis.detections.map((det) => {
                  const [ymin, xmin, ymax, xmax] = det.boundingBox;
                  return (
                    <div 
                      key={det.id}
                      className={`absolute border-2 pointer-events-none transition-all duration-300 ${
                        det.isConfirmedDamage ? 'border-red-500 bg-red-500/10' : 'border-yellow-400 bg-yellow-400/10'
                      } shadow-[0_0_15px_rgba(0,0,0,0.5)]`}
                      style={{
                        top: `${ymin / 10}%`,
                        left: `${xmin / 10}%`,
                        width: `${(xmax - xmin) / 10}%`,
                        height: `${(ymax - ymin) / 10}%`,
                      }}
                    >
                      <div className={`absolute top-0 left-0 -translate-y-full px-2 py-0.5 text-[9px] font-black text-white uppercase tracking-tighter rounded-t-lg flex items-center gap-1 border-t border-x border-white/20 ${
                        det.isConfirmedDamage ? 'bg-red-500' : 'bg-yellow-500'
                      }`}>
                        {det.isConfirmedDamage ? <AlertCircle size={10} /> : <Search size={10} />}
                        {det.type}
                      </div>
                    </div>
                  );
                })}

                {/* Processing Overlay */}
                {currentImage.analysis.isAnalyzing && (
                  <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-md flex flex-col items-center justify-center">
                    <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
                    <p className="font-black text-white text-lg tracking-widest uppercase">Deep Surface Scanning</p>
                    <p className="text-slate-400 text-xs mt-1 animate-pulse font-mono tracking-tighter">Locating finger points & surface artifacts...</p>
                  </div>
                )}
              </>
            )}
          </div>

          {currentImage && (
            <div className="flex items-center gap-3">
              <button 
                onClick={() => updateImageAnalysis(activeIndex, { detections: [], error: undefined })}
                disabled={currentImage.analysis.isAnalyzing}
                className="flex-1 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 font-black uppercase text-xs py-4 px-6 rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 ring-1 ring-white/5"
              >
                <RotateCcw className="w-4 h-4" />
                Re-scan Photo
              </button>
            </div>
          )}
        </div>

        {/* Right: Results Panel */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          <div className="bg-slate-900 rounded-3xl shadow-2xl border border-slate-800 flex flex-col h-[700px] ring-1 ring-white/5">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/50 backdrop-blur-sm rounded-t-3xl">
              <h2 className="text-sm font-black text-white flex items-center gap-2 uppercase tracking-widest">
                <ImageIcon className="text-blue-500 w-4 h-4" />
                Findings
              </h2>
              {currentImage && (
                <span className="px-2 py-0.5 bg-slate-800 text-slate-400 text-[10px] font-bold rounded-md border border-slate-700">
                  {currentImage.analysis.detections.length} DETECTION(S)
                </span>
              )}
            </div>

            <div className="p-4 overflow-y-auto custom-scrollbar flex-1 space-y-4">
              {currentImage?.analysis.error && (
                <div className="bg-red-950/40 text-red-400 p-4 rounded-2xl border border-red-900/50 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                  <p className="text-xs font-bold uppercase tracking-tight leading-tight">{currentImage.analysis.error}</p>
                </div>
              )}

              {!currentImage ? (
                <div className="flex flex-col items-center justify-center h-full py-16 text-slate-600 space-y-4">
                  <div className="p-6 bg-slate-800/50 rounded-[2rem] border border-slate-700 shadow-inner">
                    <Car className="w-10 h-10 opacity-10" />
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest">Awaiting Photo Input</p>
                </div>
              ) : currentImage.analysis.isAnalyzing ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="h-28 bg-slate-800/40 rounded-2xl border border-slate-800 animate-pulse flex flex-col p-4 space-y-2">
                       <div className="w-1/2 h-3 bg-slate-700 rounded-full" />
                       <div className="w-full h-2 bg-slate-700/50 rounded-full" />
                       <div className="w-3/4 h-2 bg-slate-700/50 rounded-full" />
                    </div>
                  ))}
                </div>
              ) : currentImage.analysis.detections.length === 0 ? (
                <div className="text-center py-20 space-y-4">
                  <div className="w-16 h-16 bg-slate-800/50 text-slate-700 rounded-full flex items-center justify-center mx-auto ring-1 ring-slate-700">
                    <Search className="w-8 h-8" />
                  </div>
                  <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest leading-relaxed">System Idle<br/>Waiting for Analysis</p>
                </div>
              ) : (
                currentImage.analysis.detections.map((det) => (
                  <div 
                    key={det.id}
                    className="p-4 bg-slate-800/30 rounded-2xl border border-slate-800 hover:border-slate-700 transition-all group relative overflow-hidden ring-1 ring-white/5"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${det.isConfirmedDamage ? 'bg-red-500 shadow-[0_0_8px_#ef4444]' : 'bg-yellow-400 shadow-[0_0_8px_#facc15]'}`} />
                        <h3 className="font-black text-white text-[11px] capitalize tracking-wide">{det.type}</h3>
                      </div>
                      <span className="text-[9px] font-mono font-bold text-slate-500">
                        {Math.round(det.confidence * 100)}%
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mb-4 leading-normal font-medium">{det.description}</p>
                    
                    <div className="mt-2 pt-3 border-t border-slate-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <ZoomIn size={12} className="text-blue-400" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-blue-400">
                          Finger Focus Report
                        </span>
                      </div>
                      
                      {zoomingId === det.id ? (
                        <div className="flex items-center gap-2 text-blue-400 text-[10px] font-bold animate-pulse">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          CONFIRMING TEXTURE...
                        </div>
                      ) : det.zoomAnalysis ? (
                        <div className="bg-blue-950/30 p-3 rounded-xl border border-blue-900/30">
                          <p className="text-[11px] text-blue-200/80 leading-relaxed font-medium">
                            {det.zoomAnalysis}
                          </p>
                        </div>
                      ) : (
                        <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tight">Verified by Scan</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="p-5 bg-slate-950/50 border-t border-slate-800 rounded-b-3xl">
              <div className="flex items-center justify-between text-[8px] text-slate-500 uppercase font-black tracking-[0.2em]">
                <div className="flex items-center gap-2">
                  <Fingerprint size={10} className="text-blue-500" />
                  <span>Agentic Focus Active</span>
                </div>
                <span>v3.0 PRO</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="mt-12 text-slate-600 text-[10px] pb-10 flex items-center gap-6 font-black uppercase tracking-[0.3em]">
        <span>AI VISUAL INSPECTOR PRO</span>
        <span className="w-1.5 h-1.5 bg-slate-800 rounded-full" />
        <span>20-PHOTO CAPACITY</span>
        <span className="w-1.5 h-1.5 bg-slate-800 rounded-full" />
        <span>FINGER-POINT TRACKING</span>
      </footer>
    </div>
  );
}
