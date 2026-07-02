/**
 * dst 사각형 (0,0)-(dstW-1,dstH-1) → src quad 로 가는 호모그래피 (역방향 워핑용).
 * DLT 4점 대응 → 8x9 연립을 가우스 소거로 풂. 반환: row-major 3x3.
 */
export function computeH(src, dstW, dstH) {
    const d = [
        { x: 0, y: 0 }, { x: dstW - 1, y: 0 },
        { x: dstW - 1, y: dstH - 1 }, { x: 0, y: dstH - 1 },
    ];
    const s = [src.tl, src.tr, src.br, src.bl];
    // 미지수 h11..h32 (h33=1) — 8x8 선형계
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
        const { x, y } = d[i];
        const { x: u, y: v } = s[i];
        A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
        b.push(u);
        A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
        b.push(v);
    }
    const h = solve8(A, b);
    return new Float64Array([h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]);
}
/** H 적용: dst 좌표 → src 좌표 */
export function applyH(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return {
        x: (H[0] * x + H[1] * y + H[2]) / w,
        y: (H[3] * x + H[4] * y + H[5]) / w,
    };
}
/** 부분 피벗 가우스 소거 (8x8) */
function solve8(A, b) {
    const n = 8;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
        let piv = col;
        for (let r = col + 1; r < n; r++)
            if (Math.abs(M[r][col]) > Math.abs(M[piv][col]))
                piv = r;
        [M[col], M[piv]] = [M[piv], M[col]];
        const p = M[col][col];
        if (Math.abs(p) < 1e-12)
            throw new Error('degenerate quad');
        for (let r = 0; r < n; r++) {
            if (r === col)
                continue;
            const f = M[r][col] / p;
            for (let c = col; c <= n; c++)
                M[r][c] -= f * M[col][c];
        }
    }
    return M.map((row, i) => row[n] / M[i][i]);
}
