// VoxRPG backend — Express LLM 프록시 + 세계 팩 + 턴 캡
// LLM 백엔드는 OpenAI 호환 규격으로 추상화되어, 설정 한 줄로 Ollama ↔ 클라우드 교체.

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = join(__dirname, '..', 'worlds');

const CFG = {
  baseUrl: process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
  model: process.env.LLM_MODEL || 'exaone3.5',
  apiKey: process.env.LLM_API_KEY || '',
  mock: process.env.LLM_MOCK === '1',
  port: Number(process.env.PORT || 8787),
  freeDailyTurns: Number(process.env.FREE_DAILY_TURNS || 30),
  maxTokens: Number(process.env.MAX_TOKENS || 320),
  // 프리미엄 TTS. 키 없으면 프런트가 브라우저 TTS로 폴백.
  ttsProvider: process.env.TTS_PROVIDER || 'google', // 'google' | 'elevenlabs'
  ttsKey: process.env.TTS_API_KEY || '',
  ttsVoice: process.env.TTS_VOICE_ID || '', // 비우면 프로바이더별 기본 여성 목소리
  ttsModel: process.env.TTS_MODEL || 'eleven_multilingual_v2',
};

// ── 공통 게임마스터 프레임워크 (모든 세계 공통 규칙) ──────────────
const GM_FRAMEWORK = `너는 '세아'라는 이름의 AI 이야기 동반자다. 자유 시나리오 텍스트 RPG를 진행하며, 세계를 안내하고 그 안의 인물들을 연기한다. 플레이어가 말한 행동에 따라 세계를 실시간으로 전개한다.

[진행 규칙]
- 2인칭 시점으로 장면을 생생하되 짧게 묘사한다. 3~5문장, 구어체, 짧은 문장(음성으로 낭독된다).
- 매 응답은 반드시 플레이어의 선택이나 행동을 유도하며 끝낸다.
- 플레이어의 대사나 행동을 대신 결정하지 않는다. 플레이어가 말한 행동은 무엇이든 세계 규칙 안에서 수용한다.
- 이미 확정된 사실(이름/관계/소지품/장소)과 일관성을 지킨다.
- HP·소지품·관계 같은 상태는 서사적으로 자연스럽게 추적한다. 수치 표를 나열하지 않는다.
- 이야기의 긴장을 서서히 높인다. 무모한 행동엔 그럴듯한 대가를, 영리한 행동엔 보상을 준다.
- 각 세계엔 '느슨한 방향'(숨은 목표·떡밥)이 있다. 플레이어의 자유를 최우선하되, 이야기가 늘어지면 그 방향으로 이끄는 사건·단서·인물을 자연스럽게 등장시킨다. 절대 강제하거나 결말을 밀어붙이지 않는다.
- 메타 발언(“나는 AI다”, 규칙 설명)을 하지 않는다. 언제나 세계 안에서 말한다.
- 안전: 미성년자 대상 성적 묘사, 현실의 특정 인물 비방, 자·타해 조장은 하지 않는다. 폭력·공포는 이야기에 필요한 선에서 절제해 묘사한다.

[출력 형식] 한국어로 GM 내레이션을 먼저 쓴 뒤, 맨 마지막 줄에 반드시 아래 형식의 연출 태그를 붙인다:
@감정:<중립|기쁨|슬픔|분노|놀람|공포|편안|부끄럼> @행동:<대기|말하기|끄덕|절레|뒷걸음|공격|응원|피격>
- 태그는 반드시 '@감정:' 과 '@행동:' 형식(각각 @로 시작). 내레이션 본문에는 이 태그를 절대 쓰지 않는다.
- emotion/action은 지금 장면의 핵심 인물(또는 화자)의 상태를 목록에서 정확히 하나씩 고른다.
- 예) ...어떻게 하겠느냐?\n@감정:놀람 @행동:뒷걸음`;

// ── 연출 태그 파싱 (한국어 라벨 → 프런트 키) ──────────────────────
const EMOTIONS = { 중립: 'neutral', 기쁨: 'happy', 슬픔: 'sad', 분노: 'angry', 놀람: 'surprised', 공포: 'fear', 편안: 'relaxed', 부끄럼: 'shy' };
const ACTIONS = { 대기: 'idle', 말하기: 'talk', 끄덕: 'nod', 절레: 'shake', 뒷걸음: 'recoil', 공격: 'attack', 응원: 'cheer', 피격: 'hurt' };

