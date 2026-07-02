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
/** 흐림 점수. ok 판정 임계는 소비자 정책 — minBlur로 조정 (기본 60 = 경험값) */
export declare function quality(src: Src, opts?: {
    minBlur?: number;
}): {
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
/** 라이브 카메라 코너 하이라이트 (~15fps 스로틀). 반환 함수 호출 시 중단 */
export declare function highlight(video: HTMLVideoElement, overlay: HTMLCanvasElement): () => void;
