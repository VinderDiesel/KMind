import { useCallback, useEffect, useMemo, useRef } from 'react';
import ForceGraph3D, {
  type ForceGraphMethods,
  type NodeObject,
} from 'react-force-graph-3d';
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Object3D,
} from 'three';
import type { EgoGraph, EgoNode } from './api';

/** Hop shell palette — matches legend for quick reading. */
const HOP_COLOR = {
  0: '#5eead4',
  1: '#e8b86d',
  2: '#7a8b9e',
} as const;

const NODE_REL_SIZE = 4.5;
const glowTexCache = new Map<string, CanvasTexture>();
const sphereGeoCache = new Map<string, SphereGeometry>();

interface GraphNode extends EgoNode {
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relationType: string;
}

interface GraphViewProps {
  graph: EgoGraph;
  onSelect: (id: string) => void;
}

/**
 * 3D ego force graph with smooth glowing spheres and hop-shell coloring.
 */
export function GraphView({ graph, onSelect }: GraphViewProps) {
  const fgRef = useRef<
    ForceGraphMethods<NodeObject<GraphNode>, GraphLink> | undefined
  >(undefined);

  const hopOf = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n.hop])),
    [graph.nodes],
  );

  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })) as GraphNode[],
      links: graph.links.map((l) => ({
        source: l.source,
        target: l.target,
        relationType: l.relationType,
      })),
    }),
    [graph],
  );

  const fit = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    try {
      fg.zoomToFit(600, 100);
    } catch {
      /* layout not ready */
    }
  }, []);

  const makeNode = useCallback((n: NodeObject<GraphNode>): Object3D => {
    return createGlowingNode(n as GraphNode);
  }, []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    const charge = fg.d3Force('charge') as
      | { strength?: (n: number) => void }
      | undefined;
    charge?.strength?.(-110);

    fg.d3Force('radial', createRadialForce(graph.focusId, graph.nodes));

    const linkForce = fg.d3Force('link') as
      | { distance?: (fn: (l: GraphLink) => number) => void }
      | undefined;
    linkForce?.distance?.((l) => {
      const hop = Math.max(
        hopOf.get(resolveId(l.source)) ?? 1,
        hopOf.get(resolveId(l.target)) ?? 1,
      );
      return 32 + hop * 24;
    });

    const t1 = window.setTimeout(fit, 300);
    const t2 = window.setTimeout(fit, 900);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [graph, hopOf, fit]);

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={data}
      backgroundColor="rgba(0,0,0,0)"
      showNavInfo={false}
      nodeRelSize={NODE_REL_SIZE}
      nodeThreeObject={makeNode}
      nodeThreeObjectExtend={false}
      nodeLabel={(n) => {
        const node = n as GraphNode;
        const short =
          node.title.length > 32 ? `${node.title.slice(0, 31)}…` : node.title;
        return `${short}\n${node.type} · hop ${node.hop}${
          node.hasHealthIssue ? '\n⚠ health' : ''
        }`;
      }}
      linkColor={(l) => linkTone(l as GraphLink, hopOf)}
      linkWidth={(l) => (linkHop(l as GraphLink, hopOf) <= 1 ? 1.35 : 0.45)}
      linkOpacity={0.8}
      linkDirectionalParticles={(l) =>
        linkHop(l as GraphLink, hopOf) <= 1 ? 2 : 0
      }
      linkDirectionalParticleWidth={1.1}
      linkDirectionalParticleSpeed={0.004}
      linkDirectionalParticleColor={() => 'rgba(94,234,212,0.85)'}
      onNodeClick={(n) => onSelect((n as GraphNode).id)}
      onEngineStop={fit}
      cooldownTicks={110}
      warmupTicks={36}
    />
  );
}

