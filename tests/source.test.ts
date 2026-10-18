import { describe, it, expect } from 'vitest';
import { imageIndexAt, isImageFile, sortNatural, sourceFromFiles } from '../src/ingest/source';

const file = (name: string, type = '') => new File([new Uint8Array(1)], name, { type });

describe('sortNatural', () => {
  it('orders numbered frames numerically', () => {
    const names = sortNatural([file('IMG_10.jpg'), file('IMG_2.jpg'), file('IMG_1.jpg')]).map((f) => f.name);
    expect(names).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg']);
  });
});

describe('isImageFile', () => {
  it('accepts browser-decodable stills and rejects RAW, TIFF and sidecars', () => {
    expect(isImageFile(file('a.JPG'))).toBe(true);
    expect(isImageFile(file('a.webp'))).toBe(true);
    expect(isImageFile(file('a.CR2'))).toBe(false);
    expect(isImageFile(file('a.tif', 'image/tiff'))).toBe(false);
    expect(isImageFile(file('a.xmp'))).toBe(false);
  });
});

describe('sourceFromFiles', () => {
  it('builds a sorted image sequence named after the shared prefix', () => {
    const src = sourceFromFiles([file('sky_0003.jpg'), file('sky_0001.jpg'), file('sky_0002.jpg'), file('notes.xmp')], 25);
    expect(src?.kind).toBe('images');
    if (src?.kind !== 'images') return;
    expect(src.files.map((f) => f.name)).toEqual(['sky_0001.jpg', 'sky_0002.jpg', 'sky_0003.jpg']);
    expect(src.fps).toBe(25);
    expect(src.name).toBe('sky');
  });

  it('picks a video file', () => {
    const src = sourceFromFiles([file('clip.mp4', 'video/mp4')]);
    expect(src).toMatchObject({ kind: 'video', name: 'clip' });
  });

  it('returns null for a single image', () => {
    expect(sourceFromFiles([file('one.jpg')])).toBeNull();
  });
});

describe('imageIndexAt', () => {
  it('maps clip time to the still on screen', () => {
    expect(imageIndexAt(0, 100, 25)).toBe(0);
    expect(imageIndexAt(0.039, 100, 25)).toBe(0);
    expect(imageIndexAt(0.041, 100, 25)).toBe(1);
    expect(imageIndexAt(99, 100, 25)).toBe(99);
  });
});
