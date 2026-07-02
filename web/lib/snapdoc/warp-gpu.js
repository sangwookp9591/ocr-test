// WebGPU 원근 워핑 — 텍스처 bilinear 샘플링으로 <5ms.
// @webgpu/types 의존 없이 최소 타입만 로컬 선언 (zero-dep 유지).
/* eslint-disable @typescript-eslint/no-explicit-any */
const WGSL = /* wgsl */ `
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  // 풀스크린 삼각형
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  var out: VSOut;
  out.pos = vec4f(p[i], 0.0, 1.0);
  out.uv = (p[i] + vec2f(1.0)) * 0.5;
  return out;
}

struct U { h0: vec4f, h1: vec4f, h2: vec4f, size: vec4f }; // H rows + (dstW,dstH,srcW,srcH)
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let d = vec2f(in.uv.x * u.size.x, (1.0 - in.uv.y) * u.size.y); // dst 픽셀 좌표
  let w = u.h2.x * d.x + u.h2.y * d.y + u.h2.z;
  let sx = (u.h0.x * d.x + u.h0.y * d.y + u.h0.z) / w;
  let sy = (u.h1.x * d.x + u.h1.y * d.y + u.h1.z) / w;
  let uv = vec2f(sx / u.size.z, sy / u.size.w);
  return textureSampleLevel(tex, samp, uv, 0.0);
}
`;
let devicePromise = null;
function getDevice() {
    if (!devicePromise) {
        const gpu = navigator.gpu;
        devicePromise = gpu
            ? gpu.requestAdapter().then((a) => (a ? a.requestDevice() : null)).catch(() => null)
            : Promise.resolve(null);
    }
    return devicePromise;
}
// 셰이더/파이프라인/샘플러는 device·format 불변이므로 1회 생성 캐시 (호출마다 재컴파일 방지)
let pipeCache = null;
function getPipeline(device, format) {
    if (!pipeCache || pipeCache.device !== device || pipeCache.format !== format) {
        const module = device.createShaderModule({ code: WGSL });
        pipeCache = {
            device,
            format,
            pipeline: device.createRenderPipeline({
                layout: 'auto',
                vertex: { module, entryPoint: 'vs' },
                fragment: { module, entryPoint: 'fs', targets: [{ format }] },
            }),
            sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }),
        };
    }
    return pipeCache;
}
export function warpGpuAvailable() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
}
export async function warpGpu(source, H, dstW, dstH) {
    const device = await getDevice();
    if (!device)
        return null;
    const srcW = source.width, srcH = source.height;
    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('webgpu');
    if (!ctx)
        return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });
    const tex = device.createTexture({
        size: [srcW, srcH],
        format: 'rgba8unorm',
        usage: 0x4 | 0x2 | 0x10, // TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture({ source }, { texture: tex }, [srcW, srcH]);
    // uniform: H 행별 vec4 + 크기
    const uni = new Float32Array([
        H[0], H[1], H[2], 0,
        H[3], H[4], H[5], 0,
        H[6], H[7], H[8], 0,
        dstW, dstH, srcW, srcH,
    ]);
    const ubuf = device.createBuffer({ size: uni.byteLength, usage: 0x40 | 0x8 }); // UNIFORM | COPY_DST
    device.queue.writeBuffer(ubuf, 0, uni);
    const { pipeline, sampler } = getPipeline(device, format);
    const bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: ubuf } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: tex.createView() },
        ],
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
        colorAttachments: [{
                view: ctx.getCurrentTexture().createView(),
                loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    tex.destroy(); // GC 대기 없이 GPU 메모리 즉시 해제
    ubuf.destroy();
    return canvas;
}
