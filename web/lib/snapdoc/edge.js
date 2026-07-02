/** Sobel 그래디언트 크기 */
export function sobel(g) {
    const { data, width: w, height: h } = g;
    const out = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const gx = -data[i - w - 1] + data[i - w + 1]
                - 2 * data[i - 1] + 2 * data[i + 1]
                - data[i + w - 1] + data[i + w + 1];
            const gy = -data[i - w - 1] - 2 * data[i - w] - data[i - w + 1]
                + data[i + w - 1] + 2 * data[i + w] + data[i + w + 1];
            out[i] = Math.hypot(gx, gy);
        }
    }
    return { data: out, width: w, height: h };
}
/** 최대값 대비 비율 임계로 이진화 */
export function threshold(g, ratio = 0.25) {
    let max = 0;
    for (let i = 0; i < g.data.length; i++)
        if (g.data[i] > max)
            max = g.data[i];
    const t = max * ratio;
    const out = new Uint8Array(g.data.length);
    for (let i = 0; i < g.data.length; i++)
        out[i] = g.data[i] > t ? 1 : 0;
    return out;
}