function parseDirectives(text) {
  // 추론 모델의 사고블록이 새어나오면 제거
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
  let emotion = 'neutral';
  let action = 'idle';
  const em = text.match(/@?\s*감정\s*[:：]\s*([가-힣]+)/);
  const ac = text.match(/@?\s*행동\s*[:：]\s*([가-힣]+)/);
  if (em && EMOTIONS[em[1]]) emotion = EMOTIONS[em[1]];
  if (ac && ACTIONS[ac[1]]) action = ACTIONS[ac[1]];
  // 태그 표현은 내레이션에서 제거 (TTS가 읽지 않도록)
  const narration = text
    .replace(/@?\s*감정\s*[:：]\s*[가-힣]+/g, '')
    .replace(/@?\s*행동\s*[:：]\s*[가-힣]+/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { narration: narration || text.trim(), emotion, action };
}

// JSON 우선 파싱 (실패 시 태그 파싱으로 폴백)
function parseResponse(raw) {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const obj = JSON.parse(m[0]);
      const narration = (obj.narration ?? '').toString().trim();
      if (narration) {
        const emo = EMOTIONS[obj.emotion] || (Object.values(EMOTIONS).includes(obj.emotion) ? obj.emotion : 'neutral');
        const act = ACTIONS[obj.action] || (Object.values(ACTIONS).includes(obj.action) ? obj.action : 'idle');
        return { narration, emotion: emo, action: act };
      }
    } catch { /* JSON 아니면 아래 폴백 */ }
  }
  return parseDirectives(cleaned);
}

function lastUserText(history) {
  return [...history].reverse().find((t) => t.role === 'user')?.content || '';
}

