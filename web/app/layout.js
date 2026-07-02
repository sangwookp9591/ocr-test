import './globals.css';

export const metadata = { title: '영수증 스캔', description: '영수증 OCR 프로바이더 A/B 테스트' };

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
