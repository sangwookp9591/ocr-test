/** RGBA → luma 그레이스케일 (BT.601) */
export function toGray(rgba, width, height) {
    const data = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i++, p += 4) {
        data[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    }
    return { data, width, height };
}
/** 대비 스트레칭: 2%~98% 백분위를 0~255로 (감열지 저대비 보정). in-place */
export function stretchContrast(g) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.data.length; i++)
        hist[g.data[i] | 0]++;
    const total = g.data.length;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) {
        acc += hist[v];
        if (acc >= total * 0.02) {
            lo = v;
            break;
        }
    }
    acc = 0;
    for (let v = 255; v >= 0; v--) {
        acc += hist[v];
        if (acc >= total * 0.02) {
            hi = v;
            break;
        }
    }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < g.data.length; i++) {
        g.data[i] = Math.min(255, Math.max(0, ((g.data[i] - lo) * 255) / range));
    }
    return g;
}
