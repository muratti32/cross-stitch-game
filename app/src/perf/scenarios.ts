import { SharedValue } from 'react-native-reanimated';
import { AppState, AppStateStatus } from 'react-native';
import { PatternData } from '../pattern-artifact';
import { RendererState } from '../renderer/RendererState';
import {
  FrameSampler,
  LatencySampler,
  ThermalSampler,
} from './metrics';
import {
  ScenarioId,
  SCENARIO_KIND,
  ThermalState,
  REQUIRED_SCENARIOS,
} from './budgets';
import {
  beginCriticalPathWindow,
  endCriticalPathWindow,
  resetCriticalPathSentinel,
  CriticalPathViolation,
} from './criticalPathSentinel';
import {
  CELL_SIZE,
  getAnchoredZoomTransform,
  computeEdgePanVelocity,
} from '../renderer/tileMath';
import { getThermalState } from '../../modules/perf-thermal';
import { ScenarioMeasurement } from './report';

export interface ScenarioContext {
  rendererState: RendererState;
  pattern: PatternData;
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  scale: SharedValue<number>;
  containerWidth: SharedValue<number>;
  containerHeight: SharedValue<number>;
  completedShared: SharedValue<Uint8Array>;
  activeColorIndexShared: SharedValue<number>;
  frameSampler: FrameSampler;
  latencySampler: LatencySampler;
  thermalSampler: ThermalSampler;
  bumpRevision: () => void;
  stitchCell: (x: number, y: number) => void;
  undoLast: () => void;
  remountCanvas?: () => void;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  title: string;
  description: string;
  fixture: 'late-play' | 'fully-completed';
  requiresOperatorAction: boolean;
  operatorInstruction?: string;
  run: (ctx: ScenarioContext, signal: { cancelled: boolean }) => Promise<void>;
}

const getCurrentTime = () =>
  typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function clampTranslation(
  tx: number,
  ty: number,
  scale: number,
  patternWidth: number,
  patternHeight: number,
  cW: number,
  cH: number
) {
  const contentW = patternWidth * CELL_SIZE * scale;
  const contentH = patternHeight * CELL_SIZE * scale;
  let newTx = tx;
  let newTy = ty;
  if (contentW <= cW) {
    newTx = (cW - contentW) / 2;
  } else {
    newTx = Math.max(cW - contentW, Math.min(0, tx));
  }
  if (contentH <= cH) {
    newTy = (cH - contentH) / 2;
  } else {
    newTy = Math.max(cH - contentH, Math.min(0, ty));
  }
  return { tx: newTx, ty: newTy, scale };
}

