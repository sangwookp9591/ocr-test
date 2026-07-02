import type { Gray } from './types.js';
/** RGBA → luma 그레이스케일 (BT.601) */
export declare function toGray(rgba: Uint8ClampedArray, width: number, height: number): Gray;
/** 대비 스트레칭: 2%~98% 백분위를 0~255로 (감열지 저대비 보정). in-place */
export declare function stretchContrast(g: Gray): Gray;
