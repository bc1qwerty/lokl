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

    // Build nodes
    const nodeMap = new Map<string, Node>();
    for (const p of paths) {
      nodeMap.set(p, {
        id: p,
        label: p.split('/').pop()?.replace(/\.md$/, '') || p,
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: 0,
        vy: 0,
      });
    }

    // Build edges
    const edges: Edge[] = [];
    for (const [source, targets] of links) {
      for (const target of targets) {
        if (nodeMap.has(source) && nodeMap.has(target)) {
          edges.push({ source, target });
        }
      }
    }

    if (nodeMap.size === 0) return;

    const nodes = Array.from(nodeMap.values());
    const isDark = theme.value === 'dark';
    const colors = {
      bg: isDark ? '#0d1117' : '#ffffff',
      node: isDark ? '#58a6ff' : '#0969da',
      nodeActive: isDark ? '#f0883e' : '#cf222e',
      edge: isDark ? 'rgba(88,166,255,0.15)' : 'rgba(9,105,218,0.15)',
      text: isDark ? '#8b949e' : '#656d76',
    };

    let animFrame: number;
    let dragging: Node | null = null;

    function resize() {
      const rect = canvas!.parentElement!.getBoundingClientRect();
      canvas!.width = rect.width;
      canvas!.height = rect.height;
    }
    resize();

    // Re-center nodes
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    for (const n of nodes) {
      n.x = cx + (Math.random() - 0.5) * Math.min(canvas.width, 600);
      n.y = cy + (Math.random() - 0.5) * Math.min(canvas.height, 400);
    }

    function simulate() {
      // Repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 800 / (dist * dist);
          dx = (dx / dist) * force;
          dy = (dy / dist) * force;
          a.vx -= dx; a.vy -= dy;
          b.vx += dx; b.vy += dy;
        }
      }

      // Attraction (edges)
      for (const e of edges) {
        const a = nodeMap.get(e.source)!;
        const b = nodeMap.get(e.target)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 100) * 0.01;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }

      // Center gravity
      for (const n of nodes) {
        n.vx += (cx - n.x) * 0.001;
        n.vy += (cy - n.y) * 0.001;
      }

      // Apply velocity
      for (const n of nodes) {
        if (n === dragging) continue;
        n.vx *= 0.9;
        n.vy *= 0.9;
        n.x += n.vx;
        n.y += n.vy;
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      // Edges
      ctx!.strokeStyle = colors.edge;
      ctx!.lineWidth = 1;
      for (const e of edges) {
        const a = nodeMap.get(e.source)!;
        const b = nodeMap.get(e.target)!;
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
      }

      // Nodes
      const active = currentFilePath.value;
      for (const n of nodes) {
        const isActive = n.id === active;
        const hasEdge = edges.some((e) => e.source === n.id || e.target === n.id);
        const r = isActive ? 6 : hasEdge ? 4 : 3;

        ctx!.beginPath();
        ctx!.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx!.fillStyle = isActive ? colors.nodeActive : colors.node;
        ctx!.fill();

        // Label (only for connected or active nodes)
        if (isActive || hasEdge) {
          ctx!.font = `${isActive ? 12 : 10}px system-ui`;
          ctx!.fillStyle = colors.text;
          ctx!.textAlign = 'center';
          ctx!.fillText(n.label, n.x, n.y + r + 12);
        }
      }
    }

    function loop() {
      simulate();
      draw();
      animFrame = requestAnimationFrame(loop);
    }
    loop();

    // Mouse interaction
    function getNode(mx: number, my: number): Node | null {
      for (const n of nodes) {
        const dx = n.x - mx;
        const dy = n.y - my;
        if (dx * dx + dy * dy < 200) return n;
      }
      return null;
    }

    function onMouseDown(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      dragging = getNode(e.clientX - rect.left, e.clientY - rect.top);
    }
    function onMouseMove(e: MouseEvent) {
      if (!dragging) return;
      const rect = canvas!.getBoundingClientRect();
      dragging.x = e.clientX - rect.left;
      dragging.y = e.clientY - rect.top;
      dragging.vx = 0;
      dragging.vy = 0;
    }
    function onMouseUp() { dragging = null; }
    function onClick(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const node = getNode(e.clientX - rect.left, e.clientY - rect.top);
      if (node) {
        graphOpen.value = false;
        onNavigate(node.id);
      }
    }

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('click', onClick);

    return () => {
      cancelAnimationFrame(animFrame);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('click', onClick);
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
