interface Props {
  activeStep: number | null;
}

const NODES = [
  { id: "agent", label: "Agent", icon: "\u{1F916}", desc: "AI Client" },
  { id: "server", label: "Resource Server", icon: "\u{1F5A5}\uFE0F", desc: "Sentiment API" },
  { id: "facilitator", label: "Facilitator", icon: "\u{1F50F}", desc: "Verify & Settle" },
  { id: "chain", label: "Blockchain", icon: "\u26D3\uFE0F", desc: "Anvil (local)" },
];

type NodeState = "idle" | "active" | "done";

function getNodeState(nodeId: string, step: number | null): NodeState {
  if (step === null) return "idle";
  if (step >= 8) return "done";

  const activeSteps: Record<string, number[]> = {
    agent: [1, 3, 4, 5],
    server: [2, 5, 6],
    facilitator: [6],
    chain: [7],
  };

  if (activeSteps[nodeId]?.includes(step)) return "active";

  const doneAfter: Record<string, number> = {
    agent: 5,
    server: 7,
    facilitator: 7,
    chain: 8,
  };

  if (step > (doneAfter[nodeId] ?? 99)) return "done";
  return "idle";
}

function getArrowState(idx: number, step: number | null): NodeState {
  if (step === null) return "idle";
  if (step >= 8) return "done";

  const activeAt: number[][] = [[1, 5], [5, 6], [7]];
  if (activeAt[idx]?.includes(step)) return "active";

  const doneAfter = [5, 7, 7];
  if (step > doneAfter[idx]) return "done";
  return "idle";
}

const stateStyles: Record<NodeState, string> = {
  idle: "border-slate-700 bg-slate-800/50",
  active: "border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/20 scale-105",
  done: "border-green-500/50 bg-green-500/5",
};

const arrowColors: Record<NodeState, string> = {
  idle: "bg-slate-700",
  active: "bg-blue-500",
  done: "bg-green-500/40",
};

const arrowTipColors: Record<NodeState, string> = {
  idle: "border-l-slate-700",
  active: "border-l-blue-500",
  done: "border-l-green-500/40",
};

export default function FlowDiagram({ activeStep }: Props) {
  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 overflow-x-auto">
      <div className="flex items-center justify-between gap-2 min-w-[600px]">
        {NODES.map((node, i) => {
          const state = getNodeState(node.id, activeStep);
          const arrowState = i < NODES.length - 1 ? getArrowState(i, activeStep) : "idle";

          return (
            <div key={node.id} className="contents">
              {/* Node card */}
              <div
                className={`flex-1 max-w-[180px] rounded-lg border p-4 text-center transition-all duration-300 ${stateStyles[state]}`}
              >
                <div className="text-2xl mb-1">{node.icon}</div>
                <div className="text-sm font-medium text-slate-200">{node.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{node.desc}</div>
                {state === "active" && (
                  <div className="mt-2 h-0.5 w-8 mx-auto bg-blue-500 rounded animate-pulse" />
                )}
                {state === "done" && (
                  <div className="mt-2 text-xs text-green-400">done</div>
                )}
              </div>

              {/* Arrow */}
              {i < NODES.length - 1 && (
                <div className="flex-shrink-0 w-12 flex items-center justify-center">
                  <div className={`w-full h-0.5 relative transition-colors duration-300 ${arrowColors[arrowState]}`}>
                    {arrowState === "active" && (
                      <div className="absolute inset-0 bg-blue-400 rounded animate-pulse" />
                    )}
                    <div
                      className={`absolute right-0 top-1/2 -translate-y-1/2 border-t-[4px] border-b-[4px] border-l-[6px] border-t-transparent border-b-transparent transition-colors duration-300 ${arrowTipColors[arrowState]}`}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