// Selects 200 deterministic cell coordinates matching the active color
function getDeterministicStitchCells(ctx: ScenarioContext): { x: number; y: number }[] {
  const activeColor = ctx.activeColorIndexShared.value + 1; // 1-based in grid
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < ctx.pattern.height; y++) {
    for (let x = 0; x < ctx.pattern.width; x++) {
      const idx = y * ctx.pattern.width + x;
      if (ctx.pattern.grid[idx] === activeColor && !ctx.rendererState.isCompleted(x, y)) {
        cells.push({ x, y });
      }
    }
  }
  
  if (cells.length === 0) {
    // Fallback if no matching cells
    for (let y = 0; y < ctx.pattern.height; y++) {
      for (let x = 0; x < ctx.pattern.width; x++) {
        cells.push({ x, y });
      }
    }
  }

  const result: { x: number; y: number }[] = [];
  const step = Math.max(1, Math.floor(cells.length / 200));
  for (let i = 0; i < 200; i++) {
    result.push(cells[(i * step) % cells.length]);
  }
  return result;
}

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'stitch-latency',
    title: 'Stitch Latency',
    description: 'Measures latency of 200 deterministic stitches.',
    fixture: 'late-play',
    requiresOperatorAction: false,
    async run(ctx, signal) {
      const selected = getDeterministicStitchCells(ctx);
      for (let i = 0; i < 200; i++) {
        if (signal.cancelled) break;
        const cell = selected[i];
        const id = `stitch-${i}`;
        const inputTime = getCurrentTime();
        ctx.latencySampler.markInput(id, inputTime);
        
        ctx.stitchCell(cell.x, cell.y);
        
        const capturedId = id;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            ctx.latencySampler.markVisible(capturedId, getCurrentTime());
          });
        });
        await delay(50);
      }
    },
  },
  {
    id: 'undo-latency',
    title: 'Undo Latency',
    description: 'Measures latency of 200 deterministic undos.',
    fixture: 'late-play',
    requiresOperatorAction: false,
    async run(ctx, signal) {
      const selected = getDeterministicStitchCells(ctx);
      for (let i = 0; i < 200; i++) {
        if (signal.cancelled) break;
        const cell = selected[i];
        
        // 1. Stitch
        ctx.stitchCell(cell.x, cell.y);
        await delay(50);
        
        // 2. Undo
        const id = `undo-${i}`;
        const inputTime = getCurrentTime();
        ctx.latencySampler.markInput(id, inputTime);
        
        ctx.undoLast();
        
        const capturedId = id;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            ctx.latencySampler.markVisible(capturedId, getCurrentTime());
          });
        });
        await delay(50);
      }
    },
  },
  {
    id: 'pan',
    title: 'Pan Frame Rate',
    description: 'Pans over a deterministic serpentine path across the pattern for 20 seconds.',
    fixture: 'late-play',
    requiresOperatorAction: false,
    async run(ctx, signal) {
      let lastTime = getCurrentTime();
      const duration = 20000;
      const startTime = lastTime;
      const currentScale = 1.5;
      ctx.scale.value = currentScale;
      
      const cW = ctx.containerWidth.value || 390;
      const cH = ctx.containerHeight.value || 844;
      
      while (getCurrentTime() - startTime < duration) {
        if (signal.cancelled) break;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const now = getCurrentTime();
        const dt = now - lastTime;
        lastTime = now;
        ctx.frameSampler.pushFrameInterval(dt);
        
        const t = (now - startTime) / duration;
        const contentW = ctx.pattern.width * CELL_SIZE * currentScale;
        const contentH = ctx.pattern.height * CELL_SIZE * currentScale;
        const minTx = cW - contentW;
        const minTy = cH - contentH;
        
        const targetTy = minTy * t;
        const targetTx = minTx * (0.5 + 0.5 * Math.sin(t * 10 * 2 * Math.PI));
        
        const clamped = clampTranslation(targetTx, targetTy, currentScale, ctx.pattern.width, ctx.pattern.height, cW, cH);
        ctx.translateX.value = clamped.tx;
        ctx.translateY.value = clamped.ty;
      }
    },
  },
  {
    id: 'anchored-zoom',
    title: 'Anchored Zoom',
    description: 'Zoom cycles in/out anchored on a fixed focal point for 20 seconds.',
    fixture: 'late-play',
    requiresOperatorAction: false,
    async run(ctx, signal) {
      let lastTime = getCurrentTime();
      const duration = 20000;
      const startTime = lastTime;
      const cW = ctx.containerWidth.value || 390;
      const cH = ctx.containerHeight.value || 844;
      const fitScale = Math.min(cW / (ctx.pattern.width * CELL_SIZE), cH / (ctx.pattern.height * CELL_SIZE));
      
      ctx.scale.value = fitScale;
      ctx.translateX.value = (cW - ctx.pattern.width * CELL_SIZE * fitScale) / 2;
      ctx.translateY.value = (cH - ctx.pattern.height * CELL_SIZE * fitScale) / 2;
      
      while (getCurrentTime() - startTime < duration) {
        if (signal.cancelled) break;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const now = getCurrentTime();
        const dt = now - lastTime;
        lastTime = now;
        ctx.frameSampler.pushFrameInterval(dt);
        
        const t = (now - startTime) / duration;
        const wave = 0.5 + 0.5 * Math.sin(t * 5 * 2 * Math.PI - Math.PI / 2);
        const targetScale = fitScale + (3.0 - fitScale) * wave;
        
        const transform = getAnchoredZoomTransform(
          ctx.scale.value,
          ctx.translateX.value,
          ctx.translateY.value,
          targetScale,
          cW / 2,
          cH / 2,
          fitScale,
          3.0,
          ctx.pattern.width,
          ctx.pattern.height,
          cW,
          cH
        );
        ctx.scale.value = transform.scale;
        ctx.translateX.value = transform.translateX;
        ctx.translateY.value = transform.translateY;
      }
    },
  },
  {
    id: 'stitch-sweep',
    title: 'Stitch Sweep Frame Rate',
    description: 'Simulates sweep-stitching back and forth across rows with edge auto-pan.',
    fixture: 'late-play',
    requiresOperatorAction: false,
    async run(ctx, signal) {
      let lastTime = getCurrentTime();
      const duration = 20000;
      const startTime = lastTime;
      const cW = ctx.containerWidth.value || 390;
      const cH = ctx.containerHeight.value || 844;
      
      ctx.scale.value = 2.0;
      ctx.translateX.value = (cW - ctx.pattern.width * CELL_SIZE * 2.0) / 2;
      ctx.translateY.value = (cH - ctx.pattern.height * CELL_SIZE * 2.0) / 2;
      
      let lastStitchedX = -1;
      let lastStitchedY = -1;
      
      while (getCurrentTime() - startTime < duration) {
        if (signal.cancelled) break;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const now = getCurrentTime();
        const dt = now - lastTime;
        lastTime = now;
        ctx.frameSampler.pushFrameInterval(dt);
        
        const t = (now - startTime) / duration;
        const fingerX = 20 + (cW - 40) * (0.5 + 0.5 * Math.sin(t * 30 * 2 * Math.PI));
        const fingerY = cH / 2 + 100 * Math.sin(t * 5 * Math.PI);
        
        const vx = computeEdgePanVelocity(fingerX, cW, 48, 0.5);
        const vy = computeEdgePanVelocity(fingerY, cH, 48, 0.5);
        ctx.translateX.value = ctx.translateX.value + vx * dt;
        ctx.translateY.value = ctx.translateY.value + vy * dt;
        
        const clamped = clampTranslation(
          ctx.translateX.value,
          ctx.translateY.value,
          ctx.scale.value,
          ctx.pattern.width,
          ctx.pattern.height,
          cW,
          cH
        );
        ctx.translateX.value = clamped.tx;
        ctx.translateY.value = clamped.ty;
        
        const patX = (fingerX - ctx.translateX.value) / ctx.scale.value;
        const patY = (fingerY - ctx.translateY.value) / ctx.scale.value;
        const cellX = Math.floor(patX / CELL_SIZE);
        const cellY = Math.floor(patY / CELL_SIZE);
        
        if (cellX >= 0 && cellX < ctx.pattern.width && cellY >= 0 && cellY < ctx.pattern.height) {
          if (cellX !== lastStitchedX || cellY !== lastStitchedY) {
            const idx = cellY * ctx.pattern.width + cellX;
            const matchesColor = ctx.pattern.grid[idx] === ctx.activeColorIndexShared.value + 1;
            const isUnfinished = !ctx.rendererState.isCompleted(cellX, cellY);
            if (matchesColor && isUnfinished) {
              lastStitchedX = cellX;
              lastStitchedY = cellY;
              ctx.stitchCell(cellX, cellY);
            }
          }
        }
      }
    },
  },
  {
    id: 'worst-case-fully-completed',
    title: 'Worst-Case Fully Completed',
    description: 'Pans and zooms over a 100%-completed pattern.',
    fixture: 'fully-completed',
    requiresOperatorAction: false,
    async run(ctx, signal) {
      let lastTime = getCurrentTime();
      const duration = 20000;
      const startTime = lastTime;
      const cW = ctx.containerWidth.value || 390;
      const cH = ctx.containerHeight.value || 844;
      const fitScale = Math.min(cW / (ctx.pattern.width * CELL_SIZE), cH / (ctx.pattern.height * CELL_SIZE));
      
      while (getCurrentTime() - startTime < duration) {
        if (signal.cancelled) break;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const now = getCurrentTime();
        const dt = now - lastTime;
        lastTime = now;
        ctx.frameSampler.pushFrameInterval(dt);
        
        const t = (now - startTime) / duration;
        const targetScale = fitScale + (3.0 - fitScale) * (0.5 + 0.5 * Math.sin(t * 4 * 2 * Math.PI - Math.PI / 2));
        const transform = getAnchoredZoomTransform(
          ctx.scale.value,
          ctx.translateX.value,
          ctx.translateY.value,
          targetScale,
          cW / 2,
          cH / 2,
          fitScale,
          3.0,
          ctx.pattern.width,
          ctx.pattern.height,
          cW,
          cH
        );
        
        const contentW = ctx.pattern.width * CELL_SIZE * transform.scale;
        const contentH = ctx.pattern.height * CELL_SIZE * transform.scale;
        const minTx = cW - contentW;
        const minTy = cH - contentH;
        
        const targetTx = transform.translateX + minTx * 0.1 * Math.sin(t * 10 * 2 * Math.PI);
        const targetTy = transform.translateY + minTy * 0.1 * Math.cos(t * 10 * 2 * Math.PI);
        
        const clamped = clampTranslation(
          targetTx,
          targetTy,
          transform.scale,
          ctx.pattern.width,
          ctx.pattern.height,
          cW,
          cH
        );
        ctx.scale.value = clamped.scale;
        ctx.translateX.value = clamped.tx;
        ctx.translateY.value = clamped.ty;
      }
    },
  },
  {
    id: 'worst-case-rapid-stitch-during-pan-zoom',
    title: 'Worst-Case Rapid Stitch During Pan/Zoom',
    description: 'Pans and zooms continuously while committing a stitch every 50ms.',
    fixture: 'late-play',
    requiresOperatorAction: false,
    async run(ctx, signal) {
      let lastTime = getCurrentTime();
      const duration = 20000;
      const startTime = lastTime;
      const cW = ctx.containerWidth.value || 390;
      const cH = ctx.containerHeight.value || 844;
      const fitScale = Math.min(cW / (ctx.pattern.width * CELL_SIZE), cH / (ctx.pattern.height * CELL_SIZE));
      
      const eligible = getDeterministicStitchCells(ctx);
      let lastStitchTime = 0;
      let stitchIndex = 0;
      
      while (getCurrentTime() - startTime < duration) {
        if (signal.cancelled) break;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const now = getCurrentTime();
        const dt = now - lastTime;
        lastTime = now;
        ctx.frameSampler.pushFrameInterval(dt);
        
        const t = (now - startTime) / duration;
        const targetScale = fitScale + (3.0 - fitScale) * (0.5 + 0.5 * Math.sin(t * 4 * 2 * Math.PI - Math.PI / 2));
        const transform = getAnchoredZoomTransform(
          ctx.scale.value,
          ctx.translateX.value,
          ctx.translateY.value,
          targetScale,
          cW / 2,
          cH / 2,
          fitScale,
          3.0,
          ctx.pattern.width,
          ctx.pattern.height,
          cW,
          cH
        );
        
        const contentW = ctx.pattern.width * CELL_SIZE * transform.scale;
        const contentH = ctx.pattern.height * CELL_SIZE * transform.scale;
        const minTx = cW - contentW;
        const minTy = cH - contentH;
        
        const targetTx = transform.translateX + minTx * 0.1 * Math.sin(t * 10 * 2 * Math.PI);
        const targetTy = transform.translateY + minTy * 0.1 * Math.cos(t * 10 * 2 * Math.PI);
        
        const clamped = clampTranslation(
          targetTx,
          targetTy,
          transform.scale,
          ctx.pattern.width,
          ctx.pattern.height,
          cW,
          cH
        );
        ctx.scale.value = clamped.scale;
        ctx.translateX.value = clamped.tx;
        ctx.translateY.value = clamped.ty;
        
        if (now - lastStitchTime >= 50) {
          lastStitchTime = now;
          if (stitchIndex < eligible.length) {
            const cell = eligible[stitchIndex];
            ctx.stitchCell(cell.x, cell.y);
            stitchIndex++;
          }
        }
      }
    },
  },
  {
    id: 'worst-case-memory-pressure',
    title: 'Worst-Case Memory Pressure',
    description: 'Holds 8x24MB ArrayBuffers while thrashing tile caches.',
    fixture: 'late-play',
    requiresOperatorAction: false,
    async run(ctx, signal) {
      const ballast: ArrayBuffer[] = [];
      try {
        for (let i = 0; i < 8; i++) {
          ballast.push(new ArrayBuffer(24 * 1024 * 1024));
        }
        
        let lastTime = getCurrentTime();
        const duration = 20000;
        const startTime = lastTime;
        const cW = ctx.containerWidth.value || 390;
        const cH = ctx.containerHeight.value || 844;
        
        ctx.scale.value = 3.0; // Zoom in to make caches active
        
        while (getCurrentTime() - startTime < duration) {
          if (signal.cancelled) break;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const now = getCurrentTime();
          const dt = now - lastTime;
          lastTime = now;
          ctx.frameSampler.pushFrameInterval(dt);
          
          const t = (now - startTime) / duration;
          const contentW = ctx.pattern.width * CELL_SIZE * ctx.scale.value;
          const contentH = ctx.pattern.height * CELL_SIZE * ctx.scale.value;
          const minTx = cW - contentW;
          const minTy = cH - contentH;
          
          const targetTx = minTx * (0.5 + 0.5 * Math.sin(t * 15 * 2 * Math.PI));
          const targetTy = minTy * t;
          
          const clamped = clampTranslation(
            targetTx,
            targetTy,
            ctx.scale.value,
            ctx.pattern.width,
            ctx.pattern.height,
            cW,
            cH
          );
          ctx.translateX.value = clamped.tx;
          ctx.translateY.value = clamped.ty;
        }
      } finally {
        ballast.length = 0;
      }
    },
  },
  {
    id: 'worst-case-gpu-context-loss',
    title: 'Worst-Case GPU Context Loss',
    description: 'Remounts the canvas and measures frame rates during recovery.',
    fixture: 'late-play',
    requiresOperatorAction: false,
    async run(ctx, signal) {
      if (ctx.remountCanvas) {
        ctx.remountCanvas();
      }
      await delay(500);
      
      let lastTime = getCurrentTime();
      const duration = 5000;
      const startTime = lastTime;
      const cW = ctx.containerWidth.value || 390;
      const cH = ctx.containerHeight.value || 844;
      const fitScale = Math.min(cW / (ctx.pattern.width * CELL_SIZE), cH / (ctx.pattern.height * CELL_SIZE));
      
      while (getCurrentTime() - startTime < duration) {
        if (signal.cancelled) break;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const now = getCurrentTime();
        const dt = now - lastTime;
        lastTime = now;
        ctx.frameSampler.pushFrameInterval(dt);
        
        const t = (now - startTime) / duration;
        const targetScale = fitScale + (3.0 - fitScale) * (0.5 + 0.5 * Math.sin(t * 2 * 2 * Math.PI));
        const transform = getAnchoredZoomTransform(
          ctx.scale.value,
          ctx.translateX.value,
          ctx.translateY.value,
          targetScale,
          cW / 2,
          cH / 2,
          fitScale,
          3.0,
          ctx.pattern.width,
          ctx.pattern.height,
          cW,
          cH
        );
        ctx.scale.value = transform.scale;
        ctx.translateX.value = transform.translateX;
        ctx.translateY.value = transform.translateY;
      }
    },
  },
  {
    id: 'worst-case-app-resume',
    title: 'Worst-Case App Resume',
    description: 'Operator action: Background the app and return to it 10 times.',
    fixture: 'late-play',
    requiresOperatorAction: true,
    operatorInstruction: 'Background the app and return to it 10 times. A stitch will be recorded immediately upon each resume.',
    async run(ctx, signal) {
      let resumeCount = 0;
      let resolvePromise: (() => void) | null = null;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      
      const eligible = getDeterministicStitchCells(ctx);
      
      const handleAppStateChange = (nextAppState: AppStateStatus) => {
        if (nextAppState === 'active') {
          if (resumeCount < 10 && resumeCount < eligible.length) {
            const cell = eligible[resumeCount];
            const id = `resume-${resumeCount}`;
            const inputTime = getCurrentTime();
            ctx.latencySampler.markInput(id, inputTime);
            
            ctx.stitchCell(cell.x, cell.y);
            
            const capturedId = id;
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                ctx.latencySampler.markVisible(capturedId, getCurrentTime());
              });
            });
            
            resumeCount++;
            if (resumeCount >= 10) {
              resolvePromise?.();
            }
          }
        }
      };
      
      const subscription = AppState.addEventListener('change', handleAppStateChange);
      
      try {
        await Promise.race([
          promise,
          (async () => {
            while (resumeCount < 10 && !signal.cancelled) {
              await delay(100);
            }
          })(),
        ]);
      } finally {
        subscription.remove();
      }
    },
  },
  {
    id: 'sustained-15min',
    title: 'Sustained 15-Minute Load',
    description: 'Alternates pan, zoom, and sweep stitches for 15 minutes, recording thermal progression.',
    fixture: 'late-play',
    requiresOperatorAction: false,
    async run(ctx, signal) {
      let lastTime = getCurrentTime();
      const duration = 15 * 60 * 1000;
      const startTime = lastTime;
      let lastThermalTime = 0;
      
      const cW = ctx.containerWidth.value || 390;
      const cH = ctx.containerHeight.value || 844;
      const fitScale = Math.min(cW / (ctx.pattern.width * CELL_SIZE), cH / (ctx.pattern.height * CELL_SIZE));
      
      const eligible = getDeterministicStitchCells(ctx);
      
      while (getCurrentTime() - startTime < duration) {
        if (signal.cancelled) break;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const now = getCurrentTime();
        const dt = now - lastTime;
        lastTime = now;
        ctx.frameSampler.pushFrameInterval(dt);
        
        if (now - lastThermalTime >= 5000) {
          lastThermalTime = now;
          ctx.thermalSampler.push(getThermalState());
        }
        
        const elapsed = now - startTime;
        const phase = Math.floor(elapsed / 10000) % 3;
        const phaseT = (elapsed % 10000) / 10000;
        
        if (phase === 0) {
          // Pan
          ctx.scale.value = 1.5;
          const contentW = ctx.pattern.width * CELL_SIZE * 1.5;
          const contentH = ctx.pattern.height * CELL_SIZE * 1.5;
          const minTx = cW - contentW;
          const minTy = cH - contentH;
          
          const targetTx = minTx * (0.5 + 0.5 * Math.sin(phaseT * 2 * Math.PI));
          const targetTy = minTy * phaseT;
          const clamped = clampTranslation(targetTx, targetTy, 1.5, ctx.pattern.width, ctx.pattern.height, cW, cH);
          ctx.translateX.value = clamped.tx;
          ctx.translateY.value = clamped.ty;
        } else if (phase === 1) {
          // Zoom
          const targetScale = fitScale + (3.0 - fitScale) * (0.5 + 0.5 * Math.sin(phaseT * 2 * Math.PI - Math.PI / 2));
          const transform = getAnchoredZoomTransform(
            ctx.scale.value,
            ctx.translateX.value,
            ctx.translateY.value,
            targetScale,
            cW / 2,
            cH / 2,
            fitScale,
            3.0,
            ctx.pattern.width,
            ctx.pattern.height,
            cW,
            cH
          );
          ctx.scale.value = transform.scale;
          ctx.translateX.value = transform.translateX;
          ctx.translateY.value = transform.translateY;
        } else {
          // Sweep
          ctx.scale.value = 2.0;
          const fingerX = 20 + (cW - 40) * (0.5 + 0.5 * Math.sin(phaseT * 10 * 2 * Math.PI));
          const fingerY = cH / 2 + 100 * Math.sin(phaseT * 2 * Math.PI);
          
          const clamped = clampTranslation(
            ctx.translateX.value,
            ctx.translateY.value,
            ctx.scale.value,
            ctx.pattern.width,
            ctx.pattern.height,
            cW,
            cH
          );
          ctx.translateX.value = clamped.tx;
          ctx.translateY.value = clamped.ty;
          
          const patX = (fingerX - ctx.translateX.value) / ctx.scale.value;
          const patY = (fingerY - ctx.translateY.value) / ctx.scale.value;
          const cellX = Math.floor(patX / CELL_SIZE);
          const cellY = Math.floor(patY / CELL_SIZE);
          
          if (cellX >= 0 && cellX < ctx.pattern.width && cellY >= 0 && cellY < ctx.pattern.height) {
            const idx = cellY * ctx.pattern.width + cellX;
            const matchesColor = ctx.pattern.grid[idx] === ctx.activeColorIndexShared.value + 1;
            const isUnfinished = !ctx.rendererState.isCompleted(cellX, cellY);
            if (matchesColor && isUnfinished) {
              ctx.stitchCell(cellX, cellY);
            }
          }
        }
      }
    },
  },
];

