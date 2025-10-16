import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SlidesService, SlideDoc, defaultSlides } from '../../slides.service';

@Component({
  standalone: true,
  selector: 'app-slide',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './slide.component.html'
})
export class SlidePageComponent implements OnInit {
  deck: SlideDoc | null = null;
  slides: { id: string; text: string }[] = defaultSlides().slides;
  pendingSave?: any;
  openModal = false;
  openId = '';
  openQuery = '';
  openRows: SlideDoc[] = [];
  openFiltered: SlideDoc[] = [];
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
      case 'undo': document.execCommand('undo'); break;
      case 'redo': document.execCommand('redo'); break;
      case 'newSlide': this.addSlide(); break;
      case 'dupSlide': this.slides.push({ ...this.slides[0], id: String(this.slides.length+1) }); this.queueSave(); break;
      case 'present': this.present(); break;
      default: break;
    }
  }

  private async copyDeck(){
    if (!this.deck) return;
    const created = await this.svc.create({ title: (this.deck.title||'Untitled')+ ' (Copy)', data: { slides: this.slides } });
    this.deck = created; this.router.navigate(['/slide', created.id]);
  }
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
