# 보이스토리 — 단일 서비스 (프런트 빌드 + Express 백엔드가 함께 서빙)
FROM node:20-slim
WORKDIR /app

# 1) 프런트 빌드 (devDeps 포함 설치 → vite 사용 가능)
COPY web/package.json web/package-lock.json* ./web/
RUN cd web && npm install
COPY web ./web
# dist/index.html 이 생겼는지 검증 (없으면 빌드를 실패시켜 로그로 드러냄)
RUN cd web && npm run build && ls -la dist && test -f dist/index.html && echo "=== DIST BUILD OK ==="

# 2) 백엔드 의존성
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# 3) 소스
COPY server ./server
COPY worlds ./worlds

# LLM/포트는 배포 플랫폼의 환경변수로 주입
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server/index.js"]
