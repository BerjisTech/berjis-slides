import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SlidesService, SlideCollaborator, SlideDoc, defaultSlides } from '../../slides.service';
import { CANVAS_HEIGHT, CANVAS_WIDTH, GRID_SIZE, SlideElement, SlideLayout, SlideModel, cloneSlide, createSlide } from '../../models/slide';

interface AlignmentGuides {
  vertical: number | null;
  horizontal: number | null;
}

@Component({
  standalone: true,
  selector: 'app-slide',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './slide.component.html'
})
export class SlidePageComponent implements OnInit, OnDestroy {
  deck: SlideDoc | null = null;
  slides: SlideModel[] = defaultSlides().slides;
  selectedSlideIndex = 0;
  selectedElementId: string | null = null;

  readonly zoomLevels = [0.25, 0.5, 1, 1.5, 2];
  zoom = 1;
  pan = { x: 0, y: 0 };
  private panOrigin = { x: 0, y: 0 };
  private panPointerStart = { x: 0, y: 0 };

  readonly canvasWidth = CANVAS_WIDTH;
  readonly canvasHeight = CANVAS_HEIGHT;
  readonly gridSize = GRID_SIZE;

  dragThumbIndex = -1;
  dragOverIndex = -1;
  draggingElementId: string | null = null;
  private dragOffset = { x: 0, y: 0 };
  alignmentGuides: AlignmentGuides = { vertical: null, horizontal: null };

  spacePressed = false;
  isPanning = false;

  shareOpen = false;
  shareRows: SlideCollaborator[] = [];
  shareUserId = '';
  shareRole: 'viewer' | 'commenter' | 'editor' = 'viewer';
  shareLoading = false;
  shareError: string | null = null;

  openModal = false;
  openQuery = '';
  openRows: SlideDoc[] = [];
  openFiltered: SlideDoc[] = [];

  renameModal = false;
  renameTitle = '';

  pendingSave?: ReturnType<typeof setTimeout>;

  contextMenus: { name: string; menus: { name: string; action: string }[] }[] = [
    {
      name: 'File',
      menus: [
        { name: 'New', action: 'new' },
        { name: 'Open', action: 'open' },
        { name: 'Rename', action: 'rename' },
        { name: 'Download (.json)', action: 'download' }
      ]
    },
    {
      name: 'Insert',
      menus: [
        { name: 'Blank slide', action: 'newSlide:blank' },
        { name: 'Title slide', action: 'newSlide:title' },
        { name: 'Title & content', action: 'newSlide:title-content' }
      ]
    },
    {
      name: 'Slide',
      menus: [
        { name: 'Duplicate', action: 'dupSlide' },
        { name: 'Delete', action: 'deleteSlide' }
      ]
    },
    {
      name: 'View',
      menus: [
        { name: 'Present', action: 'present' },
        { name: 'Zoom…', action: 'zoomPrompt' }
      ]
    }
  ];

  @ViewChild('canvasSurface', { static: false }) canvasSurface?: ElementRef<HTMLDivElement>;

  constructor(private route: ActivatedRoute, private router: Router, public svc: SlidesService) {}

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') || 'new';
    this.deck = {
      id,
      title: 'Untitled presentation',
      data: defaultSlides(),
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (id !== 'new') {
      const existing = this.svc.get(id) || await this.svc.fetch(id);
      if (!existing) {
        await this.router.navigate(['/']);
        return;
      }
      this.deck = existing;
    }
    this.slides = this.cloneSlides(this.deck?.data?.slides ?? defaultSlides().slides);
  }

