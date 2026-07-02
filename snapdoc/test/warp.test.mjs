import test from 'node:test';
import assert from 'node:assert';
import { computeH, applyH } from '../dist/homography.js';
import { warpCpu } from '../dist/warp-cpu.js';

test('computeH: 항등 사각형 → 항등 변환', () => {
  const quad = { tl: { x: 0, y: 0 }, tr: { x: 9, y: 0 }, br: { x: 9, y: 9 }, bl: { x: 0, y: 9 } };
  const H = computeH(quad, 10, 10); // dst (0..9) → src (0..9)
  const p = applyH(H, 3, 7);
  assert.ok(Math.abs(p.x - 3) < 0.01 && Math.abs(p.y - 7) < 0.01, `${p.x},${p.y}`);
});

test('warpCpu: 기울어진 컬러 사각형 → 코너 색 복원', () => {
  // 20x20 캔버스: 사각형 내부를 4분면 색으로 채움
  const w = 20, h = 20;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const quad = { tl: { x: 4, y: 2 }, tr: { x: 17, y: 4 }, br: { x: 15, y: 17 }, bl: { x: 2, y: 15 } };
  // 전체를 quad 중심 기준 4분면 색으로 칠함 (경계 무관하게 단순화)
  const cx = 9.5, cy = 9.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      rgba[p] = x < cx ? 255 : 0;       // 좌 = 빨강
      rgba[p + 1] = y < cy ? 255 : 0;   // 상 = 초록
      rgba[p + 2] = 0;
      rgba[p + 3] = 255;
    }
  }
  const H = computeH(quad, 10, 10);
  const out = warpCpu(rgba, w, h, H, 10, 10);
  assert.equal(out.length, 10 * 10 * 4);
  // 출력 tl 근처(1,1) → 원본 quad tl 근처 = 좌상 = 빨강+초록
  const tl = (1 * 10 + 1) * 4;
  assert.ok(out[tl] > 200 && out[tl + 1] > 200, `tl rgb=${out[tl]},${out[tl + 1]}`);
  // 출력 br 근처(8,8) → 원본 quad br 근처 = 우하 = 검정(빨강0,초록0)
  const br = (8 * 10 + 8) * 4;
  assert.ok(out[br] < 50 && out[br + 1] < 50, `br rgb=${out[br]},${out[br + 1]}`);
});
