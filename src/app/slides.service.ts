import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

export type SlideStatus = 'active'|'archived'|'deleted';
export interface SlideDoc { id: string; title?: string; data?: any; status: SlideStatus; createdAt: string; updatedAt: string }

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
  private load() { try { const raw = localStorage.getItem(STORAGE_KEY); this.cache = raw ? JSON.parse(raw) : {}; } catch { this.cache = {}; } }
  private persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cache)); }
  private now() { return new Date().toISOString(); }

  async list(status: SlideStatus[] = ['active']): Promise<SlideDoc[]> {
    if (this.preferRemote) {
      try {
        const res = await firstValueFrom(this.http.get<any>(`${API_BASE}/v1/slides`, { params: { status: status.join(',') }, withCredentials: true }));
        const rows: SlideDoc[] = res?.data || [];
        for (const s of rows) this.cache[s.id] = s; this.persist();
        this.preferRemote = true; this.syncMode='remote'; this.lastError=null; return rows;
      } catch (e) { this.switchToLocal(e); }
    }
    return Object.values(this.cache).filter(s => status.includes(s.status)).sort((a,b)=> (b.updatedAt||'').localeCompare(a.updatedAt||''));
  }
  get(id: string) { return this.cache[id]; }
  async fetch(id: string): Promise<SlideDoc|undefined> {
    if (this.preferRemote) {
      try {
        const res = await firstValueFrom(this.http.get<any>(`${API_BASE}/v1/slides/${id}`, { withCredentials: true }));
        const s: SlideDoc = res?.data; if (s) { this.cache[s.id] = s; this.persist(); }
        this.preferRemote = true; this.syncMode='remote'; this.lastError=null; return s;
      } catch (e) { this.switchToLocal(e); }
    }
    return this.cache[id];
  }

  async create(initial?: Partial<SlideDoc>): Promise<SlideDoc> {
    const tmp: SlideDoc = { id: this.uuid(), title: initial?.title?.trim() || '', data: initial?.data ?? defaultSlides(), status: 'active', createdAt: this.now(), updatedAt: this.now() };
    if (this.preferRemote) {
      try {
        this.beginSave();
        const res = await firstValueFrom(this.http.post<any>(`${API_BASE}/v1/slides`, { title: tmp.title || undefined, data: tmp.data }, { withCredentials: true }));
        const s: SlideDoc = res.data; this.cache[s.id] = s; this.persist(); this.endSave(); return s;
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
        const res = await firstValueFrom(this.http.put<any>(`${API_BASE}/v1/slides/${s.id}`, { title: s.title || undefined, data: s.data }, { withCredentials: true }));
        const out: SlideDoc = res.data; this.cache[out.id] = out; this.persist(); this.endSave(); return out;
      } catch (e) { this.endSave(e); this.switchToLocal(e); }
    }
    s.updatedAt = this.now(); this.cache[s.id] = { ...s }; this.persist(); return s;
  }

  async archive(id: string) { if (this.preferRemote) { try { this.beginSave(); await firstValueFrom(this.http.post(`${API_BASE}/v1/slides/${id}/archive`, {}, { withCredentials: true })); this.endSave(); } catch (e) { this.endSave(e); this.switchToLocal(e); } } const s=this.cache[id]; if (s){ s.status='archived'; s.updatedAt=this.now(); this.persist(); } }
  async restore(id: string) { if (this.preferRemote) { try { this.beginSave(); await firstValueFrom(this.http.post(`${API_BASE}/v1/slides/${id}/restore`, {}, { withCredentials: true })); this.endSave(); } catch (e) { this.endSave(e); this.switchToLocal(e); } } const s=this.cache[id]; if (s){ s.status='active'; s.updatedAt=this.now(); this.persist(); } }
  async softDelete(id: string) { if (this.preferRemote) { try { this.beginSave(); await firstValueFrom(this.http.delete(`${API_BASE}/v1/slides/${id}`, { withCredentials: true })); this.endSave(); } catch (e) { this.endSave(e); this.switchToLocal(e); } } const s=this.cache[id]; if (s){ s.status='deleted'; s.updatedAt=this.now(); this.persist(); } }

  private beginSave(){ this.isSaving=true; this.lastError=null; }
  private endSave(err?: any){ this.isSaving=false; if (err) this.lastError = err?.message||'sync error'; else this.lastSavedAt=this.now(); }
  private switchToLocal(e?: any){ this.preferRemote=false; this.syncMode='local'; this.lastError = e?.message || 'offline, saving locally'; }
  private uuid(): string { return 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
}

export function defaultSlides(){ return { slides: [ { id: '1', text: '' } ] }; }

function normalizeBase(base: string): string {
  if (!base) return '';
  return base.replace(/\/+$/, '');
}

