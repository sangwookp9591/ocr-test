import type { Gray, Point, Quad } from './types.js';
import { toGray, stretchContrast } from './gray.js';
import { sobel, threshold } from './edge.js';
import { findQuad } from './quad.js';
import { computeH } from './homography.js';
import { warpCpu } from './warp-cpu.js';
import { warpGpu, warpGpuAvailable } from './warp-gpu.js';
import { blurScore } from './blur.js';

export type { Gray, Point, Quad };
export { blurScore, warpGpuAvailable };

const DETECT_SIZE = 360;   // 감지 작업 해상도 상한
const WARP_MAX = 1600;     // 워핑 출력 상한

export interface ScanResult {
  canvas: HTMLCanvasElement;
  quad: Quad | null;
  blur: number;
}

type Src = CanvasImageSource | ImageData;

function dimsOf(src: Src): { w: number; h: number } {
  if (src instanceof ImageData) return { w: src.width, h: src.height };
  return {
    w: (src as HTMLVideoElement).videoWidth ?? (src as HTMLImageElement).naturalWidth ?? (src as HTMLCanvasElement).width,
    h: (src as HTMLVideoElement).videoHeight ?? (src as HTMLImageElement).naturalHeight ?? (src as HTMLCanvasElement).height,
  };
}

function toCanvas(src: Src, maxSize?: number): HTMLCanvasElement {
  if (src instanceof ImageData) {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d', { willReadFrequently: true })!.putImageData(src, 0, 0);
    return c;
  }
  const { w, h } = dimsOf(src);
  const scale = maxSize ? Math.min(1, maxSize / Math.max(w, h)) : 1;
  if (scale === 1 && src instanceof HTMLCanvasElement) return src; // 이미 적정 캔버스 — 재복사 생략
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d', { willReadFrequently: true })!.drawImage(src as CanvasImageSource, 0, 0, c.width, c.height);
  return c;
}

function grayOf(src: Src, maxSize: number): { g: Gray; scaleX: number; scaleY: number } {
  const { w, h } = dimsOf(src);
  const small = toCanvas(src, maxSize); // 축소는 drawImage 한 번에 (풀해상도 중간 복사 없음)
  const id = small.getContext('2d')!.getImageData(0, 0, small.width, small.height);
  const g = stretchContrast(toGray(id.data, id.width, id.height));
  return { g, scaleX: w / small.width, scaleY: h / small.height };
}

/** 문서 코너 감지 (원본 좌표계). 실패 시 null */
export function detect(src: Src): Quad | null {
  const { g, scaleX, scaleY } = grayOf(src, DETECT_SIZE);
  const q = findQuad(threshold(sobel(g)), g.width, g.height);
  if (!q) return null;
  const s = (p: Point): Point => ({ x: p.x * scaleX, y: p.y * scaleY });
  return { tl: s(q.tl), tr: s(q.tr), br: s(q.br), bl: s(q.bl) };
}

/** 흐림 점수. ok 판정 임계는 소비자 정책 — minBlur로 조정 (기본 60 = 경험값) */
export function quality(src: Src, opts: { minBlur?: number } = {}): { blur: number; ok: boolean } {
  const { g } = grayOf(src, DETECT_SIZE);
  const b = blurScore(g);
  return { blur: b, ok: b >= (opts.minBlur ?? 60) };
}

/** 원근 보정 크롭. GPU 우선, 실패 시 CPU */
export async function warp(
  src: Src, quad: Quad, opts: { maxSize?: number } = {},
): Promise<HTMLCanvasElement> {
  const maxSize = opts.maxSize ?? WARP_MAX;
  const full = toCanvas(src);
  // 출력 크기 = 대응 변 평균 길이 (maxSize 캡)
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  let dstW = Math.round((dist(quad.tl, quad.tr) + dist(quad.bl, quad.br)) / 2);
  let dstH = Math.round((dist(quad.tl, quad.bl) + dist(quad.tr, quad.br)) / 2);
  const cap = Math.min(1, maxSize / Math.max(dstW, dstH));
  dstW = Math.max(1, Math.round(dstW * cap));
  dstH = Math.max(1, Math.round(dstH * cap));

  const H = computeH(quad, dstW, dstH);
  if (warpGpuAvailable()) {
    const gpu = await warpGpu(full, H, dstW, dstH).catch(() => null);
    if (gpu) return gpu;
  }
  const id = full.getContext('2d')!.getImageData(0, 0, full.width, full.height);
  const out = warpCpu(id.data, full.width, full.height, H, dstW, dstH);
  const c = document.createElement('canvas');
  c.width = dstW;
  c.height = dstH;
  c.getContext('2d')!.putImageData(new ImageData(out as unknown as ImageDataArray, dstW, dstH), 0, 0);
  return c;
}

/** 원샷: 감지 → (성공 시) 보정, 실패 시 원본 유지. 흐림 점수 포함 */
export async function scan(file: Blob, opts: { maxSize?: number } = {}): Promise<ScanResult> {
  const bmp = await createImageBitmap(file);
  const full = toCanvas(bmp);
  bmp.close();
  const quad = detect(full);
  const canvas = quad ? await warp(full, quad, opts) : full;
  const blur = quality(canvas).blur;
  return { canvas, quad, blur };
}

/** 라이브 카메라 코너 하이라이트 (~15fps 스로틀). 반환 함수 호출 시 중단 */
export function highlight(video: HTMLVideoElement, overlay: HTMLCanvasElement): () => void {
  let running = true;
  let raf = 0;
  let last = 0;
  const ctx = overlay.getContext('2d')!;
  const loop = (t: number) => {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (t - last < 66) return; // 감지는 ~15fps면 충분 — 60fps 풀 파이프라인은 낭비
    last = t;
    if (!video.videoWidth) return;
    if (overlay.width !== video.videoWidth) overlay.width = video.videoWidth;   // 대입만으로도
    if (overlay.height !== video.videoHeight) overlay.height = video.videoHeight; // 백킹스토어 재할당됨
    const q = detect(video);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (q) {
      ctx.strokeStyle = '#0E9F6E';
      ctx.lineWidth = Math.max(2, overlay.width / 200);
      ctx.beginPath();
      ctx.moveTo(q.tl.x, q.tl.y);
      for (const p of [q.tr, q.br, q.bl, q.tl]) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  };
  raf = requestAnimationFrame(loop);
  return () => {
    running = false;
    cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
  };
}
