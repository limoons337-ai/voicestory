// 음성 입력(STT)·출력(TTS) 래퍼. 브라우저 내장 Web Speech API 사용 → 비용 ₩0.

// ── STT (말하기 → 텍스트) ──────────────────────────────────────
type SR = any;
const SRClass: any =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;

export const sttSupported = !!SRClass;

export interface SttHandlers {
  onInterim?: (text: string) => void; // 실시간(중간) 인식 결과
  onFinal: (text: string) => void; // 최종 결과
  onError?: (err: string) => void;
  onEnd?: () => void;
}

export class Recognizer {
  private rec: SR | null = null;
  private active = false;

  start(h: SttHandlers) {
    if (!SRClass) {
      h.onError?.('이 브라우저는 음성 인식을 지원하지 않아요. 텍스트로 입력해 주세요.');
      return;
    }
    if (this.active) return;
    const rec: SR = new SRClass();
    rec.lang = 'ko-KR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = (ev: any) => {
      let interim = '';
      let final = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) h.onInterim?.(interim);
      if (final) h.onFinal(final.trim());
    };
    rec.onerror = (ev: any) => {
      const map: Record<string, string> = {
        'no-speech': '음성이 들리지 않았어요. 다시 말해 주세요.',
        'not-allowed': '마이크 권한이 필요해요. 브라우저 설정에서 허용해 주세요.',
        'audio-capture': '마이크를 찾을 수 없어요.',
      };
      h.onError?.(map[ev.error] || `음성 인식 오류: ${ev.error}`);
    };
    rec.onend = () => {
      this.active = false;
      h.onEnd?.();
    };
    this.rec = rec;
    this.active = true;
    rec.start();
  }

  stop() {
    if (this.rec && this.active) this.rec.stop();
  }

  get listening() {
    return this.active;
  }
}

// ── TTS (텍스트 → 낭독) ────────────────────────────────────────
// 크롬은 긴 발화를 ~15초에서 끊는 버그가 있어 문장 단위로 큐잉한다.
export const ttsSupported = 'speechSynthesis' in window;

const VOICE_KEY = 'voxrpg.voiceName';

export function listKoreanVoices(): SpeechSynthesisVoice[] {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  return voices.filter((v) => v.lang?.toLowerCase().startsWith('ko') || /korean|한국/i.test(v.name));
}

// 여성·상냥한 목소리 우선 점수
function scoreVoice(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase();
  let s = 0;
  if (/female|여성|heami|sunhi|yuna|nari|seoyeon|jimin|가람|아라|지연|서연|보라/.test(n)) s += 10;
  if (/male|남성|injoon|minjun|민준|현우|namjoon/.test(n)) s -= 10;
  if (/google/.test(n)) s += 4; // 구글 한국어 보이스는 대체로 여성·자연스러움
  if (/네트워크|online|natural|neural/.test(n)) s += 2;
  return s;
}

export function setSelectedVoice(name: string) {
  try { localStorage.setItem(VOICE_KEY, name); } catch {}
}
export function getSelectedVoiceName(): string {
  try { return localStorage.getItem(VOICE_KEY) || ''; } catch { return ''; }
}

function pickKoreanVoice(): SpeechSynthesisVoice | null {
  const list = listKoreanVoices();
  if (!list.length) return null;
  const saved = getSelectedVoiceName();
  if (saved) {
    const hit = list.find((v) => v.name === saved);
    if (hit) return hit;
  }
  // 저장 선택 없으면 여성 우선 자동 선택
  return [...list].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];
}
if (ttsSupported) {
  // 일부 브라우저는 목록이 비동기로 로드됨 — 목록만 미리 워밍
  window.speechSynthesis.onvoiceschanged = () => { listKoreanVoices(); };
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?。…”"’'])\s+|(?<=[다요죠음까네])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface SpeakOpts {
  onMouth?: (v: number) => void; // 0~1 입 개방 (립싱크)
  onDone?: () => void;
}

let mouthTimer: number | null = null;
function clearMouth(onMouth?: (v: number) => void) {
  if (mouthTimer !== null) {
    clearInterval(mouthTimer);
    mouthTimer = null;
  }
  onMouth?.(0);
}

export function speak(text: string, opts: SpeakOpts = {}) {
  const { onMouth, onDone } = opts;
  if (!ttsSupported) {
    onDone?.();
    return;
  }
  window.speechSynthesis.cancel();
  clearMouth();
  const parts = splitSentences(text);
  const voice = pickKoreanVoice();
  let i = 0;

  // 브라우저 무료 TTS는 오디오를 못 주므로 '말하는 동안 뻐끔' 근사 립싱크.
  if (onMouth) {
    let f = 0;
    mouthTimer = window.setInterval(() => {
      f += 1;
      const v = 0.2 + 0.8 * Math.abs(Math.sin(f * 1.25)) * (0.55 + 0.45 * Math.random());
      onMouth(Math.min(1, v));
    }, 90) as unknown as number;
  }

  const next = () => {
    if (i >= parts.length) {
      clearMouth(onMouth);
      onDone?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(parts[i++]);
    u.lang = 'ko-KR';
    if (voice) u.voice = voice;
    u.rate = 1.02;
    u.pitch = 1.12; // 살짝 높여 젊고 밝은 톤
    u.onend = next;
    u.onerror = next;
    window.speechSynthesis.speak(u);
  };
  next();
}

export function stopSpeaking(onMouth?: (v: number) => void) {
  if (ttsSupported) window.speechSynthesis.cancel();
  clearMouth(onMouth);
}
