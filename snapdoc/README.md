# snapdoc

**Zero-dependency, WebGPU-accelerated document scanner for the web.**

Detect documents, fix perspective, and check image quality — in the browser, with no OpenCV, no WASM blob, no dependencies.

|  | snapdoc | jscanify (OpenCV.js) |
|---|---|---|
| Bundle size | **~18 KB** (unminified ESM) | ~8 MB |
| Dependencies | **0** | opencv.js |
| Perspective warp | **WebGPU** (<5ms), CPU fallback | CPU |
| Types | TypeScript built-in | — |

## Quick start

```js
import { scan } from 'snapdoc';

const { canvas, quad, blur } = await scan(file); // File/Blob in
// canvas: perspective-corrected crop (or original if no document found)
// quad:   detected corners, null if none
// blur:   sharpness score (Laplacian variance) — gate retakes before upload
```

## API

| Function | What it does |
|---|---|
| `detect(src)` | Find document corners → `Quad \| null` |
| `warp(src, quad, {maxSize})` | Perspective-correct crop → `HTMLCanvasElement` |
| `quality(src)` | `{ blur, ok }` sharpness gate |
| `scan(file, {maxSize})` | detect + warp + quality in one call |
| `highlight(video, overlayCanvas)` | Live corner highlight on a camera stream. Returns `stop()` |

`src` accepts `HTMLCanvasElement`, `HTMLImageElement`, `HTMLVideoElement`, `ImageBitmap`, or `ImageData`.

## How it stays fast

- **Detection runs on CPU at ≤360px** — Sobel + convex-quad scoring takes a few ms; a GPU round-trip would cost more than it saves. This is also what runs per-frame for `highlight()`.
- **Warping runs on WebGPU at full resolution** — perspective correction is literally texture sampling, the thing GPUs were built for. ~85% of 2026 browsers take this path; the rest get a bilinear CPU fallback (~50ms, fine for one-shot scans).
- Thermal-paper receipts get a contrast stretch (2–98 percentile) before detection.

## Demo

```bash
npm install && npm run build
npx http-server .   # open /demo
```

## Development

```bash
npm test   # tsc build + node:test unit tests (pure-function CV modules, no DOM needed)
```

MIT
