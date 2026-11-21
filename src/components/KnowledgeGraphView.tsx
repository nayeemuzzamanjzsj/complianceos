import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api';
import type { GraphEdge, NavView, RegulationItem } from '../types';

interface KnowledgeGraphViewProps {
  regulations: RegulationItem[];
  initialRegulationId: string | null;
  onNavigate: (view: NavView, itemId?: string) => void;
}

interface PositionedNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
}

const LAYER_ORDER: Record<string, number> = {
  Regulation: 0,
  Obligation: 1,
  Control: 2,
  Policy: 3,
  System: 3,
  Remediation: 4,
  Evidence: 5,
  Verification: 6,
};

const NODE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  Regulation: { bg: '#0F1D3D', border: '#0F1D3D', text: '#FFFFFF' },
  Obligation: { bg: '#EFF6FF', border: '#2563EB', text: '#1E3A8A' },
  Control: { bg: '#ECFDF5', border: '#16A34A', text: '#065F46' },
  Policy: { bg: '#FFFBEB', border: '#D97706', text: '#92400E' },
  System: { bg: '#F5F3FF', border: '#7C3AED', text: '#5B21B6' },
  Remediation: { bg: '#F8FAFC', border: '#475569', text: '#0F172A' },
  Evidence: { bg: '#ECFEFF', border: '#0891B2', text: '#164E63' },
  Verification: { bg: '#DCFCE7', border: '#15803D', text: '#14532D' },
};

