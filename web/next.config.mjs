const API = process.env.RECEIPT_API || 'http://localhost:8000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // Docker 런타임 이미지에서 dev deps 제외
  async rewrites() {
    return [
      { source: '/receipt', destination: `${API}/receipt` },
      { source: '/health', destination: `${API}/health` },
    ];
  },
};
export default nextConfig;