  ngOnDestroy(): void {
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
    }
  }

  get activeSlide(): SlideModel | null { return this.slides[this.selectedSlideIndex] ?? null; }
  get slideCounterLabel(): string { return `${this.selectedSlideIndex + 1} / ${Math.max(this.slides.length, 1)}`; }
  get canShare(): boolean { return !!this.deck && this.deck.id !== 'new'; }

  onMenu(action: string) {
    if (action.startsWith('newSlide:')) {
      const layout = action.split(':')[1] as SlideLayout;
      this.addSlide(layout);
      return;
    }
    switch (action) {
      case 'new':
        this.router.navigate(['/slide', 'new']);
        break;
      case 'open':
        this.showOpen();
        break;
      case 'rename':
        this.showRename();
        break;
      case 'download':
        this.downloadDeck();
        break;
      case 'dupSlide':
        this.duplicateSlide();
        break;
      case 'deleteSlide':
        this.deleteSlide();
        break;
      case 'present':
        this.present();
        break;
      case 'zoomPrompt':
        this.promptZoom();
        break;
      default:
        break;
    }
  }

  selectSlide(index: number) {
    this.selectedSlideIndex = index;
    this.selectedElementId = null;
  }

  addSlide(layout: SlideLayout) {
    const slide = createSlide(layout);
    const insertIndex = this.selectedSlideIndex + 1;
    this.slides.splice(insertIndex, 0, slide);
    this.selectSlide(insertIndex);
    this.queueSave();
  }

  duplicateSlide() {
    const current = this.activeSlide;
    if (!current) return;
    const duplicated = cloneSlide(current);
    this.slides.splice(this.selectedSlideIndex + 1, 0, duplicated);
    this.selectSlide(this.selectedSlideIndex + 1);
    this.queueSave();
  }

  deleteSlide() {
    if (!this.activeSlide) return;
    if (!confirm('Delete this slide?')) return;
    this.slides.splice(this.selectedSlideIndex, 1);
    if (!this.slides.length) {
      this.slides.push(createSlide('blank'));
    }
    this.selectedSlideIndex = Math.max(0, this.selectedSlideIndex - 1);
    this.queueSave();
  }

  onThumbDragStart(index: number) { this.dragThumbIndex = index; }
  onThumbDragOver(event: DragEvent, index: number) { event.preventDefault(); this.dragOverIndex = index; }
  onThumbDrop(event: DragEvent, index: number) {
    event.preventDefault();
    if (this.dragThumbIndex === -1 || this.dragThumbIndex === index) { this.resetThumbDrag(); return; }
    const [slide] = this.slides.splice(this.dragThumbIndex, 1);
    this.slides.splice(index, 0, slide);
    this.selectedSlideIndex = index;
    this.resetThumbDrag();
    this.queueSave();
  }
  onThumbDragEnd() { this.resetThumbDrag(); }
  private resetThumbDrag() { this.dragThumbIndex = -1; this.dragOverIndex = -1; }

  changeZoom(level: number) { this.zoom = level; }

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    if (this.isInputTarget(event.target)) return;
    if (event.code === 'Space') this.spacePressed = true;
    if (event.key === 'ArrowLeft') { this.prevSlide(); event.preventDefault(); }
    if (event.key === 'ArrowRight') { this.nextSlide(); event.preventDefault(); }
  }

  @HostListener('window:keyup', ['$event'])
  handleKeyUp(event: KeyboardEvent) {
    if (event.code === 'Space') this.spacePressed = false;
  }

  prevSlide() { if (this.selectedSlideIndex > 0) this.selectSlide(this.selectedSlideIndex - 1); }
  nextSlide() { if (this.selectedSlideIndex < this.slides.length - 1) this.selectSlide(this.selectedSlideIndex + 1); }

  onCanvasPointerDown(event: PointerEvent) {
    if (this.spacePressed || event.button === 1) { this.startPan(event); return; }
    this.selectedElementId = null;
  }

  onElementPointerDown(event: PointerEvent, element: SlideElement) {
    event.preventDefault();
    event.stopPropagation();
    this.selectedElementId = element.id;
    this.draggingElementId = element.id;
    const { x, y } = this.clientToCanvas(event);
    this.dragOffset = { x: x - element.x, y: y - element.y };
    this.updateAlignmentGuides(element);
  }

  @HostListener('window:pointermove', ['$event'])
  handlePointerMove(event: PointerEvent) {
    if (this.isPanning) {
      const deltaX = event.clientX - this.panPointerStart.x;
      const deltaY = event.clientY - this.panPointerStart.y;
      this.pan = { x: this.panOrigin.x + deltaX, y: this.panOrigin.y + deltaY };
      event.preventDefault();
      return;
    }
    if (!this.draggingElementId) return;
    const slide = this.a
