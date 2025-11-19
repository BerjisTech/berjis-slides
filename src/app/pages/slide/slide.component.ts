import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SlidesService, SlideCollaborator, SlideDoc, UploadedAsset, defaultSlides } from '../../slides.service';
import { CANVAS_HEIGHT, CANVAS_WIDTH, GRID_SIZE, SlideElement, SlideLayout, SlideModel, cloneSlide, createImageElement, createShapeElement, createSlide, createTextElement } from '../../models/slide';

type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

interface AlignmentGuides {
  vertical: number | null;
  horizontal: number | null;
}

interface ImageRenderBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ResizeOrigin {
  x: number;
  y: number;
  width: number;
  height: number;
  pointerX: number;
  pointerY: number;
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
  imageUploadError: string | null = null;
  imageUploading = false;
  isCanvasDropActive = false;
  private canvasDragDepth = 0;
  readonly imageResizeHandles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  readonly resizeHandleSize = 12;
  readonly imageSizeRange = { min: 40, max: 1600 };
  readonly imageCropZoomRange = { min: 1, max: 4, step: 0.05 };
  readonly imageCropOffsetRange = { min: -100, max: 100, step: 1 };
  readonly imageFilterRange = { min: 0.2, max: 2, step: 0.05 };
  readonly imageSaturationRange = { min: 0, max: 3, step: 0.05 };
  readonly imageFilterDefaults = { brightness: 1, contrast: 1, saturation: 1 };
  readonly imageRotationRange = { min: -180, max: 180, step: 1 };
  resizingElementId: string | null = null;
  resizeHandle: ResizeHandle | null = null;
  private resizeOrigin?: ResizeOrigin;
  private resizeDidMutate = false;
  readonly lineHeightRange = { min: 0.8, max: 2.5, step: 0.1 };
  readonly bulletStyles: ('none' | 'bullet' | 'number')[] = ['none', 'bullet', 'number'];
  readonly strokeStyles: Array<'solid' | 'dashed' | 'dotted'> = ['solid', 'dashed', 'dotted'];
  shapeVariant: 'rectangle' | 'square' | 'ellipse' | 'line' | 'arrow' | 'triangle' = 'rectangle';
  readonly shapeStrokeRange = { min: 1, max: 12, step: 1 };
  readonly shapeOpacityRange = { min: 0.1, max: 1, step: 0.05 };
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
  @ViewChild('imageFileInput', { static: false }) imageFileInput?: ElementRef<HTMLInputElement>;

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

  get selectedImageElement(): SlideElement | null {
    const slide = this.activeSlide;
    if (!slide) {
      return null;
    }
    return slide.elements.find(el => el.id === this.selectedElementId && el.type === 'image') ?? null;
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

  triggerImageUpload() {
    this.imageUploadError = null;
    this.resetImageFileInput();
    this.imageFileInput?.nativeElement?.click();
  }

  async handleImageFileChange(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    if (!file) {
      return;
    }
    try {
      await this.uploadImageFromFile(file);
    } finally {
      this.resetImageFileInput();
    }
  }

  addImageFromUrl() {
    const url = prompt('Paste image URL');
    if (!url) {
      return;
    }
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      this.imageUploadError = 'Enter a valid http(s) URL.';
      return;
    }
    this.imageUploadError = null;
    this.insertImageElement({
      url: trimmed,
      source: 'external',
      name: trimmed
    });
  }

  onCanvasDragEnter(event: DragEvent) {
    if (!this.shouldHandleImageDrag(event)) {
      return;
    }
    event.preventDefault();
    this.canvasDragDepth += 1;
    this.isCanvasDropActive = true;
    this.imageUploadError = null;
  }

