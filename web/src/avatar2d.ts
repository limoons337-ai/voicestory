// 2D 아바타 렌더러. 예쁜 애니 일러스트를 감정별로 교체(크로스페이드)하고,
// 숨쉬기(CSS)·말할 때 미세 끄덕임(립싱크 대체)·전이 액션(끄덕/절레/공격 등)을 CSS/JS로 살린다.
// three.js 3D 버전(avatar.ts)과 동일한 공개 API라 main.ts는 렌더러만 바꿔 끼우면 된다.

export type Emotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'fear' | 'relaxed' | 'shy';
export type Action = 'idle' | 'talk' | 'nod' | 'shake' | 'recoil' | 'attack' | 'cheer' | 'hurt';

const EMO_FILE: Record<Emotion, string> = {
  neutral: 'neutral', happy: 'happy', sad: 'sad', angry: 'angry',
  surprised: 'surprised', fear: 'fear', relaxed: 'relaxed', shy: 'shy',
};
// 세트에 파일이 없으면 아래 우선순위로 폴백
const FALLBACK: Partial<Record<Emotion, string>> = { relaxed: 'neutral', shy: 'happy' };
const FILES = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'fear', 'relaxed', 'shy'];

const ACTION_DUR: Record<Action, number> = {
  idle: 0, talk: 0, nod: 0.7, shake: 0.7, recoil: 0.7, attack: 0.55, cheer: 0.9, hurt: 0.6,
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const bump = (p: number) => Math.sin(Math.min(1, Math.max(0, p)) * Math.PI);

export class Avatar2D {
  private motion: HTMLElement;
  private flash: HTMLElement;
  private layers = new Map<string, HTMLImageElement>();
  private raf = 0;
  private disposed = false;
  private last = performance.now();

  private mouthTarget = 0; private mouthCur = 0;
  private action: Action = 'idle'; private actionT = 0;

  private base: string;
  constructor(private stage: HTMLElement, charSet = 'default') {
    this.base = `/avatars/2d/${charSet}/`;
    stage.classList.add('av2d');
    const breathe = document.createElement('div');
    breathe.className = 'av-breathe';
    this.motion = document.createElement('div');
    this.motion.className = 'av-motion';
    breathe.appendChild(this.motion);

    for (const f of FILES) {
      const img = document.createElement('img');
      img.className = 'av-layer';
      img.src = `${this.base}${f}.webp`;
      img.alt = '';
      img.draggable = false;
      img.style.opacity = f === 'neutral' ? '1' : '0';
      // 파일 없으면 조용히 숨김(부분 세트도 동작)
      img.onerror = () => { img.dataset.missing = '1'; img.style.display = 'none'; };
      this.motion.appendChild(img);
      this.layers.set(f, img);
    }
    this.flash = document.createElement('div');
    this.flash.className = 'av-flash';
    this.motion.appendChild(this.flash);

    stage.appendChild(breathe);
    this.loop();
  }

  // ── 공개 API (3D 버전과 동일) ───────────────────────────────
  setEmotion(e: Emotion) {
    if (!(e in EMO_FILE)) e = 'neutral';
    // 이 세트에 존재하는 파일을 폴백 체인으로 결정: 해당표정 → 지정폴백 → neutral
    const chain = [EMO_FILE[e], FALLBACK[e], 'neutral'].filter(Boolean) as string[];
    let shown = 'neutral';
    for (const f of chain) {
      const img = this.layers.get(f);
      if (img && !img.dataset.missing) { shown = f; break; }
    }
    for (const [name, img] of this.layers) {
      if (img.dataset.missing) continue;
      img.style.opacity = name === shown ? '1' : '0';
    }
  }
  playAction(a: Action) {
    if (!(a in ACTION_DUR) || a === 'idle' || a === 'talk') return;
    this.action = a; this.actionT = 0;
  }
  setMouthOpen(v: number) { this.mouthTarget = Math.max(0, Math.min(1, v)); }

  // ── 프레임 루프 ─────────────────────────────────────────────
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    // 립싱크: 말하는 동안 살짝 끄덕임
    this.mouthCur = lerp(this.mouthCur, this.mouthTarget, 1 - Math.pow(0.001, dt));
    let ty = -this.mouthCur * 3;
    let tx = 0;
    let sc = 1 + this.mouthCur * 0.006;
    let rot = 0;
    let flash = 0;

    if (this.action !== 'idle' && this.action !== 'talk') {
      const dur = ACTION_DUR[this.action];
      this.actionT += dt;
      const p = this.actionT / dur;
      const b = bump(p);
      switch (this.action) {
        case 'nod': ty += Math.sin(p * Math.PI * 2) * 8; break;
        case 'shake': tx += Math.sin(p * Math.PI * 4) * 10; break;
        case 'recoil': ty += -b * 12; sc -= b * 0.05; break;
        case 'attack': sc += b * 0.07; ty += b * 5; break;
        case 'cheer': ty += -b * 16; break;
        case 'hurt': tx += Math.sin(p * Math.PI * 6) * 7; flash = b * 0.55; rot = Math.sin(p * Math.PI * 6) * 1.2; break;
      }
      if (p >= 1) this.action = 'idle';
    }

    this.motion.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${sc.toFixed(4)}) rotate(${rot.toFixed(2)}deg)`;
    this.flash.style.opacity = flash.toFixed(2);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.stage.classList.remove('av2d');
    this.stage.innerHTML = '';
  }
}
