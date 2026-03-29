import { useRef, useEffect } from 'preact/hooks';
import { wikilinksIndex, allFilePaths, currentFilePath, graphOpen } from '../lib/store';
import { t } from '../i18n';
import { theme } from '../lib/theme';

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  edges: number;
}

interface Edge {
  source: string;
  target: string;
}

export function GraphView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const str = t.value.graph;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const paths = allFilePaths.value;
    const links = wikilinksIndex.value;

    // Build edges
    const edgeCount = new Map<string, number>();
    const edges: Edge[] = [];
    for (const [source, targets] of links) {
      for (const target of targets) {
        if (paths.includes(source) && paths.includes(target)) {
          edges.push({ source, target });
          edgeCount.set(source, (edgeCount.get(source) || 0) + 1);
          edgeCount.set(target, (edgeCount.get(target) || 0) + 1);
        }
      }
    }

    // Resize canvas
    const rect = canvas.parentElement!.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const W = canvas.width, H = canvas.height, HW = W / 2, HH = H / 2;

    // Build nodes
    const nodeMap = new Map<string, Node>();
    const count = paths.length;
    const spreadRadius = Math.max(200, Math.sqrt(count) * 60);
    let idx = 0;
    for (const p of paths) {
      const angle = (idx / count) * Math.PI * 2;
      nodeMap.set(p, {
        id: p,
        label: p.split('/').pop()?.replace(/\.md$/, '') || p,
        x: Math.cos(angle) * spreadRadius + (Math.random() - 0.5) * 40,
        y: Math.sin(angle) * spreadRadius + (Math.random() - 0.5) * 40,
        vx: 0, vy: 0,
        edges: edgeCount.get(p) || 0,
      });
      idx++;
    }

    if (nodeMap.size === 0) return;
    const nodes = Array.from(nodeMap.values());
    const N = nodes.length;

    const isDark = theme.value === 'dark';
    const colors = {
      node: isDark ? '#58a6ff' : '#0969da',
      nodeActive: isDark ? '#f0883e' : '#cf222e',
      nodeOrphan: isDark ? '#484f58' : '#afb8c1',
      edge: isDark ? 'rgba(88,166,255,0.3)' : 'rgba(9,105,218,0.3)',
      text: isDark ? '#c9d1d9' : '#1f2328',
      textDim: isDark ? '#6e7681' : '#656d76',
    };

    // Camera
    let camX = 0, camY = 0, zoom = 1;
    const fitZoom = Math.min(W, H) / (spreadRadius * 2.5);
    zoom = Math.max(0.15, Math.min(fitZoom, 1.5));

    let animFrame: number;
    let dragging: Node | null = null;
    let panning = false;
    let panStartX = 0, panStartY = 0, camStartX = 0, camStartY = 0;
    let tick = 0;
    const MAX_TICKS = 300;
    let settled = false;
    let needsRedraw = true;

    // Simulation params scaled to node count
    const repBase = Math.max(500, count * 8);
    const idealDist = Math.max(80, Math.sqrt(count) * 15);
    // Distance cutoff: skip repulsion for nodes farther than this
    const cutoffDist = idealDist * 4;
    const cutoffSq = cutoffDist * cutoffDist;

    function simulate() {
      if (settled) return;
      tick++;
      const alpha = Math.max(0.005, 1 - tick / MAX_TICKS);
      if (tick > MAX_TICKS) { settled = true; return; }

      const repStr = repBase * alpha;
      const attStr = 0.04 * alpha;

      // Repulsion with distance cutoff
      for (let i = 0; i < N; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < N; j++) {
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy;
          if (distSq > cutoffSq) continue; // skip far pairs
          const dist = Math.sqrt(Math.max(distSq, 400));
          const f = repStr / (dist * dist);
          const fx = (dx / dist) * f;
          const fy = (dy / dist) * f;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }

      // Attraction (edges)
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const a = nodeMap.get(e.source)!;
        const b = nodeMap.get(e.target)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (dist - idealDist) * attStr;
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }

      // Gentle center gravity
      const grav = 0.001 * alpha;
      for (let i = 0; i < N; i++) {
        const nd = nodes[i];
        nd.vx -= nd.x * grav;
        nd.vy -= nd.y * grav;
      }

      // Apply velocity
      for (let i = 0; i < N; i++) {
        const nd = nodes[i];
        if (nd === dragging) continue;
        nd.vx *= 0.82;
        nd.vy *= 0.82;
        const spd = Math.sqrt(nd.vx * nd.vx + nd.vy * nd.vy);
        if (spd > 10) { nd.vx = (nd.vx / spd) * 10; nd.vy = (nd.vy / spd) * 10; }
        nd.x += nd.vx;
        nd.y += nd.vy;
      }
      needsRedraw = true;
    }

    function draw() {
      if (!needsRedraw) return;
      needsRedraw = false;

      ctx.clearRect(0, 0, W, H);

      // Edges
      ctx.strokeStyle = colors.edge;
      ctx.lineWidth = Math.max(0.5, zoom);
      ctx.beginPath();
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const a = nodeMap.get(e.source)!;
        const b = nodeMap.get(e.target)!;
        const ax = (a.x - camX) * zoom + HW;
        const ay = (a.y - camY) * zoom + HH;
        const bx = (b.x - camX) * zoom + HW;
        const by = (b.y - camY) * zoom + HH;
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();

      // Nodes
      const active = currentFilePath.value;
      const showLabels = zoom > 0.4;
      const showAllLabels = zoom > 1;

      for (let i = 0; i < N; i++) {
        const nd = nodes[i];
        const sx = (nd.x - camX) * zoom + HW;
        const sy = (nd.y - camY) * zoom + HH;
        if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) continue;

        const isActive = nd.id === active;
        const hasEdge = nd.edges > 0;
        const baseR = isActive ? 7 : hasEdge ? Math.min(3 + nd.edges, 8) : 2.5;
        const r = Math.max(baseR * zoom, 1.5);

        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, 6.283);
        ctx.fillStyle = isActive ? colors.nodeActive : hasEdge ? colors.node : colors.nodeOrphan;
        ctx.fill();

        if (showLabels && (isActive || hasEdge) || showAllLabels) {
          const fs = Math.max(8, (isActive ? 12 : 10) * zoom);
          ctx.font = `${isActive ? 'bold ' : ''}${fs}px system-ui`;
          ctx.fillStyle = isActive || hasEdge ? colors.text : colors.textDim;
          ctx.textAlign = 'center';
          ctx.fillText(nd.label, sx, sy + r + fs + 2);
        }
      }

      // Zoom indicator
      ctx.fillStyle = colors.textDim;
      ctx.font = '11px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`${Math.round(zoom * 100)}%`, 12, H - 12);
    }

    function loop() {
      simulate();
      draw();
      animFrame = requestAnimationFrame(loop);
    }
    loop();

    // --- Interaction ---

    function reheat() {
      settled = false;
      tick = Math.min(tick, MAX_TICKS - 80);
      needsRedraw = true;
    }

    function getNodeAt(sx: number, sy: number): Node | null {
      const wx = (sx - HW) / zoom + camX;
      const wy = (sy - HH) / zoom + camY;
      const hitR = 15 / zoom;
      const hitSq = hitR * hitR;
      for (let i = 0; i < N; i++) {
        const dx = nodes[i].x - wx;
        const dy = nodes[i].y - wy;
        if (dx * dx + dy * dy < hitSq) return nodes[i];
      }
      return null;
    }

    function onMouseDown(e: MouseEvent) {
      const r = canvas!.getBoundingClientRect();
      const node = getNodeAt(e.clientX - r.left, e.clientY - r.top);
      if (node) {
        dragging = node;
        reheat();
      } else {
        panning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        camStartX = camX;
        camStartY = camY;
      }
    }

    function onMouseMove(e: MouseEvent) {
      if (dragging) {
        const r = canvas!.getBoundingClientRect();
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        dragging.x = (sx - HW) / zoom + camX;
        dragging.y = (sy - HH) / zoom + camY;
        dragging.vx = 0;
        dragging.vy = 0;
        needsRedraw = true;
      } else if (panning) {
        camX = camStartX - (e.clientX - panStartX) / zoom;
        camY = camStartY - (e.clientY - panStartY) / zoom;
        needsRedraw = true;
      }
    }

    function onMouseUp() { dragging = null; panning = false; }

    function onClick(e: MouseEvent) {
      if (panning) return;
      const r = canvas!.getBoundingClientRect();
      const node = getNodeAt(e.clientX - r.left, e.clientY - r.top);
      if (node) {
        graphOpen.value = false;
        onNavigate(node.id);
      }
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const r = canvas!.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const wx = (mx - HW) / zoom + camX;
      const wy = (my - HH) / zoom + camY;
      const raw = -e.deltaY * 0.001;
      const step = Math.max(-0.05, Math.min(raw, 0.05));
      zoom = Math.max(0.15, Math.min(zoom * (1 + step), 3));
      camX = wx - (mx - HW) / zoom;
      camY = wy - (my - HH) / zoom;
      needsRedraw = true;
    }

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(animFrame);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [theme.value]);

  return (
    <div class="graph-overlay">
      <div class="graph-container">
        <div class="graph-header">
          <span>{str.title}</span>
          <button class="toolbar-btn" onClick={() => { graphOpen.value = false; }}>×</button>
        </div>
        <canvas ref={canvasRef} class="graph-canvas" />
      </div>
    </div>
  );
}
