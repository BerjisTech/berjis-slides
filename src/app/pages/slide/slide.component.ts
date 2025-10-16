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
  contextMenus: { name: string, menus: { icon: string, name: string, action: string }[] }[] = [
    {
      name: 'File',
      menus: [
        { icon: '', name: 'New', action: '' },
        { icon: '', name: 'Open', action: '' },
        { icon: '', name: 'Duplicate', action: '' },
        { icon: '', name: 'Share', action: '' },
        { icon: '', name: 'Email', action: '' },
        { icon: '', name: 'Export', action: '' }
      ]
    },
    {
      name: 'Edit',
      menus: [
        { icon: '', name: '', action: '' }
      ]
    },
    {
      name: 'View',
      menus: [
        { icon: '', name: '', action: '' }
      ]
    },
    {
      name: 'Insert',
      menus: [
        { icon: '', name: '', action: '' }
      ]
    },
    {
      name: 'Format',
      menus: [
        { icon: '', name: '', action: '' }
      ]
    },
    {
      name: 'Tools',
      menus: [
        { icon: '', name: '', action: '' }
      ]
    },
    {
      name: 'Extensions',
      menus: [
        { icon: '', name: '', action: '' }
      ]
    },
    {
      name: 'Help',
      menus: [
        { icon: '', name: '', action: '' }
      ]
    },
  ]

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
