import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SlidesService, SlideDoc, defaultSlides } from '../../slides.service';

@Component({
  standalone: true,
  selector: 'app-slide',
  imports: [CommonModule, FormsModule],
  templateUrl: './slide.component.html'
})
export class SlidePageComponent implements OnInit {
  deck: SlideDoc | null = null;
  slides: { id: string; text: string }[] = defaultSlides().slides;
  pendingSave?: any;
  zoom = 1;
  openModal = false;
  openId = '';
  openQuery = '';
  openRows: SlideDoc[] = [];
  openFiltered: SlideDoc[] = [];
  // Share modal
  shareOpen = false;
  shareRows: { userId: string; role: 'viewer'|'commenter'|'editor' }[] = [];
  shareUserId = '';
  shareRole: 'viewer'|'commenter'|'editor' = 'viewer';
  contextMenus: { name: string, menus: { icon: string, name: string, action: string }[] }[] = [
    { name: 'File', menus: [
      { icon: '', name: 'New', action: 'new' },
      { icon: '', name: 'Open', action: 'open' },
      { icon: '', name: 'Rename', action: 'rename' },
      { icon: '', name: 'Import slides', action: 'import' },
      { icon: '', name: 'Make a copy', action: 'copy' },
      { icon: '', name: 'Download (.json)', action: 'download' }
    ]},
    { name: 'Edit', menus: [
      { icon: '', name: 'Undo', action: 'undo' },
      { icon: '', name: 'Redo', action: 'redo' }
    ]},
    { name: 'View', menus: [
      { icon: '', name: 'Present', action: 'present' },
      { icon: '', name: 'Grid view', action: 'grid' },
      { icon: '', name: 'Zoom', action: 'zoom' }
    ]},
    { name: 'Insert', menus: [
      { icon: '', name: 'New slide', action: 'newSlide' },
      { icon: '', name: 'Text box', action: 'textBox' },
      { icon: '', name: 'Image', action: 'image' },
      { icon: '', name: 'Shape', action: 'shape' }
    ]},
    { name: 'Slide', menus: [
      { icon: '', name: 'New slide', action: 'newSlide' },
      { icon: '', name: 'Duplicate slide', action: 'dupSlide' },
      { icon: '', name: 'Skip slide', action: 'skipSlide' },
      { icon: '', name: 'Change layout', action: 'layout' }
    ]},
    { name: 'Format', menus: [
      { icon: '', name: 'Text', action: 'formatText' },
      { icon: '', name: 'Align', action: 'align' }
    ]},
    { name: 'Arrange', menus: [
      { icon: '', name: 'Order', action: 'order' },
      { icon: '', name: 'Align horizontally', action: 'alignH' }
    ]},
    { name: 'Tools', menus: [
      { icon: '', name: 'Spelling', action: 'spelling' }
    ]},
    { name: 'Help', menus: [
      { icon: '', name: 'Slides help', action: 'help' }
    ]}
  ];

  onMenu(action: string){
    switch(action){
      case 'new': this.router.navigate(['/slide','new']); break;
      case 'open': { this.showOpen(); break; }
      case 'copy': this.copyDeck(); break;
      case 'rename': this.showRename(); break;
      case 'download': this.downloadDeck(); break;
      case 'import': this.importDeck(); break;
      case 'undo': document.execCommand('undo'); break;
      case 'redo': document.execCommand('redo'); break;
      case 'newSlide': this.addSlide(); break;
      case 'dupSlide': this.slides.push({ ...this.slides[0], id: String(this.slides.length+1) }); this.queueSave(); break;
      case 'present': this.present(); break;
      case 'grid': this.showGridOverview(); break;
      case 'zoom': this.promptZoom(); break;
      case 'textBox': this.focusEditor(); break;
      case 'image': this.insertImagePlaceholder(); break;
      case 'shape': this.insertShapeMarker(); break;
      case 'formatText': this.formatSelectionUppercase(); break;
      case 'align': this.insertAlignMarker('center'); break;
      case 'order': this.moveFirstToLast(); break;
      case 'alignH': this.insertAlignMarker('left'); break;
      case 'spelling': this.toggleTextareaSpellcheck(); break;
      case 'help': this.openHelp('slides'); break;
      case 'share': this.openShare(); break;
      default: break;
    }
  }

