import './style.css';
import { fetchWorlds, streamChat, type World, type Turn } from './api';
import { Recognizer, sttSupported, ttsSupported, speak, narrate, stopSpeaking, setPremiumTTS, listKoreanVoices, setSelectedVoice, getSelectedVoiceName } from './speech';
import { Avatar2D as Avatar, type Emotion, type Action } from './avatar2d';
import { listSaves, upsertSave, removeSave, newSessionId, relativeTime, type Save } from './saves';

const app = document.getElementById('app')!;
const recognizer = new Recognizer();

// ── 앱 상태 ───────────────────────────────────────────────────
const state = {
  worlds: [] as World[],
  world: null as World | null,
  history: [] as Turn[],
  remaining: null as number | null,
  voiceOn: JSON.parse(localStorage.getItem('voxrpg.voice') ?? 'true') as boolean,
  busy: false,
  avatar: null as Avatar | null,
  sessionId: '',
  streaming: { active: false, text: '' },
};

const mouthCb = (v: number) => state.avatar?.setMouthOpen(v);
let streamEl: HTMLElement | null = null;

// ── 렌더링 ────────────────────────────────────────────────────
function esc(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
}

function renderSelect() {
  disposeAvatar();
  app.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <div class="brand"><span>보이스토리</span></div>
        <div class="spacer"></div>
        <span class="pill">말하면 이야기가 시작돼요</span>
      </div>
      <div class="saves" id="saves"></div>
      <div class="hero">
        <h1>어떤 세계로 들어갈까요?</h1>
        <p>세계를 고르고, 마이크를 눌러 말하면 세아가 당신만의 이야기를 살아 움직이는 캐릭터로 들려줍니다.</p>
      </div>
      <div class="worlds" id="worlds"></div>
    </div>`;
  renderSaves();
  const wrap = document.getElementById('worlds')!;
  if (!state.worlds.length) {
    wrap.innerHTML = `<p style="color:var(--muted)">세계를 불러오는 중…</p>`;
    return;
  }
  for (const w of state.worlds) {
    const el = document.createElement('button');
    el.className = 'world';
    el.innerHTML = `
      <span class="badge ${w.free ? 'free' : 'pro'}">${w.free ? '무료' : 'PRO'}</span>
      <h3>${esc(w.name)}</h3>
      <div class="tag">${esc(w.tagline)}</div>`;
    el.onclick = () => startWorld(w);
    wrap.appendChild(el);
  }
}

function renderChat() {
  app.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="iconbtn" id="back">← 세계</button>
        <div class="brand" style="font-size:15px">${esc(state.world!.name)}</div>
        <div class="spacer"></div>
        <span class="pill" id="remain"></span>
        <select class="voicesel" id="voicesel" title="세아 목소리 선택"></select>
        <button class="iconbtn ${state.voiceOn ? 'on' : ''}" id="voice" title="낭독 켜기/끄기">${state.voiceOn ? '🔊' : '🔇'}</button>
      </div>
      <div class="stage" id="stage"></div>
      <div class="log" id="log"></div>
      <div id="banner"></div>
      <div class="inputbar">
        <div class="interim" id="interim"></div>
        <div class="row">
          <textarea class="textin" id="text" rows="1" placeholder="말하거나 여기에 입력…"></textarea>
          <button class="mic" id="mic" title="말하기">🎤</button>
          <button class="send" id="send">보내기</button>
        </div>
        <div class="hint" id="hint"></div>
      </div>
    </div>`;

  document.getElementById('back')!.onclick = () => {
    stopSpeaking(mouthCb);
    recognizer.stop();
    disposeAvatar();
    state.world = null;
    state.history = [];
    renderSelect();
  };
  document.getElementById('voice')!.onclick = toggleVoice;
  document.getElementById('send')!.onclick = onSend;
  document.getElementById('mic')!.onclick = onMic;

  const voicesel = document.getElementById('voicesel') as HTMLSelectElement;
  voicesel.onchange = () => {
    setSelectedVoice(voicesel.value);
    stopSpeaking(mouthCb);
    speak('안녕, 나는 세아야. 이 목소리 괜찮아?', { onMouth: mouthCb });
  };

  const ta = document.getElementById('text') as HTMLTextAreaElement;
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  });

  const hint = document.getElementById('hint')!;
  if (!sttSupported) hint.textContent = '이 브라우저는 음성 인식을 지원하지 않아 텍스트로 진행돼요. (크롬 권장)';
  else if (!ttsSupported) hint.textContent = '이 브라우저는 낭독을 지원하지 않아요.';

  // 아바타 생성 (세계별 캐릭터 세트)
  const stage = document.getElementById('stage') as HTMLElement;
  state.avatar = new Avatar(stage, state.world!.char || 'default');

  populateVoiceSelect();
  renderLog();
  updateRemaining();
}

