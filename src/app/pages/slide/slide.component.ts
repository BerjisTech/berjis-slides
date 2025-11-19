import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SlidesService, SlideCollaborator, SlideDoc, UploadedAsset, defaultSlides } from '../../slides.service';
import { CANVAS_HEIGHT, CANVAS_WIDTH, GRID_SIZE, SlideElement, SlideLayout, SlideModel, cloneElement, cloneSlide, createId, createImageElement, createShapeElement, createSlide, createTextElement } from '../../models/slide';

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
  private selectedElementIds = new Set<string>();
  private history: Array<{ slides: SlideModel[]; selectedSlideIndex: number }> = [];
  private historyIndex = -1;
  private readonly historyLimit = 50;

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
  private dragSelectionOffsets = new Map<string, { dx: number; dy: number }>();
  private dragOffset = { x: 0, y: 0 };
  alignmentGuides: AlignmentGuides = { vertical: null, horizontal: null };
  private clipboardElements: SlideElement[] = [];
  private pasteBump = 0;

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
  pendingImageReplaceId: string | null = null;
  isCanvasDropActive = false;
  private canvasDragDepth = 0;
  private marqueeSelecting = false;
  private marqueeAdditive = false;
  private marqueeStart = { x: 0, y: 0 };
  private marqueeCurrent = { x: 0, y: 0 };
  readonly resizeHandles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  readonly resizeHandleSize = 12;
  readonly imageSizeRange = { min: 40, max: 1600 };
  readonly imageBorderRange = { min: 0, max: 20, step: 1 };
  readonly imageCropZoomRange = { min: 1, max: 4, step: 0.05 };
  readonly imageCropOffsetRange = { min: -100, max: 100, step: 1 };
  readonly imageFilterRange = { min: 0.2, max: 2, step: 0.05 };
  readonly imageSaturationRange = { min: 0, max: 3, step: 0.05 };
  readonly imageFilterDefaults = { brightness: 1, contrast: 1, saturation: 1 };
  readonly imageRotationRange = { min: -180, max: 180, step: 1 };
  readonly rotationHandleOffset = 32;
  readonly rotationHandleRadius = 6;
  resizingElementId: string | null = null;
  resizeHandle: ResizeHandle | null = null;
  private resizeOrigin?: ResizeOrigin;
  private resizeDidMutate = false;
  private resizeAspectRatio: number | null = null;
  rotatingElementId: string | null = null;
  private rotationOrigin: { x: number; y: number } | null = null;
  private rotationStartAngle = 0;
  private rotationInitial = 0;
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
    this.history = [];
    this.historyIndex = -1;
    this.recordHistorySnapshot();
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

  get selectedElements(): SlideElement[] {
    const slide = this.activeSlide;
    if (!slide || !this.selectedElementIds.size) {
      return [];
    }
    return slide.elements.filter(el => this.selectedElementIds.has(el.id));
  }

  isElementSelected(element: SlideElement): boolean {
    return this.selectedElementIds.has(element.id);
  }

  isLocked(element: SlideElement): boolean {
    return !!element.data.locked;
  }

  isElementHidden(element: SlideElement): boolean {
    return !!element.data.hidden;
  }

  showSelectionOutline(element: SlideElement): boolean {
    return this.isElementSelected(element);
  }

  showSelectionHandles(element: SlideElement): boolean {
    return this.selectedElementIds.size === 1 && this.isElementSelected(element) && !this.isLocked(element) && !this.isElementHidden(element);
  }

  get selectionCount(): number {
    return this.selectedElements.length;
  }

  selectionAllLocked(): boolean {
    return this.selectionCount > 0 && this.selectedElements.every(element => this.isLocked(element));
  }

  selectionAnyLocked(): boolean {
    return this.selectedElements.some(element => this.isLocked(element));
  }

  selectionAllHidden(): boolean {
    return this.selectionCount > 0 && this.selectedElements.every(element => this.isElementHidden(element));
  }

  selectionAnyHidden(): boolean {
    return this.selectedElements.some(element => this.isElementHidden(element));
  }

  selectionHasGroup(): boolean {
    return this.selectedElements.some(element => !!element.data.groupId);
  }

  get layerEntries(): Array<{ id: string; element: SlideElement; label: string; order: number }> {
    const slide = this.activeSlide;
    if (!slide) {
      return [];
    }
    const total = slide.elements.length;
    return slide.elements.map((element, index) => ({
      id: element.id,
      element,
      label: this.elementLabel(element),
      order: total - index
    })).reverse();
  }

  trackLayer(_index: number, entry: { id: string }): string {
    return entry.id;
  }

  private elementLabel(element: SlideElement): string {
    if (element.type === 'text') {
      const content = element.data.text?.trim();
      return content ? `Text: ${content.slice(0, 12)}${content.length > 12 ? '…' : ''}` : 'Text box';
    }
    if (element.type === 'image') {
      return element.data.assetName ? `Image: ${element.data.assetName}` : 'Image';
    }
    const kind = element.data.shapeKind ?? 'rect';
    return `Shape: ${kind}`;
  }

  private replaceSelection(ids: string[]) {
    this.selectedElementIds = new Set(ids);
    this.selectedElementId = ids.length ? ids[ids.length - 1] : null;
  }

  private addToSelection(id: string) {
    const next = new Set(this.selectedElementIds);
    next.add(id);
    this.selectedElementIds = next;
    this.selectedElementId = id;
  }

  private removeFromSelection(id: string) {
    if (this.selectedElementIds.has(id)) {
      const next = new Set(this.selectedElementIds);
      next.delete(id);
      this.selectedElementIds = next;
      if (this.selectedElementId === id) {
        this.selectedElementId = next.size ? Array.from(next).pop() ?? null : null;
      }
    }
  }

  private clearSelection() {
    this.selectedElementIds.clear();
    this.selectedElementId = null;
  }

  private findElementById(id: string | null): SlideElement | null {
    if (!id) {
      return null;
    }
    const slide = this.activeSlide;
    if (!slide) {
      return null;
    }
    return slide.elements.find(element => element.id === id) ?? null;
  }

  private selectGroup(groupId: string, additive: boolean) {
    const slide = this.activeSlide;
    if (!slide) {
      return;
    }
    const ids = this.elementsInGroup(groupId).map(element => element.id);
    if (!ids.length) {
      return;
    }
    if (additive) {
      ids.forEach(id => this.addToSelection(id));
    } else {
      this.replaceSelection(ids);
    }
  }

  private elementsInGroup(groupId: string): SlideElement[] {
    const slide = this.activeSlide;
    if (!slide) {
      return [];
    }
    return slide.elements.filter(element => element.data.groupId === groupId);
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

  triggerImageUpload(targetElementId?: string) {
    this.imageUploadError = null;
    this.pendingImageReplaceId = targetElementId ?? null;
    this.resetImageFileInput();
    this.imageFileInput?.nativeElement?.click();
  }

  replaceImageWithUpload() {
    const element = this.selectedImageElement;
    if (!element) {
      return;
    }
    this.triggerImageUpload(element.id);
  }

  replaceImageWithUrl() {
    const element = this.selectedImageElement;
    if (!element) {
      return;
    }
    const url = prompt('Paste image URL to replace the current image');
    if (!url) {
      return;
    }
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      this.imageUploadError = 'Enter a valid http(s) URL.';
      return;
    }
    this.imageUploadError = null;
    this.insertImageElement(
      {
        url: trimmed,
        source: 'external',
        name: trimmed
      },
      element
    );
  }

  async handleImageFileChange(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    const replaceElement = this.findElementById(this.pendingImageReplaceId);
    this.pendingImageReplaceId = null;
    if (!file) {
      this.resetImageFileInput();
      return;
    }
    try {
      await this.uploadImageFromFile(file, replaceElement ?? undefined);
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
    event.stopPropagation();
    event.preventDefault();
    if (!this.isElementSelected(element)) {
      this.replaceSelection([element.id]);
    }
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
    this.resizeAspectRatio = this.shouldLockResizeAspect(element, handle, event) ? this.elementAspectRatio(element) : null;
    this.resizeDidMutate = false;
  }

  selectSlide(index: number) {
    this.selectedSlideIndex = index;
    this.clearSelection();
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
    if (event.key === 'Escape') {
      if (this.insertMode) {
        this.insertMode = null;
        return;
      }
      if (this.selectedElementIds.size) {
        this.clearSelection();
        return;
      }
    }
    if (event.code === 'Space') {
      this.spacePressed = true;
    }
    const hasSelection = this.selectedElementIds.size > 0;
    const metaKey = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (metaKey && key === 'z' && event.shiftKey) {
      this.redo();
      event.preventDefault();
      return;
    }
    if (metaKey && key === 'z' && !event.shiftKey) {
      this.undo();
      event.preventDefault();
      return;
    }
    if (metaKey && key === 'y') {
      this.redo();
      event.preventDefault();
      return;
    }
    if (metaKey && key === 'c' && hasSelection) {
      this.copySelection();
      event.preventDefault();
      return;
    }
    if (metaKey && key === 'x' && hasSelection) {
      this.cutSelection();
      event.preventDefault();
      return;
    }
    if (metaKey && key === 'v') {
      this.pasteClipboard();
      event.preventDefault();
      return;
    }
    if (metaKey && key === 'd' && hasSelection) {
      this.duplicateSelection();
      event.preventDefault();
      return;
    }
    if (metaKey && key === 'g' && hasSelection && !event.shiftKey) {
      this.groupSelection();
      event.preventDefault();
      return;
    }
    if (metaKey && key === 'g' && event.shiftKey) {
      this.ungroupSelection();
      event.preventDefault();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && hasSelection) {
      this.deleteSelectedElements();
      event.preventDefault();
      return;
    }
    if (hasSelection && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      const delta = event.shiftKey ? 10 : 2;
      switch (event.key) {
        case 'ArrowUp':
          this.moveSelectionBy(0, -delta);
          break;
        case 'ArrowDown':
          this.moveSelectionBy(0, delta);
          break;
        case 'ArrowLeft':
          this.moveSelectionBy(-delta, 0);
          break;
        case 'ArrowRight':
          this.moveSelectionBy(delta, 0);
          break;
      }
      event.preventDefault();
      return;
    }
    if (!hasSelection && event.key === 'ArrowLeft') {
      this.prevSlide();
      event.preventDefault();
      return;
    }
    if (!hasSelection && event.key === 'ArrowRight') {
      this.nextSlide();
      event.preventDefault();
      return;
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
    if (event.button !== 0) {
      return;
    }
    this.beginMarqueeSelection(event);
  }

  onElementPointerDown(event: PointerEvent, element: SlideElement) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }
    if (this.insertMode) {
      this.insertMode = null;
    }
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const groupId = element.data.groupId;
    if (groupId) {
      if (additive) {
        const ids = this.elementsInGroup(groupId).map(entry => entry.id);
        const shouldRemove = ids.every(id => this.selectedElementIds.has(id));
        ids.forEach(id => {
          if (shouldRemove) {
            this.removeFromSelection(id);
          } else {
            this.addToSelection(id);
          }
        });
      } else {
        this.selectGroup(groupId, false);
      }
    } else {
      if (additive) {
        if (this.isElementSelected(element) && (event.ctrlKey || event.metaKey)) {
          this.removeFromSelection(element.id);
        } else {
          this.addToSelection(element.id);
        }
      } else if (!this.isElementSelected(element)) {
        this.replaceSelection([element.id]);
      }
    }
    if (!this.selectedElementIds.size && !(event.ctrlKey || event.metaKey)) {
      this.replaceSelection([element.id]);
    }
    if (!this.selectedElementIds.size || this.isLocked(element)) {
      return;
    }
    this.draggingElementId = element.id;
    this.prepareDragSelection(event, element);
    if (!this.dragSelectionOffsets.size) {
      this.draggingElementId = null;
      return;
    }
    this.updateAlignmentGuides(element);
  }

  @HostListener('window:pointermove', ['$event'])
  handlePointerMove(event: PointerEvent) {
    if (this.resizingElementId && this.resizeHandle) {
      this.handleResizePointerMove(event);
      return;
    }
    if (this.rotatingElementId) {
      this.handleRotationPointerMove(event);
      event.preventDefault();
      return;
    }
    if (this.marqueeSelecting) {
      this.updateMarqueeSelection(event);
      event.preventDefault();
      return;
    }
    if (this.isPanning) {
      const deltaX = event.clientX - this.panPointerStart.x;
      const deltaY = event.clientY - this.panPointerStart.y;
      this.pan = { x: this.panOrigin.x + deltaX, y: this.panOrigin.y + deltaY };
      event.preventDefault();
      return;
    }
    if (this.draggingElementId) {
      this.updateDraggingElements(event);
      event.preventDefault();
    }
  }

  @HostListener('window:pointerup', ['$event'])
  handlePointerUp(event: PointerEvent) {
    if (this.isPanning) {
      this.isPanning = false;
      event.preventDefault();
    }
    if (this.draggingElementId) {
      this.draggingElementId = null;
      this.dragSelectionOffsets.clear();
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
      this.resizeAspectRatio = null;
    }
    if (this.rotatingElementId) {
      this.rotatingElementId = null;
      this.rotationOrigin = null;
      this.resizeDidMutate = false;
      this.queueSave();
    }
    if (this.marqueeSelecting) {
      this.finishMarqueeSelection();
      event.preventDefault();
    }
  }

  get marqueeRectStyle(): Record<string, string> | null {
    if (!this.marqueeSelecting) {
      return null;
    }
    const rect = this.currentMarqueeRect();
    if (!rect) {
      return null;
    }
    return {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    };
  }

  private moveSelectionBy(dx: number, dy: number) {
    if (!dx && !dy) {
      return;
    }
    const slide = this.activeSlide;
    if (!slide) {
      return;
    }
    const targets = this.selectedElements;
    if (!targets.length) {
      return;
    }
    let changed = false;
    for (const element of targets) {
      if (this.isLocked(element)) {
        continue;
      }
      const nextX = this.clamp(element.x + dx, 0, this.canvasWidth - element.width);
      const nextY = this.clamp(element.y + dy, 0, this.canvasHeight - element.height);
      if (nextX !== element.x || nextY !== element.y) {
        element.x = nextX;
        element.y = nextY;
        changed = true;
      }
    }
    if (changed) {
      this.queueSave();
    }
  }

  bringSelectionToFront() {
    this.reorderSelection('front');
  }

  sendSelectionToBack() {
    this.reorderSelection('back');
  }

  bringSelectionForward() {
    this.reorderSelection('forward');
  }

  sendSelectionBackward() {
    this.reorderSelection('backward');
  }

  toggleLockSelection(lock: boolean) {
    if (!this.selectionCount) {
      return;
    }
    let changed = false;
    for (const element of this.selectedElements) {
      if (!!element.data.locked !== lock) {
        element.data.locked = lock;
        changed = true;
      }
    }
    if (changed) {
      this.queueSave();
    }
  }

  toggleVisibilitySelection(hidden: boolean) {
    if (!this.selectionCount) {
      return;
    }
    let changed = false;
    for (const element of this.selectedElements) {
      if (!!element.data.hidden !== hidden) {
        element.data.hidden = hidden;
        changed = true;
      }
    }
    if (changed) {
      if (hidden) {
        this.clearSelection();
      }
      this.queueSave();
    }
  }

  groupSelection() {
    if (this.selectionCount < 2) {
      return;
    }
    const groupId = createId('grp');
    for (const element of this.selectedElements) {
      element.data.groupId = groupId;
    }
    this.queueSave();
  }

  ungroupSelection() {
    let changed = false;
    for (const element of this.selectedElements) {
      if (element.data.groupId) {
        delete element.data.groupId;
        changed = true;
      }
    }
    if (changed) {
      this.queueSave();
    }
  }

  private copySelection() {
    const elements = this.selectedElements;
    if (!elements.length) {
      return;
    }
    this.clipboardElements = elements.map(element => ({
      ...element,
      data: { ...element.data }
    }));
    this.pasteBump = 0;
  }

  private cutSelection() {
    if (!this.selectedElements.length) {
      return;
    }
    this.copySelection();
    this.deleteSelectedElements();
  }

  private pasteClipboard() {
    if (!this.clipboardElements.length) {
      return;
    }
    const slide = this.activeSlide;
    if (!slide) {
      return;
    }
    const offset = 24 + this.pasteBump;
    this.pasteBump = (this.pasteBump + 8) % 64;
    const newIds: string[] = [];
    this.clipboardElements.forEach(source => {
      const clone = cloneElement(source);
      clone.x = this.clamp(clone.x + offset, 0, this.canvasWidth - clone.width);
      clone.y = this.clamp(clone.y + offset, 0, this.canvasHeight - clone.height);
      slide.elements.push(clone);
      newIds.push(clone.id);
    });
    this.replaceSelection(newIds);
    this.queueSave();
  }

  private duplicateSelection() {
    if (!this.selectedElements.length) {
      return;
    }
    this.copySelection();
    this.pasteClipboard();
  }

  private deleteSelectedElements() {
    const slide = this.activeSlide;
    if (!slide || !this.selectedElementIds.size) {
      return;
    }
    slide.elements = slide.elements.filter(element => !this.selectedElementIds.has(element.id));
    this.clearSelection();
    this.queueSave();
  }

  private reorderSelection(mode: 'front' | 'back' | 'forward' | 'backward') {
    const slide = this.activeSlide;
    if (!slide || !this.selectedElementIds.size) {
      return;
    }
    const selectedIds = new Set(this.selectedElementIds);
    const original = [...slide.elements];
    if (mode === 'front' || mode === 'back') {
      const selected = original.filter(el => selectedIds.has(el.id));
      const others = original.filter(el => !selectedIds.has(el.id));
      slide.elements = mode === 'front' ? [...others, ...selected] : [...selected, ...others];
    } else if (mode === 'forward') {
      for (let i = original.length - 2; i >= 0; i--) {
        if (!selectedIds.has(slide.elements[i].id)) continue;
        if (selectedIds.has(slide.elements[i + 1].id)) continue;
        [slide.elements[i], slide.elements[i + 1]] = [slide.elements[i + 1], slide.elements[i]];
      }
    } else if (mode === 'backward') {
      for (let i = 1; i < slide.elements.length; i += 1) {
        if (!selectedIds.has(slide.elements[i].id)) continue;
        if (selectedIds.has(slide.elements[i - 1].id)) continue;
        [slide.elements[i], slide.elements[i - 1]] = [slide.elements[i - 1], slide.elements[i]];
      }
    }
    this.queueSave();
  }

  selectLayerElement(element: SlideElement, event?: MouseEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    const additive = !!event && (event.ctrlKey || event.metaKey || event.shiftKey);
    if (additive) {
      if (this.isElementSelected(element)) {
        this.removeFromSelection(element.id);
      } else {
        this.addToSelection(element.id);
      }
    } else {
      this.replaceSelection([element.id]);
    }
  }

  toggleLayerVisibility(element: SlideElement, event?: MouseEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    element.data.hidden = !element.data.hidden;
    if (element.data.hidden) {
      this.removeFromSelection(element.id);
    }
    this.queueSave();
  }

  toggleLayerLock(element: SlideElement, event?: MouseEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    element.data.locked = !element.data.locked;
    this.queueSave();
  }

  private prepareDragSelection(event: PointerEvent, anchor: SlideElement) {
    const slide = this.activeSlide;
    if (!slide) {
      return;
    }
    if (!this.selectedElementIds.size) {
      this.replaceSelection([anchor.id]);
    }
    const selectionIds = Array.from(this.selectedElementIds);
    const { x, y } = this.clientToCanvas(event);
    this.dragSelectionOffsets.clear();
    for (const id of selectionIds) {
      const target = slide.elements.find(el => el.id === id);
      if (!target || this.isLocked(target)) continue;
      this.dragSelectionOffsets.set(id, { dx: x - target.x, dy: y - target.y });
    }
    if (!this.dragSelectionOffsets.size) {
      return;
    }
    this.dragOffset = { x: x - anchor.x, y: y - anchor.y };
  }

  private updateDraggingElements(event: PointerEvent) {
    const slide = this.activeSlide;
    if (!slide) {
      return;
    }
    const { x, y } = this.clientToCanvas(event);
    let anchor: SlideElement | undefined;
    if (!this.dragSelectionOffsets.size && this.draggingElementId) {
      const element = slide.elements.find(el => el.id === this.draggingElementId);
      if (element) {
        this.dragSelectionOffsets.set(element.id, { dx: x - element.x, dy: y - element.y });
      }
    }
    this.dragSelectionOffsets.forEach((offset, id) => {
      const target = slide.elements.find(el => el.id === id);
      if (!target) {
        return;
      }
      if (this.isLocked(target)) {
        return;
      }
      const nextX = this.snapToGrid(x - offset.dx);
      const nextY = this.snapToGrid(y - offset.dy);
      target.x = this.clamp(nextX, 0, this.canvasWidth - target.width);
      target.y = this.clamp(nextY, 0, this.canvasHeight - target.height);
      if (id === this.draggingElementId) {
        anchor = target;
      }
    });
    if (anchor) {
      this.updateAlignmentGuides(anchor);
    }
  }

  private beginMarqueeSelection(event: PointerEvent) {
    const { x, y } = this.clientToCanvas(event);
    event.preventDefault();
    this.marqueeSelecting = true;
    this.marqueeAdditive = event.ctrlKey || event.metaKey || event.shiftKey;
    this.marqueeStart = { x, y };
    this.marqueeCurrent = { x, y };
    if (!this.marqueeAdditive) {
      this.clearSelection();
    }
  }

  private updateMarqueeSelection(event: PointerEvent) {
    const { x, y } = this.clientToCanvas(event);
    this.marqueeCurrent = { x, y };
  }

  private finishMarqueeSelection() {
    if (!this.marqueeSelecting) {
      return;
    }
    this.marqueeSelecting = false;
    const rect = this.currentMarqueeRect();
    const slide = this.activeSlide;
    if (!rect || !slide) {
      this.marqueeAdditive = false;
      return;
    }
    const hitIds = slide.elements
      .filter(element => this.rectsIntersect(rect, this.elementBounds(element)))
      .map(element => element.id);
    if (!hitIds.length) {
      this.marqueeAdditive = false;
      return;
    }
    if (this.marqueeAdditive) {
      hitIds.forEach(id => this.addToSelection(id));
    } else {
      this.replaceSelection(hitIds);
    }
    this.marqueeAdditive = false;
  }

  private currentMarqueeRect(): { x: number; y: number; width: number; height: number } | null {
    if (!this.marqueeSelecting) {
      return null;
    }
    const width = Math.abs(this.marqueeCurrent.x - this.marqueeStart.x);
    const height = Math.abs(this.marqueeCurrent.y - this.marqueeStart.y);
    if (width < 2 && height < 2) {
      return null;
    }
    const x = Math.min(this.marqueeStart.x, this.marqueeCurrent.x);
    const y = Math.min(this.marqueeStart.y, this.marqueeCurrent.y);
    return { x, y, width, height };
  }

  private elementBounds(element: SlideElement): { x: number; y: number; width: number; height: number } {
    if (element.type === 'shape' && (element.data.shapeKind === 'line' || element.data.shapeKind === 'arrow')) {
      const x2 = element.x + element.width;
      const y2 = element.y + element.height;
      const minX = Math.min(element.x, x2);
      const minY = Math.min(element.y, y2);
      return {
        x: minX,
        y: minY,
        width: Math.abs(element.width),
        height: Math.abs(element.height)
      };
    }
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height
    };
  }

  private rectsIntersect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
    return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
  }

  private handleResizePointerMove(event: PointerEvent) {
    if (!this.resizingElementId || !this.resizeHandle || !this.resizeOrigin) {
      return;
    }
    const slide = this.activeSlide;
    if (!slide) {
      return;
    }
    const element = slide.elements.find(el => el.id === this.resizingElementId);
    if (!element) {
      return;
    }
    const { x, y } = this.clientToCanvas(event);
    const dx = x - this.resizeOrigin.pointerX;
    const dy = y - this.resizeOrigin.pointerY;
    let nextWidth = this.resizeOrigin.width;
    let nextHeight = this.resizeOrigin.height;
    let nextX = this.resizeOrigin.x;
    let nextY = this.resizeOrigin.y;
    const minSize = this.resizeMinSize(element);
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

    let aspectRatio = this.resizeAspectRatio ?? null;
    if (handle.length === 2 && event.shiftKey) {
      aspectRatio = this.elementAspectRatio(element) ?? aspectRatio;
    }
    nextWidth = Math.max(minSize, nextWidth);
    nextHeight = Math.max(minSize, nextHeight);

    if (aspectRatio && handle.length === 2) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        nextHeight = nextWidth / aspectRatio;
      } else {
        nextWidth = nextHeight * aspectRatio;
      }
      if (affectsNorth) {
        nextY = this.resizeOrigin.y + (this.resizeOrigin.height - nextHeight);
      }
      if (affectsWest) {
        nextX = this.resizeOrigin.x + (this.resizeOrigin.width - nextWidth);
      }
    }

    nextX = this.clamp(nextX, 0, this.canvasWidth - nextWidth);
    nextY = this.clamp(nextY, 0, this.canvasHeight - nextHeight);
    nextWidth = Math.min(nextWidth, this.canvasWidth - nextX);
    nextHeight = Math.min(nextHeight, this.canvasHeight - nextY);

    element.x = Math.round(nextX);
    element.y = Math.round(nextY);
    element.width = Math.max(1, Math.round(nextWidth));
    element.height = Math.max(1, Math.round(nextHeight));
    if (element.type === 'image') {
      if (element.width > 0 && element.height > 0) {
        element.data.aspectRatio = element.width / element.height;
      }
      this.normalizeImageCrop(element);
    }
    this.resizeDidMutate = true;
  }

  onRotationHandlePointerDown(event: PointerEvent, element: SlideElement) {
    event.stopPropagation();
    event.preventDefault();
    if (!this.isElementSelected(element)) {
      this.replaceSelection([element.id]);
    }
    const center = this.elementCenter(element);
    this.rotatingElementId = element.id;
    this.rotationOrigin = center;
    this.rotationStartAngle = this.pointerAngle(event, center);
    this.rotationInitial = element.rotation ?? 0;
  }

  private handleRotationPointerMove(event: PointerEvent) {
    if (!this.rotatingElementId || !this.rotationOrigin) {
      return;
    }
    const slide = this.activeSlide;
    if (!slide) {
      return;
    }
    const element = slide.elements.find(el => el.id === this.rotatingElementId);
    if (!element) {
      return;
    }
    const angle = this.pointerAngle(event, this.rotationOrigin);
    let next = this.rotationInitial + (angle - this.rotationStartAngle);
    if (event.shiftKey) {
      next = Math.round(next / 15) * 15;
    }
    if (next < -180 || next > 180) {
      next = ((next + 180) % 360) - 180;
    }
    element.rotation = Math.round(next);
    this.resizeDidMutate = true;
  }

  private elementCenter(element: SlideElement): { x: number; y: number } {
    const bounds = this.elementBounds(element);
    return {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    };
  }

  rotationHandlePosition(element: SlideElement): { cx: number; lineStartY: number; lineEndY: number; knobY: number } {
    const bounds = this.elementBounds(element);
    const cx = bounds.x + bounds.width / 2;
    const lineStartY = bounds.y;
    const lineEndY = bounds.y - this.rotationHandleOffset;
    const knobY = lineEndY - this.rotationHandleRadius;
    return { cx, lineStartY, lineEndY, knobY };
  }

  private pointerAngle(event: PointerEvent, center: { x: number; y: number }): number {
    const { x, y } = this.clientToCanvas(event);
    const angle = Math.atan2(y - center.y, x - center.x) * (180 / Math.PI);
    return angle;
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
    this.replaceSelection([element.id]);
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
    this.replaceSelection([element.id]);
    this.insertMode = null;
    this.alignmentGuides = { vertical: null, horizontal: null };
    this.queueSave();
  }

  private insertUploadedImage(asset: UploadedAsset, targetElement?: SlideElement) {
    if (!asset?.url) {
      this.imageUploadError = 'Upload response missing URL.';
      return;
    }
    this.insertImageElement(
      {
        url: asset.url,
        source: 'upload',
        name: asset.name,
        size: asset.size
      },
      targetElement
    );
  }

  private insertImageElement(options: { url: string; source: 'upload' | 'external'; name?: string; size?: number }, existingElement?: SlideElement | null): SlideElement | null {
    const slide = this.activeSlide;
    if (!slide) {
      return null;
    }
    if (existingElement && existingElement.type === 'image') {
      this.applyImageAsset(existingElement, options);
      this.normalizeImageCrop(existingElement);
      this.replaceSelection([existingElement.id]);
      this.queueSave();
      return existingElement;
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
    this.replaceSelection([element.id]);
    this.normalizeImageCrop(element);
    this.queueSave();
    return element;
  }

  private async uploadImageFromFile(file: File, targetElement?: SlideElement) {
    if (!this.isImageFile(file)) {
      this.imageUploadError = 'Only image files are supported.';
      return;
    }
    this.imageUploadError = null;
    this.imageUploading = true;
    try {
      const asset = await this.svc.uploadImage(file);
      this.insertUploadedImage(asset, targetElement);
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

  changeImageBorderColor(color: string) {
    const element = this.selectedImageElement;
    if (!element || !color) return;
    element.data.stroke = color;
    if ((element.data.strokeWidth ?? 0) <= 0) {
      element.data.strokeWidth = 2;
    }
    this.pushStrokeColor(color);
    this.queueSave();
  }

  changeImageBorderWidth(value: number | string) {
    const element = this.selectedImageElement;
    if (!element) return;
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(numeric)) return;
    const clamped = this.clamp(Math.round(numeric), this.imageBorderRange.min, this.imageBorderRange.max);
    element.data.strokeWidth = clamped;
    if (clamped > 0 && !element.data.stroke) {
      element.data.stroke = '#1d4ed8';
    }
    this.queueSave();
  }

  changeImageBorderStyle(style: 'solid' | 'dashed' | 'dotted') {
    const element = this.selectedImageElement;
    if (!element) return;
    element.data.strokeStyle = style;
    this.queueSave();
  }

  clearImageBorder() {
    const element = this.selectedImageElement;
    if (!element) return;
    element.data.stroke = undefined;
    element.data.strokeWidth = 0;
    element.data.strokeStyle = 'solid';
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
    this.resetImageCropValues(element);
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

  private shouldLockResizeAspect(element: SlideElement, handle: ResizeHandle, event: PointerEvent): boolean {
    if (handle.length !== 2) {
      return false;
    }
    if (event.shiftKey) {
      return true;
    }
    if (element.type === 'image') {
      return this.isImageAspectLocked(element);
    }
    return false;
  }

  private elementAspectRatio(element: SlideElement): number | null {
    const width = Math.abs(element.width);
    const height = Math.abs(element.height);
    if (!width || !height) {
      return null;
    }
    return width / height;
  }

  private resizeMinSize(element: SlideElement): number {
    if (element.type === 'image') {
      return this.imageSizeRange.min;
    }
    if (element.type === 'text') {
      return 24;
    }
    return 16;
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

  imageBorderWidthValue(element: SlideElement): number {
    if (element.type !== 'image') {
      return 0;
    }
    const width = typeof element.data.strokeWidth === 'number' ? element.data.strokeWidth : 0;
    return this.clamp(width, this.imageBorderRange.min, this.imageBorderRange.max);
  }

  imageHasBorder(element: SlideElement): boolean {
    if (element.type !== 'image') {
      return false;
    }
    return (element.data.strokeWidth ?? 0) > 0 && !!element.data.stroke;
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

  elementTransform(element: SlideElement): string | null {
    const angle = element.rotation ?? 0;
    if (!angle) {
      return null;
    }
    const bounds = this.elementBounds(element);
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
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

  private recordHistorySnapshot() {
    const snapshot = {
      slides: this.cloneSlides(this.slides),
      selectedSlideIndex: this.selectedSlideIndex
    };
    if (this.historyIndex < this.history.length - 1) {
      this.history.splice(this.historyIndex + 1);
    }
    this.history.push(snapshot);
    if (this.history.length > this.historyLimit) {
      this.history.shift();
    }
    this.historyIndex = this.history.length - 1;
  }

  private undo() {
    if (this.historyIndex <= 0) {
      return;
    }
    this.historyIndex -= 1;
    const snapshot = this.history[this.historyIndex];
    this.applyHistorySnapshot(snapshot);
  }

  private redo() {
    if (this.historyIndex >= this.history.length - 1) {
      return;
    }
    this.historyIndex += 1;
    const snapshot = this.history[this.historyIndex];
    this.applyHistorySnapshot(snapshot);
  }

  private applyHistorySnapshot(snapshot: { slides: SlideModel[]; selectedSlideIndex: number }) {
    this.slides = this.cloneSlides(snapshot.slides);
    this.selectedSlideIndex = Math.min(snapshot.selectedSlideIndex, Math.max(this.slides.length - 1, 0));
    this.clearSelection();
    this.queueSave(false);
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

  queueSave(recordHistory = true) {
    if (!this.deck) {
      return;
    }
    if (recordHistory) {
      this.recordHistorySnapshot();
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

  private applyImageAsset(element: SlideElement, options: { url: string; source: 'upload' | 'external'; name?: string; size?: number }) {
    if (element.type !== 'image') {
      return;
    }
    element.data.assetUrl = options.url;
    element.data.assetName = options.name;
    element.data.assetSize = options.size;
    element.data.assetSource = options.source;
    element.data.cropZoom = 1;
    element.data.cropOffsetX = 0;
    element.data.cropOffsetY = 0;
    element.data.aspectRatio = element.width > 0 && element.height > 0 ? element.width / element.height : element.data.aspectRatio;
  }

  private resetImageCropValues(element: SlideElement) {
    if (element.type !== 'image') {
      return;
    }
    element.data.cropZoom = 1;
    element.data.cropOffsetX = 0;
    element.data.cropOffsetY = 0;
  }

}