  onCanvasDragOver(event: DragEvent) {
    if (!this.shouldHandleImageDrag(event)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    if (!this.isCanvasDropActive) {
      this.isCanvasDropActive = true;
    }
  }

  onCanvasDragLeave(event: DragEvent) {
    if (!this.shouldHandleImageDrag(event)) {
      return;
    }
    event.preventDefault();
    this.canvasDragDepth = Math.max(0, this.canvasDragDepth - 1);
    if (this.canvasDragDepth === 0) {
      this.resetCanvasDropState();
    }
  }

  async onCanvasDrop(event: DragEvent) {
    if (!this.shouldHandleImageDrag(event)) {
      return;
    }
    event.preventDefault();
    const file = this.getImageFileFromTransfer(event.dataTransfer);
    this.resetCanvasDropState();
    if (!file) {
      this.imageUploadError = 'Drop an image file (PNG, JPG, SVG, WebP, etc.).';
      return;
    }
    await this.uploadImageFromFile(file);
  }

  onResizeHandlePointerDown(event: PointerEvent, element: SlideElement, handle: ResizeHandle) {
    if (element.type !== 'image') {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    this.selectedElementId = element.id;
    const { x, y } = this.clientToCanvas(event);
    this.resizingElementId = element.id;
    this.resizeHandle = handle;
    this.resizeOrigin = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      pointerX: x,
      pointerY: y
    };
    this.resizeDidMutate = false;
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
    if (this.resizingElementId && this.resizeHandle) {
      this.handleImageResizePointerMove(event);
      return;
    }
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
    if (this.resizingElementId) {
      this.resizingElementId = null;
      this.resizeHandle = null;
      this.resizeOrigin = undefined;
      if (this.resizeDidMutate) {
        this.queueSave();
      }
      this.resizeDidMutate = false;
    }
  }

  private handleImageResizePointerMove(event: PointerEvent) {
    if (!this.resizingElementId || !this.resizeHandle || !this.resizeOrigin) {
      return;
    }
    const slide = this.activeSlide;
    if (!slide) {
      return;
    }
    const element = slide.elements.find(el => el.id === this.resizingElementId);
    if (!element || element.type !== 'image') {
      return;
    }
    const { x, y } = this.clientToCanvas(event);
    const dx = x - this.resizeOrigin.pointerX;
    const dy = y - this.resizeOrigin.pointerY;
    let nextWidth = this.resizeOrigin.width;
    let nextHeight = this.resizeOrigin.height;
    let nextX = this.resizeOrigin.x;
    let nextY = this.resizeOrigin.y;
    const minSize = this.imageSizeRange.min;
    const handle = this.resizeHandle;
    const affectsWest = handle.includes('w');
    const affectsEast = handle.includes('e');
    const affectsNorth = handle.includes('n');
    const affectsSouth = handle.includes('s');

    if (affectsEast) {
      nextWidth = this.resizeOrigin.width + dx;
    }
    if (affectsSouth) {
      nextHeight = this.resizeOrigin.height + dy;
    }
    if (affectsWest) {
      nextWidth = this.resizeOrigin.width - dx;
      nextX = this.resizeOrigin.x + dx;
    }
    if (affectsNorth) {
      nextHeight = this.resizeOrigin.height - dy;
      nextY = this.resizeOrigin.y + dy;
    }

    nextWidth = Math.max(minSize, nextWidth);
    nextHeight = Math.max(minSize, nextHeight);

    if (this.isImageAspectLocked(element) && handle.length === 2) {
      const ratio = this.imageAspectRatio(element);
      if (ratio > 0) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          nextHeight = nextWidth / ratio;
        } else {
          nextWidth = nextHeight * ratio;
        }
        if (affectsNorth) {
          nextY = this.resizeOrigin.y + (this.resizeOrigin.height - nextHeight);
        }
        if (affectsWest) {
          nextX = this.resizeOrigin.x + (this.resizeOrigin.width - nextWidth);
        }
      }
    }

    nextX = this.clamp(nextX, 0, this.canvasWidth - nextWidth);
    nextY = this.clamp(nextY, 0, this.canvasHeight - nextHeight);
    nextWidth = Math.min(nextWidth, this.canvasWidth - nextX);
    nextHeight = Math.min(nextHeight, this.canvasHeight - nextY);