export const KnowledgeGraphView: React.FC<KnowledgeGraphViewProps> = ({
  regulations,
  initialRegulationId,
  onNavigate,
}) => {
  const [selectedRegId, setSelectedRegId] = useState<string>(
    initialRegulationId || regulations[0]?.id || 'reg_bb_retention'
  );
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<PositionedNode | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ edges: GraphEdge[] }>(`/api/graph?regulationId=${encodeURIComponent(selectedRegId)}`)
      .then((res) => {
        setEdges(res.edges);
        setSelectedNode(null);
      })
      .finally(() => setLoading(false));
  }, [selectedRegId]);

  const { nodes, svgHeight } = useMemo(() => {
    const map = new Map<string, { id: string; label: string; type: string }>();
    for (const e of edges) {
      if (!map.has(e.source_id)) {
        map.set(e.source_id, { id: e.source_id, label: e.source_label, type: e.source_type });
      }
      if (!map.has(e.target_id)) {
        map.set(e.target_id, { id: e.target_id, label: e.target_label, type: e.target_type });
      }
    }

    const columns: Record<number, Array<{ id: string; label: string; type: string }>> = {
      0: [],
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
    };
    for (const n of map.values()) {
      const col = LAYER_ORDER[n.type] ?? 2;
      columns[col].push(n);
    }

    const colX = [24, 214, 404, 594, 784, 974, 1164];
    const positioned: PositionedNode[] = [];
    let maxRows = 1;
    Object.entries(columns).forEach(([colIdxStr, list]) => {
      const colIdx = Number(colIdxStr);
      if (list.length > maxRows) maxRows = list.length;
      list.forEach((n, rowIdx) => {
        positioned.push({
          ...n,
          x: colX[colIdx],
          y: 44 + rowIdx * 96,
        });
      });
    });

    return {
      nodes: positioned,
      svgHeight: Math.max(380, maxRows * 100 + 60),
    };
  }, [edges]);

  const nodeLookup = useMemo(() => {
    const m = new Map<string, PositionedNode>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const connectedEdges = useMemo(() => {
    if (!selectedNode) return [];
    return edges.filter(
      (e) => e.source_id === selectedNode.id || e.target_id === selectedNode.id
    );
  }, [edges, selectedNode]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-[#0F172A]">
            Compliance Knowledge Graph
          </h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Click any node to inspect full compliance lineage: Regulation → Obligation → Control → Policy/System → Remediation → Evidence → Verification.
          </p>
        </div>

        <select
          value={selectedRegId}
          onChange={(e) => setSelectedRegId(e.target.value)}
          className="rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A]"
        >
          {regulations.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} — {r.regulator}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 bg-white border border-[#E2E8F0] rounded-xl p-5 overflow-x-auto">
          {loading ? (
            <div className="h-96 animate-pulse bg-[#F8FAFC] rounded-lg" />
          ) : nodes.length === 0 ? (
            <div className="h-80 flex flex-col items-center justify-center text-center p-6">
              <p className="text-sm font-semibold text-[#0F172A]">
                No graph lineage edges mapped for this directive yet.
              </p>
              <p className="text-xs text-[#64748B] mt-1">
                Select BB-PSD-09/2026 or create a remediation action on an applicable obligation to view full compliance lineage.
              </p>
            </div>
          ) : (
            <svg width="1360" height={svgHeight} className="min-w-[1260px]">
              {/* Column headers */}
              {['Regulation', 'Obligations', 'Controls', 'Policies & Systems', 'Remediation', 'Evidence', 'Verification'].map(
                (title, idx) => (
                  <text
                    key={title}
                    x={[24, 214, 404, 594, 784, 974, 1164][idx]}
                    y={20}
                    fontSize="11"
                    fontWeight="700"
                    fill="#64748B"
                  >
                    {title}
                  </text>
                )
              )}

              {/* Edges */}
              {edges.map((edge) => {
                const src = nodeLookup.get(edge.source_id);
                const tgt = nodeLookup.get(edge.target_id);
                if (!src || !tgt) return null;
                const x1 = src.x + 170;
                const y1 = src.y + 26;
                const x2 = tgt.x;
                const y2 = tgt.y + 26;
                const highlighted =
                  selectedNode &&
                  (selectedNode.id === src.id || selectedNode.id === tgt.id);
                return (
                  <g key={edge.id}>
                    <path
                      d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={highlighted ? '#2563EB' : '#CBD5E1'}
                      strokeWidth={highlighted ? 2.2 : 1.4}
                    />
                  </g>
                );
              })}

              {/* Nodes */}
              {nodes.map((node) => {
                const palette = NODE_COLORS[node.type] || NODE_COLORS.Remediation;
                const isSelected = selectedNode?.id === node.id;
                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    onClick={() => setSelectedNode(node)}
                    className="cursor-pointer"
                  >
                    <rect
                      width="170"
                      height="52"
                      rx="8"
                      fill={palette.bg}
                      stroke={isSelected ? '#2563EB' : palette.border}
                      strokeWidth={isSelected ? 2.5 : 1.2}
                    />
                    <text
                      x="10"
                      y="18"
                      fontSize="10"
                      fontWeight="700"
                      fill={palette.text}
                      opacity="0.8"
                    >
                      {node.type}
                    </text>
                    <text x="10" y="36" fontSize="11" fontWeight="600" fill={palette.text}>
                      {node.label.length > 23 ? `${node.label.slice(0, 22)}…` : node.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Right Inspector Panel */}
        <div className="xl:col-span-4 bg-white border border-[#E2E8F0] rounded-xl p-6">
          <h2 className="font-display text-sm font-bold text-[#0F172A] mb-3">
            Node Lineage Inspector
          </h2>
          {!selectedNode ? (
            <p className="text-xs text-[#64748B] leading-relaxed">
              Click any node in the graph to inspect its regulatory relationships, connected policies, systems, controls, and remediation tasks.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <div className="text-xs font-semibold text-[#2563EB]">{selectedNode.type}</div>
                <div className="text-sm font-bold text-[#0F172A] mt-0.5">{selectedNode.label}</div>
                <div className="text-[11px] font-mono text-[#64748B] mt-1">{selectedNode.id}</div>
              </div>

              <div>
                <div className="text-xs font-semibold text-[#475569] mb-2">
                  Connected Relationships ({connectedEdges.length})
                </div>
                <div className="space-y-2">
                  {connectedEdges.map((e) => (
                    <div
                      key={e.id}
                      className="text-xs border border-[#E2E8F0] rounded-lg p-2.5 bg-white"
                    >
                      <span className="font-medium text-[#0F172A]">{e.source_label}</span>
                      <span className="mx-1.5 font-mono text-[11px] text-[#2563EB]">
                        → {e.relationship} →
                      </span>
                      <span className="font-medium text-[#0F172A]">{e.target_label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-[#E2E8F0] flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onNavigate('regulations', selectedRegId)}
                  className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-xs font-semibold cursor-pointer"
                >
                  Open Regulation
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onNavigate(
                      'remediation',
                      selectedNode.type === 'Remediation' ? selectedNode.id : undefined
                    )
                  }
                  className="px-3 py-1.5 rounded-md border border-[#CBD5E1] text-xs font-semibold text-[#0F172A] cursor-pointer"
                >
                  View Remediation
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('evidence')}
                  className="px-3 py-1.5 rounded-md border border-[#CBD5E1] text-xs font-semibold text-[#0F172A] cursor-pointer"
                >
                  View Evidence
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('audit-log')}
                  className="px-3 py-1.5 rounded-md border border-[#CBD5E1] text-xs font-semibold text-[#0F172A] cursor-pointer"
                >
                  Audit Trail
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
