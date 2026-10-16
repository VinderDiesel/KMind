import { useEffect, useMemo, useRef } from 'react';
import ForceGraph3D, {
  type ForceGraphMethods,
  type NodeObject,
} from 'react-force-graph-3d';
import type { EgoGraph, EgoNode } from './api';

const TYPE_COLOR: Record<string, string> = {
  problem_solution: '#4fd1c5',
  best_practice: '#7dd3c7',
  architecture_design: '#e8b86d',
  tool_usage: '#8ab4f8',
  pitfall: '#f07178',
  code_snippet: '#b8a4e8',
  process_spec: '#9aa7b8',
};

interface GraphNode extends EgoNode {
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

interface GraphViewProps {
  graph: EgoGraph;
  onSelect: (id: string) => void;
}

/**
 * 3D ego force graph with hop-shell radial bias.
 */
export function GraphView({ graph, onSelect }: GraphViewProps) {
  const fgRef = useRef<
    | ForceGraphMethods<
        NodeObject<GraphNode>,
        { source: string; target: string; relationType: string }
      >
    | undefined
  >(undefined);
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

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force('charge') as
      | { strength?: (n: number) => void }
      | undefined;
    charge?.strength?.(-52);
    fg.d3Force('radial', createRadialForce(graph.focusId, graph.nodes));
    const t = window.setTimeout(() => {
      fg.zoomToFit(700, 90);
    }, 450);
    return () => window.clearTimeout(t);
  }, [graph]);

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={data}
      backgroundColor="rgba(0,0,0,0)"
      showNavInfo={false}
      nodeLabel={(n) => {
        const node = n as GraphNode;
        return `${node.title}\n${node.type} · hop ${node.hop}${
          node.hasHealthIssue ? '\n⚠ health' : ''
        }`;
      }}
      nodeVal={(n) => {
        const node = n as GraphNode;
        if (node.hop === 0) return 9;
        return Math.max(2.2, 6.5 - node.hop * 1.4);
      }}
      nodeColor={(n) => {
        const node = n as GraphNode;
        if (node.hasHealthIssue) return '#f07178';
        if (node.hop === 0) return '#4fd1c5';
        return TYPE_COLOR[node.type] ?? '#9aa7b8';
      }}
      nodeOpacity={0.94}
      linkColor={() => 'rgba(148,175,196,0.3)'}
      linkWidth={0.55}
      linkOpacity={0.5}
      onNodeClick={(n) => onSelect((n as GraphNode).id)}
      cooldownTicks={100}
    />
  );
}

function createRadialForce(focusId: string, nodes: EgoNode[]) {
  const hopOf = new Map(nodes.map((n) => [n.id, n.hop]));
  let sim: GraphNode[] = [];

  function force(alpha: number) {
    for (const node of sim) {
      const hop = hopOf.get(node.id) ?? 1;
      const targetR = hop === 0 ? 0 : 30 + hop * 38;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const z = node.z ?? 0;
      const r = Math.hypot(x, y, z) || 0.001;
      const k = ((targetR - r) / r) * alpha * 0.38;
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