/** Build a core sphere + additive halo shell + soft bloom sprite. */
function createGlowingNode(node: GraphNode): Object3D {
  const hex = colorFor(node);
  const radius = radiusFor(node);
  const group = new Group();

  const core = new Mesh(
    sphereGeometry(radius, 48),
    new MeshBasicMaterial({ color: hex }),
  );
  group.add(core);

  const glowMul = node.hop === 0 ? 5.2 : node.hop === 1 ? 3.6 : 2.6;
  const glowOpacity = node.hop === 0 ? 1 : node.hop === 1 ? 0.72 : 0.4;
  const bloom = new Sprite(
    new SpriteMaterial({
      map: glowTexture(hex),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      opacity: glowOpacity,
    }),
  );
  bloom.scale.set(radius * glowMul, radius * glowMul, 1);
  group.add(bloom);

  return group;
}

function colorFor(node: GraphNode): string {
  if (node.hasHealthIssue) return '#f07178';
  if (node.hop === 0) return HOP_COLOR[0];
  if (node.hop === 1) return HOP_COLOR[1];
  return HOP_COLOR[2];
}

function nodeVal(node: GraphNode): number {
  if (node.hop === 0) return 22;
  if (node.hop === 1) return 9;
  return Math.max(3.2, 5.2 - node.hop * 0.4);
}

/** Match three-forcegraph radius: cbrt(val) * nodeRelSize. */
function radiusFor(node: GraphNode): number {
  return Math.cbrt(nodeVal(node)) * NODE_REL_SIZE;
}

function sphereGeometry(radius: number, segments: number): SphereGeometry {
  const key = `${radius.toFixed(3)}:${segments}`;
  let geo = sphereGeoCache.get(key);
  if (!geo) {
    geo = new SphereGeometry(radius, segments, segments);
    sphereGeoCache.set(key, geo);
  }
  return geo;
}

function glowTexture(hex: string): CanvasTexture {
  const cached = glowTexCache.get(hex);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const empty = new CanvasTexture(canvas);
    glowTexCache.set(hex, empty);
    return empty;
  }

  const { r, g, b } = new Color(hex);
  const mid = size / 2;
  const grad = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  grad.addColorStop(0, `rgba(${toByte(r)},${toByte(g)},${toByte(b)},1)`);
  grad.addColorStop(0.25, `rgba(${toByte(r)},${toByte(g)},${toByte(b)},0.55)`);
  grad.addColorStop(0.55, `rgba(${toByte(r)},${toByte(g)},${toByte(b)},0.18)`);
  grad.addColorStop(1, `rgba(${toByte(r)},${toByte(g)},${toByte(b)},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  glowTexCache.set(hex, tex);
  return tex;
}

function toByte(channel: number): number {
  return Math.round(channel * 255);
}

function linkHop(link: GraphLink, hopOf: Map<string, number>): number {
  const a = hopOf.get(resolveId(link.source)) ?? 1;
  const b = hopOf.get(resolveId(link.target)) ?? 1;
  return Math.min(a, b);
}

function linkTone(link: GraphLink, hopOf: Map<string, number>): string {
  const hop = linkHop(link, hopOf);
  if (hop === 0) return 'rgba(94,234,212,0.75)';
  if (hop === 1) return 'rgba(232,184,109,0.45)';
  return 'rgba(122,139,158,0.22)';
}

function resolveId(ref: string | GraphNode): string {
  return typeof ref === 'string' ? ref : ref.id;
}

function createRadialForce(focusId: string, nodes: EgoNode[]) {
  const hopMap = new Map(nodes.map((n) => [n.id, n.hop]));
  let sim: GraphNode[] = [];

  function force(alpha: number) {
    for (const node of sim) {
      const hop = hopMap.get(node.id) ?? 1;
      const targetR = hop === 0 ? 0 : hop === 1 ? 52 : 52 + (hop - 1) * 56;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const z = node.z ?? 0;
      const r = Math.hypot(x, y, z) || 0.001;
      const k = ((targetR - r) / r) * alpha * 0.45;
      node.vx = (node.vx ?? 0) + x * k;
      node.vy = (node.vy ?? 0) + y * k;
      node.vz = (node.vz ?? 0) + z * k;
      if (node.id === focusId) {
        node.vx = (node.vx ?? 0) - x * alpha;
        node.vy = (node.vy ?? 0) - y * alpha;
        node.vz = (node.vz ?? 0) - z * alpha;
      }
    }
  }
  force.initialize = (n: GraphNode[]) => {
    sim = n;
  };
  return force;
}