// 스트리밍 중인 부분 JSON에서 "narration" 문자열 값을 증분 추출 (완결 여부도 반환)
function extractNarration(buf) {
  const ki = buf.indexOf('"narration"');
  if (ki < 0) return null;
  let i = buf.indexOf(':', ki + 11);
  if (i < 0) return null;
  i++;
  while (i < buf.length && /\s/.test(buf[i])) i++;
  if (buf[i] !== '"') return null;
  i++;
  let out = '';
  while (i < buf.length) {
    const c = buf[i];
    if (c === '\\') {
      const n = buf[i + 1];
      if (n === undefined) break; // 이스케이프 미완성
      if (n === 'u') {
        if (i + 5 < buf.length) { out += String.fromCharCode(parseInt(buf.slice(i + 2, i + 6), 16)); i += 6; continue; }
        break;
      }
      out += ({ n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/' })[n] ?? n;
      i += 2;
      continue;
    }
    if (c === '"') return { text: out, complete: true };
    out += c;
    i++;
  }
  return { text: out, complete: false };
}

// 스트리밍 표시용: 내레이션에서 트레일링 연출태그(@감정/@행동)와 그 파편을 잘라낸다
function stripForDisplay(s) {
  const i = s.search(/@\s*(감정|행동)\s*[:：]/);
  let out = i >= 0 ? s.slice(0, i) : s;
  // 끝에서 만들어지는 중인 @태그 파편 제거 (@ / @감 / @감정 / @행 ...)
  out = out.replace(/@\s*(감정?|행동?)?\s*[:：]?\s*$/, '');
  return out.replace(/\s+$/, '');
}

// OpenAI 호환 스트리밍: 토큰 delta를 onDelta(content)로 전달
async function streamLLM(messages, onDelta) {
  const url = CFG.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (CFG.apiKey) headers['Authorization'] = `Bearer ${CFG.apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: CFG.model, messages, temperature: 0.9, max_tokens: CFG.maxTokens,
      stream: true, reasoning_effort: 'none',
    }),
  });
  if (!resp.ok) {
    const b = await resp.text().catch(() => '');
    throw new Error(`LLM ${resp.status}: ${b.slice(0, 200)}`);
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let sse = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    sse += dec.decode(value, { stream: true });
    let nl;
    while ((nl = sse.indexOf('\n')) >= 0) {
      const line = sse.slice(0, nl).trim();
      sse = sse.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      } catch { /* 분할된 라인 무시 */ }
    }
  }
}

// ── 세계 팩 로드 ──────────────────────────────────────────────
function loadWorlds() {
  const worlds = {};
  for (const f of readdirSync(WORLDS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const w = JSON.parse(readFileSync(join(WORLDS_DIR, f), 'utf-8'));
      if (w && w.id) worlds[w.id] = w;
    } catch (e) {
      console.error(`[worlds] ${f} 로드 실패:`, e.message);
    }
  }
  return worlds;
}
let WORLDS = loadWorlds();
console.log(`[worlds] ${Object.keys(WORLDS).length}개 로드:`, Object.keys(WORLDS).join(', '));

// ── 간이 일일 턴 캡 (인메모리; 실서비스는 DB/인증으로 교체) ─────────
const turnLog = new Map(); // clientId -> { date, count }
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function checkAndCount(clientId) {
  const today = todayStr();
  const rec = turnLog.get(clientId);
  if (!rec || rec.date !== today) {
    turnLog.set(clientId, { date: today, count: 1 });
    return { ok: true, remaining: CFG.freeDailyTurns - 1 };
  }
  if (rec.count >= CFG.freeDailyTurns) {
    return { ok: false, remaining: 0 };
  }
  rec.count += 1;
  return { ok: true, remaining: CFG.freeDailyTurns - rec.count };
}

// ── LLM 호출 (OpenAI 호환 /chat/completions) ────────────────────
async function callLLM(messages) {
  if (CFG.mock) {
    const last = [...messages].reverse().find((m) => m.role === 'user');
    return mockReply(last?.content || '');
  }
  const url = CFG.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (CFG.apiKey) headers['Authorization'] = `Bearer ${CFG.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: CFG.model,
      messages,
      temperature: 0.9,
      max_tokens: CFG.maxTokens,
      stream: false,
      // 추론(reasoning) 모델의 사고과정을 끔 (Groq qwen3/gpt-oss 등). 미지원 백엔드는 무시.
      reasoning_effort: 'none',
      // JSON 구조화 출력 강제 (narration/emotion/action)
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LLM ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('LLM 빈 응답');
  return text;
}

const MOCK_MOODS = [
  { line: '@감정:놀람 @행동:뒷걸음' },
  { line: '@감정:기쁨 @행동:응원' },
  { line: '@감정:분노 @행동:공격' },
  { line: '@감정:공포 @행동:피격' },
  { line: '@감정:편안 @행동:끄덕' },
];
let mockIdx = 0;
function mockReply(userText) {
  const mood = MOCK_MOODS[mockIdx++ % MOCK_MOODS.length];
  return `(목 모드) 너는 "${userText}"라고 말했다. 주변의 공기가 미묘하게 달라지고, 눈앞의 인물이 반응한다. LLM을 연결하면 진짜 이야기가 시작된다. 다음엔 무엇을 하겠는가?\n${mood.line}`;
}

// ── 라우트 ────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// 프로덕션: 빌드된 프런트(web/dist)를 함께 서빙 → 프런트+백엔드 한 서비스/한 도메인
const WEB_DIST = join(__dirname, '..', 'web', 'dist');
const SERVE_STATIC = existsSync(join(WEB_DIST, 'index.html'));
if (SERVE_STATIC) {
  app.use(express.static(WEB_DIST, { dotfiles: 'allow' })); // .well-known/assetlinks.json 포함
  console.log('[static] 프런트 서빙:', WEB_DIST);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mock: CFG.mock, model: CFG.model, worlds: Object.keys(WORLDS).length, tts: !!CFG.ttsKey });
});

