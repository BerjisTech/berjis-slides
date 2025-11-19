export type SlideLayout = 'blank' | 'title' | 'title-content';
export type SlideElementType = 'shape' | 'text' | 'image';

export interface SlideElement {
  id: string;
  type: SlideElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  data: {
    text?: string;
    fontSize?: number;
    fill?: string;
    stroke?: string;
    radius?: number;
    align?: 'left' | 'center' | 'right' | 'justify';
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    lineHeight?: number;
    bulletStyle?: 'none' | 'bullet' | 'number';
    shapeKind?: 'rect' | 'ellipse' | 'line' | 'arrow' | 'triangle';
    strokeWidth?: number;
    strokeStyle?: 'solid' | 'dashed' | 'dotted';
    opacity?: number;
    assetUrl?: string;
    assetName?: string;
    assetSize?: number;
    assetSource?: 'upload' | 'external';
    aspectRatio?: number;
    lockAspectRatio?: boolean;
    cropZoom?: number;
    cropOffsetX?: number;
    cropOffsetY?: number;
    brightness?: number;
    contrast?: number;
    saturation?: number;
  };
}

export interface SlideModel {
  id: string;
  name: string;
  layout: SlideLayout;
  background: string;
  elements: SlideElement[];
}

export interface PresentationData {
  slides: SlideModel[];
}

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 540;
export const GRID_SIZE = 20;

export function createSlide(layout: SlideLayout = 'blank'): SlideModel {
  const id = createId('slide');
  const elements: SlideElement[] = [];
  if (layout === 'title' || layout === 'title-content') {
    elements.push(createTextElement('Title', {
      x: 80,
      y: 90,
      width: 800,
      height: 80,
      fontSize: 40,
      align: 'left'
    }));
  }
  if (layout === 'title-content') {
    elements.push(createTextElement('Add your content here', {
      x: 80,
      y: 210,
      width: 780,
      height: 220,
      fontSize: 20,
      align: 'left'
    }));
  }
  if (layout === 'blank') {
    elements.push(createShapeElement({
      x: 360,
      y: 180,
      width: 240,
      height: 160,
      fill: '#bfdbfe'
    }));
  }
  return {
    id,
    name: layout === 'blank' ? 'Blank' : layout === 'title' ? 'Title' : 'Title & Content',
    layout,
    background: '#ffffff',
    elements,
  };
}

export function cloneSlide(slide: SlideModel): SlideModel {
  return {
    ...slide,
    id: createId('slide'),
    elements: slide.elements.map(elem => cloneElement(elem))
  };
}

export function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export interface ShapeElementOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  radius?: number;
  shapeKind?: 'rect' | 'ellipse' | 'line' | 'arrow' | 'triangle';
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  opacity?: number;
}

export function createShapeElement(opts: ShapeElementOptions): SlideElement {
  return {
    id: createId('el'),
    type: 'shape',
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    rotation: 0,
    data: {
      fill: opts.fill ?? '#cbd5f5',
      stroke: opts.stroke ?? '#1d4ed8',
      radius: opts.radius ?? 12,
      shapeKind: opts.shapeKind ?? 'rect',
      strokeWidth: opts.strokeWidth ?? 2,
      strokeStyle: opts.strokeStyle ?? 'solid',
      opacity: opts.opacity ?? 1
    },
  };
}

export interface TextElementOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  align?: 'left' | 'center' | 'right' | 'justify';
  fill?: string;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  lineHeight?: number;
  bulletStyle?: 'none' | 'bullet' | 'number';
}

export function createTextElement(text: string, opts: TextElementOptions): SlideElement {
  return {
    id: createId('el'),
    type: 'text',
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    rotation: 0,
    data: {
      text,
      fontSize: opts.fontSize,
      fill: opts.fill ?? '#0f172a',
      align: opts.align ?? 'left',
      fontFamily: opts.fontFamily ?? 'Inter',
      bold: opts.bold ?? false,
      italic: opts.italic ?? false,
      underline: opts.underline ?? false,
      strikethrough: opts.strikethrough ?? false,
      lineHeight: opts.lineHeight ?? 1.2,
      bulletStyle: opts.bulletStyle ?? 'none'
    },
  };
}

export interface ImageElementOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  url: string;
  name?: string;
  size?: number;
  source?: 'upload' | 'external';
}

export function createImageElement(opts: ImageElementOptions): SlideElement {
  return {
    id: createId('el'),
    type: 'image',
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    rotation: 0,
    data: {
      assetUrl: opts.url,
      assetName: opts.name,
      assetSize: opts.size,
      assetSource: opts.source ?? 'upload',
      aspectRatio: opts.height > 0 ? opts.width / opts.height : undefined,
      lockAspectRatio: true,
      cropZoom: 1,
      cropOffsetX: 0,
      cropOffsetY: 0,
      brightness: 1,
      contrast: 1,
      saturation: 1
    }
  };
}

export function cloneElement(element: SlideElement): SlideElement {
  return {
    ...element,
    id: createId('el'),
    data: { ...element.data }
  };
}
