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

    // Build edges first (to count connections)
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

    // Build nodes
    const nodeMap = new Map<string, Node>();

    // Resize canvas
    const rect = canvas.parentElement!.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Place nodes in a circle for stable initial layout
    const radius = Math.min(canvas.width, canvas.height) * 0.3;
    let i = 0;
    for (const p of paths) {
      const angle = (i / paths.length) * Math.PI * 2;
      nodeMap.set(p, {
        id: p,
        label: p.split('/').pop()?.replace(/\.md$/, '') || p,
        x: cx + Math.cos(angle) * radius + (Math.random() - 0.5) * 20,
        y: cy + Math.sin(angle) * radius + (Math.random() - 0.5) * 20,
        vx: 0,
        vy: 0,
        edges: edgeCount.get(p) || 0,
      });
      i++;
    }

    if (nodeMap.size === 0) return;

    const nodes = Array.from(nodeMap.values());
    const isDark = theme.value === 'dark';
    const colors = {
      node: isDark ? '#58a6ff' : '#0969da',
      nodeActive: isDark ? '#f0883e' : '#cf222e',
      nodeOrphan: isDark ? '#30363d' : '#d0d7de',
      edge: isDark ? 'rgba(88,166,255,0.25)' : 'rgba(9,105,218,0.25)',
      text: isDark ? '#8b949e' : '#656d76',
    };

    let animFrame: number;
    let dragging: Node | null = null;
    let tick = 0;
    const MAX_TICKS = 300; // Simulation cools down after this

    function simulate() {
      tick++;
      // Cooling: alpha decreases over time, simulation stabilizes
      const alpha = Math.max(0.01, 1 - tick / MAX_TICKS);
      const repulsionStrength = 200 * alpha;
      const attractionStrength = 0.03 * alpha;
      const gravityStrength = 0.005;
      const maxVelocity = 8;
      const damping = 0.85;

      // Repulsion (only between nearby nodes for performance)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy;
          const minDist = 30;
          const dist = Math.sqrt(Math.max(distSq, minDist * minDist));
          const force = repulsionStrength / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }

      // Attraction (edges)
      const idealDist = 120;
      for (const e of edges) {
        const a = nodeMap.get(e.source)!;
        const b = nodeMap.get(e.target)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - idealDist) * attractionStrength;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }

      // Center gravity
      for (const n of nodes) {
        n.vx += (cx - n.x) * gravityStrength;
        n.vy += (cy - n.y) * gravityStrength;
      }

      // Apply velocity with damping and clamping
      for (const n of nodes) {
        if (n === dragging) continue;
        n.vx *= damping;
        n.vy *= damping;
        // Clamp velocity
        const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        if (speed > maxVelocity) {
          n.vx = (n.vx / speed) * maxVelocity;
          n.vy = (n.vy / speed) * maxVelocity;
        }
        n.x += n.vx;
        n.y += n.vy;
        // Keep in bounds
        n.x = Math.max(20, Math.min(canvas!.width - 20, n.x));
        n.y = Math.max(20, Math.min(canvas!.height - 20, n.y));
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      // Edges
      ctx!.lineWidth = 1;
      for (const e of edges) {
        const a = nodeMap.get(e.source)!;
        const b = nodeMap.get(e.target)!;
        ctx!.strokeStyle = colors.edge;
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
      }

      // Nodes
      const active = currentFilePath.value;
      for (const n of nodes) {
        const isActive = n.id === active;
        const hasEdge = n.edges > 0;
        const r = isActive ? 7 : hasEdge ? Math.min(3 + n.edges, 8) : 2.5;

        ctx!.beginPath();
        ctx!.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx!.fillStyle = isActive ? colors.nodeActive : hasEdge ? colors.node : colors.nodeOrphan;
        ctx!.fill();

        // Label
        if (isActive || hasEdge) {
          ctx!.font = `${isActive ? 11 : 9}px system-ui`;
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
      const r = canvas!.getBoundingClientRect();
      const node = getNode(e.clientX - r.left, e.clientY - r.top);
      if (node) {
        dragging = node;
        tick = 0; // Reheat simulation when dragging
      }
    }
    function onMouseMove(e: MouseEvent) {
      if (!dragging) return;
      const r = canvas!.getBoundingClientRect();
      dragging.x = e.clientX - r.left;
      dragging.y = e.clientY - r.top;
      dragging.vx = 0;
      dragging.vy = 0;
    }
    function onMouseUp() { dragging = null; }
    function onClick(e: MouseEvent) {
      const r = canvas!.getBoundingClientRect();
      const node = getNode(e.clientX - r.left, e.clientY - r.top);
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
