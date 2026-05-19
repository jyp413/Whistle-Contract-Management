import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // public/geo/*.json (특히 ~870KB korea-admin.topo.json) — 콘텐츠가 거의 변하지 않으므로
        // 브라우저 캐시 1일 + immutable. 갱신 시엔 파일명에 hash 를 붙여 새 파일로 배포.
        source: '/geo/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, immutable',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
