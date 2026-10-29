/** @type {import('next').NextConfig} */
const apiBaseUrl = (process.env.NOVA_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '')

const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiBaseUrl}/api/:path*`,
      },
    ]
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
