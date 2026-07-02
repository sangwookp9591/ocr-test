/** 라플라시안 분산 — 높을수록 선명. 0 = 완전 균일 */
export function blurScore(g) {
    const { data, width: w, height: h } = g;
    let sum = 0, sumSq = 0, n = 0;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const lap = data[i - w] + data[i + w] + data[i - 1] + data[i + 1] - 4 * data[i];
            sum += lap;
            sumSq += lap * lap;
            n++;
        }
    }
    if (n === 0)
        return 0;
    const mean = sum / n;
    return sumSq / n - mean * mean; // 분산
}
