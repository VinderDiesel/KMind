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
import { relationColor } from './relationColors';

/** Hop shell palette — matches legend for quick reading. */
const HOP_COLOR = {
  0: '#5eead4',
  1: '#e8b86d',
  2: '#7a8b9e',
} as const;

/** Type colors for global mode (problem gets weak emphasis). */
const TYPE_COLOR: Record<string, string> = {
  problem: '#f0a060',
  outcome: '#6bcb8e',
  problem_solution: '#5eb0e8',
  best_practice: '#5eead4',
  architecture_design: '#c4a5f5',
  tool_usage: '#7a8b9e',
  pitfall: '#e8b86d',
  code_snippet: '#8ab4f8',
  process_spec: '#9aa8b8',
};

const PROBLEM_COLOR = '#f0a060';
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

export type GraphViewMode = 'ego' | 'global';

interface GraphViewProps {
  graph: EgoGraph;
  mode?: GraphViewMode;
  onSelect: (id: string) => void;
}

/**
 * 3D force graph: ego hop shells, or global type-colored layout.
 */
export function GraphView({
  graph,
  mode = 'ego',
  onSelect,
}: GraphViewProps) {
  const fgRef = useRef<
    ForceGraphMethods<NodeObject<GraphNode>, GraphLink> | undefined
  >(undefined);
  const isGlobal = mode === 'global';

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

  const makeNode = useCallback(
    (n: NodeObject<GraphNode>): Object3D => {
      return createGlowingNode(n as GraphNode, isGlobal);
    },
    [isGlobal],
  );

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    const charge = fg.d3Force('charge') as
      | { strength?: (n: number) => void }
      | undefined;
    charge?.strength?.(isGlobal ? -80 : -110);

    if (!isGlobal && graph.focusId) {
      fg.d3Force('radial', createRadialForce(graph.focusId, graph.nodes));
    } else {
      fg.d3Force('radial', null);
    }

    const linkForce = fg.d3Force('link') as
      | { distance?: (fn: (l: GraphLink) => number) => void }
      | undefined;
    linkForce?.distance?.((l) => {
      if (isGlobal) return 48;
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
  }, [graph, hopOf, fit, isGlobal]);

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
        const anchors =
          node.hasCodeAnchors && (node.codeAnchorCount ?? 0) > 0
            ? `\n⌘ ${node.codeAnchorCount} code anchors`
            : '';
        const hopLine = isGlobal ? node.type : `${node.type} · hop ${node.hop}`;
        const problem =
          node.type === 'problem' ? '\n◆ open problem' : '';
        return `${short}\n${hopLine}${
          node.hasHealthIssue ? '\n⚠ health' : ''
        }${problem}${anchors}`;
      }}
      linkColor={(l) =>
        isGlobal
          ? 'rgba(122,139,158,0.35)'
          : relationLinkColor(l as GraphLink, hopOf)
      }
      linkWidth={(l) => {
        if (isGlobal) return 0.7;
        const link = l as GraphLink;
        const hop = linkHop(link, hopOf);
        const typed = link.relationType && link.relationType !== 'related_to';
        if (hop <= 1 && typed) return 1.6;
        if (hop <= 1) return 1.2;
        return 0.45;
      }}
      linkOpacity={0.85}
      linkLabel={(l) => (l as GraphLink).relationType || 'related_to'}
      linkDirectionalParticles={(l) =>
        isGlobal ? 0 : linkHop(l as GraphLink, hopOf) <= 1 ? 2 : 0
      }
      linkDirectionalParticleWidth={1.1}
      linkDirectionalParticleSpeed={0.004}
      linkDirectionalParticleColor={(l) =>
        relationColor((l as GraphLink).relationType || 'related_to', 0.9)
      }
      onNodeClick={(n) => onSelect((n as GraphNode).id)}
      onEngineStop={fit}
      cooldownTicks={110}
      warmupTicks={36}
    />
  );
}

/** Build a core sphere + additive halo shell + soft bloom sprite. */
function createGlowingNode(node: GraphNode, isGlobal: boolean): Object3D {
  const hex = colorFor(node, isGlobal);
  const radius = radiusFor(node, isGlobal);
  const group = new Group();

  const core = new Mesh(
    sphereGeometry(radius, 48),
    new MeshBasicMaterial({ color: hex }),
  );
  group.add(core);

  const isProblem = node.type === 'problem';
  const glowMul = isGlobal
    ? isProblem
      ? 4.2
      : 2.8
    : node.hop === 0
      ? 5.2
      : node.hop === 1
        ? 3.6
        : 2.6;
  const glowOpacity = isGlobal
    ? isProblem
      ? 0.85
      : 0.45
    : node.hop === 0
      ? 1
      : node.hop === 1
        ? 0.72
        : 0.4;
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

  if (node.hasCodeAnchors) {
    const codeBloom = new Sprite(
      new SpriteMaterial({
        map: glowTexture('#8ab4f8'),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        opacity: 0.55,
      }),
    );
    codeBloom.scale.set(radius * (glowMul + 1.4), radius * (glowMul + 1.4), 1);
    group.add(codeBloom);
  }

  return group;
}

function colorFor(node: GraphNode, isGlobal: boolean): string {
  if (node.hasHealthIssue) return '#f07178';
  if (node.type === 'problem') return PROBLEM_COLOR;
  if (isGlobal) return TYPE_COLOR[node.type] ?? HOP_COLOR[2];
  if (node.hop === 0) return HOP_COLOR[0];
  if (node.hop === 1) return HOP_COLOR[1];
  return HOP_COLOR[2];
}

function nodeVal(node: GraphNode, isGlobal: boolean): number {
  if (isGlobal) {
    if (node.type === 'problem') return 14;
    return 7;
  }
  if (node.hop === 0) return 22;
  if (node.hop === 1) return 9;
  return Math.max(3.2, 5.2 - node.hop * 0.4);
}

/** Match three-forcegraph radius: cbrt(val) * nodeRelSize. */
function radiusFor(node: GraphNode, isGlobal: boolean): number {
  return Math.cbrt(nodeVal(node, isGlobal)) * NODE_REL_SIZE;
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

/** Prefer relation-type color; dim by hop so far shells stay quiet. */
function relationLinkColor(
  link: GraphLink,
  hopOf: Map<string, number>,
): string {
  const hop = linkHop(link, hopOf);
  const rel = link.relationType || 'related_to';
  if (hop >= 2) return relationColor(rel, 0.22);
  if (hop === 1) return relationColor(rel, 0.55);
  return relationColor(rel, 0.85);
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
