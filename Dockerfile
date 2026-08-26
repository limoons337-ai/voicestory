# 보이스토리 — 단일 서비스 (프런트 빌드 + Express 백엔드가 함께 서빙)
FROM node:20-slim
WORKDIR /app

# 1) 프런트 빌드
COPY web/package*.json ./web/
RUN cd web && npm install
COPY web ./web
RUN cd web && npm run build

# 2) 백엔드 의존성
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# 3) 소스
COPY server ./server
COPY worlds ./worlds

# LLM/포트는 배포 플랫폼의 환경변수로 주입 (아래 배포-가이드 참고)
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server/index.js"]
