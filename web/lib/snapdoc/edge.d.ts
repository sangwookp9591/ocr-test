import type { Gray } from './types.js';
/** Sobel 그래디언트 크기 */
export declare function sobel(g: Gray): Gray;
/** 최대값 대비 비율 임계로 이진화 */
export declare function threshold(g: Gray, ratio?: number): Uint8Array;
