import { useState } from "react";

interface Props {
  onPay: (ticker: string) => void;
  paying: boolean;
}

const QUERIES = [
  { ticker: "ETH", label: "Ethereum Sentiment" },
  { ticker: "BTC", label: "Bitcoin Sentiment" },
  { ticker: "SOL", label: "Solana Sentiment" },
];

export default function Controls({ onPay, paying }: Props) {
  const [selected, setSelected] = useState(QUERIES[0].ticker);

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="space-y-2">
          <div>
            <h2 className="text-sm font-medium text-slate-300">Buy Premium Data</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              The agent pays <span className="text-slate-400">$0.05 USDC</span> per
              request &mdash; settled confidentially on-chain via x402
            </p>
          </div>
          <div className="flex gap-2">
            {QUERIES.map((q) => (
              <button
                key={q.ticker}
                onClick={() => setSelected(q.ticker)}
                disabled={paying}
                className={`
                  px-3 py-1 rounded text-xs font-medium transition-all border
                  ${selected === q.ticker
                    ? "border-blue-500 bg-blue-500/15 text-blue-300"
                    : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600"
                  }
                  ${paying ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
                `}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => onPay(selected)}
          disabled={paying}
          className={`
            px-6 py-3 rounded-lg text-sm font-semibold transition-all
            ${paying
              ? "bg-slate-800 text-slate-500 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer active:scale-95 shadow-md shadow-blue-600/25"
            }
          `}
        >
          {paying ? "Processing\u2026" : "Pay & Request"}
        </button>
      </div>
    </div>
  );
}