  private async copyDeck(){
    if (!this.deck) return;
    const created = await this.svc.create({ title: (this.deck.title||'Untitled')+ ' (Copy)', data: { slides: this.slides } });
    this.deck = created; this.router.navigate(['/slide', created.id]);
  }

  // Share
  openShare(){ this.shareOpen = true; this.loadCollaborators(); }
  private get id(): string | null { return this.deck?.id ?? null; }
  async loadCollaborators(){ const id=this.id; if(!id){ this.shareRows=[]; return; } try { const res=await fetch(`/v1/slides/${encodeURIComponent(id)}/collaborators`, { credentials:'include' }); const j=await res.json(); const rows=(j?.data||[]) as any[]; this.shareRows = rows.map(r => ({ userId: r.userId||r.user_id, role: (r.role||'viewer') })); } catch { this.shareRows=[]; } }
  async addCollaborator(){ const id=this.id; if(!id) return; const userId=this.shareUserId.trim(); if(!userId) return; const role=this.shareRole; await fetch(`/v1/slides/${encodeURIComponent(id)}/collaborators`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId, role }) }); this.shareUserId=''; await this.loadCollaborators(); }
  async removeCollaborator(uid:string){ const id=this.id; if(!id) return; await fetch(`/v1/slides/${encodeURIComponent(id)}/collaborators?user_id=${encodeURIComponent(uid)}`, { method:'DELETE', credentials:'include' }); await this.loadCollaborators(); }
  private downloadDeck(){
    const name = ((this.deck?.title)||'presentation').replace(/\s+/g,'-').slice(0,80);
    const blob = new Blob([JSON.stringify({ title: this.deck?.title||'', slides: this.slides }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name}.json`; a.click(); URL.revokeObjectURL(a.href);
  }

  private present(){
    const w = window.open('', '_blank'); if (!w) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${this.deck?.title||'Presentation'}</title>
      <style>body{margin:0;font-family:system-ui,sans-serif} .slide{display:flex;align-items:center;justify-content:center;height:100vh;padding:40px;}
      .nav{position:fixed;bottom:10px;right:10px}</style></head><body>
      ${this.slides.map(s=>`<div class="slide"><div>${(s.text||'').replace(/</g,'&lt;')}</div></div>`).join('')}
      <div class="nav">Use browser to navigate</div></body></html>`;
    w.document.write(html); w.document.close();
  }
  private promptZoom(){ const v = prompt('Zoom % (e.g. 100)', String(Math.round(this.zoom*100))); if (v!==null){ const f = parseFloat(v); if(!isNaN(f) && f>10 && f<=400) this.zoom = f/100; }}
  private focusEditor(){ setTimeout(() => { const ta = document.querySelector('textarea'); (ta as HTMLTextAreaElement|undefined)?.focus(); }, 0); }
  private insertImagePlaceholder(){ const ta = document.querySelector('textarea') as HTMLTextAreaElement | null; const url = prompt('Image URL'); if (ta && url){ const ins = `\n[Image] ${url}\n`; const start = ta.selectionStart||0; const end = ta.selectionEnd||0; const cur = ta.value; const out = cur.slice(0,start) + ins + cur.slice(end); ta.value = out; this.onSlideChange(0, out); }}
  private insertShapeMarker(){ const ta = document.querySelector('textarea') as HTMLTextAreaElement | null; if (!ta) return; const ins = `\n[Shape: rectangle]\n`; const start = ta.selectionStart||0; const end = ta.selectionEnd||0; const cur = ta.value; const out = cur.slice(0,start) + ins + cur.slice(end); ta.value = out; this.onSlideChange(0, out); }
  private formatSelectionUppercase(){ const ta = document.querySelector('textarea') as HTMLTextAreaElement | null; if (!ta) return; const start = ta.selectionStart||0; const end = ta.selectionEnd||0; const sel = ta.value.slice(start,end); const rep = sel.toUpperCase(); const out = ta.value.slice(0,start)+rep+ta.value.slice(end); ta.value = out; this.onSlideChange(0, out); }
  private insertAlignMarker(kind: 'left'|'center'){ const ta = document.querySelector('textarea') as HTMLTextAreaElement | null; if (!ta) return; const ins = kind==='center'? '\n[Align: center]\n' : '\n[Align: left]\n'; const start = ta.selectionStart||0; const end = ta.selectionEnd||0; const cur = ta.value; const out = cur.slice(0,start)+ins+cur.slice(end); ta.value=out; this.onSlideChange(0,out); }
  private moveFirstToLast(){ if (this.slides.length>1){ const [first]=this.slides.splice(0,1); this.slides.push(first); this.queueSave(); } }
  private showGridOverview(){ window.scrollTo({ top: 0, behavior: 'smooth' }); }
  private toggleTextareaSpellcheck(){ const ta = document.querySelector('textarea') as HTMLTextAreaElement | null; if (ta) ta.spellcheck = !ta.spellcheck; }
  private importDeck(){ const el = document.createElement('input'); el.type='file'; el.accept='.json,application/json'; el.onchange = async () => { const f = el.files && el.files[0]; if (!f) return; const txt = await f.text().catch(()=>null); try{ const parsed = JSON.parse(txt||'{}'); if (Array.isArray(parsed.slides)){ this.slides = parsed.slides.map((s:any,i:number)=>({ id: String(i+1), text: String(s.text||'') })); this.queueSave(); alert('Imported slides.'); } else { alert('Invalid file format.'); } } catch { alert('Invalid JSON.'); } }; el.click(); }
  private openHelp(app: 'docs'|'sheets'|'slides'|'pdf'){ const sp = localStorage.getItem(`berjis_help_url_${app}`); const g = localStorage.getItem('berjis_help_url'); const u = sp||g||`/help/${app}`; window.open(u, '_blank'); }

  confirmOpen(){ const id=(this.openId||'').trim(); if (id){ this.openModal=false; this.router.navigate(['/slide', id]); } }
  cancelOpen(){ this.openModal=false; }
  private async showOpen(){
    this.openModal = true;
    try { this.openRows = await this.svc.list(['active']); } catch { this.openRows = []; }
    this.openFiltered = [...this.openRows]; this.openQuery='';
  }
  onOpenQueryChange(){
    const q = (this.openQuery||'').toLowerCase(); if (!q){ this.openFiltered=[...this.openRows]; return; }
    this.openFiltered = this.openRows.filter(s =>
      (s.title||'').toLowerCase().includes(q) || JSON.stringify((s.data as any)?.slides||[]).toLowerCase().includes(q)
    );
  }
  openDeck(s: SlideDoc){ this.openModal=false; this.router.navigate(['/slide', s.id]); }

  // Rename modal
  renameModal = false; renameTitle = '';
  private showRename(){ this.renameTitle = (this.deck?.title||''); this.renameModal = true; }
  confirmRename(){ if(!this.deck){ this.renameModal=false; return; } this.deck.title = (this.renameTitle||'').trim(); this.renameModal=false; this.onTitleChange(); }
  cancelRename(){ this.renameModal=false; }

  constructor(private route: ActivatedRoute, private router: Router, public svc: SlidesService) { }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') || 'new';
    this.deck = { id, title: '', data: defaultSlides(), status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (id !== 'new') {
      const existing = this.svc.get(id) || await this.svc.fetch(id);
      if (existing) this.deck = existing; else { this.router.navigate(['/']); return; }
    }
    this.slides = (this.deck?.data?.slides as any[]) || defaultSlides().slides;
  }

  onTitleChange() { this.queueSave(); }
  onSlideChange(i: number, val: string) { this.slides[i].text = val; this.queueSave(); }
  addSlide() { this.slides.push({ id: String(this.slides.length + 1), text: '' }); this.queueSave(); }
  removeSlide(i: number) { this.slides.splice(i, 1); this.queueSave(); }

  private queueSave() { if (!this.deck) return; if (this.pendingSave) clearTimeout(this.pendingSave); this.pendingSave = setTimeout(() => this.save(), 400); }
  private async ensureCreatedId() { if (this.deck && this.deck.id === 'new') { const hasTitle = !!this.deck.title && this.deck.title.trim().length > 0; const hasData = JSON.stringify(this.slides).length > 2; if (hasTitle || hasData) { const created = await this.svc.create({ title: this.deck.title, data: { slides: this.slides } }); this.deck = created; this.router.navigate(['/slide', created.id], { replaceUrl: true }); } } }
  private async save() { if (!this.deck) return; await this.ensureCreatedId(); if (!this.deck) return; this.deck.data = { slides: this.slides }; await this.svc.save(this.deck); }
}
