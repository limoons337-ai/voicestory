// 세이브/이어하기 — localStorage 기반 (기기별, 백엔드 불필요).
// 한 플레이 세션 = 한 세이브. 매 턴 자동 저장. 여러 이야기 동시 보관.
import type { Turn } from './api';

export interface Save {
  id: string;
  worldId: string;
  worldName: string;
  char: string;
  updatedAt: number;
  preview: string;
  history: Turn[];
}

const KEY = 'voxrpg.saves';
const MAX_SAVES = 12;

function readAll(): Save[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(list: Save[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 용량 초과 등은 조용히 무시 */
  }
}

export function listSaves(): Save[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function upsertSave(save: Save) {
  const list = readAll().filter((s) => s.id !== save.id);
  list.unshift(save);
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  writeAll(list.slice(0, MAX_SAVES));
}

export function removeSave(id: string) {
  writeAll(readAll().filter((s) => s.id !== id));
}

export function newSessionId(): string {
  return (crypto as any).randomUUID?.() || 's-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  const date = new Date(ts);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