    element.x = Math.round(nextX);
    element.y = Math.round(nextY);
    element.width = Math.round(nextWidth);
    element.height = Math.round(nextHeight);
    if (element.width > 0 && element.height > 0) {
      element.data.aspectRatio = element.width / element.height;
    }
    this.normalizeImageCrop(element);
    this.resizeDidMutate = true;
  }

  @HostListener('document:dragend')
  @HostListener('document:drop')
  handleDocumentDragReset() {
    if (this.isCanvasDropActive || this.canvasDragDepth !== 0) {
      this.resetCanvasDropState();
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

  private insertUploadedImage(asset: UploadedAsset) {
    if (!asset?.url) {
      this.imageUploadError = 'Upload response missing URL.';
      return;
    }
    this.insertImageElement({
      url: asset.url,
      source: 'upload',
      name: asset.name,
      size: asset.size
    });
  }

  private insertImageElement(options: { url: string; source: 'upload' | 'external'; name?: string; size?: number }) {
    const slide = this.activeSlide;
    if (!slide) {
      return;
    }
    const width = 360;
    const height = 240;
    const x = (this.canvasWidth - width) / 2;
    const y = (this.canvasHeight - height) / 2;
    const element = createImageElement({
      x,
      y,
      width,
      height,
      url: options.url,
      name: options.name,
      size: options.size,
      source: options.source
    });
    slide.elements.push(element);
    this.selectedElementId = element.id;
    this.normalizeImageCrop(element);
    this.queueSave();
  }

  private async uploadImageFromFile(file: File) {
    if (!this.isImageFile(file)) {
      this.imageUploadError = 'Only image files are supported.';
      return;
    }
    this.imageUploadError = null;
    this.imageUploading = true;
    try {
      const asset = await this.svc.uploadImage(file);
      this.insertUploadedImage(asset);
    } catch (err) {
      this.imageUploadError = err instanceof Error ? err.message : 'Upload failed';
    } finally {
      this.imageUploading = false;
    }
  }

  private resetImageFileInput() {
    if (this.imageFileInput?.nativeElement) {
      this.imageFileInput.nativeElement.value = '';
    }
  }

  private resetCanvasDropState() {
    this.canvasDragDepth = 0;
    this.isCanvasDropActive = false;
  }

  private shouldHandleImageDrag(event: DragEvent): boolean {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) {
      return false;
    }
    const items = dataTransfer.items;
    if (items && items.length) {
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item && item.kind === 'file' && (!item.type || item.type.startsWith('image/'))) {
          return true;
        }
      }
    }
    const files = dataTransfer.files;
    if (files && files.length) {
      for (let i = 0; i < files.length; i += 1) {
        if (this.isImageFile(files[i])) {
          return true;
        }
      }
    }
    return false;
  }

  private getImageFileFromTransfer(dataTransfer: DataTransfer | null): File | null {
    if (!dataTransfer) {
      return null;
    }
    const files = dataTransfer.files;
    if (files && files.length) {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        if (this.isImageFile(file)) {
          return file;
        }
      }
    }
    const items = dataTransfer.items;
    if (items && items.length) {
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (!item || item.kind !== 'file') {
          continue;
        }
        const file = item.getAsFile();
        if (this.isImageFile(file)) {
          return file;
        }
      }
    }
    return null;
  }

  private isImageFile(file?: File | null): file is File {
    if (!file) {
      return false;
    }
    if (file.type) {
      return file.type.startsWith('image/');
    }
    const name = file.name || '';
    return /(\.(png|apng|gif|jpe?g|svg|bmp|webp|avif|heic|heif))$/i.test(name);
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

  changeShapeOpacity(value: number | string) {
    const element = this.selectedShapeElement;
    if (!element) {
      return;
    }
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(numeric)) {
      return;
    }
    const clamped = Number(Math.min(this.shapeOpacityRange.max, Math.max(this.shapeOpacityRange.min, numeric)).toFixed(2));
    element.data.opacity = clamped;
    this.queueSave();
  }

  changeImageWidth(value: number | string) {
    const element = this.selectedImageElement;
    if (!element) return;
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(numeric)) return;
    const clamped = this.clamp(Math.round(numeric), this.imageSizeRange.min, this.canvasWidth);
    const ratio = this.imageAspectRatio(element);
    element.width = clamped;
    if (this.isImageAspectLocked(element) && ratio > 0) {
      const nextHeight = Math.round(clamped / ratio);
      element.height = this.clamp(nextHeight, this.imageSizeRange.min, this.canvasHeight);
    }
    element.data.aspectRatio = element.width > 0 && element.height > 0 ? element.width / element.height : element.data.aspectRatio;
    this.clampElementToCanvas(element);
    this.normalizeImageCrop(element);
    this.queueSave();
  }

  changeImageHeight(value: number | string) {
    const element = this.selectedImageElement;
    if (!element) return;
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(numeric)) return;
    const clamped = this.clamp(Math.round(numeric), this.imageSizeRange.min, this.canvasHeight);
    const ratio = this.imageAspectRatio(element);
    element.height = clamped;
    if (this.isImageAspectLocked(element) && ratio > 0) {
      const nextWidth = Math.round(clamped * ratio);
      element.width = this.clamp(nextWidth, this.imageSizeRange.min, this.canvasWidth);
    }
    element.data.aspectRatio = element.width > 0 && element.height > 0 ? element.width / element.height : element.data.aspectRatio;
    this.clampElementToCanvas(element);
    this.normalizeImageCrop(element);
    this.queueSave();
  }

  toggleImageAspectLock(locked: boolean) {
    const element = this.selectedImageElement;
    if (!element) return;
    element.data.lockAspectRatio = locked;
    if (locked && element.width > 0 && element.height > 0) {
      element.data.aspectRatio = element.width / element.height;
    }
    this.queueSave();
  }

  resetImageSize() {
    const element = this.selectedImageElement;
    if (!element) return;
    const ratio = this.imageAspectRatio(element) || 1;
    const targetWidth = this.clamp(360, this.imageSizeRange.min, this.canvasWidth);
    const targetHeight = this.clamp(Math.round(targetWidth / ratio), this.imageSizeRange.min, this.canvasHeight);
    element.width = targetWidth;
    element.height = targetHeight;
    element.data.aspectRatio = ratio;
    this.clampElementToCanvas(element);
    this.normalizeImageCrop(element);
    this.queueSave();
  }

  changeImageCropZoom(value: number | string) {
    const element = this.selectedImageElement;
    if (!element) return;
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(numeric)) return;
    const clamped = this.clamp(numeric, this.imageCropZoomRange.min, this.imageCropZoomRange.max);
    element.data.cropZoom = Number(clamped.toFixed(2));
    if ((element.data.cropZoom ?? 1) <= 1) {
      element.data.cropZoom = 1;
      element.data.cropOffsetX = 0;
      element.data.cropOffsetY = 0;
    }
    this.normalizeImageCrop(element);
    this.queueSave();
  }

  changeImageCropOffset(axis: 'x' | 'y', value: number | string) {
    const element = this.selectedImageElement;
    if (!element) return;
    if (!element.data.cropZoom || element.data.cropZoom <= 1) {
      return;
    }
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(numeric)) return;
    const clampedPercent = this.clamp(numeric, this.imageCropOffsetRange.min, this.imageCropOffsetRange.max);
    const normalized = Number((clampedPercent / 100).toFixed(2));
    if (axis === 'x') {
      element.data.cropOffsetX = normalized;
    } else {
      element.data.cropOffsetY = normalized;
    }
    this.normalizeImageCrop(element);
    this.queueSave();
  }

  resetImageCrop() {
    const element = this.selectedImageElement;
    if (!element) return;
    element.data.cropZoom = 1;
    element.data.cropOffsetX = 0;
    element.data.cropOffsetY = 0;
    this.queueSave();
  }

  changeImageFilter(kind: 'brightness' | 'contrast' | 'saturation', value: number | string) {
    const element = this.selectedImageElement;
    if (!element) return;
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(numeric)) return;
    const range = kind === 'saturation' ? this.imageSaturationRange : this.imageFilterRange;
    const clamped = this.clamp(Number(numeric), range.min, range.max);
    element.data[kind] = Number(clamped.toFixed(2));
    this.queueSave();
  }

  resetImageFilters() {
    const element = this.selectedImageElement;
    if (!element) return;
    element.data.brightness = this.imageFilterDefaults.brightness;
    element.data.contrast = this.imageFilterDefaults.contrast;
    element.data.saturation = this.imageFilterDefaults.saturation;
    this.queueSave();
  }

  changeImageRotation(value: number | string) {
    const element = this.selectedImageElement;
    if (!element) return;
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(numeric)) return;
    const clamped = this.clamp(Math.round(numeric), this.imageRotationRange.min, this.imageRotationRange.max);
    element.rotation = clamped;
    this.queueSave();
  }

  resetImageRotation() {
    const element = this.selectedImageElement;
    if (!element) return;
    element.rotation = 0;
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

  isImageAspectLocked(element: SlideElement): boolean {
    if (element.type !== 'image') {
      return false;
    }
    return element.data.lockAspectRatio !== false;
  }

  imageAspectRatio(element: SlideElement): number {
    if (element.type !== 'image') {
      return 1;
    }
    if (element.data.aspectRatio && element.data.aspectRatio > 0) {
      return element.data.aspectRatio;
    }
    if (element.height > 0) {
      return element.width / element.height;
    }
    return 1;
  }

  imageCropZoomValue(element: SlideElement): number {
    if (element.type !== 'image') {
      return 1;
    }
    const zoom = typeof element.data.cropZoom === 'number' ? element.data.cropZoom : 1;
    const clamped = this.clamp(zoom, this.imageCropZoomRange.min, this.imageCropZoomRange.max);
    return Number(clamped.toFixed(2));
  }

  imageCropOffsetPercent(element: SlideElement, axis: 'x' | 'y'): number {
    if (element.type !== 'image') {
      return 0;
    }
    const value = axis === 'x' ? element.data.cropOffsetX ?? 0 : element.data.cropOffsetY ?? 0;
    return Math.round(value * 100);
  }

  imageFilterValue(element: SlideElement, kind: 'brightness' | 'contrast' | 'saturation'): number {
    if (element.type !== 'image') {
      return this.imageFilterDefaults[kind];
    }
    const value = element.data[kind];
    if (typeof value === 'number' && Number.isFinite(value)) {
      const range = kind === 'saturation' ? this.imageSaturationRange : this.imageFilterRange;
      return Number(this.clamp(value, range.min, range.max).toFixed(2));
    }
    return this.imageFilterDefaults[kind];
  }

  imageFilterString(element: SlideElement): string | null {
    if (element.type !== 'image') {
      return null;
    }
    const brightness = this.imageFilterValue(element, 'brightness');
    const contrast = this.imageFilterValue(element, 'contrast');
    const saturation = this.imageFilterValue(element, 'saturation');
    if (brightness === 1 && contrast === 1 && saturation === 1) {
      return null;
    }
    return `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
  }

  isImageFiltersDefault(element: SlideElement): boolean {
    if (element.type !== 'image') {
      return true;
    }
    return (
      Math.abs(this.imageFilterValue(element, 'brightness') - this.imageFilterDefaults.brightness) < 0.01 &&
      Math.abs(this.imageFilterValue(element, 'contrast') - this.imageFilterDefaults.contrast) < 0.01 &&
      Math.abs(this.imageFilterValue(element, 'saturation') - this.imageFilterDefaults.saturation) < 0.01
    );
  }

  imageRotationValue(element: SlideElement): number {
    return element.rotation ?? 0;
  }

  imageTransform(element: SlideElement): string | null {
    if (element.type !== 'image') {
      return null;
    }
    const angle = element.rotation ?? 0;
    if (!angle) {
      return null;
    }
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    return `rotate(${angle} ${cx} ${cy})`;
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

  imageRenderBox(element: SlideElement): ImageRenderBox {
    if (element.type !== 'image') {
      return { x: element.x, y: element.y, width: element.width, height: element.height };
    }
    return this.computeImageRenderBox(element);
  }

  imageClipPathId(element: SlideElement, scope: string): string {
    return `${scope}-clip-${element.id}`;
  }

  imageClipPathUrl(element: SlideElement, scope: string): string {
    return `url(#${this.imageClipPathId(element, scope)})`;
  }

  resizeHandlePosition(element: SlideElement, handle: ResizeHandle): { x: number; y: number } {
    const size = this.resizeHandleSize;
    let x = element.x - size / 2;
    let y = element.y - size / 2;
    switch (handle) {
      case 'n':
        x = element.x + element.width / 2 - size / 2;
        y = element.y - size / 2;
        break;
      case 'ne':
        x = element.x + element.width - size / 2;
        y = element.y - size / 2;
        break;
      case 'e':
        x = element.x + element.width - size / 2;
        y = element.y + element.height / 2 - size / 2;
        break;
      case 'se':
        x = element.x + element.width - size / 2;
        y = element.y + element.height - size / 2;
        break;
      case 's':
        x = element.x + element.width / 2 - size / 2;
        y = element.y + element.height - size / 2;
        break;
      case 'sw':
        x = element.x - size / 2;
        y = element.y + element.height - size / 2;
        break;
      case 'w':
        x = element.x - size / 2;
        y = element.y + element.height / 2 - size / 2;
        break;
      default:
        x = element.x - size / 2;
        y = element.y - size / 2;
        break;
    }
    return { x, y };
  }

  resizeHandleCursor(handle: ResizeHandle): string {
    switch (handle) {
      case 'n':
      case 's':
        return 'ns-resize';
      case 'e':
      case 'w':
        return 'ew-resize';
      case 'ne':
      case 'sw':
        return 'nesw-resize';
      default:
        return 'nwse-resize';
    }
  }

  private computeImageRenderBox(element: SlideElement): ImageRenderBox {
    const zoom = this.imageCropZoomValue(element);
    const width = element.width * zoom;
    const height = element.height * zoom;
    const extraWidth = width - element.width;
    const extraHeight = height - element.height;
    const offsetXPercent = this.clamp(element.data.cropOffsetX ?? 0, -1, 1);
    const offsetYPercent = this.clamp(element.data.cropOffsetY ?? 0, -1, 1);
    const offsetX = extraWidth ? (extraWidth / 2) * offsetXPercent : 0;
    const offsetY = extraHeight ? (extraHeight / 2) * offsetYPercent : 0;
    return {
      x: element.x - extraWidth / 2 + offsetX,
      y: element.y - extraHeight / 2 + offsetY,
      width,
      height
    };
  }

  private clampElementToCanvas(element: SlideElement) {
    element.x = this.clamp(element.x, 0, this.canvasWidth - element.width);
    element.y = this.clamp(element.y, 0, this.canvasHeight - element.height);
  }

  private normalizeImageCrop(element: SlideElement) {
    if (element.type !== 'image') {
      return;
    }
    const zoom = element.data.cropZoom ?? 1;
    const clampedZoom = this.clamp(zoom, this.imageCropZoomRange.min, this.imageCropZoomRange.max);
    element.data.cropZoom = Number(clampedZoom.toFixed(2));
    if (element.data.cropZoom <= 1) {
      element.data.cropZoom = 1;
      element.data.cropOffsetX = 0;
      element.data.cropOffsetY = 0;
      return;
    }
    element.data.cropOffsetX = this.clamp(element.data.cropOffsetX ?? 0, -1, 1);
    element.data.cropOffsetY = this.clamp(element.data.cropOffsetY ?? 0, -1, 1);
  }
}
