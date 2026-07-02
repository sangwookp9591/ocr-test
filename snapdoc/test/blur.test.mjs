import test from 'node:test';
import assert from 'node:assert';
import { blurScore } from '../dist/blur.js';

// 체커보드(선명) vs 균일 회색(완전 블러 극단) — 라플라시안 분산 대소 비교
test('blurScore: 선명한 체커보드 > 균일 이미지', () => {
  const w = 16, h = 16;
  const sharp = new Float32Array(w * h);
  const flat = new Float32Array(w * h).fill(128);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      sharp[y * w + x] = (x + y) % 2 ? 255 : 0;
  const sSharp = blurScore({ data: sharp, width: w, height: h });
  const sFlat = blurScore({ data: flat, width: w, height: h });
  assert.ok(sSharp > sFlat * 10, `sharp=${sSharp} flat=${sFlat}`);
  assert.equal(sFlat, 0);
});
