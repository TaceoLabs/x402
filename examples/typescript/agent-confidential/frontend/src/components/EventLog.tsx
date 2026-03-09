import { useEffect, useRef } from "react";
import type { DemoEvent } from "../types";

interface Props {
  events: DemoEvent[];
}

const EVENT_META: Record<string, { label: string; color: string }> = {
  request_start: { label: "Request initiated", color: "text-blue-400" },
  payment_required: { label: "402 Payment Required", color: "text-amber-400" },
  creating_payment: { label: "Creating confidential payment...", color: "text-blue-300" },
  payment_created: { label: "Payment payload signed (EIP-712)", color: "text-purple-400" },
  payment_sent: { label: "Resending with payment header", color: "text-blue-400" },
  verifying: { label: "Facilitator verifying & settling...", color: "text-amber-300" },
  settled: { label: "Settled on-chain", color: "text-green-400" },
  response_received: { label: "Response received", color: "text-green-400" },
  settlement_failed: { label: "Settlement failed", color: "text-red-400" },
  error: { label: "Error", color: "text-red-400" },
};

function truncate(s: string, len = 24): string {
  if (s.length <= len) return s;
  return s.slice(0, len / 2) + "\u2026" + s.slice(-len / 4);
}

export default function EventLog({ events }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 h-full">
      <h2 className="text-sm font-medium text-slate-400 mb-4 uppercase tracking-wider">
        Protocol Flow
      </h2>
      <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
        {events.length === 0 ? (
          <div className="text-center py-16 text-slate-600 text-sm">
            Click a ticker above to start a payment
          </div>
        ) : (
          events.map((event, i) => {
            const meta = EVENT_META[event.type] || { label: event.type, color: "text-slate-400" };
            return (
              <div key={i} className="flex gap-3 items-start animate-fade-in">
                {/* Step badge */}
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-mono text-slate-400">
                  {event.step ?? "\u00B7"}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${meta.color}`}>{meta.label}</p>

                  {event.type === "request_start" && event.url && (
                    <p className="text-xs text-slate-500 font-mono mt-0.5">
                      GET {event.url}
                    </p>
                  )}

                  {event.type === "payment_required" && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      Server requires <span className="text-amber-300/80">$0.05 USDC</span> via{" "}
                      <span className="text-purple-300/80">confidential</span> scheme
                    </p>
                  )}

                  {event.type === "payment_created" && event.payload && (
                    <div className="text-xs text-slate-500 mt-1 space-y-0.5 font-mono bg-slate-800/50 rounded p-2 border border-slate-700/50">
                      <p>
                        <span className="text-slate-600">commitment:</span>{" "}
                        <span className="text-amber-300/70">
                          {truncate(event.payload.amountCommitment ?? "")}
                        </span>
                      </p>
                      <p>
                        <span className="text-slate-600">ciphertext:</span>{" "}
                        {event.payload.hasCiphertext ? (
                          <span className="text-green-400/70">3-of-3 secret shares</span>
                        ) : (
                          <span className="text-red-400/70">missing</span>
                        )}
                      </p>
                      <p>
                        <span className="text-slate-600">signature:</span>{" "}
                        {event.payload.hasSignature ? (
                          <span className="text-green-400/70">EIP-712 signed</span>
                        ) : (
                          <span className="text-red-400/70">missing</span>
                        )}
                      </p>
                    </div>
                  )}

                  {event.type === "settled" && event.transaction && (
                    <p className="text-xs text-slate-500 font-mono mt-0.5 break-all">
                      tx: {event.transaction}
                    </p>
                  )}

                  {event.type === "response_received" && event.data && (
                    <div className="text-xs mt-1 font-mono bg-slate-800/50 rounded p-2 border border-green-900/30">
                      <p className="text-green-300/80">
                        {event.data.ticker}: sentiment={event.data.sentiment}, signal=
                        {event.data.signal}
                      </p>
                    </div>
                  )}

                  {event.type === "error" && event.message && (
                    <p className="text-xs text-red-400/70 mt-0.5">{event.message}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
