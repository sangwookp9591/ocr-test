import type { Gray, Point, Quad } from './types.js';
import { warpGpuAvailable } from './warp-gpu.js';
import { blurScore } from './blur.js';
export type { Gray, Point, Quad };
export { blurScore, warpGpuAvailable };
export interface ScanResult {
    canvas: HTMLCanvasElement;
    quad: Quad | null;
    blur: number;
}
type Src = CanvasImageSource | ImageData;
/** 문서 코너 감지 (원본 좌표계). 실패 시 null */
export declare function detect(src: Src): Quad | null;
/** 흐림 점수 — ok 기준은 경험적 임계(라플라시안 분산 60) */
export declare function quality(src: Src): {
    blur: number;
    ok: boolean;
};
/** 원근 보정 크롭. GPU 우선, 실패 시 CPU */
export declare function warp(src: Src, quad: Quad, opts?: {
    maxSize?: number;
}): Promise<HTMLCanvasElement>;
/** 원샷: 감지 → (성공 시) 보정, 실패 시 원본 유지. 흐림 점수 포함 */
export declare function scan(file: Blob, opts?: {
    maxSize?: number;
}): Promise<ScanResult>;
/** 라이브 카메라 코너 하이라이트. 반환 함수 호출 시 중단 */
export declare function highlight(video: HTMLVideoElement, overlay: HTMLCanvasElement): () => void;
