// 앱(ImageManipulator resize 1600 + q0.7)과 동일 파라미터(업스케일만 생략) — 감열지 하한선, 줄이지 말 것.
export function fitWithin(w, h, max = 1600) {
  if (w <= max) return { width: w, height: h }; // ponytail: 업스케일 생략(정보 이득 없음)
  return { width: max, height: Math.round(h * (max / w)) };
}

export async function compressImage(file, max = 1600, quality = 0.7) {
  const bmp = await createImageBitmap(file);
  const { width, height } = fitWithin(bmp.width, bmp.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d', { alpha: false }).drawImage(bmp, 0, 0, width, height);
  bmp.close(); // 원본 해상도 디코드 비트맵 즉시 해제
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}
