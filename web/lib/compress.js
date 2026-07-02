// 앱(ImageManipulator resize 1600 + q0.7)과 동일 파라미터 — 감열지 하한선, 줄이지 말 것.
export function fitWithin(w, h, max = 1600) {
  if (w <= max) return { width: w, height: h }; // ponytail: 업스케일 생략(앱은 항상 1600으로 리사이즈하지만 정보 이득 없음)
  return { width: max, height: Math.round(h * (max / w)) };
}

export async function compressImage(file, max = 1600, quality = 0.7) {
  const bmp = await createImageBitmap(file);
  const { width, height } = fitWithin(bmp.width, bmp.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bmp, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}
