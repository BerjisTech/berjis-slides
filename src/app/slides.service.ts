import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
import { PresentationData, SlideElement, SlideModel, createId, createSlide } from './models/slide';

export type SlideStatus = 'active' | 'archived' | 'deleted';
export interface SlideDoc {
  id: string;
  title?: string;
  data?: PresentationData;
  status: SlideStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SlideCollaborator {
  userId: string;
  role: 'viewer' | 'commenter' | 'editor';
  invitedBy?: string;
  createdAt?: string;
}

interface ApiResponse<T> { success?: boolean; data?: T; message?: string }

const API_BASE = normalizeBase(environment.slidesApiBase || 'https://slides-api.berjis.tech');
const STORAGE_KEY = 'berjis-slides';

@Injectable({ providedIn: 'root' })
export class SlidesService {
  private cache: Record<string, SlideDoc> = {};
  private preferRemote = true;
  syncMode: 'remote'|'local' = 'remote';
  isSaving = false;
  lastSavedAt: string | null = null;
  lastError: string | null = null;

  constructor(private http: HttpClient) { this.load(); }
  private load() {
    this.cache = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, SlideDoc> | SlideDoc[] | undefined;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const doc = this.normalizeDoc(entry);
          if (doc) {
            this.cache[doc.id] = doc;
          }
        }
        return;
      }
      if (parsed && typeof parsed === 'object') {
        for (const value of Object.values(parsed)) {
          const doc = this.normalizeDoc(value);
          if (doc) {
            this.cache[doc.id] = doc;
          }
        }
      }
    } catch {
      this.cache = {};
    }
  }
  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
    } catch {
      // ignore quota / private mode failures
    }
  }
  private now() { return new Date().toISOString(); }

  async list(status: SlideStatus[] = ['active']): Promise<SlideDoc[]> {
    if (this.preferRemote) {
      try {
        const res = await firstValueFrom(this.http.get<ApiResponse<unknown>>(`${API_BASE}/v1/slides`, {
          params: { status: status.join(',') },
          withCredentials: true
        }));
        const rows = this.normalizeDocs(res?.data);
        this.mergeCache(rows);
        this.preferRemote = true;
        this.syncMode = 'remote';
        this.lastError = null;
        return rows;
      } catch (e) {
        this.switchToLocal(e);
      }
    }
    return this.filterCached(status);
  }
  get(id: string) { return this.cache[id]; }
  async fetch(id: string): Promise<SlideDoc|undefined> {
    if (this.preferRemote) {
      try {
        const res = await firstValueFrom(this.http.get<ApiResponse<unknown>>(`${API_BASE}/v1/slides/${id}`, { withCredentials: true }));
        const doc = this.normalizeDoc(res?.data);
        if (doc) {
          this.cache[doc.id] = doc;
          this.persist();
        }
        this.preferRemote = true; this.syncMode='remote'; this.lastError=null; return doc || undefined;
      } catch (e) { this.switchToLocal(e); }
    }
    return this.cache[id];
  }

  async create(initial?: Partial<SlideDoc>): Promise<SlideDoc> {
    const tmp: SlideDoc = { id: this.uuid(), title: initial?.title?.trim() || '', data: initial?.data ?? defaultSlides(), status: 'active', createdAt: this.now(), updatedAt: this.now() };
    if (this.preferRemote) {
      try {
        this.beginSave();
        const res = await firstValueFrom(this.http.post<ApiResponse<unknown>>(`${API_BASE}/v1/slides`, { title: tmp.title || undefined, data: tmp.data }, { withCredentials: true }));
        const doc = this.normalizeDoc(res?.data);
        if (doc) {
          this.cache[doc.id] = doc;
          this.persist();
          this.endSave();
          return doc;
        }
        throw new Error('invalid response');
      } catch (e) { this.endSave(e); this.switchToLocal(e); }
    }
    this.cache[tmp.id] = tmp; this.persist(); return tmp;
  }

  async save(s: SlideDoc): Promise<SlideDoc|undefined> {
    const hasTitle = !!s.title && s.title.trim().length>0;
    const hasData = s.data && JSON.stringify(s.data).length>2;
    if (!hasTitle && !hasData) return undefined;
    if (this.preferRemote) {
      try {
        this.beginSave();
        const res = await firstValueFrom(this.http.put<ApiResponse<unknown>>(`${API_BASE}/v1/slides/${s.id}`, { title: s.title || undefined, data: s.data }, { withCredentials: true }));
        const doc = this.normalizeDoc(res?.data);
        if (doc) {
          this.cache[doc.id] = doc;
          this.persist();
        }
        this.endSave();
        return doc ?? s;
      } catch (e) { this.endSave(e); this.switchToLocal(e); }
    }
    s.updatedAt = this.now(); this.cache[s.id] = { ...s }; this.persist(); return s;
  }

  async archive(id: string) { if (this.preferRemote) { try { this.beginSave(); await firstValueFrom(this.http.post(`${API_BASE}/v1/slides/${id}/archive`, {}, { withCredentials: true })); this.endSave(); } catch (e) { this.endSave(e); this.switchToLocal(e); } } const s=this.cache[id]; if (s){ s.status='archived'; s.updatedAt=this.now(); this.persist(); } }
  async restore(id: string) { if (this.preferRemote) { try { this.beginSave(); await firstValueFrom(this.http.post(`${API_BASE}/v1/slides/${id}/restore`, {}, { withCredentials: true })); this.endSave(); } catch (e) { this.endSave(e); this.switchToLocal(e); } } const s=this.cache[id]; if (s){ s.status='active'; s.updatedAt=this.now(); this.persist(); } }
  async softDelete(id: string) { if (this.preferRemote) { try { this.beginSave(); await firstValueFrom(this.http.delete(`${API_BASE}/v1/slides/${id}`, { withCredentials: true })); this.endSave(); } catch (e) { this.endSave(e); this.switchToLocal(e); } } const s=this.cache[id]; if (s){ s.status='deleted'; s.updatedAt=this.now(); this.persist(); } }

  async listCollaborators(slideId: string): Promise<SlideCollaborator[]> {
    if (!slideId || slideId === 'new') {
      return [];
    }
    if (!this.preferRemote) {
      throw new Error('Reconnect to the server to manage collaborators.');
    }
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<unknown>>(`${API_BASE}/v1/slides/${encodeURIComponent(slideId)}/collaborators`, { withCredentials: true }));
      const rows = Array.isArray(res?.data) ? res.data : [];
      return rows.map(r => this.normalizeCollaborator(r)).filter((r): r is SlideCollaborator => !!r);
    } catch (e) {
      throw new Error(this.describeError(e, 'Unable to load collaborators'));
    }
  }

  async addCollaborator(slideId: string, userId: string, role: SlideCollaborator['role']): Promise<void> {
    if (!slideId || slideId === 'new') {
      throw new Error('Save the presentation before inviting collaborators.');
    }
    if (!userId.trim()) {
      throw new Error('User ID is required.');
    }
    if (!this.preferRemote) {
      throw new Error('Reconnect to the server to manage collaborators.');
    }
    try {
      await firstValueFrom(this.http.post(`${API_BASE}/v1/slides/${encodeURIComponent(slideId)}/collaborators`, { userId, role }, { withCredentials: true }));
    } catch (e) {
      throw new Error(this.describeError(e, 'Unable to add collaborator'));
    }
  }

  async removeCollaborator(slideId: string, userId: string): Promise<void> {
    if (!slideId || slideId === 'new' || !userId.trim()) {
      return;
    }
    if (!this.preferRemote) {
      throw new Error('Reconnect to the server to manage collaborators.');
    }
    try {
      await firstValueFrom(this.http.delete(`${API_BASE}/v1/slides/${encodeURIComponent(slideId)}/collaborators`, {
        params: { user_id: userId },
        withCredentials: true
      }));
    } catch (e) {
      throw new Error(this.describeError(e, 'Unable to remove collaborator'));
    }
  }

  private beginSave(){ this.isSaving=true; this.lastError=null; }
  private endSave(err?: any){ this.isSaving=false; if (err) this.lastError = err?.message||'sync error'; else this.lastSavedAt=this.now(); }
  private switchToLocal(e?: any){ this.preferRemote=false; this.syncMode='local'; this.lastError = this.describeError(e, 'offline, saving locally'); }
  private uuid(): string { return 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  private filterCached(status: SlideStatus[]): SlideDoc[] {
    const set = new Set(status);
    return Object.values(this.cache)
      .filter(doc => set.has(doc.status))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }
  private mergeCache(docs: SlideDoc[]) {
    if (!docs.length) {
      return;
    }
    for (const doc of docs) {
      this.cache[doc.id] = doc;
    }
    this.persist();
  }
  private normalizeDoc(payload: any): SlideDoc | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const rawId = (payload as any).id ?? (payload as any).ID;
    const id = typeof rawId === 'string' ? rawId.trim() : rawId ? String(rawId) : '';
    if (!id) {
      return null;
    }
    const status = this.coerceStatus(typeof (payload as any).status === 'string' ? (payload as any).status : undefined);
    return {
      id,
      title: typeof (payload as any).title === 'string' ? (payload as any).title : undefined,
      data: this.normalizeData((payload as any).data),
      status,
      createdAt: this.coerceDate((payload as any).createdAt ?? (payload as any).created_at),
      updatedAt: this.coerceDate((payload as any).updatedAt ?? (payload as any).updated_at),
    };
  }
  private normalizeDocs(payload: any): SlideDoc[] {
    if (!Array.isArray(payload)) {
      return [];
    }
    return payload
      .map(entry => this.normalizeDoc(entry))
      .filter((doc): doc is SlideDoc => !!doc);
  }
  private normalizeCollaborator(payload: any): SlideCollaborator | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const userId = typeof (payload as any).userId === 'string'
      ? (payload as any).userId
      : typeof (payload as any).user_id === 'string'
        ? (payload as any).user_id
        : '';
    if (!userId) {
      return null;
    }
    const roleRaw = typeof (payload as any).role === 'string' ? (payload as any).role.toLowerCase() : 'viewer';
    const role: SlideCollaborator['role'] = roleRaw === 'editor' || roleRaw === 'commenter' ? roleRaw : 'viewer';
    return {
      userId,
      role,
      invitedBy: typeof (payload as any).invitedBy === 'string'
        ? (payload as any).invitedBy
        : typeof (payload as any).invited_by === 'string'
          ? (payload as any).invited_by
          : undefined,
      createdAt: this.coerceDate((payload as any).createdAt ?? (payload as any).created_at),
    };
  }
  private coerceStatus(value: string | undefined): SlideStatus {
    const normalized = (value || '').toLowerCase();
    if (normalized === 'archived' || normalized === 'deleted') {
      return normalized;
    }
    return 'active';
  }
  private normalizeData(payload: any): PresentationData {
    if (payload && typeof payload === 'object' && Array.isArray(payload.slides)) {
      const slides = payload.slides.map((s: any, index: number) => this.normalizeSlide(s, index))
        .filter((s: SlideModel | null): s is SlideModel => !!s);
      if (slides.length) {
        return { slides };
      }
    }
    return defaultSlides();
  }
  private normalizeSlide(payload: any, index: number): SlideModel | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    if (Array.isArray(payload.elements)) {
      const elements = payload.elements.map((el: any) => this.normalizeElement(el))
        .filter((e: SlideElement | null): e is SlideElement => !!e);
      return {
        id: typeof payload.id === 'string' ? payload.id : createId('slide'),
        name: typeof payload.name === 'string' && payload.name.trim() ? payload.name : `Slide ${index + 1}`,
        layout: typeof payload.layout === 'string' ? payload.layout : 'blank',
        background: typeof payload.background === 'string' ? payload.background : '#ffffff',
        elements,
      };
    }
    if (typeof payload.text === 'string') {
      const slide = createSlide('blank');
      slide.name = `Slide ${index + 1}`;
      slide.elements = [{
        id: createId('el'),
        type: 'text',
        x: 80,
        y: 120,
        width: 760,
        height: 300,
        rotation: 0,
        data: { text: payload.text, fontSize: 28, fill: '#0f172a', align: 'left' }
      }];
      return slide;
    }
    return createSlide('blank');
  }
  private normalizeElement(payload: any): SlideElement | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const type = payload.type === 'text' ? 'text' : 'shape';
    return {
      id: typeof payload.id === 'string' ? payload.id : createId('el'),
      type,
      x: typeof payload.x === 'number' ? payload.x : 0,
      y: typeof payload.y === 'number' ? payload.y : 0,
      width: typeof payload.width === 'number' ? payload.width : 200,
      height: typeof payload.height === 'number' ? payload.height : 80,
      rotation: typeof payload.rotation === 'number' ? payload.rotation : 0,
      data: {
        text: payload.data?.text,
        fontSize: payload.data?.fontSize ?? (type === 'text' ? 24 : undefined),
        fill: payload.data?.fill ?? (type === 'shape' ? '#cbd5f5' : '#0f172a'),
        stroke: payload.data?.stroke ?? '#1d4ed8',
        radius: payload.data?.radius ?? 12,
        align: payload.data?.align ?? 'left',
        fontFamily: payload.data?.fontFamily ?? 'Inter',
        bold: Boolean(payload.data?.bold),
        italic: Boolean(payload.data?.italic),
        underline: Boolean(payload.data?.underline),
        strikethrough: Boolean(payload.data?.strikethrough),
        lineHeight: typeof payload.data?.lineHeight === 'number' ? payload.data.lineHeight : 1.2
      }
    };
  }
  private coerceDate(value: any): string {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    return this.now();
  }
  private describeError(err: any, fallback: string): string {
    if (!err) {
      return fallback;
    }
    if (typeof err === 'string' && err.trim()) {
      return err;
    }
    if (err?.message) {
      return err.message;
    }
    if (err?.error?.message) {
      return err.error.message;
    }
    return fallback;
  }
}

export function defaultSlides(): PresentationData { return { slides: [createSlide('title-content')] }; }

function normalizeBase(base: string): string {
  if (!base) return '';
  return base.replace(/\/+$/, '');
}

