const API = process.env.RECEIPT_API || 'http://localhost:8000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: '/receipt', destination: `${API}/receipt` },
      { source: '/health', destination: `${API}/health` },
    ];
  },
};
export default nextConfig;
