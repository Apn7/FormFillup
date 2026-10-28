export const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function guessMime(file: { name: string; type: string }): string {
  if (ACCEPTED_TYPES.includes(file.type)) return file.type;
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  return { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext] ?? '';
}

/** Validate a candidate file list. Returns the accepted files and human-readable problems. */
export function checkFiles<T extends { name: string; type: string; size: number }>(
  existing: T[],
  incoming: T[],
  maxTotal = MAX_TOTAL_BYTES,
): { accepted: T[]; errors: string[] } {
  const errors: string[] = [];
  const accepted: T[] = [];
  let total = existing.reduce((n, f) => n + f.size, 0);
  for (const f of incoming) {
    if (!guessMime(f)) {
      errors.push(`${f.name}: unsupported type. Use PDF, JPG, PNG or WEBP.`);
    } else if (f.size === 0) {
      errors.push(`${f.name}: the file is empty.`);
    } else if (existing.some((e) => e.name === f.name && e.size === f.size) || accepted.some((e) => e.name === f.name && e.size === f.size)) {
      errors.push(`${f.name}: already added.`);
    } else if (total + f.size > maxTotal) {
      errors.push(`${f.name} (${formatSize(f.size)}): would exceed the ${formatSize(maxTotal)} total limit.`);
    } else {
      total += f.size;
      accepted.push(f);
    }
  }
  return { accepted, errors };
}

/** Longest edge after downscaling. Keeps certificate and NID text legible for the AI. */
export const IMAGE_MAX_EDGE = 2000;
const IMAGE_QUALITY = 0.85;
/** Images already this small are sent as-is. */
const IMAGE_SHRINK_THRESHOLD = 1.5 * 1024 * 1024;

/** Target size for an image whose longest edge is capped at `maxEdge`. Never upscales. */
export function scaledSize(width: number, height: number, maxEdge = IMAGE_MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Re-encode a large photo as a downscaled JPEG. PDFs, small images and anything the browser cannot
 * decode are returned unchanged. EXIF orientation is applied, so rotated phone photos stay upright.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (!guessMime(file).startsWith('image/') || file.size <= IMAGE_SHRINK_THRESHOLD) return file;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: IMAGE_QUALITY });
    if (blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}

/** Read a File/Blob as raw base64 (no data: prefix). */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.onload = () => {
      const s = String(r.result ?? '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.readAsDataURL(file);
  });
}
