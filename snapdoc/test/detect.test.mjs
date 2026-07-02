import test from 'node:test';
import assert from 'node:assert';
import { sobel, threshold } from '../dist/edge.js';
import { findQuad } from '../dist/quad.js';

// 검은 배경에 흰 볼록 사각형을 그린 합성 그레이 이미지
function synthQuad(w, h, corners) {
  const data = new Float32Array(w * h);
  // 점이 사각형 내부인지: 4변 모두에 대해 같은 방향(볼록)
  const pts = [corners.tl, corners.tr, corners.br, corners.bl];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let inside = true;
      for (let i = 0; i < 4; i++) {
        const a = pts[i], b = pts[(i + 1) % 4];
        const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
        if (cross < 0) { inside = false; break; }
      }
      if (inside) data[y * w + x] = 230;
    }
  }
  return { data, width: w, height: h };
}

test('findQuad: 기울어진 사각형 코너 ±3px 감지', () => {
  const w = 200, h = 200;
  const truth = {
    tl: { x: 40, y: 30 }, tr: { x: 170, y: 45 },
    br: { x: 160, y: 175 }, bl: { x: 30, y: 160 },
  };
  const g = synthQuad(w, h, truth);
  const edges = threshold(sobel(g));
  const q = findQuad(edges, w, h);
  assert.ok(q, 'quad를 찾아야 함');
  for (const k of ['tl', 'tr', 'br', 'bl']) {
    assert.ok(Math.abs(q[k].x - truth[k].x) <= 3, `${k}.x: ${q[k].x} vs ${truth[k].x}`);
    assert.ok(Math.abs(q[k].y - truth[k].y) <= 3, `${k}.y: ${q[k].y} vs ${truth[k].y}`);
  }
});

test('findQuad: 문서 없는 노이즈 이미지 → null', () => {
  const w = 100, h = 100;
  const data = new Float32Array(w * h);
  let seed = 42; // 결정적 의사난수 (Math.random 대체)
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = seed % 256;
  }
  const edges = threshold(sobel({ data, width: w, height: h }));
  assert.equal(findQuad(edges, w, h), null);
});