function populateVoiceSelect() {
  const sel = document.getElementById('voicesel') as HTMLSelectElement | null;
  if (!sel) return;
  const voices = listKoreanVoices();
  if (!voices.length) {
    sel.innerHTML = '<option>기본 목소리</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  const current = getSelectedVoiceName();
  sel.innerHTML = voices
    .map((v) => {
      const label = v.name.replace(/^(Microsoft|Google)\s+/i, '').slice(0, 18);
      return `<option value="${esc(v.name)}"${v.name === current ? ' selected' : ''}>🗣 ${esc(label)}</option>`;
    })
    .join('');
}

function disposeAvatar() {
  state.avatar?.dispose();
  state.avatar = null;
}

function renderLog() {
  const log = document.getElementById('log');
  if (!log) return;
  log.innerHTML = '';
  for (const t of state.history) {
    const div = document.createElement('div');
    div.className = 'msg ' + (t.role === 'assistant' ? 'gm' : 'user');
    div.innerHTML = `<div class="who">${t.role === 'assistant' ? '세아' : '나'}</div>${esc(t.content)}`;
    log.appendChild(div);
  }
  streamEl = null;
  if (state.streaming.active) {
    const div = document.createElement('div');
    div.className = 'msg gm';
    div.innerHTML = `<div class="who">세아</div>${esc(state.streaming.text)}<span class="cursor"></span>`;
    log.appendChild(div);
    streamEl = div;
  } else if (state.busy) {
    const typing = document.createElement('div');
    typing.className = 'typing';
    typing.innerHTML = '세아가 이야기를 짓는 중 <i></i><i></i><i></i>';
    log.appendChild(typing);
  }
  log.scrollTop = log.scrollHeight;
}

function updateStream() {
  if (!streamEl) {
    renderLog();
    return;
  }
  streamEl.innerHTML = `<div class="who">세아</div>${esc(state.streaming.text)}<span class="cursor"></span>`;
  const log = document.getElementById('log');
  if (log) log.scrollTop = log.scrollHeight;
}

function updateRemaining() {
  const el = document.getElementById('remain');
  if (el) el.textContent = state.remaining == null ? '' : `오늘 남은 턴 ${state.remaining}`;
}

function showBanner(kind: 'err' | 'cap', text: string) {
  const b = document.getElementById('banner');
  if (b) b.innerHTML = `<div class="banner ${kind}">${esc(text)}</div>`;
}
function clearBanner() {
  const b = document.getElementById('banner');
  if (b) b.innerHTML = '';
}

// ── 흐름 ─────────────────────────────────────────────────────
function startWorld(w: World) {
  state.world = w;
  state.sessionId = newSessionId();
  state.history = [{ role: 'assistant', content: w.opening }];
  renderChat();
  state.avatar?.setEmotion('neutral');
  if (state.voiceOn) narrate(w.opening, { onMouth: mouthCb });
}

function resumeSave(save: Save) {
  // 세이브에 필요한 정보(id·name·char·history)가 모두 있어 세계 목록 없이도 이어짐
  state.world = { id: save.worldId, name: save.worldName, char: save.char, tagline: '', free: true, opening: '' };
  state.sessionId = save.id;
  state.history = save.history.slice();
  renderChat();
  state.avatar?.setEmotion('neutral');
}

function saveCurrent() {
  if (!state.world || !state.sessionId) return;
  const lastGm = [...state.history].reverse().find((t) => t.role === 'assistant');
  upsertSave({
    id: state.sessionId,
    worldId: state.world.id,
    worldName: state.world.name,
    char: state.world.char || 'default',
    updatedAt: Date.now(),
    preview: (lastGm?.content || '').slice(0, 70),
    history: state.history,
  });
}

function renderSaves() {
  const sec = document.getElementById('saves');
  if (!sec) return;
  const saves = listSaves();
  if (!saves.length) {
    sec.innerHTML = '';
    return;
  }
  sec.innerHTML = `<div class="sec-title">이어하기</div>`;
  for (const s of saves) {
    const card = document.createElement('div');
    card.className = 'save';
    card.innerHTML = `
      <div class="save-main">
        <div class="save-world">${esc(s.worldName)}</div>
        <div class="save-prev">${esc(s.preview)}…</div>
      </div>
      <div class="save-time">${relativeTime(s.updatedAt)}</div>
      <button class="save-del" title="삭제">✕</button>`;
    card.querySelector('.save-main')!.addEventListener('click', () => resumeSave(s));
    card.querySelector('.save-del')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('이 이야기를 삭제할까요?')) {
        removeSave(s.id);
        renderSaves();
      }
    });
    sec.appendChild(card);
  }
}

