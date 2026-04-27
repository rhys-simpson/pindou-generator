import React, { useState, useRef, useEffect } from 'react';
import type { PindouColor } from './types';
import mardPaletteData from '../data/mard-palete.json';

// @ts-ignore
import logoPath from '../data/logo.png';

const mardPalette = mardPaletteData as PindouColor[];

// Helper to determine if a color is dark or light for text contrast
const getContrastingTextColor = (bead: PindouColor): string => {
  // Formula for perceived brightness
  const luminance = (bead.r * 0.299 + bead.g * 0.587 + bead.b * 0.114);
  const LUMINANCE_THRESHOLD = 186;
  return luminance > LUMINANCE_THRESHOLD ? '#000' : '#FFF';
};

export default function PindouGenerator() {
  const [gridSize, setGridSize] = useState<number>(48);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [removeBg, setRemoveBg] = useState<boolean>(true);
  const logoRef = useRef<HTMLImageElement | null>(null);
  const [logoLoaded, setLogoLoaded] = useState<boolean>(false);
  const [showReference, setShowReference] = useState<boolean>(false);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isPanMode, setIsPanMode] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const [undoStack, setUndoStack] = useState<(PindouColor | null)[][]>([]);
  const [highlightColor, setHighlightColor] = useState<string | null>(null);
  const legendHitboxesRef = useRef<{code: string, x: number, y: number, w: number, h: number}[]>([]);

  // Interactive state
  const [gridData, setGridData] = useState<(PindouColor | null)[] | null>(null);
  const [paintColor, setPaintColor] = useState<string>('erase');
  const [isPainting, setIsPainting] = useState<boolean>(false);
  const [hoveredCell, setHoveredCell] = useState<{ gridX: number, gridY: number, color: PindouColor | null } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number, y: number }>({ x: 0, y: 0 });
  const activePaintColor = mardPalette.find(c => c.code === paintColor);
  
  // Refs for keyboard shortcut state access
  const undoStackRef = useRef<(PindouColor | null)[][]>([]);
  const gridDataRef = useRef<(PindouColor | null)[] | null>(null);
  useEffect(() => { undoStackRef.current = undoStack; }, [undoStack]);
  useEffect(() => { gridDataRef.current = gridData; }, [gridData]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => { logoRef.current = img; setLogoLoaded(true); };
    img.src = logoPath;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return;

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault(); 
        setIsPanMode(true);
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        if (undoStackRef.current.length > 0 && gridDataRef.current) {
          handleUndo();
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsPanMode(false);
        setIsDragging(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Helper to find the closest bead color using Euclidean distance
  const getClosestColor = (r: number, g: number, b: number): PindouColor => {
    let minDistance = Infinity;
    // Default to the first color in the palette as a safe starting point
    let closestColor: PindouColor = mardPalette[0];

    for (const color of mardPalette) {
      const distance = Math.sqrt(
        Math.pow(color.r - r, 2) +
        Math.pow(color.g - g, 2) +
        Math.pow(color.b - b, 2)
      );
      if (distance < minDistance) {
        minDistance = distance;
        closestColor = color;
      }
    }
    return closestColor;
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.name.toLowerCase().endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const data = JSON.parse(event.target?.result as string);
            if (data.gridSize && data.gridData) {
              setGridSize(data.gridSize);
              const restoredData = data.gridData.map((code: string | null) =>
                code ? (mardPalette.find(c => c.code === code) || null) : null
              );
              setGridData(restoredData);
              setImageSrc(null);
              sourceImageRef.current = null;
              setUndoStack([]);
            }
          } catch (err) {
            console.error("Failed to parse project file", err);
          }
        };
        reader.readAsText(file);
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (typeof event.target?.result === 'string') {
            setImageSrc(event.target.result);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleRemoveFile = () => {
    setImageSrc(null);
    setGridData(null);
    sourceImageRef.current = null;
    setZoomLevel(1);
    setUndoStack([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const generateTemplate = () => {
    if (!imageSrc) return;

    const img = new Image();

    img.onload = () => {
      sourceImageRef.current = img;

      // 1. Draw image to a hidden, tiny canvas to downsample it
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = gridSize;
      offscreenCanvas.height = gridSize;
      const offCtx = offscreenCanvas.getContext('2d');
      if (!offCtx) {
        console.error("Failed to get 2D context from offscreen canvas.");
        return;
      }
      offCtx.drawImage(img, 0, 0, gridSize, gridSize); // NOSONAR
      
      const imgData = offCtx.getImageData(0, 0, gridSize, gridSize).data;

      // Detect "outside" background via Flood Fill from top-left corner
      const bgFill = new Array(gridSize * gridSize).fill(false);
      if (removeBg) {
        const startR = imgData[0], startG = imgData[1], startB = imgData[2], startA = imgData[3];
        const queue = [{cx: 0, cy: 0}];
        bgFill[0] = true;

        while (queue.length > 0) {
          const {cx, cy} = queue.shift()!;
          const neighbors = [{cx: cx + 1, cy}, {cx: cx - 1, cy}, {cx, cy: cy + 1}, {cx, cy: cy - 1}];

          for (const {cx: nx, cy: ny} of neighbors) {
            if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
              const idx1D = ny * gridSize + nx;
              if (!bgFill[idx1D]) {
                const idx = idx1D * 4;
                const r = imgData[idx], g = imgData[idx+1], b = imgData[idx+2], a = imgData[idx+3];
                let match = false;
                if (startA < 128 && a < 128) match = true;
                else if (startA >= 128 && a >= 128) {
                  const dist = Math.sqrt((r - startR) ** 2 + (g - startG) ** 2 + (b - startB) ** 2);
                  if (dist < 40) match = true;
                }
                if (match) {
                  bgFill[idx1D] = true;
                  queue.push({cx: nx, cy: ny});
                }
              }
            }
          }
        }
      }

      // 2. Store generated pixel layout into state
      const newGridData: (PindouColor | null)[] = new Array(gridSize * gridSize).fill(null);
      for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
          const idx1D = y * gridSize + x;
          const index = idx1D * 4;
          const a = imgData[index + 3];
          if (a < 128 || bgFill[idx1D]) continue;
          const r = imgData[index];
          const g = imgData[index + 1];
          const b = imgData[index + 2];
          newGridData[idx1D] = getClosestColor(r, g, b);
        }
      }
      setGridData(newGridData);
      setZoomLevel(1);
      setUndoStack([]);
    };
    img.src = imageSrc;
  };

  // Draws the grid + legend to the canvas whenever gridData or gridSize changes
  useEffect(() => {
    if (!gridData || !canvasRef.current) return;
    if (gridData.length !== gridSize * gridSize) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Pre-calculate color usage from gridData to determine legend requirements
    const colorCounts: Record<string, number> = {};
    for (const cell of gridData) {
      if (cell) {
        colorCounts[cell.code] = (colorCounts[cell.code] || 0) + 1;
      }
    }

    // Set up the main output canvas for high-res printing + Legend
    const cellSize = 40;
    const gridPixelSize = gridSize * cellSize;
    
    const activeColors = mardPalette.filter(c => colorCounts[c.code]);
    const activeColorsCount = activeColors.length;
    
    const legendTitleHeight = 80;
    const swatchHeight = 45;
    const columnWidth = 350;
    const maxItemsPerColumn = Math.max(1, Math.floor((gridPixelSize - legendTitleHeight) / swatchHeight));
    const columnsCount = Math.ceil(activeColorsCount / maxItemsPerColumn);
    const legendWidth = columnsCount > 0 ? (columnsCount * columnWidth) : 0;
    
    canvas.width = gridPixelSize + legendWidth;
    canvas.height = gridPixelSize;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (showReference && sourceImageRef.current) {
      ctx.drawImage(sourceImageRef.current, 0, 0, gridPixelSize, gridPixelSize);
    }

    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;

    // Map colors and draw the grid
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const bead = gridData[y * gridSize + x];
        if (!bead) continue;

        const isHighlighted = highlightColor && bead.code === highlightColor;
        const isDimmed = highlightColor && bead.code !== highlightColor;

        // Draw cell background
        let fillAlpha = showReference ? 0.5 : 1;
        if (isDimmed) fillAlpha = 0.15;

        ctx.fillStyle = `rgba(${bead.r}, ${bead.g}, ${bead.b}, ${fillAlpha})`;
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);

        // Draw grid borders
        if (isHighlighted) {
          ctx.strokeStyle = '#FF0000';
          ctx.lineWidth = 2;
          ctx.strokeRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2);
        } else {
          ctx.strokeStyle = isDimmed ? 'rgba(224, 224, 224, 0.3)' : '#e0e0e0';
          ctx.lineWidth = 1;
          ctx.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
        ctx.lineWidth = 1;

        // Draw text label
        if (!isDimmed) {
          ctx.fillStyle = getContrastingTextColor(bead);
          ctx.fillText(bead.code, x * cellSize + (cellSize / 2), y * cellSize + (cellSize / 2)); // NOSONAR
        }
      }
    }

    // Draw the Legend
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Colour Legend', gridPixelSize + 30, 30);

    let currentY = legendTitleHeight;
    let currentX = gridPixelSize + 30;
    let itemsInCol = 0;
    legendHitboxesRef.current = [];

    for (const color of activeColors) {
      const count = colorCounts[color.code];
      const isHighlighted = highlightColor === color.code;

      if (itemsInCol >= maxItemsPerColumn) {
        currentY = legendTitleHeight;
        currentX += columnWidth;
        itemsInCol = 0;
      }

      legendHitboxesRef.current.push({
        code: color.code,
        x: currentX,
        y: currentY,
        w: columnWidth,
        h: swatchHeight
      });

      // Swatch background and border
      ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
      ctx.fillRect(currentX, currentY, 30, 30);
      ctx.strokeStyle = isHighlighted ? '#FF0000' : '#000000';
      ctx.lineWidth = isHighlighted ? 3 : 1;
      ctx.strokeRect(currentX, currentY, 30, 30);
      ctx.lineWidth = 1;

      // Count Label
      ctx.fillStyle = isHighlighted ? '#FF0000' : '#000000';
      ctx.font = isHighlighted ? 'bold 20px Arial' : '20px Arial';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${color.code} - ${color.name} (${count} cells)`, currentX + 45, currentY + 15);

      currentY += swatchHeight;
      itemsInCol++;
    }

    // Draw Logo
    if (logoRef.current) {
      const finalLogo = logoRef.current;
      const logoMaxWidth = 200;
      const scale = finalLogo.width > logoMaxWidth ? logoMaxWidth / finalLogo.width : 1;
      const w = finalLogo.width * scale;
      const h = finalLogo.height * scale;
      const x = canvas.width - w - 20;
      const y = canvas.height - h - 20;
      const radius = 16; // Corner rounding

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(finalLogo, x, y, w, h);
      ctx.restore();
    }
  }, [gridData, gridSize, logoLoaded, showReference, highlightColor]);

  // --- Canvas Interactions for Hover and Editing ---
  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const elementRatio = rect.width / rect.height;
    const canvasRatio = canvas.width / canvas.height;
    let actualWidth = rect.width;
    let actualHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (canvasRatio > elementRatio) {
      actualHeight = rect.width / canvasRatio;
      offsetY = (rect.height - actualHeight) / 2;
    } else {
      actualWidth = rect.height * canvasRatio;
      offsetX = (rect.width - actualWidth) / 2;
    }

    const scaleX = canvas.width / actualWidth;
    const scaleY = canvas.height / actualHeight;
    const x = (e.clientX - rect.left - offsetX) * scaleX;
    const y = (e.clientY - rect.top - offsetY) * scaleY;
    return { x, y };
  };

  const paintCell = (gridX: number, gridY: number) => {
    if (gridX >= 0 && gridX < gridSize && gridY >= 0 && gridY < gridSize) {
      const idx = gridY * gridSize + gridX;
      const newColor = paintColor === 'erase' ? null : (mardPalette.find(c => c.code === paintColor) || null);

      setGridData(prev => {
        if (!prev) return prev;
        if (prev[idx]?.code === newColor?.code) return prev; // Prevent unnecessary re-renders
        const newData = [...prev];
        newData[idx] = newColor;
        return newData;
      });
      setHoveredCell({ gridX, gridY, color: newColor });
    }
  };

  const handleImageMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    if (isPanMode) {
      setIsDragging(true);
      if (scrollContainerRef.current) {
        setDragStart({
          x: e.clientX,
          y: e.clientY,
          scrollLeft: scrollContainerRef.current.scrollLeft,
          scrollTop: scrollContainerRef.current.scrollTop
        });
      }
    }
  };

  const handleImageMouseMove = (e: React.MouseEvent<HTMLImageElement>) => {
    if (isPanMode && isDragging && scrollContainerRef.current) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      scrollContainerRef.current.scrollLeft = dragStart.scrollLeft - dx;
      scrollContainerRef.current.scrollTop = dragStart.scrollTop - dy;
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanMode) {
      setIsDragging(true);
      if (scrollContainerRef.current) {
        setDragStart({
          x: e.clientX,
          y: e.clientY,
          scrollLeft: scrollContainerRef.current.scrollLeft,
          scrollTop: scrollContainerRef.current.scrollTop
        });
      }
      return; // Skip paint logic while panning
    }

    const coords = getCanvasCoordinates(e);
    if (!coords) return;
    const cellSize = 40;
    const gridX = Math.floor(coords.x / cellSize);
    const gridY = Math.floor(coords.y / cellSize);

    // Check for color picker / eyedropper interaction
    if (e.button === 2 || e.altKey || paintColor === 'eyedropper') {
      const idx = gridY * gridSize + gridX;
      const color = gridData?.[idx];
      if (color) {
        setPaintColor(color.code);
      } else {
        setPaintColor('erase');
      }
      return; // Don't paint when picking a color
    }

    if (e.button === 0) { // Standard Left click
      setUndoStack(prev => [...prev, [...(gridData ?? [])]]);
      setIsPainting(true);
      paintCell(gridX, gridY);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (e.deltaY < 0) {
      setZoomLevel(prev => Math.min(5, prev + 0.15));
    } else if (e.deltaY > 0) {
      setZoomLevel(prev => Math.max(0.5, prev - 0.15));
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanMode && isDragging && scrollContainerRef.current) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      scrollContainerRef.current.scrollLeft = dragStart.scrollLeft - dx;
      scrollContainerRef.current.scrollTop = dragStart.scrollTop - dy;
      return;
    }

    if (!gridData) return;
    const coords = getCanvasCoordinates(e);
    if (!coords) return;

    setMousePos({ x: e.clientX, y: e.clientY });

    const cellSize = 40;
    const gridPixelSize = gridSize * cellSize;
    const gridX = Math.floor(coords.x / cellSize);
    const gridY = Math.floor(coords.y / cellSize);

    let foundHighlight = null;
    if (coords.x > gridPixelSize) {
      for (const box of legendHitboxesRef.current) {
        if (coords.x >= box.x && coords.x < box.x + box.w && coords.y >= box.y && coords.y < box.y + box.h) {
          foundHighlight = box.code;
          break;
        }
      }
    }
    setHighlightColor(foundHighlight);

    if (gridX >= 0 && gridX < gridSize && gridY >= 0 && gridY < gridSize && coords.x <= gridPixelSize) {
      if (isPainting) {
        paintCell(gridX, gridY);
      } else {
        const idx = gridY * gridSize + gridX;
        setHoveredCell({ gridX, gridY, color: gridData[idx] });
      }
    } else {
      setHoveredCell(null);
    }
  };

  const handleCanvasMouseLeave = () => {
    if (isDragging) setIsDragging(false);
    setHoveredCell(null);
    setHighlightColor(null);
    setIsPainting(false);
  };

  const handleCanvasMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      return;
    }
    setIsPainting(false);
  };

  const handleUndo = () => {
    if (undoStackRef.current.length === 0) return;
    const lastState = undoStackRef.current[undoStackRef.current.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setGridData(lastState);
  };

  const handleCenterDesign = () => {
    if (!gridData) return;
    let minX = gridSize, maxX = -1, minY = gridSize, maxY = -1;
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        if (gridData[y * gridSize + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return; // Empty grid

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const targetX = Math.floor((gridSize - boxWidth) / 2);
    const targetY = Math.floor((gridSize - boxHeight) / 2);
    const offsetX = targetX - minX;
    const offsetY = targetY - minY;

    if (offsetX === 0 && offsetY === 0) return; // Already centered

    setUndoStack(prev => [...prev, [...gridData]]);
    const newGridData = new Array(gridSize * gridSize).fill(null);
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const cell = gridData[y * gridSize + x];
        if (cell) {
          const newX = x + offsetX;
          const newY = y + offsetY;
          if (newX >= 0 && newX < gridSize && newY >= 0 && newY < gridSize) {
            newGridData[newY * gridSize + newX] = cell;
          }
        }
      }
    }
    setGridData(newGridData);
  };

  const saveProject = () => {
    if (!gridData) return;
    const projectData = {
      gridSize,
      gridData: gridData.map(c => c ? c.code : null)
    };
    const blob = new Blob([JSON.stringify(projectData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pindou-project.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadTemplate = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.error("Canvas element not found for download.");
      return;
    }
    const link = document.createElement('a');
    link.download = 'pindou-template.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  let canvasCursor = 'crosshair';
  if (isPanMode) {
    canvasCursor = isDragging ? 'grabbing' : 'grab';
  } else if (paintColor === 'eyedropper') {
    canvasCursor = 'copy';
  }
  const imgCursor = isPanMode ? (isDragging ? 'grabbing' : 'grab') : 'default';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '20px', boxSizing: 'border-box', fontFamily: 'sans-serif' }}>
      <h2>Pixel Template Generator</h2>

      <div style={{ marginBottom: '10px', flexShrink: 0, display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="file" accept="image/*,.json" onChange={handleImageUpload} ref={fileInputRef} />
        {(imageSrc || gridData) && <button onClick={handleRemoveFile}>Remove File</button>}
        <select
          value={gridSize}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setGridSize(Number(e.target.value))}
        >
          <option value={24}>24x24</option>
          <option value={48}>48x48</option>
          <option value={60}>60x60</option>
        </select>
        <label>
          <input type="checkbox" checked={removeBg} onChange={e => setRemoveBg(e.target.checked)} />
          Remove Background
        </label>
        <label>
          <input type="checkbox" checked={showReference} onChange={e => setShowReference(e.target.checked)} />
          Show Reference Photo
        </label>
        <button onClick={generateTemplate}>Generate Grid</button>
      </div>

      {gridData && (
        <div style={{ marginBottom: '10px', flexShrink: 0, display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={downloadTemplate}>Download PNG</button>
          <button onClick={saveProject}>Save Project</button>
          <button onClick={handleUndo} disabled={undoStack.length === 0}>Undo</button>
          <button onClick={handleCenterDesign}>Center Design</button>

          <div style={{ display: 'inline-flex', alignItems: 'center', borderLeft: '1px solid #ccc', paddingLeft: '10px' }}>
          <span style={{ marginRight: '5px' }}>Zoom:</span>
          <button onClick={() => setZoomLevel(prev => Math.max(1, prev - 0.5))}>-</button>
          <span style={{ minWidth: '45px', textAlign: 'center', fontSize: '14px' }}>{Math.round(zoomLevel * 100)}%</span>
          <button onClick={() => setZoomLevel(prev => Math.min(5, prev + 0.5))}>+</button>
        </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', borderLeft: '1px solid #ccc', paddingLeft: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center' }}>
              Paint:
              {activePaintColor ? (
                <div style={{ width: '18px', height: '18px', backgroundColor: `rgb(${activePaintColor.r}, ${activePaintColor.g}, ${activePaintColor.b})`, margin: '0 5px', border: '1px solid #000' }} />
              ) : paintColor === 'eyedropper' ? (
                <div style={{ width: '18px', height: '18px', backgroundColor: '#fff', margin: '0 5px', border: '1px solid #000', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '12px' }}>💧</div>
              ) : (
                <div style={{ width: '18px', height: '18px', backgroundColor: 'transparent', margin: '0 5px', border: '1px dashed #000', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '10px', color: '#000' }}>X</div>
              )}
              <select value={paintColor} onChange={e => setPaintColor(e.target.value)} style={{ maxWidth: '150px' }}>
                <option value="eyedropper">💧 Eyedropper</option>
                <option value="erase">Eraser (Remove)</option>
                {mardPalette.map(c => (
                  <option key={c.code} value={c.code} style={{ backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})`, color: getContrastingTextColor(c) }}>{c.code} - {c.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {!gridData && imageSrc && showReference && (
        <div ref={scrollContainerRef} style={{ flexGrow: 1, minHeight: 0, overflow: 'auto', border: '1px solid #ccc', backgroundColor: '#e9e9e9' }}>
          <div style={{ width: `${zoomLevel * 100}%`, height: `${zoomLevel * 100}%`, minWidth: '100%', minHeight: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <img 
              src={imageSrc} 
              alt="Reference" 
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: imgCursor }} 
              onMouseDown={handleImageMouseDown}
              onMouseMove={handleImageMouseMove}
              onMouseUp={() => setIsDragging(false)}
              onMouseLeave={() => setIsDragging(false)}
              onDragStart={e => e.preventDefault()}
            />
          </div>
        </div>
      )}

      {gridData && (
        <div ref={scrollContainerRef} style={{ flexGrow: 1, minHeight: 0, overflow: 'auto', border: '1px solid #ccc', backgroundColor: '#e9e9e9' }}>
          <div style={{ width: `${zoomLevel * 100}%`, height: `${zoomLevel * 100}%`, minWidth: '100%', minHeight: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <canvas 
              ref={canvasRef} 
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: canvasCursor }}
              onContextMenu={(e) => e.preventDefault()}
              onWheel={handleWheel}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseLeave}
            ></canvas>
          </div>
        </div>
      )}

      {hoveredCell && (
        <div style={{
          position: 'fixed',
          left: mousePos.x + 15,
          top: mousePos.y + 15,
          backgroundColor: 'rgba(0,0,0,0.85)',
          color: '#fff',
          padding: '8px 12px',
          borderRadius: '6px',
          pointerEvents: 'none',
          zIndex: 9999,
          fontSize: '14px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
            {hoveredCell.color ? `${hoveredCell.color.code} - ${hoveredCell.color.name}` : 'Empty Cell'}
          </div>
          <div style={{ fontSize: '12px', color: '#ccc' }}>
            Click to paint: {paintColor === 'erase' ? 'Eraser' : paintColor === 'eyedropper' ? 'Eyedropper' : paintColor} <br/>
            <span style={{ fontSize: '10px' }}>(Right-click to pick color)</span>
          </div>
        </div>
      )}
    </div>
  );
}