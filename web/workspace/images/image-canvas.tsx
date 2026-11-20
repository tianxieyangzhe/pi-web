"use client";

import { useEffect, useRef, useState } from "react";
import { Group, Image as KonvaImage, Layer, Rect, Shape, Stage } from "react-konva";
import type Konva from "konva";
import { Button } from "../../components/button";
import { settingsInput, settingsLabel, settingsSelect } from "../settings-page";

export type PreviewImage = { id: string; name: string; url: string; source: string; downloadUrl?: string; width?: number; height?: number };
type Point = { x: number; y: number };

function createCheckerboard() {
  const tile = document.createElement("canvas");
  tile.width = tile.height = 16;
  const context = tile.getContext("2d");
  if (context) {
    context.fillStyle = "white";
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = "#e2e8f0";
    context.fillRect(0, 0, 8, 8);
    context.fillRect(8, 8, 8, 8);
  }
  return tile;
}

export default function ImageCanvas({ preview, onClose }: { preview: PreviewImage | null; onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const transform = useRef<Konva.Group>(null);
  const anchor = useRef<Point | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [loaded, setLoaded] = useState<{ url: string; image: HTMLImageElement | null }>();
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<{ start: Point; end: Point } | null>(null);
  const [showAxes, setShowAxes] = useState(true);
  const [pointerCoordinates, setPointerCoordinates] = useState("");
  const [background, setBackground] = useState("checkerboard");
  const [checkerboard] = useState(createCheckerboard);
  const [color, setColor] = useState("#f1f5f9");
  const url = preview?.url;

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updatePixelRatio = () => {
      const ratio = window.devicePixelRatio || 1;
      for (const layer of stage.current?.getLayers() ?? []) {
        const canvas = layer.getCanvas();
        if (canvas.getPixelRatio() === ratio) continue;
        canvas.setPixelRatio(ratio);
        layer.getContext().setAttr("imageSmoothingEnabled", layer.imageSmoothingEnabled());
        layer.batchDraw();
      }
    };
    updatePixelRatio();
    window.addEventListener("resize", updatePixelRatio);
    return () => window.removeEventListener("resize", updatePixelRatio);
  }, [size.width, size.height]);

  useEffect(() => {
    if (!url) return;
    const image = new window.Image();
    image.onload = () => setLoaded({ url, image });
    image.onerror = () => setLoaded({ url, image: null });
    image.src = url;
    return () => { image.onload = null; image.onerror = null; };
  }, [url, retry]);

  useEffect(() => {
    anchor.current = null;
    setZoom(1);
    setRotation(0);
    setSelecting(false);
    setSelection(null);
  }, [preview?.id, url]);

  const image = loaded?.url === url ? loaded?.image : undefined;
  const width = image?.naturalWidth ?? 0;
  const height = image?.naturalHeight ?? 0;
  const sideways = rotation % 180 !== 0;
  const fitScale = image ? Math.min(1, size.width / (sideways ? height : width), size.height / (sideways ? width : height)) : 1;
  const scale = fitScale * zoom;
  const displayedWidth = (sideways ? height : width) * scale;
  const displayedHeight = (sideways ? width : height) * scale;
  const bounds = {
    left: (size.width - displayedWidth) / 2, right: (size.width + displayedWidth) / 2,
    top: (size.height - displayedHeight) / 2, bottom: (size.height + displayedHeight) / 2,
  };
  const rectangle = selection ? {
    x: Math.min(selection.start.x, selection.end.x), y: Math.min(selection.start.y, selection.end.y),
    width: Math.abs(selection.end.x - selection.start.x), height: Math.abs(selection.end.y - selection.start.y),
  } : null;
  function clampToImage(point: Point): Point {
    return { x: Math.max(0, Math.min(width, point.x)), y: Math.max(0, Math.min(height, point.y)) };
  }
  const group = { x: size.width / 2, y: size.height / 2, offsetX: width / 2, offsetY: height / 2, scaleX: scale, scaleY: scale, rotation };

  return <section className="flex h-full min-h-0 min-w-0 flex-col border-l border-slate-200" aria-label="图片查看">
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">图片查看</h2>
    </header>
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 px-3 py-2">
      <div role="group" aria-label="缩放" className="flex items-center gap-1">
        <Button type="button" size="iconCompact" disabled={!image || zoom <= 0.25} onClick={() => setZoom(value => Math.max(0.25, value / 1.25))} aria-label="缩小">−</Button>
        <span className="min-w-9 text-center text-xs tabular-nums">{image ? `${Math.round(scale * 100)}%` : "—"}</span>
        <Button type="button" size="iconCompact" disabled={!image || zoom >= 8} onClick={() => setZoom(value => Math.min(8, value * 1.25))} aria-label="放大">＋</Button>
      </div>
      <div role="group" aria-label="图片工具" className="flex flex-wrap items-center gap-1">
        <Button type="button" disabled={!image} onClick={() => setRotation(value => (value + 90) % 360)}>旋转</Button>
        {selection && <Button type="button" onClick={() => { anchor.current = null; setSelection(null); }}>取消选区</Button>}
      </div>
      <div role="group" aria-label="查看工具" className="flex shrink-0 items-center gap-1">
        <Button type="button" disabled={!image} aria-pressed={selecting} onClick={() => { anchor.current = null; setSelecting(!selecting); }}>选区</Button>
        <Button type="button" aria-pressed={showAxes} onClick={() => { setPointerCoordinates(""); setShowAxes(value => !value); }}>坐标系</Button>
      </div>
      <Button type="button" className="ml-auto" onClick={onClose}>关闭查看</Button>
    </div>
    <div role="group" aria-label="背景设置" className="flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-200 px-3 py-2">
      <label className={settingsLabel} htmlFor="image-canvas-background">背景</label>
      <select id="image-canvas-background" className={settingsSelect} value={background} onChange={event => setBackground(event.target.value)}>
        <option value="checkerboard">棋盘格</option><option value="white">白色</option><option value="black">黑色</option><option value="custom">自定义颜色</option>
      </select>
      {background === "custom" && <input aria-label="画布自定义颜色" className={`${settingsInput} w-10!`} type="color" value={color} onChange={event => setColor(event.target.value)} />}
    </div>
    <div className={`relative min-h-0 flex-1 overflow-hidden ${selecting ? "touch-none cursor-crosshair" : ""}`} ref={container} onPointerLeave={() => setPointerCoordinates("")}>
      {size.width > 0 && size.height > 0 && <Stage ref={stage} width={size.width} height={size.height}
        onPointerDown={event => {
          if (!image || !selecting || event.evt.button !== 0) return;
          const point = transform.current?.getRelativePointerPosition();
          if (!point) return;
          event.evt.target instanceof Element && event.evt.target.setPointerCapture(event.evt.pointerId);
          const start = clampToImage(point);
          anchor.current = start;
          setSelection({ start, end: start });
        }}
        onPointerMove={() => {
          if (showAxes) {
            const pointer = stage.current?.getPointerPosition();
            setPointerCoordinates(pointer && pointer.x >= 0 && pointer.y >= 0 && pointer.x < size.width && pointer.y < size.height
              ? `X ${Math.floor(pointer.x)} · Y ${Math.floor(pointer.y)} px` : "");
          }
          if (anchor.current) {
            const point = transform.current?.getRelativePointerPosition();
            if (point) setSelection({ start: anchor.current, end: clampToImage(point) });
          }
        }}
        onPointerUp={() => { anchor.current = null; }} onPointerCancel={() => { anchor.current = null; }}>
        <Layer listening={false}>
          {background !== "checkerboard" && <Rect {...size} fill={background === "custom" ? color : background} />}
          {background === "checkerboard" && <Shape {...size} sceneFunc={context => {
            const pattern = context.createPattern(checkerboard, "repeat");
            if (pattern) {
              context.setAttr("fillStyle", pattern);
              context.fillRect(0, 0, size.width, size.height);
            }
          }} />}
          {image && showAxes && <Shape sceneFunc={context => {
            const xs = [bounds.left, bounds.right].filter(x => x >= 0 && x <= size.width);
            const ys = [bounds.top, bounds.bottom].filter(y => y >= 0 && y <= size.height);
            context.beginPath();
            for (const x of xs) { context.moveTo(x, 0); context.lineTo(x, size.height); }
            for (const y of ys) { context.moveTo(0, y); context.lineTo(size.width, y); }
            context.setAttr("strokeStyle", "#d1d5db");
            context.setAttr("lineWidth", 1);
            context.stroke();
            context.setAttr("font", "10px system-ui, sans-serif");
            context.setAttr("textBaseline", "top");
            context.setAttr("strokeStyle", "rgba(255, 255, 255, .9)");
            context.setAttr("lineWidth", 3);
            context.setAttr("fillStyle", "#64748b");
            for (const [index, x] of xs.entries()) {
              const label = `X ${Math.round(x)}`;
              context.setAttr("textAlign", index === 0 ? "right" : "left");
              const position = Math.max(40, Math.min(size.width - 40, x + (index === 0 ? -3 : 3)));
              context.strokeText(label, position, 3);
              context.fillText(label, position, 3);
            }
            context.setAttr("textAlign", "left");
            for (const [index, y] of ys.entries()) {
              const label = `Y ${Math.round(y)}`;
              const position = Math.max(16, Math.min(size.height - 12, y + (index === 0 ? -13 : 3)));
              context.strokeText(label, 3, position);
              context.fillText(label, 3, position);
            }
          }} />}
        </Layer>
        <Layer listening={false} imageSmoothingEnabled={scale <= 1}>
          <Group ref={transform} {...group}>
            {image && <>
              <KonvaImage image={image} width={width} height={height} />
              <Rect width={width} height={height} stroke="#d1d5db" strokeWidth={1} strokeScaleEnabled={false} />
            </>}
          </Group>
        </Layer>
        <Layer listening={false}>
          {rectangle && <Group {...group}><Rect {...rectangle} stroke="#0284c7" strokeScaleEnabled={false} strokeWidth={2} fill="rgba(56, 189, 248, .18)" /></Group>}
        </Layer>
      </Stage>}
      {!image && <div className="pointer-events-none absolute inset-0 grid place-content-center justify-items-center gap-2">
        <p className="rounded bg-white/95 px-3 py-2 text-sm text-slate-700">{!preview ? "暂无图片" : image === null ? "图片加载失败" : "正在加载图片…"}</p>
        {image === null && <Button type="button" className="pointer-events-auto" onClick={() => { setLoaded(undefined); setRetry(value => value + 1); }}>重试</Button>}
      </div>}
    </div>
    {preview && <p className="m-0 truncate border-t border-slate-200 p-2 text-xs" title={preview.name}>
      {preview.source} · {preview.name}{image ? ` · ${width}×${height} px` : ""}
      {rectangle && ` · 选区 (${Math.round(rectangle.x)}, ${Math.round(rectangle.y)}) ${Math.round(rectangle.width)}×${Math.round(rectangle.height)} px`}
    </p>}
    {showAxes && <p className="m-0 shrink-0 px-2 pb-2 text-xs tabular-nums text-slate-600">
      {pointerCoordinates || "画布左上角 (0, 0) · X 向右 · Y 向下"}
    </p>}
  </section>;
}
