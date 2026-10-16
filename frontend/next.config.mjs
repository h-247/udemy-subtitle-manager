/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/',
        destination: '/dashboard',
        permanent: false,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.udemycdn.com',
      },
      {
        protocol: 'https',
        hostname: 'img-c.udemycdn.com',
      },
      {
        protocol: 'https',
        hostname: 'img-b.udemycdn.com',
      },
      {
        protocol: 'https',
        hostname: '**.udemy.com',
      },
    ],
  },
};

export default nextConfig;
