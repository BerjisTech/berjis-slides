import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SlidesService, SlideCollaborator, SlideDoc, defaultSlides } from '../../slides.service';
import { CANVAS_HEIGHT, CANVAS_WIDTH, GRID_SIZE, SlideElement, SlideLayout, SlideModel, cloneSlide, createShapeElement, createSlide, createTextElement } from '../../models/slide';

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
  private static readonly TEXT_COLOR_STORAGE_KEY = 'slides.textColors';
  private static readonly SHAPE_COLOR_STORAGE_KEY = 'slides.shapeColors';
  private static readonly SHAPE_STROKE_COLOR_STORAGE_KEY = 'slides.shapeStrokeColors';
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
  insertMode: 'text' | 'shape' | null = null;
  readonly fontFamilies = [
    'Inter',
    'Roboto',
    'Open Sans',
    'Montserrat',
    'Work Sans',
    'Lato',
    'Source Sans 3',
    'Poppins',
    'Nunito',
    'Merriweather',
    'Playfair Display',
    'Space Grotesk'
  ];
  readonly fontSizeRange = { min: 8, max: 96 };
  readonly defaultTextColors = [
    '#0f172a',
    '#1d4ed8',
    '#dc2626',
    '#059669',
    '#b45309',
    '#9333ea',
    '#475569',
    '#64748b',
    '#f97316',
    '#facc15'
  ];
  recentTextColors: string[] = [];
  recentShapeColors: string[] = [];
  recentStrokeColors: string[] = [];
  readonly lineHeightRange = { min: 0.8, max: 2.5, step: 0.1 };
  readonly bulletStyles: ('none' | 'bullet' | 'number')[] = ['none', 'bullet', 'number'];
  readonly strokeStyles: Array<'solid' | 'dashed' | 'dotted'> = ['solid', 'dashed', 'dotted'];
  shapeVariant: 'rectangle' | 'square' | 'ellipse' | 'line' | 'arrow' | 'triangle' = 'rectangle';
  readonly shapeStrokeRange = { min: 1, max: 12, step: 1 };
  readonly shapePresets: Record<'rectangle' | 'square' | 'ellipse' | 'line' | 'arrow' | 'triangle', { width: number; height: number; kind: 'rect' | 'ellipse' | 'line' | 'arrow' | 'triangle'; radius?: number; strokeWidth?: number }> = {
    rectangle: { width: 260, height: 160, kind: 'rect', radius: 16, strokeWidth: 2 },
    square: { width: 180, height: 180, kind: 'rect', radius: 12, strokeWidth: 2 },
    ellipse: { width: 240, height: 160, kind: 'ellipse', strokeWidth: 2 },
    line: { width: 220, height: 0, kind: 'line', strokeWidth: 3 },
    arrow: { width: 220, height: 0, kind: 'arrow', strokeWidth: 3 },
    triangle: { width: 220, height: 160, kind: 'triangle', strokeWidth: 2 }
  };

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
    this.recentTextColors = this.loadRecentColors();
    this.recentShapeColors = this.loadShapeColors();
    this.recentStrokeColors = this.loadStrokeColors();
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
  get selectedTextElement(): SlideElement | null {
    const slide = this.activeSlide;
    if (!slide) {
      return null;
    }
    return slide.elements.find(el => el.id === this.selectedElementId && el.type === 'text') ?? null;
  }

  get selectedShapeElement(): SlideElement | null {
    const slide = this.activeSlide;
    if (!slide) {
      return null;
    }
    return slide.elements.find(el => el.id === this.selectedElementId && el.type === 'shape') ?? null;
  }

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

  toggleInsertMode(mode: 'text') {
    this.insertMode = this.insertMode === mode ? null : mode;
  }

  toggleShapeInsert(kind: 'rectangle' | 'square' | 'ellipse' | 'line' | 'arrow' | 'triangle') {
    if (this.insertMode === 'shape' && this.shapeVariant === kind) {
      this.insertMode = null;
      return;
    }
    this.shapeVariant = kind;
    this.insertMode = 'shape';
  }

  selectSlide(index: number) {
    this.selectedSlideIndex = index;
    this.selectedElementId = null;
    this.insertMode = null;
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
    if (event.key === 'Escape' && this.insertMode) {
      this.insertMode = null;
      return;
    }
    if (event.code === 'Space') {
      this.spacePressed = true;
    }
    if (event.key === 'ArrowLeft') {
      this.prevSlide();
      event.preventDefault();
    }
    if (event.key === 'ArrowRight') {
      this.nextSlide();
      event.preventDefault();
    }
  }

  @HostListener('window:keyup', ['$event'])
  handleKeyUp(event: KeyboardEvent) {
    if (event.code === 'Space') {
      this.spacePressed = false;
    }
  }

  prevSlide() { if (this.selectedSlideIndex > 0) this.selectSlide(this.selectedSlideIndex - 1); }
  nextSlide() { if (this.selectedSlideIndex < this.slides.length - 1) this.selectSlide(this.selectedSlideIndex + 1); }

  onCanvasPointerDown(event: PointerEvent) {
    if (this.spacePressed || event.button === 1) {
      this.startPan(event);
      return;
    }
    if (this.insertMode === 'text' && event.button === 0) {
      this.insertTextElement(event);
      return;
    }
    if (this.insertMode === 'shape' && event.button === 0) {
      this.insertShapeElement(event);
      return;
    }
    this.selectedElementId = null;
  }

  onElementPointerDown(event: PointerEvent, element: SlideElement) {
    event.preventDefault();
    event.stopPropagation();
    if (this.insertMode) {
      this.insertMode = null;
    }
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
    const slide = this.activeSlide;
    if (!slide) return;
    const element = slide.elements.find(el => el.id === this.draggingElementId);
    if (!element) return;
    const { x, y } = this.clientToCanvas(event);
    const nextX = this.snapToGrid(x - this.dragOffset.x);
    const nextY = this.snapToGrid(y - this.dragOffset.y);
    element.x = this.clamp(nextX, 0, this.canvasWidth - element.width);
    element.y = this.clamp(nextY, 0, this.canvasHeight - element.height);
    this.updateAlignmentGuides(element);
  }

  @HostListener('window:pointerup', ['$event'])
  handlePointerUp(event: PointerEvent) {
    if (this.isPanning) {
      this.isPanning = false;
      event.preventDefault();
    }
    if (this.draggingElementId) {
      this.draggingElementId = null;
      this.alignmentGuides = { vertical: null, horizontal: null };
      this.queueSave();
    }
  }

  private startPan(event: PointerEvent) {
    this.isPanning = true;
    this.panOrigin = { ...this.pan };
    this.panPointerStart = { x: event.clientX, y: event.clientY };
    event.preventDefault();
  }

  private insertTextElement(event: PointerEvent) {
    const slide = this.activeSlide;
    if (!slide) {
      return;
    }
    event.preventDefault();
    const { x, y } = this.clientToCanvas(event);
    const width = 360;
    const height = 120;
    const elementX = this.clamp(x - width / 2, 0, this.canvasWidth - width);
    const elementY = this.clamp(y - height / 2, 0, this.canvasHeight - height);
    const element = createTextElement('Click to add text', {
      x: elementX,
      y: elementY,
      width,
      height,
      fontSize: 28,
      align: 'left'
    });
    slide.elements.push(element);
    this.selectedElementId = element.id;
    this.insertMode = null;
    this.alignmentGuides = { vertical: null, horizontal: null };
    this.queueSave();
  }

  private insertShapeElement(event: PointerEvent) {
    const slide = this.activeSlide;
    if (!slide) {
      return;
    }
    event.preventDefault();
    const preset = this.shapePresets[this.shapeVariant] ?? this.shapePresets.rectangle;
    const { x, y } = this.clientToCanvas(event);
    const width = preset.width;
    const height = preset.height;
    const elementX = this.clamp(x - width / 2, 0, this.canvasWidth - width);
    const elementY = this.clamp(y - height / 2, 0, this.canvasHeight - height);
    const element = createShapeElement({
      x: elementX,
      y: elementY,
      width,
      height,
      radius: preset.kind === 'rect' ? preset.radius : undefined,
      shapeKind: preset.kind,
      strokeWidth: preset.strokeWidth
    });
    slide.elements.push(element);
    this.selectedElementId = element.id;
    this.insertMode = null;
    this.alignmentGuides = { vertical: null, horizontal: null };
    this.queueSave();
  }

  toggleRichStyle(style: 'bold' | 'italic' | 'underline' | 'strikethrough') {
    const element = this.selectedTextElement;
    if (!element) return;
    element.data[style] = !element.data[style];
    this.queueSave();
  }

  changeFontFamily(family: string) {
    const element = this.selectedTextElement;
    if (!element || !family) return;
    element.data.fontFamily = family;
    this.queueSave();
  }

  changeFontSize(size: number | string) {
    const element = this.selectedTextElement;
    if (!element) return;
    const numeric = typeof size === 'string' ? Number(size) : size;
    if (!Number.isFinite(numeric)) {
      return;
    }
    const clamped = this.clamp(numeric, this.fontSizeRange.min, this.fontSizeRange.max);
    element.data.fontSize = Math.round(clamped);
    this.queueSave();
  }

  updateTextContent(value: string) {
    const element = this.selectedTextElement;
    if (!element) return;
    element.data.text = value;
    this.queueSave();
  }

  changeTextColor(color: string) {
    const element = this.selectedTextElement;
    if (!element || !color) {
      return;
    }
    element.data.fill = color;
    this.pushRecentColor(color);
    this.queueSave();
  }

  changeShapeFill(color: string) {
    const element = this.selectedShapeElement;
    if (!element || !color) {
      return;
    }
    element.data.fill = color;
    this.pushShapeColor(color);
    this.queueSave();
  }

  changeShapeStroke(color: string) {
    const element = this.selectedShapeElement;
    if (!element || !color) {
      return;
    }
    element.data.stroke = color;
    this.pushStrokeColor(color);
    this.queueSave();
  }

  changeShapeStrokeWidth(value: number | string) {
    const element = this.selectedShapeElement;
    if (!element) {
      return;
    }
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(numeric)) {
      return;
    }
    const clamped = Math.min(this.shapeStrokeRange.max, Math.max(this.shapeStrokeRange.min, numeric));
    element.data.strokeWidth = clamped;
    this.queueSave();
  }

  changeShapeStrokeStyle(style: 'solid' | 'dashed' | 'dotted') {
    const element = this.selectedShapeElement;
    if (!element) {
      return;
    }
    element.data.strokeStyle = style;
    this.queueSave();
  }

  changeShapeRadius(value: number | string) {
    const element = this.selectedShapeElement;
    if (!element || element.data.shapeKind !== 'rect') {
      return;
    }
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(numeric)) {
      return;
    }
    const clamped = Math.max(0, Math.min(300, numeric));
    element.data.radius = clamped;
    this.queueSave();
  }

  changeLineHeight(value: number | string) {
    const element = this.selectedTextElement;
    if (!element) {
      return;
    }
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(numeric)) {
      return;
    }
    const clamped = Number(Math.min(this.lineHeightRange.max, Math.max(this.lineHeightRange.min, numeric)).toFixed(2));
    element.data.lineHeight = clamped;
    this.queueSave();
  }

  changeAlignment(alignment: 'left' | 'center' | 'right' | 'justify') {
    const element = this.selectedTextElement;
    if (!element) {
      return;
    }
    element.data.align = alignment;
    this.queueSave();
  }

  changeBulletStyle(style: 'none' | 'bullet' | 'number') {
    const element = this.selectedTextElement;
    if (!element) {
      return;
    }
    element.data.bulletStyle = style;
    this.queueSave();
  }

  get selectedFontFamily(): string {
    return this.selectedTextElement?.data.fontFamily || this.fontFamilies[0];
  }

  get selectedFontSize(): number {
    return this.selectedTextElement?.data.fontSize ?? 28;
  }

  get selectedAlignment(): 'left' | 'center' | 'right' | 'justify' {
    return this.selectedTextElement?.data.align ?? 'left';
  }

  get selectedLineHeight(): number {
    return this.selectedTextElement?.data.lineHeight ?? 1.2;
  }

  get selectedBulletStyle(): 'none' | 'bullet' | 'number' {
    return this.selectedTextElement?.data.bulletStyle ?? 'none';
  }

  get shapeVariantLabel(): string {
    switch (this.shapeVariant) {
      case 'square':
        return 'Square';
      case 'ellipse':
        return 'Ellipse';
      case 'line':
        return 'Line';
      case 'arrow':
        return 'Arrow';
      case 'triangle':
        return 'Triangle';
      default:
        return 'Rectangle';
    }
  }

  textDecorationFor(element: SlideElement): string | null {
    if (element.type !== 'text') return null;
    const parts: string[] = [];
    if (element.data.underline) parts.push('underline');
    if (element.data.strikethrough) parts.push('line-through');
    return parts.length ? parts.join(' ') : null;
  }

  private cloneSlides(slides: SlideModel[]): SlideModel[] {
    return slides.map(slide => ({
      ...slide,
      elements: slide.elements.map(element => ({
        ...element,
        data: { ...element.data }
      }))
    }));
  }

  private async persistDeck() {
    if (!this.deck) return;
    const payload: SlideDoc = {
      ...this.deck,
      title: this.deck.title?.trim() || 'Untitled presentation',
      data: { slides: this.cloneSlides(this.slides) },
      updatedAt: new Date().toISOString()
    };
    try {
      let saved: SlideDoc | undefined;
      if (payload.id === 'new') {
        saved = await this.svc.create({ title: payload.title, data: payload.data });
      } else {
        saved = await this.svc.save(payload);
      }
      if (saved) {
        this.deck = saved;
      } else {
        this.deck = payload;
      }
      this.renameTitle = this.deck?.title ?? '';
    } catch (err) {
      this.svc.lastError = err instanceof Error ? err.message : 'Unable to save presentation.';
      this.deck = payload;
    }
  }

  queueSave() {
    if (!this.deck) {
      return;
    }
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
    }
    this.pendingSave = setTimeout(() => {
      this.pendingSave = undefined;
      void this.persistDeck();
    }, 350);
  }

  async showOpen() {
    this.openModal = true;
    this.openQuery = '';
    try {
      this.openRows = await this.svc.list();
      this.openFiltered = [...this.openRows];
    } catch (err) {
      this.openRows = [];
      this.openFiltered = [];
      this.svc.lastError = err instanceof Error ? err.message : 'Unable to load presentations.';
    }
  }

  showRename() {
    this.renameModal = true;
    this.renameTitle = this.deck?.title ?? '';
  }

  downloadDeck() {
    if (!this.deck) {
      return;
    }
    const payload = {
      ...this.deck,
      data: { slides: this.cloneSlides(this.slides) }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const safeTitle = (this.deck.title || 'presentation').replace(/[^a-z0-9-_]+/gi, '-');
    anchor.download = `${safeTitle}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  present() {
    if (!this.deck || this.deck.id === 'new') {
      alert('Save the presentation before presenting.');
      return;
    }
    const base = window.location.origin;
    window.open(`${base}/slides/${this.deck.id}/present`, '_blank', 'noopener');
  }

  promptZoom() {
    const input = prompt('Zoom (%)', `${Math.round(this.zoom * 100)}`);
    if (!input) return;
    const parsed = Number(input);
    if (Number.isFinite(parsed) && parsed > 0) {
      const normalized = parsed / 100;
      const min = this.zoomLevels[0];
      const max = this.zoomLevels[this.zoomLevels.length - 1];
      this.zoom = this.clamp(normalized, min, max);
    }
  }

  async openShare() {
    if (!this.deck) return;
    if (this.deck.id === 'new') {
      await this.persistDeck();
      if (!this.deck || this.deck.id === 'new') {
        this.shareError = 'Save deck before sharing.';
        return;
      }
    }
    this.shareOpen = true;
    this.shareLoading = true;
    this.shareError = null;
    try {
      this.shareRows = await this.svc.listCollaborators(this.deck.id);
    } catch (err) {
      this.shareError = err instanceof Error ? err.message : 'Unable to load collaborators.';
    } finally {
      this.shareLoading = false;
    }
  }

  private clientToCanvas(event: PointerEvent) {
    const stage = this.canvasSurface?.nativeElement.querySelector('.editor-stage') as HTMLElement | null;
    if (!stage) {
      return { x: 0, y: 0 };
    }
    const rect = stage.getBoundingClientRect();
    const offsetX = event.clientX - rect.left - this.pan.x;
    const offsetY = event.clientY - rect.top - this.pan.y;
    const divisor = this.zoom || 1;
    return {
      x: offsetX / divisor,
      y: offsetY / divisor
    };
  }

  private snapToGrid(value: number) {
    if (!this.gridSize) return value;
    return Math.round(value / this.gridSize) * this.gridSize;
  }

  private clamp(value: number, min: number, max: number) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  private updateAlignmentGuides(element: SlideElement) {
    const guides: AlignmentGuides = { vertical: null, horizontal: null };
    const tolerance = 4;
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const canvasCenterX = this.canvasWidth / 2;
    const canvasCenterY = this.canvasHeight / 2;

    if (Math.abs(centerX - canvasCenterX) <= tolerance) {
      element.x = canvasCenterX - element.width / 2;
      guides.vertical = canvasCenterX;
    } else if (Math.abs(element.x) <= tolerance) {
      element.x = 0;
      guides.vertical = 0;
    } else if (Math.abs(element.x + element.width - this.canvasWidth) <= tolerance) {
      element.x = this.canvasWidth - element.width;
      guides.vertical = this.canvasWidth;
    }

    if (Math.abs(centerY - canvasCenterY) <= tolerance) {
      element.y = canvasCenterY - element.height / 2;
      guides.horizontal = canvasCenterY;
    } else if (Math.abs(element.y) <= tolerance) {
      element.y = 0;
      guides.horizontal = 0;
    } else if (Math.abs(element.y + element.height - this.canvasHeight) <= tolerance) {
      element.y = this.canvasHeight - element.height;
      guides.horizontal = this.canvasHeight;
    }

    this.alignmentGuides = guides;
  }

  private isInputTarget(target: EventTarget | null): target is HTMLElement {
    if (!target) return false;
    const element = target as HTMLElement;
    const tag = element.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || element.isContentEditable;
  }

  get canvasTransform(): string {
    return `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
  }

  get gridStyle(): Record<string, string> {
    const size = Math.max(8, this.gridSize * this.zoom);
    const color = 'rgba(148,163,184,0.25)';
    return {
      backgroundImage: `linear-gradient(to right, ${color} 1px, transparent 1px), linear-gradient(to bottom, ${color} 1px, transparent 1px)`,
      backgroundSize: `${size}px ${size}px`,
      backgroundPosition: `${this.pan.x}px ${this.pan.y}px`
    };
  }

  get horizontalRulerStyle(): Record<string, string> {
    const spacing = Math.max(10, this.gridSize * this.zoom);
    const offset = ((this.pan.x % spacing) + spacing) % spacing;
    return {
      backgroundImage: 'linear-gradient(to right, rgba(15,23,42,0.25) 1px, transparent 1px)',
      backgroundSize: `${spacing}px 100%`,
      backgroundPosition: `${offset}px 0`
    };
  }

  get verticalRulerStyle(): Record<string, string> {
    const spacing = Math.max(10, this.gridSize * this.zoom);
    const offset = ((this.pan.y % spacing) + spacing) % spacing;
    return {
      backgroundImage: 'linear-gradient(to bottom, rgba(15,23,42,0.25) 1px, transparent 1px)',
      backgroundSize: `100% ${spacing}px`,
      backgroundPosition: `0 ${offset}px`
    };
  }

  private loadRecentColors(): string[] {
    try {
      const raw = localStorage.getItem(SlidePageComponent.TEXT_COLOR_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((value: unknown): value is string => typeof value === 'string');
      }
      return [];
    } catch {
      return [];
    }
  }

  private pushRecentColor(color: string) {
    const normalized = color.toLowerCase();
    this.recentTextColors = [normalized, ...this.recentTextColors.filter(entry => entry !== normalized)].slice(0, 6);
    try {
      localStorage.setItem(SlidePageComponent.TEXT_COLOR_STORAGE_KEY, JSON.stringify(this.recentTextColors));
    } catch {
      // ignore storage failures (private browsing / quota)
    }
  }

  private loadShapeColors(): string[] {
    try {
      const raw = localStorage.getItem(SlidePageComponent.SHAPE_COLOR_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((value: unknown): value is string => typeof value === 'string');
      }
      return [];
    } catch {
      return [];
    }
  }

  private pushShapeColor(color: string) {
    const normalized = color.toLowerCase();
    this.recentShapeColors = [normalized, ...this.recentShapeColors.filter(entry => entry !== normalized)].slice(0, 6);
    try {
      localStorage.setItem(SlidePageComponent.SHAPE_COLOR_STORAGE_KEY, JSON.stringify(this.recentShapeColors));
    } catch {
      // ignore storage failures
    }
  }

  private loadStrokeColors(): string[] {
    try {
      const raw = localStorage.getItem(SlidePageComponent.SHAPE_STROKE_COLOR_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((value: unknown): value is string => typeof value === 'string');
      }
      return [];
    } catch {
      return [];
    }
  }

  private pushStrokeColor(color: string) {
    const normalized = color.toLowerCase();
    this.recentStrokeColors = [normalized, ...this.recentStrokeColors.filter(entry => entry !== normalized)].slice(0, 6);
    try {
      localStorage.setItem(SlidePageComponent.SHAPE_STROKE_COLOR_STORAGE_KEY, JSON.stringify(this.recentStrokeColors));
    } catch {
      // ignore storage failures
    }
  }

  textAnchorFor(element: SlideElement): 'start' | 'middle' | 'end' {
    if (element.type !== 'text') return 'start';
    const align = element.data.align ?? 'left';
    if (align === 'center') return 'middle';
    if (align === 'right') return 'end';
    return 'start';
  }

  textXFor(element: SlideElement): number {
    if (element.type !== 'text') return element.x + 12;
    const align = element.data.align ?? 'left';
    const indent = 12;
    if (align === 'center') {
      return element.x + element.width / 2;
    }
    if (align === 'right') {
      return element.x + element.width - indent;
    }
    return element.x + indent;
  }

  renderLines(element: SlideElement): string[] {
    if (element.type !== 'text') return [];
    const text = element.data.text ?? '';
    const rawLines = text.split(/\r?\n/);
    const fontSize = element.data.fontSize || 24;
    const padding = 24;
    const maxChars = Math.max(1, Math.floor((element.width - padding) / (fontSize * 0.6)));
    const wrapped: string[] = [];
    for (const raw of rawLines.length ? rawLines : ['']) {
      let line = raw;
      if (!line) {
        wrapped.push('');
        continue;
      }
      const words = line.split(/\s+/);
      let current = '';
      for (const word of words) {
        if (!current) {
          current = word;
          continue;
        }
        if ((current + ' ' + word).length <= maxChars) {
          current += ` ${word}`;
        } else {
          wrapped.push(current);
          current = word;
        }
      }
      wrapped.push(current);
    }
    return wrapped;
  }

  lineHeightPx(element: SlideElement): number {
    const fontSize = element.data.fontSize || 24;
    const lineHeight = element.data.lineHeight ?? 1.2;
    return fontSize * lineHeight;
  }

  bulletPrefix(element: SlideElement, index: number): string {
    if (element.type !== 'text') {
      return '';
    }
    const style = element.data.bulletStyle ?? 'none';
    if (style === 'bullet') {
      return '• ';
    }
    if (style === 'number') {
      return `${index + 1}. `;
    }
    return '';
  }

  lineEnd(element: SlideElement): { x: number; y: number } {
    return {
      x: element.x + element.width,
      y: element.y + element.height
    };
  }

  lineStrokeWidth(element: SlideElement): number {
    return element.data.strokeWidth ?? 2;
  }

  arrowHeadPoints(element: SlideElement): string {
    const start = { x: element.x, y: element.y };
    const end = this.lineEnd(element);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const arrowLength = 14;
    const arrowWidth = 6;
    const baseX = end.x - ux * arrowLength;
    const baseY = end.y - uy * arrowLength;
    const offsetX = -uy * arrowWidth;
    const offsetY = ux * arrowWidth;
    const p1 = `${end.x},${end.y}`;
    const p2 = `${baseX + offsetX},${baseY + offsetY}`;
    const p3 = `${baseX - offsetX},${baseY - offsetY}`;
    return `${p1} ${p2} ${p3}`;
  }

  trianglePoints(element: SlideElement): string {
    const top = `${element.x + element.width / 2},${element.y}`;
    const left = `${element.x},${element.y + element.height}`;
    const right = `${element.x + element.width},${element.y + element.height}`;
    return `${top} ${left} ${right}`;
  }

  strokeDashArray(element: SlideElement): string | null {
    const style = element.data.strokeStyle ?? 'solid';
    if (style === 'dashed') {
      return `${this.lineStrokeWidth(element) * 3} ${this.lineStrokeWidth(element) * 2}`;
    }
    if (style === 'dotted') {
      return `${this.lineStrokeWidth(element)} ${this.lineStrokeWidth(element) * 1.5}`;
    }
    return null;
  }
}
