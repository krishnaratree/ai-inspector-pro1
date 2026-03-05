async function compressImageToJpegDataUrl(
  dataUrl: string,
  maxSide = 1024,
  quality = 0.75
): Promise<string> {
  const img = new Image();
  img.src = dataUrl;

  await new Promise<void>((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });

  const w = img.naturalWidth || 1;
  const h = img.naturalHeight || 1;

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = nw;
  canvas.height = nh;

  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  ctx.drawImage(img, 0, 0, nw, nh);
  return canvas.toDataURL("image/jpeg", quality);
}