export async function runScenario(
  def: ScenarioDefinition,
  ctx: ScenarioContext,
  hooks?: { onProgress?: (msg: string) => void }
): Promise<ScenarioMeasurement> {
  ctx.frameSampler.reset();
  ctx.latencySampler.reset();
  ctx.thermalSampler.reset();
  resetCriticalPathSentinel();

  const startedAtIso = new Date().toISOString();
  const startTime = getCurrentTime();

  beginCriticalPathWindow(def.id);

  const signal = { cancelled: false };
  try {
    if (hooks?.onProgress) {
      hooks.onProgress(`Starting scenario ${def.title}...`);
    }
    await def.run(ctx, signal);
  } finally {
    // Make sure we end window even if it fails
  }

  const endTime = getCurrentTime();
  const violations = endCriticalPathWindow();
  const durationMs = endTime - startTime;

  const kind = SCENARIO_KIND[def.id];
  const latencySamplesMs =
    kind === 'latency' || def.id === 'worst-case-app-resume'
      ? ctx.latencySampler.samples()
      : undefined;
  const frameIntervalsMs =
    kind === 'frame-rate' || kind === 'sustained'
      ? ctx.frameSampler.intervals()
      : undefined;
  const thermalSamples =
    kind === 'sustained' ? ctx.thermalSampler.samples() : undefined;

  return {
    scenarioId: def.id,
    startedAtIso,
    durationMs,
    latencySamplesMs,
    frameIntervalsMs,
    thermalSamples,
    criticalPathViolations: violations,
  };
}
