import type { DemoEvent } from "../types";

interface Props {
  settledEvent?: DemoEvent;
  payloadEvent?: DemoEvent;
  agentBalance?: { address: string };
}

function truncateAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return addr.slice(0, 6) + "\u2026" + addr.slice(-4);
}

export default function OnChainView({ settledEvent, payloadEvent, agentBalance }: Props) {
  const hasSettlement = !!settledEvent;
  const commitment = payloadEvent?.payload?.amountCommitment;
  const sender = payloadEvent?.payload?.sender;
  const receiver = payloadEvent?.payload?.receiver;

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 h-full">
      <h2 className="text-sm font-medium text-slate-400 mb-4 uppercase tracking-wider">
        On-Chain View
      </h2>

      {!hasSettlement ? (
        <div className="text-center py-16 text-slate-600 text-sm">
          Make a payment to see on-chain details
        </div>
      ) : (
        <div className="space-y-4">
          {/* Transaction */}
          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
              Settlement Transaction
            </p>
            <p className="font-mono text-xs text-blue-400 break-all">
              {settledEvent.transaction}
            </p>
          </div>

          {/* Confidential transfer */}
          <div className="rounded-lg border border-green-800/40 overflow-hidden">
            <div className="bg-green-900/20 px-3 py-2 border-b border-green-800/30">
              <p className="text-xs font-medium text-green-400">
                Confidential transferFrom()
              </p>
              <p className="text-[10px] text-green-500/60 mt-0.5">
                What a blockchain explorer actually sees
              </p>
            </div>
            <div className="p-3 space-y-1.5 font-mono text-xs">
              <Row label="sender" value={sender ? truncateAddr(sender) : "?"} />
              <Row label="receiver" value={receiver ? truncateAddr(receiver) : "?"} />
              <div className="flex gap-2">
                <span className="text-slate-600 w-24 flex-shrink-0">amount</span>
                <div>
                  <span className="text-amber-400 font-semibold">HIDDEN</span>
                  <span className="text-slate-600 ml-1">
                    (Poseidon2 commitment)
                  </span>
                </div>
              </div>
              {commitment && (
                <div className="flex gap-2">
                  <span className="text-slate-600 w-24 flex-shrink-0">commitment</span>
                  <span className="text-amber-300/60 break-all text-[10px] leading-relaxed">
                    {commitment}
                  </span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-slate-600 w-24 flex-shrink-0">ciphertext</span>
                <span className="text-slate-500">3-of-3 encrypted shares</span>
              </div>
            </div>
          </div>

          {/* Comparison: Standard ERC-20 */}
          <div className="rounded-lg border border-red-800/30 overflow-hidden">
            <div className="bg-red-900/15 px-3 py-2 border-b border-red-800/20">
              <p className="text-xs font-medium text-red-400">
                Standard ERC-20 transfer()
              </p>
              <p className="text-[10px] text-red-400/50 mt-0.5">
                For comparison &mdash; no privacy
              </p>
            </div>
            <div className="p-3 space-y-1.5 font-mono text-xs">
              <Row label="sender" value={sender ? truncateAddr(sender) : "?"} />
              <Row label="receiver" value={receiver ? truncateAddr(receiver) : "?"} />
              <div className="flex gap-2">
                <span className="text-slate-600 w-24 flex-shrink-0">amount</span>
                <span className="text-red-300 line-through decoration-red-500/50">
                  50,000 ($0.05 USDC)
                </span>
                <span className="text-red-400/60 text-[10px] ml-1">visible to all!</span>
              </div>
            </div>
          </div>

          {/* Agent address */}
          {agentBalance && (
            <div className="text-[10px] text-slate-600 text-center mt-2">
              Agent: {agentBalance.address}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-slate-600 w-24 flex-shrink-0">{label}</span>
      <span className="text-slate-300">{value}</span>
    </div>
  );
}
