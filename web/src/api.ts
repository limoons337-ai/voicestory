// 백엔드 통신. 개발 중엔 Vite 프록시가 /api → localhost:8787 로 전달.

export interface World {
  id: string;
  name: string;
  tagline: string;
  free: boolean;
  opening: string;
  char: string;
}

export type Turn = { role: 'user' | 'assistant'; content: string };

// 익명 클라이언트 ID (턴 캡용). 실서비스에선 로그인/구독으로 교체.
export function getClientId(): string {
  const KEY = 'voxrpg.clientId';
  const existing = localStorage.getItem(KEY);
  if (existing) return existing;
  const id: string = (crypto as any).randomUUID?.() ?? 'c-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem(KEY, id);
  return id;
}

export async function fetchWorlds(): Promise<World[]> {
  const res = await fetch('/api/worlds');
  if (!res.ok) throw new Error('세계 목록을 불러오지 못했어요.');
  const data = await res.json();
  return data.worlds as World[];
}

export interface ChatDone {
  reply: string;
  emotion: string;
  action: string;
  remaining: number;
}
export interface StreamCbs {
  onDelta: (narration: string) => void;
  onDone: (r: ChatDone) => void;
  onError: (e: { message: string; capped?: boolean }) => void;
}

// SSE 스트리밍 소비: narration이 생성되는 대로 onDelta, 완료 시 onDone(emotion/action 포함)
export async function streamChat(worldId: string, history: Turn[], cb: StreamCbs): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId, clientId: getClientId(), history }),
    });
  } catch {
    cb.onError({ message: '네트워크 오류. 백엔드가 켜져 있는지 확인해 주세요.' });
    return;
  }
  if (!res.ok || !res.body) {
    const d: any = await res.json().catch(() => ({}));
    cb.onError({ message: d.error || '요청에 실패했어요.', capped: d.capped === true });
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const evt = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = evt.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      let j: any;
      try {
        j = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (j.type === 'delta') cb.onDelta(j.narration);
      else if (j.type === 'done') cb.onDone(j as ChatDone);
      else if (j.type === 'error') cb.onError({ message: j.error, capped: j.capped });
    }
  }
}
