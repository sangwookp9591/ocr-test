import type { Quad } from './types.js';
/**
 * 엣지맵에서 "가장 문서다운" 볼록 사각형 검출.
 * 방식: 각 코너 방향의 극점 후보(코너 스코어 = 방향 투영 최대) → 볼록성·면적·직각성 검증.
 * ponytail: RANSAC/허프 없이 극점 스코어링 — 단일 문서 프레이밍 시나리오에 충분.
 *           복잡 배경 다중 사각형이 필요해지면 컨투어 추적으로 승격.
 */
export declare function findQuad(edges: Uint8Array, w: number, h: number): Quad | null;
