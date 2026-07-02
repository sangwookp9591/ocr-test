/**
 * 엣지맵에서 "가장 문서다운" 볼록 사각형 검출.
 * 방식: 각 코너 방향의 극점 후보(코너 스코어 = 방향 투영 최대) → 볼록성·면적·직각성 검증.
 * ponytail: RANSAC/허프 없이 극점 스코어링 — 단일 문서 프레이밍 시나리오에 충분.
 *           복잡 배경 다중 사각형이 필요해지면 컨투어 추적으로 승격.
 */
export function findQuad(edges, w, h) {
    // 코너별 스코어 함수: 해당 방향으로 가장 바깥 엣지 픽셀
    let tl = null, tr = null, br = null, bl = null;
    let sTl = -Infinity, sTr = -Infinity, sBr = -Infinity, sBl = -Infinity;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (!edges[y * w + x])
                continue;
            const a = -x - y, b = x - y, c = x + y, d = -x + y;
            if (a > sTl) {
                sTl = a;
                tl = { x, y };
            }
            if (b > sTr) {
                sTr = b;
                tr = { x, y };
            }
            if (c > sBr) {
                sBr = c;
                br = { x, y };
            }
            if (d > sBl) {
                sBl = d;
                bl = { x, y };
            }
        }
    }
    if (!tl || !tr || !br || !bl)
        return null;
    const quad = { tl, tr, br, bl };
    // 면적 (신발끈) — 전체의 10% 미만이면 문서 아님,
    // 95% 초과면 프레임 전체(노이즈/미감지)라 크롭 가치 없음 → null
    const area = polyArea([tl, tr, br, bl]);
    if (area < w * h * 0.1 || area > w * h * 0.95)
        return null;
    // 코너가 프레임 코너와 사실상 일치(평균 이탈 <5% 대각선)면 크롭 무의미 → null
    const diag = Math.hypot(w, h);
    const drift = (Math.hypot(tl.x, tl.y) + Math.hypot(w - tr.x, tr.y) +
        Math.hypot(w - br.x, h - br.y) + Math.hypot(bl.x, h - bl.y)) / 4;
    if (drift < diag * 0.05)
        return null;
    // 볼록성: 모든 코너 외적 같은 부호
    if (!isConvex([tl, tr, br, bl]))
        return null;
    // 직각성: 각 코너 각도가 90°±35° 벗어나면 탈락
    const pts = [tl, tr, br, bl];
    for (let i = 0; i < 4; i++) {
        const p = pts[(i + 3) % 4], q = pts[i], r = pts[(i + 1) % 4];
        const cos = cornerCos(p, q, r);
        if (Math.abs(cos) > 0.57)
            return null; // |cos| 0.57 ≈ 55°/125° 한계
    }
    return quad;
}
function polyArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
}
function isConvex(pts) {
    let sign = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (cross !== 0) {
            const s = Math.sign(cross);
            if (sign === 0)
                sign = s;
            else if (s !== sign)
                return false;
        }
    }
    return true;
}
/** 코너 q에서 p,r로 향하는 두 벡터의 코사인 (0 = 직각) */
function cornerCos(p, q, r) {
    const v1x = p.x - q.x, v1y = p.y - q.y;
    const v2x = r.x - q.x, v2y = r.y - q.y;
    const dot = v1x * v2x + v1y * v2y;
    const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    return n === 0 ? 1 : dot / n;
}
