import type { Point, Quad } from './types.js';
/**
 * dst 사각형 (0,0)-(dstW-1,dstH-1) → src quad 로 가는 호모그래피 (역방향 워핑용).
 * DLT 4점 대응 → 8x9 연립을 가우스 소거로 풂. 반환: row-major 3x3.
 */
export declare function computeH(src: Quad, dstW: number, dstH: number): Float64Array;
/** H 적용: dst 좌표 → src 좌표 */
export declare function applyH(H: Float64Array, x: number, y: number): Point;
