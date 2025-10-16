import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../api.service';
import { SlidesService, SlideDoc } from '../../slides.service';

@Component({
  standalone: true,
  selector: 'app-home',
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html'
})
export class HomePageComponent {
  authed: boolean | null = null;
  recents: SlideDoc[] = [];
  constructor(private api: ApiService, private slides: SlidesService) { this.init(); }
  get syncMode() { return this.slides.syncMode; }
  get isSaving() { return this.slides.isSaving; }
  get lastSavedAt() { return this.slides.lastSavedAt; }
  get lastError() { return this.slides.lastError; }
  async init() {
    try {
      const res = await this.api.ensureAuth();
      this.authed = !!res?.data?.valid;
      if (this.authed) { this.recents = await this.slides.list(['active']); }
    } catch { this.authed = false; }
  }
}