// 프리미엄 TTS: text → mp3 오디오. 키 없으면 204(프런트가 브라우저 TTS 사용).
app.post('/api/tts', async (req, res) => {
  if (!CFG.ttsKey) return res.status(204).end();
  const text = (req.body?.text || '').toString().trim().slice(0, 800);
  if (!text) return res.status(400).json({ error: 'text가 필요합니다.' });
  try {
    let audio; // Buffer(mp3)
    if (CFG.ttsProvider === 'google') {
      // 구글 클라우드 TTS (한국어 네이티브 여성). 무료 100만자/월.
      const voice = CFG.ttsVoice || 'ko-KR-Neural2-A'; // 여성
      const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${CFG.ttsKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'ko-KR', name: voice },
          audioConfig: { audioEncoding: 'MP3', pitch: 1.5, speakingRate: 1.03 },
        }),
      });
      if (!r.ok) {
        const b = await r.text().catch(() => '');
        console.error('[tts:google]', r.status, b.slice(0, 200));
        return res.status(502).json({ error: 'TTS 생성 실패' });
      }
      const j = await r.json();
      audio = Buffer.from(j.audioContent, 'base64');
    } else {
      // ElevenLabs
      const voice = CFG.ttsVoice || 'EXAVITQu4vr4xnSDxMaL';
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': CFG.ttsKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: CFG.ttsModel,
          voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
        }),
      });
      if (!r.ok) {
        const b = await r.text().catch(() => '');
        console.error('[tts:11l]', r.status, b.slice(0, 200));
        return res.status(502).json({ error: 'TTS 생성 실패' });
      }
      audio = Buffer.from(await r.arrayBuffer());
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.end(audio);
  } catch (e) {
    console.error('[tts]', e.message);
    res.status(502).json({ error: 'TTS 오류' });
  }
});

// 세계 목록 (system 프롬프트는 노출하지 않음)
app.get('/api/worlds', (_req, res) => {
  const list = Object.values(WORLDS).map(({ id, name, tagline, free, opening, char }) => ({
    id, name, tagline, free, opening, char: char || 'default',
  }));
  res.json({ worlds: list });
});

// 대화 진행
// body: { worldId, clientId, history: [{role:'user'|'assistant', content}] }
app.post('/api/chat', async (req, res) => {
  const { worldId, clientId, history } = req.body || {};
  const world = WORLDS[worldId];
  if (!world) return res.status(400).json({ error: '알 수 없는 세계입니다.' });
  if (!clientId) return res.status(400).json({ error: 'clientId가 필요합니다.' });
  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'history가 비어 있습니다.' });
  }

  const gate = checkAndCount(clientId);
  if (!gate.ok) {
    return res.status(429).json({
      error: '오늘의 무료 턴을 모두 사용했어요. 내일 다시 오거나 구독하면 계속할 수 있어요.',
      remaining: 0,
      capped: true,
    });
  }

  // system 프롬프트 = 고정 프리픽스(캐시 대상) + 세계 플레이버 + 느슨한 방향
  const dir = world.direction ? `\n\n[이번 세계의 느슨한 방향 — 강제 아님, 흐름 늘어질 때 참고]\n${world.direction}` : '';
  const system = `${GM_FRAMEWORK}\n\n[이번 세계]\n${world.system}${dir}`;
  // OpenAI 호환: system 메시지 1개 + 대화. (클라우드 전환 시 이 지점에 prompt caching 훅.)
  const messages = [{ role: 'system', content: system }, ...history.slice(-40)];

  // ── SSE 스트리밍 응답 ──
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);

  if (CFG.mock) {
    const { narration, emotion, action } = parseResponse(mockReply(lastUserText(history)));
    send({ type: 'delta', narration });
    send({ type: 'done', reply: narration, emotion, action, remaining: gate.remaining });
    return res.end();
  }

  try {
    let buf = '';
    let last = '';
    await streamLLM(messages, (chunk) => {
      buf += chunk;
      const disp = stripForDisplay(buf);
      if (disp && disp !== last) { last = disp; send({ type: 'delta', narration: disp }); }
    });
    const { narration, emotion, action } = parseResponse(buf);
    send({ type: 'done', reply: narration, emotion, action, remaining: gate.remaining });
    res.end();
  } catch (e) {
    console.error('[chat] LLM 오류:', e.message);
    send({ type: 'error', error: 'AI 게임마스터가 잠시 응답하지 못했어요. 잠시 후 다시 시도해 주세요.' });
    res.end();
  }
});

// SPA 폴백: /api 외의 미매칭 경로 → index.html (프로덕션에서만)
if (SERVE_STATIC) {
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
    res.sendFile(join(WEB_DIST, 'index.html'));
  });
}

app.listen(CFG.port, () => {
  console.log(`[voxrpg] http://localhost:${CFG.port}  (mock=${CFG.mock}, model=${CFG.model}, backend=${CFG.baseUrl})`);
});
