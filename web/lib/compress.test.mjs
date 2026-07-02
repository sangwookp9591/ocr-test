import assert from 'node:assert';
import { fitWithin } from './compress.js';

assert.deepStrictEqual(fitWithin(3200, 2400), { width: 1600, height: 1200 }); // 축소
assert.deepStrictEqual(fitWithin(800, 600), { width: 800, height: 600 });     // 확대 안 함
assert.deepStrictEqual(fitWithin(1600, 900), { width: 1600, height: 900 });   // 경계
console.log('compress selfcheck ok');
