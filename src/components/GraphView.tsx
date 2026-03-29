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
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

    // Build nodes — spread in a large circle proportional to count
    const nodeMap = new Map<string, Node>();
    const n = paths.length;
    const spreadRadius = Math.max(200, Math.sqrt(n) * 60);
    let idx = 0;
    for (const p of paths) {
      const angle = (idx / n) * Math.PI * 2;
      const jitter = (Math.random() - 0.5) * 40;
      nodeMap.set(p, {
        id: p,
        label: p.split('/').pop()?.replace(/\.md$/, '') || p,
        x: Math.cos(angle) * spreadRadius + jitter,
        y: Math.sin(angle) * spreadRadius + jitter,
        vx: 0, vy: 0,
        edges: edgeCount.get(p) || 0,
      });
      idx++;
    }

    if (nodeMap.size === 0) return;
    const nodes = Array.from(nodeMap.values());

    const isDark = theme.value === 'dark';
    const colors = {
      node: isDark ? '#58a6ff' : '#0969da',
      nodeActive: isDark ? '#f0883e' : '#cf222e',
      nodeOrphan: isDark ? '#484f58' : '#afb8c1',
      edge: isDark ? 'rgba(88,166,255,0.3)' : 'rgba(9,105,218,0.3)',
      text: isDark ? '#c9d1d9' : '#1f2328',
      textDim: isDark ? '#6e7681' : '#656d76',
    };

    // Camera state
    let camX = 0, camY = 0, zoom = 1;
    // Auto-fit zoom to contain all nodes
    const fitZoom = Math.min(canvas.width, canvas.height) / (spreadRadius * 2.5);
    zoom = Math.max(0.1, Math.min(fitZoom, 1.5));

    let animFrame: number;
    let dragging: Node | null = null;
    let panning = false;
    let panStartX = 0, panStartY = 0, camStartX = 0, camStartY = 0;
    let tick = 0;
    const MAX_TICKS = 400;

    // Simulation tuned to node count
    const repBase = Math.max(500, n * 8);
    const idealDist = Math.max(80, Math.sqrt(n) * 15);

    function simulate() {
      tick++;
      const alpha = Math.max(0.005, 1 - tick / MAX_TICKS);

      // Repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy;
          const dist = Math.sqrt(Math.max(distSq, 400)); // min 20px
          const force = (repBase * alpha) / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }

      // Attraction (edges)
      for (const e of edges) {
        const a = nodeMap.get(e.source)!;
        const b = nodeMap.get(e.target)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - idealDist) * 0.04 * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }

      // Gentle center gravity
      for (const nd of nodes) {
        nd.vx -= nd.x * 0.001 * alpha;
        nd.vy -= nd.y * 0.001 * alpha;
      }

      // Apply velocity
      const maxV = 10;
      for (const nd of nodes) {
        if (nd === dragging) continue;
        nd.vx *= 0.82;
        nd.vy *= 0.82;
        const spd = Math.sqrt(nd.vx * nd.vx + nd.vy * nd.vy);
        if (spd > maxV) { nd.vx = (nd.vx / spd) * maxV; nd.vy = (nd.vy / spd) * maxV; }
        nd.x += nd.vx;
        nd.y += nd.vy;
      }
    }

    // World → screen transform
    function toScreen(wx: number, wy: number): [number, number] {
      return [
        (wx - camX) * zoom + canvas!.width / 2,
        (wy - camY) * zoom + canvas!.height / 2,
      ];
    }
    // Screen → world
    function toWorld(sx: number, sy: number): [number, number] {
      return [
        (sx - canvas!.width / 2) / zoom + camX,
        (sy - canvas!.height / 2) / zoom + camY,
      ];
    }

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      // Edges
      ctx!.lineWidth = Math.max(0.5, zoom);
      ctx!.strokeStyle = colors.edge;
      for (const e of edges) {
        const a = nodeMap.get(e.source)!;
        const b = nodeMap.get(e.target)!;
        const [ax, ay] = toScreen(a.x, a.y);
        const [bx, by] = toScreen(b.x, b.y);
        ctx!.beginPath();
        ctx!.moveTo(ax, ay);
        ctx!.lineTo(bx, by);
        ctx!.stroke();
      }

      // Nodes
      const active = currentFilePath.value;
      for (const nd of nodes) {
        const [sx, sy] = toScreen(nd.x, nd.y);
        // Cull off-screen
        if (sx < -50 || sx > canvas!.width + 50 || sy < -50 || sy > canvas!.height + 50) continue;

        const isActive = nd.id === active;
        const hasEdge = nd.edges > 0;
        const baseR = isActive ? 7 : hasEdge ? Math.min(3 + nd.edges, 8) : 2.5;
        const r = baseR * zoom;

        ctx!.beginPath();
        ctx!.arc(sx, sy, Math.max(r, 1.5), 0, Math.PI * 2);
        ctx!.fillStyle = isActive ? colors.nodeActive : hasEdge ? colors.node : colors.nodeOrphan;
        ctx!.fill();

        // Labels — show when zoomed in enough or for active/connected nodes
        const showLabel = zoom > 0.4 && (isActive || hasEdge);
        const showAllLabels = zoom > 1;
        if (showLabel || showAllLabels) {
          const fontSize = Math.max(8, (isActive ? 12 : 10) * zoom);
          ctx!.font = `${isActive ? 'bold ' : ''}${fontSize}px system-ui`;
          ctx!.fillStyle = isActive || hasEdge ? colors.text : colors.textDim;
          ctx!.textAlign = 'center';
          ctx!.fillText(nd.label, sx, sy + Math.max(r, 1.5) + fontSize + 2);
        }
      }

      // Zoom indicator
      ctx!.fillStyle = colors.textDim;
      ctx!.font = '11px system-ui';
      ctx!.textAlign = 'left';
      ctx!.fillText(`${Math.round(zoom * 100)}%`, 12, canvas!.height - 12);
    }

    function loop() {
      simulate();
      draw();
      animFrame = requestAnimationFrame(loop);
    }
    loop();

    // --- Interaction ---

    function getNodeAt(sx: number, sy: number): Node | null {
      const [wx, wy] = toWorld(sx, sy);
      const hitR = 15 / zoom;
      for (const nd of nodes) {
        const dx = nd.x - wx;
        const dy = nd.y - wy;
        if (dx * dx + dy * dy < hitR * hitR) return nd;
      }
      return null;
    }

    function onMouseDown(e: MouseEvent) {
      const r = canvas!.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const node = getNodeAt(sx, sy);
      if (node) {
        dragging = node;
        tick = Math.min(tick, MAX_TICKS - 100); // Reheat a bit
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
        const [wx, wy] = toWorld(e.clientX - r.left, e.clientY - r.top);
        dragging.x = wx;
        dragging.y = wy;
        dragging.vx = 0;
        dragging.vy = 0;
      } else if (panning) {
        const dx = (e.clientX - panStartX) / zoom;
        const dy = (e.clientY - panStartY) / zoom;
        camX = camStartX - dx;
        camY = camStartY - dy;
      }
    }

    function onMouseUp() {
      dragging = null;
      panning = false;
    }

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
      // Zoom toward mouse position
      const [wx, wy] = toWorld(mx, my);
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoom = Math.max(0.05, Math.min(zoom * factor, 5));
      // Adjust camera so world point under cursor stays fixed
      camX = wx - (mx - canvas!.width / 2) / zoom;
      camY = wy - (my - canvas!.height / 2) / zoom;
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
