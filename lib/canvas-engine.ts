export interface EngineConfig {
  title: string;
  text: string;
  content?: any; // Tiptap JSON
  speed: number;
  resolution: '720p' | '1080p';
  fontTitle: string;
  fontContent: string;
  bgColor: string;
  titleColor: string;
  contentColor: string;
  titleFontSize: number;
  contentFontSize: number;
}

interface RenderNode {
  type: 'text' | 'image' | 'space';
  content?: string;
  bold?: boolean;
  italic?: boolean;
  x: number;
  y: number;
  width?: number;
  height?: number;
  image?: HTMLImageElement;
  color?: string;
  fontSize?: number;
  align?: 'left' | 'center' | 'right';
  font?: string;
}

export class ScrollingTextEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  offscreenCanvas: OffscreenCanvas | HTMLCanvasElement;
  offscreenCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  config: EngineConfig;
  isPlaying: boolean = false;
  yOffset: number = 0;
  lastTime: number = 0;
  animationFrameId: number = 0;
  onComplete?: () => void;
  onProgress?: (progress: number) => void;
  totalHeight: number = 0;
  isReady: boolean = false;
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private readyPromise: Promise<void> | null = null;
  private worker: Worker | null = null;
  public isRecordingMode: boolean = false;
  private frameCount: number = 0;
  private readonly FPS = 60;
  private readonly FRAME_TIME = 1000 / 60;

  constructor(canvas: HTMLCanvasElement, config: EngineConfig) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.config = config;

    const width = config.resolution === '1080p' ? 1080 : 720;
    const initialHeight = config.resolution === '1080p' ? 1920 : 1280;
    this.canvas.width = width;
    this.canvas.height = initialHeight;

    if (typeof OffscreenCanvas !== 'undefined') {
      this.offscreenCanvas = new OffscreenCanvas(width, initialHeight);
    } else {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = width;
      this.offscreenCanvas.height = initialHeight;
    }
    this.offscreenCtx = this.offscreenCanvas.getContext('2d') as any;

    this.initWorker();
    
    // Initial setup
    this.yOffset = initialHeight; 
    this.readyPromise = this.preRender();
    
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(() => {
        this.readyPromise = this.preRender();
      });
    }
  }

  private initWorker() {
    if (typeof Worker !== 'undefined') {
      const blob = new Blob([`
        let timer = null;
        self.onmessage = (e) => {
          if (e.data.type === 'start') {
            if (timer) clearInterval(timer);
            timer = setInterval(() => {
              self.postMessage({ type: 'tick' });
            }, 1000 / 60);
          } else if (e.data.type === 'stop') {
            if (timer) clearInterval(timer);
            timer = null;
          }
        };
      `], { type: 'application/javascript' });
      this.worker = new Worker(URL.createObjectURL(blob));
      this.worker.onmessage = () => {
        if (this.isPlaying && this.isRecordingMode) {
          this.draw(performance.now());
        }
      };
    }
  }

  waitUntilReady() {
    return this.readyPromise;
  }

  async preRender() {
    this.isReady = false;
    const width = this.canvas.width;
    const padding = width * 0.05;
    const maxWidth = width - padding * 2;
    let currentY = 0;
    const renderNodes: RenderNode[] = [];

    // Ensure we have a valid measurement context
    // We use a temporary canvas for measurements to avoid issues with height reset
    const measureCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, 100) : document.createElement('canvas');
    if (!(measureCanvas instanceof OffscreenCanvas)) measureCanvas.width = width;
    const measureCtx = measureCanvas.getContext('2d')!;
    measureCtx.textBaseline = 'top';

    // Wait for fonts if possible
    if (typeof document !== 'undefined' && document.fonts) {
      await document.fonts.ready;
    }

    const getFontString = (size: number, family: string, bold = false, italic = false) => {
      // Clean family name - remove any trailing fallback strings if present to avoid nesting
      const cleanFamily = family.split(',')[0].replace(/['"]/g, '').trim();
      return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px "${cleanFamily}", sans-serif`;
    };

    // Draw Title
    if (this.config.title) {
      const titleFont = getFontString(this.config.titleFontSize, this.config.fontTitle, true);
      measureCtx.font = titleFont;
      const titleLines = this.simpleWrap(this.config.title.toUpperCase(), maxWidth, measureCtx);
      titleLines.forEach(line => {
        renderNodes.push({
          type: 'text',
          content: line,
          x: width / 2,
          y: currentY,
          bold: true,
          color: this.config.titleColor,
          fontSize: this.config.titleFontSize,
          align: 'center',
          font: this.config.fontTitle // Keep raw family for node
        });
        currentY += this.config.titleFontSize + 25;
      });
      currentY += 50;
    }

    // Draw Content (JSON if available, else plain text)
    if (this.config.content && this.config.content.content) {
      for (const node of this.config.content.content) {
        if (node.type === 'paragraph') {
          const paraLines = this.wrapRichText(node, maxWidth, measureCtx);
          paraLines.forEach(line => {
            const totalLineWidth = line.reduce((acc, segment) => acc + segment.width, 0);
            let runningX = (width - totalLineWidth) / 2;
            
            line.forEach(segment => {
              renderNodes.push({
                type: 'text',
                content: segment.text,
                x: runningX,
                y: currentY,
                bold: segment.bold,
                italic: segment.italic,
                fontSize: this.config.contentFontSize,
                color: this.config.contentColor,
                align: 'left',
                font: this.config.fontContent // Always use content font
              });
              runningX += segment.width;
            });
            currentY += this.config.contentFontSize * 1.5;
          });
          currentY += this.config.contentFontSize * 0.6;
        } else if (node.type === 'image') {
          try {
            const img = await this.loadImage(node.attrs.src);
            const aspect = img.height / img.width;
            const imgWidth = Math.min(maxWidth, img.width);
            const imgHeight = imgWidth * aspect;
            renderNodes.push({
              type: 'image',
              image: img,
              x: (width - imgWidth) / 2,
              y: currentY,
              width: imgWidth,
              height: imgHeight
            });
            currentY += imgHeight + 40;
          } catch (e) {
            console.error('Image load fail:', node.attrs.src);
          }
        } else if (node.type === 'heading') {
          const scale = node.attrs.level === 1 ? 1.6 : 1.3;
          const hSize = Math.round(this.config.contentFontSize * scale);
          const hFont = getFontString(hSize, this.config.fontContent, true);
          measureCtx.font = hFont;
          const hText = node.content?.map((c: any) => c.text).join('') || '';
          const hLines = this.simpleWrap(hText, maxWidth, measureCtx);
          hLines.forEach(line => {
            renderNodes.push({
              type: 'text',
              content: line,
              x: width / 2,
              y: currentY,
              bold: true,
              color: this.config.contentColor,
              fontSize: hSize,
              align: 'center',
              font: this.config.fontContent
            });
            currentY += hSize + 20;
          });
          currentY += 30;
        }
      }
    } else if (this.config.text) {
      const contentFont = getFontString(this.config.contentFontSize, this.config.fontContent);
      measureCtx.font = contentFont;
      const lines = this.simpleWrap(this.config.text, maxWidth, measureCtx);
      lines.forEach(line => {
        renderNodes.push({
          type: 'text',
          content: line,
          x: width / 2,
          y: currentY,
          color: this.config.contentColor,
          fontSize: this.config.contentFontSize,
          align: 'center',
          font: this.config.fontContent
        });
        currentY += this.config.contentFontSize * 1.5;
      });
    }

    this.totalHeight = currentY + 20;
    this.offscreenCanvas.height = Math.max(1, this.totalHeight);

    // Context is clean after resize
    const ctx = this.offscreenCtx;
    ctx.fillStyle = this.config.bgColor;
    ctx.fillRect(0, 0, width, this.offscreenCanvas.height);
    ctx.textBaseline = 'top';

    for (const node of renderNodes) {
      if (node.type === 'text') {
        ctx.font = getFontString(node.fontSize || this.config.contentFontSize, node.font || this.config.fontContent, node.bold, node.italic);
        ctx.textAlign = node.align || 'left';
        ctx.fillStyle = node.color || this.config.contentColor;
        ctx.fillText(node.content || '', node.x, node.y);
      } else if (node.type === 'image' && node.image) {
        ctx.drawImage(node.image, node.x, node.y, node.width || 0, node.height || 0);
      }
    }
    
    this.isReady = true;
    this.drawFrame();
  }

  private wrapRichText(node: any, maxWidth: number, ctx: any): { text: string; bold: boolean; italic: boolean; width: number }[][] {
    if (!node.content) return [];
    const lines: { text: string; bold: boolean; italic: boolean; width: number }[][] = [];
    let currentLine: { text: string; bold: boolean; italic: boolean; width: number }[] = [];
    let currentLineWidth = 0;

    node.content.forEach((part: any) => {
      if (part.type !== 'text') return;
      const bold = part.marks?.some((m: any) => m.type === 'bold') || false;
      const italic = part.marks?.some((m: any) => m.type === 'italic') || false;
      
      const segmentFont = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${this.config.contentFontSize}px "${this.config.fontContent.split(',')[0].replace(/['"]/g, '').trim()}", sans-serif`;
      ctx.font = segmentFont;
      
      const segments = part.text.split(/(\s+)/); 
      segments.forEach((segment: string) => {
        if (!segment) return;
        const width = ctx.measureText(segment).width;
        if (currentLineWidth + width > maxWidth && currentLine.length > 0 && !/^\s+$/.test(segment)) {
          lines.push(currentLine);
          currentLine = [];
          currentLineWidth = 0;
          // Trim leading space on new line
          const trimmed = segment.trimStart();
          if (trimmed) {
            const trimmedWidth = ctx.measureText(trimmed).width;
            currentLine.push({ text: trimmed, bold, italic, width: trimmedWidth });
            currentLineWidth = trimmedWidth;
          }
        } else {
          currentLine.push({ text: segment, bold, italic, width });
          currentLineWidth += width;
        }
      });
    });

    if (currentLine.length > 0) lines.push(currentLine);
    return lines;
  }

  private simpleWrap(text: string, maxWidth: number, ctx: any): string[] {
    const lines: string[] = [];
    text.split('\n').forEach(p => {
      const words = p.split(/(\s+)/);
      let line = '';
      words.forEach(word => {
        const test = line + word;
        if (ctx.measureText(test).width > maxWidth && line.length > 0) {
          lines.push(line.trim());
          line = word.trimStart();
        } else {
          line = test;
        }
      });
      if (line) lines.push(line.trim());
    });
    return lines.length > 0 ? lines : [''];
  }

  private async loadImage(src: string): Promise<HTMLImageElement> {
    if (this.imageCache.has(src)) return this.imageCache.get(src)!;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = src;
      img.onload = () => {
        this.imageCache.set(src, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    });
  }

  drawFrame() {
    this.ctx.fillStyle = this.config.bgColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Flat drawing (no perspective)
    this.ctx.drawImage(
      this.offscreenCanvas,
      0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height,
      0, this.yOffset, this.canvas.width, this.offscreenCanvas.height
    );
  }

  renderAnimationFrame(time: number) {
    if (!this.lastTime) this.lastTime = time;
    
    let deltaTime: number;
    if (this.isRecordingMode) {
      deltaTime = this.FRAME_TIME;
      this.frameCount++;
    } else {
      deltaTime = time - this.lastTime;
    }
    this.lastTime = time;

    if (this.isPlaying) {
      const pixelsPerSecond = this.config.speed * 100;
      this.yOffset -= (pixelsPerSecond * deltaTime) / 1000;
    }

    this.drawFrame();

    const scrollLimit = -this.totalHeight;
    const scrollRange = this.canvas.height - scrollLimit;
    const currentProgress = (this.canvas.height - this.yOffset) / scrollRange;

    if (this.onProgress) {
      this.onProgress(Math.max(0, Math.min(1, currentProgress)));
    }

    if (this.yOffset < scrollLimit) {
      this.isPlaying = false;
      if (this.onComplete) this.onComplete();
    }
  }

  draw(time: number) {
    this.renderAnimationFrame(time);

    if (this.isPlaying && !this.isRecordingMode) {
      this.animationFrameId = requestAnimationFrame((t) => this.draw(t));
    }
  }

  setRecordingMode(enabled: boolean) {
    this.isRecordingMode = enabled;
    if (enabled) {
      this.frameCount = 0;
      this.pause();
      this.play();
    }
  }

  play() {
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.lastTime = performance.now();
      
      if (this.isRecordingMode) {
        this.worker?.postMessage({ type: 'start' });
      } else {
        this.draw(this.lastTime);
      }
    }
  }

  pause() {
    this.isPlaying = false;
    cancelAnimationFrame(this.animationFrameId);
    this.worker?.postMessage({ type: 'stop' });
  }

  reset() {
    this.isPlaying = false;
    cancelAnimationFrame(this.animationFrameId);
    this.worker?.postMessage({ type: 'stop' });
    this.yOffset = this.canvas.height;
    this.lastTime = 0;
    this.frameCount = 0;
    this.drawFrame();
  }

  setProgress(progress: number) {
    const scrollLimit = -this.totalHeight;
    const scrollRange = this.canvas.height - scrollLimit;
    this.yOffset = this.canvas.height - (progress * scrollRange);
    this.drawFrame();
  }

  getDuration(): number {
    const pixelsPerSecond = this.config.speed * 100;
    const scrollLimit = -this.totalHeight;
    const scrollRange = this.canvas.height - scrollLimit;
    return scrollRange / pixelsPerSecond;
  }

  updateConfig(newConfig: Partial<EngineConfig>) {
    const resolutionChanged = newConfig.resolution && newConfig.resolution !== this.config.resolution;
    this.config = { ...this.config, ...newConfig };

    if (resolutionChanged) {
      const width = this.config.resolution === '1080p' ? 1080 : 720;
      const height = this.config.resolution === '1080p' ? 1920 : 1280;
      this.canvas.width = width;
      this.canvas.height = height;

      if (typeof OffscreenCanvas !== 'undefined') {
        this.offscreenCanvas = new OffscreenCanvas(width, this.totalHeight || height);
      } else {
        this.offscreenCanvas.width = width;
      }
      this.offscreenCtx = this.offscreenCanvas.getContext('2d') as any;
    }

    this.readyPromise = this.preRender();
    return this.readyPromise;
  }

  destroy() {
    this.pause();
    this.worker?.terminate();
  }
}
