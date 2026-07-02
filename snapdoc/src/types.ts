/** DOM 무접촉 평면 그레이스케일 버퍼 — CV 모듈 공용 타입 */
export interface Gray {
  data: Float32Array; // 0~255
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 문서 코너 4점 (원본 이미지 좌표계, 시계방향) */
export interface Quad {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}
