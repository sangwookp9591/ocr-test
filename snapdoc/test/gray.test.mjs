import test from 'node:test';
import assert from 'node:assert';
import { toGray, stretchContrast } from '../dist/gray.js';

test('toGray: 순백/순흑/순적 픽셀 luma', () => {
  // 2x2: 흰, 검, 빨강, 회색(128)
  const rgba = new Uint8ClampedArray([
    255, 255, 255, 255,   0, 0, 0, 255,
    255, 0, 0, 255,       128, 128, 128, 255,
  ]);
  const g = toGray(rgba, 2, 2);
  assert.equal(g.width, 2);
  assert.equal(g.height, 2);
  assert.ok(Math.abs(g.data[0] - 255) < 1);          // 흰 → 255
  assert.ok(Math.abs(g.data[1] - 0) < 1);            // 검 → 0
  assert.ok(Math.abs(g.data[2] - 0.299 * 255) < 1);  // 빨강 → R 가중치
  assert.ok(Math.abs(g.data[3] - 128) < 1);          // 회색 → 128
});

test('stretchContrast: 좁은 범위가 0~255 부근으로 확장', () => {
  // 100~150 사이 값 100개
  const data = new Float32Array(100);
  for (let i = 0; i < 100; i++) data[i] = 100 + (i % 51);
  const g = stretchContrast({ data, width: 10, height: 10 });
  const min = Math.min(...g.data), max = Math.max(...g.data);
  assert.ok(min <= 5, `min=${min}`);
  assert.ok(max >= 250, `max=${max}`);
});