function toggleVoice() {
  state.voiceOn = !state.voiceOn;
  localStorage.setItem('voxrpg.voice', JSON.stringify(state.voiceOn));
  if (!state.voiceOn) stopSpeaking(mouthCb);
  const btn = document.getElementById('voice')!;
  btn.classList.toggle('on', state.voiceOn);
  btn.textContent = state.voiceOn ? '🔊' : '🔇';
}

function onMic() {
  const mic = document.getElementById('mic')!;
  const interim = document.getElementById('interim')!;
  if (recognizer.listening) {
    recognizer.stop();
    return;
  }
  stopSpeaking(mouthCb); // 낭독 중이면 멈추고 듣기
  mic.classList.add('listening');
  interim.textContent = '듣는 중…';
  recognizer.start({
    onInterim: (t) => (interim.textContent = t),
    onFinal: (t) => {
      interim.textContent = '';
      const ta = document.getElementById('text') as HTMLTextAreaElement;
      ta.value = t;
      submit(t);
    },
    onError: (e) => {
      interim.textContent = '';
      showBanner('err', e);
    },
    onEnd: () => {
      mic.classList.remove('listening');
      if (interim.textContent === '듣는 중…') interim.textContent = '';
    },
  });
}

function onSend() {
  const ta = document.getElementById('text') as HTMLTextAreaElement;
  const text = ta.value.trim();
  if (text) submit(text);
}

async function submit(text: string) {
  if (state.busy || !state.world) return;
  clearBanner();
  const ta = document.getElementById('text') as HTMLTextAreaElement | null;
  if (ta) {
    ta.value = '';
    ta.style.height = 'auto';
  }

  state.history.push({ role: 'user', content: text });
  const historyForServer = state.history.slice();
  state.busy = true;
  state.streaming = { active: true, text: '' };
  renderLog();

  await streamChat(state.world.id, historyForServer, {
    onDelta: (narration) => {
      state.streaming.text = narration;
      updateStream();
    },
    onDone: ({ reply, emotion, action, remaining }) => {
      state.streaming = { active: false, text: '' };
      state.history.push({ role: 'assistant', content: reply });
      state.remaining = remaining;
      state.busy = false;
      renderLog();
      updateRemaining();
      saveCurrent(); // 매 턴 자동 저장
      // 캐릭터 연출
      state.avatar?.setEmotion(emotion as Emotion);
      state.avatar?.playAction(action as Action);
      if (state.voiceOn) narrate(reply, { onMouth: mouthCb });
    },
    onError: (err) => {
      state.streaming = { active: false, text: '' };
      state.busy = false;
      renderLog();
      if (err.capped) {
        state.remaining = 0;
        updateRemaining();
        showBanner('cap', err.message);
      } else {
        showBanner('err', err.message || '오류가 발생했어요.');
      }
    },
  });
}

// ── 부트스트랩 ────────────────────────────────────────────────
async function boot() {
  renderSelect();
  try {
    const h = await fetch('/api/health').then((r) => r.json());
    setPremiumTTS(!!h.tts); // 서버에 TTS 키 있으면 프리미엄 목소리 사용
  } catch { /* health 실패 시 브라우저 TTS */ }
  try {
    state.worlds = await fetchWorlds();
    renderSelect();
  } catch (e: any) {
    const w = app.querySelector('#worlds');
    if (w) w.innerHTML = `<p style="color:var(--danger)">${esc(e.message)} — 백엔드(server)가 켜져 있는지 확인해 주세요.</p>`;
  }
}
boot();

// 목소리 목록이 비동기로 로드되는 기기에서 선택기 갱신
if (ttsSupported) {
  window.speechSynthesis?.addEventListener?.('voiceschanged', () => populateVoiceSelect());
}

// PWA 서비스워커
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
