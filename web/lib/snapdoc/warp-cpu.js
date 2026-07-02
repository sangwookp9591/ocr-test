import { applyH } from './homography.js';
/** 역방향 매핑 + bilinear 워핑 (CPU 폴백 경로) */
export function warpCpu(rgba, srcW, srcH, H, dstW, dstH) {
    const out = new Uint8ClampedArray(dstW * dstH * 4);
    for (let y = 0; y < dstH; y++) {
        for (let x = 0; x < dstW; x++) {
            const s = applyH(H, x, y);
            const sx = Math.min(srcW - 1.001, Math.max(0, s.x));
            const sy = Math.min(srcH - 1.001, Math.max(0, s.y));
            const x0 = sx | 0, y0 = sy | 0;
            const fx = sx - x0, fy = sy - y0;
            const p00 = (y0 * srcW + x0) * 4, p10 = p00 + 4;
            const p01 = p00 + srcW * 4, p11 = p01 + 4;
            const o = (y * dstW + x) * 4;
            for (let c = 0; c < 4; c++) {
                out[o + c] =
                    rgba[p00 + c] * (1 - fx) * (1 - fy) + rgba[p10 + c] * fx * (1 - fy) +
                        rgba[p01 + c] * (1 - fx) * fy + rgba[p11 + c] * fx * fy;
            }
        }
    }
    return out;
}
