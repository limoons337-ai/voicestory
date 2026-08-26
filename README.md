# 보이스토리 (VoiceStory)

말만 하면 **세아**가 나만의 이야기를 실시간으로 만들어주는 **음성 자유 시나리오 텍스트 RPG** (PWA, 구독형). *(내부 폴더/패키지명은 `voxrpg` 유지)*

기획 배경·원가 구조·로드맵은 [기획서.md](./기획서.md) 참고.

## 구조

```
voxrpg/
├─ 기획서.md         기획·원가·로드맵
├─ worlds/           세계 팩(시나리오) — JSON, 서버가 로드
│   ├─ murim.json    무협 (무료)
│   ├─ isekai.json   이세계 (무료)
│   └─ zombie.json   좀비 (PRO)
├─ server/           백엔드 — Express LLM 프록시 + 턴 캡
│   ├─ index.js
│   └─ .env.example
└─ web/              프런트 — Vite + TS PWA, 음성 입출력
```

**핵심 설계: LLM 백엔드 스위처블(OpenAI 호환).** 개발/베타는 로컬 Ollama(무료), 유료 오픈 시 클라우드로 설정 한 줄 교체.

## 실행 (개발)

### 1. 백엔드
```bash
cd server
npm install
copy .env.example .env   # (PowerShell/CMD) — 또는 cp .env.example .env
npm run dev              # http://localhost:8787
```

- **LLM 없이 UI만 보려면**: `.env`에서 `LLM_MOCK=1` → 정해진 목 응답으로 동작.
- **로컬 Ollama로 진짜 플레이**: Ollama 실행 후 `.env`의 `LLM_MODEL`을 설치된 모델명으로 (예: `exaone3.5`). 기본 주소 `http://localhost:11434/v1`.
- **클라우드로 전환**: `LLM_BASE_URL`을 OpenAI 호환 게이트웨이로, `LLM_API_KEY` 설정.

### 2. 프런트
```bash
cd web
npm install
npm run dev              # http://localhost:5173  (/api 는 8787로 프록시)
```

브라우저에서 http://localhost:5173 → 세계 선택 → 🎤 눌러 말하기.

> 음성 인식(STT)은 **크롬/엣지 권장**. 지원 안 되는 브라우저는 텍스트 입력으로 자동 폴백.

## 움직이는 3D 캐릭터

AI GM이 내레이션 + **연출 태그**(`@감정:… @행동:…`)를 뱉으면, 프런트의 three.js 아바타가 표정·모션을 바꾸고 TTS에 맞춰 입을 움직입니다. **새 아트를 매 턴 생성하지 않으므로 비주얼 비용 ₩0.**

- 기본: 절차적 치비 아바타(에셋 0, 바로 동작).
- **VRoid VRM 넣기**: `web/public/avatars/default.vrm` 에 파일을 넣으면 그 3D 캐릭터로 교체 → [avatars/README](web/public/avatars/README.md) 참고.
- 감정: 중립/기쁨/슬픔/분노/놀람/공포/편안 · 행동: 대기/말하기/끄덕/절레/뒷걸음/공격/응원/피격 (`server/index.js` `EMOTIONS`/`ACTIONS`).

## 다음 작업
- 스트리밍 응답(생성되는 대로 낭독) + 문장 단위 립싱크
- 세이브/로드, 세계 팩 추가, 세계/장면별 캐릭터 교체
- 프리미엄 TTS로 정밀 립싱크(오디오 기반 비셈)
- 클라우드 백엔드 + 프롬프트 캐싱 실측
- 로그인 + 웹 구독 결제 + 서버측 턴 캡/요약
