/**
 * A clip is either a video file or an ordered sequence of still images (a
 * timelapse straight from the camera). Image sequences have no timing of
 * their own, so they carry a frame rate that defines clip time.
 */

export type ClipSource =
  | { kind: 'video'; file: File; name: string }
  | { kind: 'images'; files: File[]; fps: number; name: string };

export const DEFAULT_SEQUENCE_FPS = 30;

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|bmp|gif)$/i;

/** Still images the browser can decode. RAW and TIFF files are not included. */
export function isImageFile(f: File): boolean {
  return IMAGE_EXT.test(f.name) || (f.type.startsWith('image/') && !/tiff/i.test(f.type));
}

export function isVideoFile(f: File): boolean {
  return f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i.test(f.name);
}

/** Sort by name the way people expect: IMG_2 before IMG_10. */
export function sortNatural(files: File[]): File[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const key = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  return [...files].sort((a, b) => collator.compare(key(a), key(b)));
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/** A short name for output files: the folder name, or the shared file prefix. */
function sequenceName(files: File[]): string {
  const rel = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (rel && rel.includes('/')) {
    const parts = rel.split('/');
    return parts[parts.length - 2];
  }
  const prefix = stripExtension(files[0].name).replace(/[\s_-]*\d+$/, '');
  return prefix || 'sequence';
}

/**
 * Build a source from files the user picked or dropped: one video, or two or
 * more images. Returns null when nothing usable was given.
 */
export function sourceFromFiles(list: Iterable<File>, fps = DEFAULT_SEQUENCE_FPS): ClipSource | null {
  const files = [...list];
  const images = sortNatural(files.filter(isImageFile));
  if (images.length >= 2) return { kind: 'images', files: images, fps, name: sequenceName(images) };
  const video = files.find(isVideoFile) ?? (images.length === 0 ? files[0] : undefined);
  if (video) return { kind: 'video', file: video, name: stripExtension(video.name) || 'video' };
  return null;
}

/** Number of frames and clip length in seconds for an image sequence. */
export function sequenceDuration(src: Extract<ClipSource, { kind: 'images' }>): number {
  return src.files.length / src.fps;
}

/** Index of the image shown at clip time `t` (seconds). */
export function imageIndexAt(t: number, count: number, fps: number): number {
  return Math.min(count - 1, Math.max(0, Math.floor(t * fps)));
}

/**
 * Collect files from a drag-and-drop, descending into dropped folders
 * (Chrome, Edge, Firefox and Safari all support the entries API).
 */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items]
    .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.some((e) => e.isDirectory)) return [...dt.files];

  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns results in batches until it yields an empty array.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}
