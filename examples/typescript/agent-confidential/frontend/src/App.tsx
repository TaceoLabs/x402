import { useState, useEffect, useCallback } from "react";
import type { DemoEvent, ServiceStatus } from "./types";
import FlowDiagram from "./components/FlowDiagram";
import EventLog from "./components/EventLog";
import Controls from "./components/Controls";
import OnChainView from "./components/OnChainView";

export default function App() {
  const [started, setStarted] = useState(false);
  const [events, setEvents] = useState<DemoEvent[]>([]);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [paying, setPaying] = useState(false);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [paymentCount, setPaymentCount] = useState(0);

  // SSE connection — only when demo is active
  useEffect(() => {
    if (!started) return;
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      const event: DemoEvent = JSON.parse(e.data);
      setEvents((prev) => [...prev, event]);
      if (event.step) setActiveStep(event.step);
      if (event.type === "response_received" || event.type === "error" || event.type === "settlement_failed") {
        setPaying(false);
        if (event.type === "response_received") {
          setPaymentCount((c) => c + 1);
        }
      }
    };
    return () => es.close();
  }, [started]);

  // Fetch status on mount + after each payment
  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, [paymentCount]);

  const handlePay = useCallback(async (ticker: string) => {
    setPaying(true);
    setActiveStep(null);
    setEvents([]);
    try {
      await fetch("/api/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
    } catch {
      setPaying(false);
    }
  }, []);

  if (!started) {
    return <AboutPage onStart={() => setStarted(true)} status={status} />;
  }

  const settledEvent = events.find((e) => e.type === "settled");
  const payloadEvent = events.find((e) => e.type === "payment_created");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              <span className="text-blue-400">x402</span>{" "}
              <span className="text-slate-300">Confidential Payment Demo</span>
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Privacy-preserving machine-to-machine payments powered by{" "}
              <span className="text-slate-400">TACEO</span>
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            {status?.chain?.name && (
              <span className="text-slate-500 border border-slate-700 rounded px-2 py-0.5">
                {status.chain.name}
              </span>
            )}
            <StatusDot label="Server" online={status?.server.status === "online"} />
            <StatusDot label="Facilitator" online={status?.facilitator.status === "online"} />
            {status?.mpc && <StatusDot label="MPC" online={status.mpc.status === "online"} />}
            <StatusDot label="Chain" online={!!status?.chain} />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <FlowDiagram activeStep={activeStep} />
        <Controls onPay={handlePay} paying={paying} />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <EventLog events={events} />
          </div>
          <div className="lg:col-span-2">
            <OnChainView
              settledEvent={settledEvent}
              payloadEvent={payloadEvent}
              agentBalance={status?.agent}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

// ── About / Landing Page ────────────────────────────────────────────────────────

function AboutPage({ onStart, status }: { onStart: () => void; status: ServiceStatus | null }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Hero */}
      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-3xl w-full space-y-12">
          {/* Title */}
          <div className="text-center space-y-3">
            <p className="text-sm font-medium tracking-widest uppercase text-blue-400">
              TACEO &times; x402
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
              Confidential Payments
              <br />
              <span className="text-slate-500">for the Machine Economy</span>
            </h1>
            <p className="text-lg text-slate-400 max-w-xl mx-auto leading-relaxed">
              AI agents pay for API access using the{" "}
              <span className="text-slate-200">HTTP 402</span> protocol &mdash; but
              with a twist: payment amounts are{" "}
              <span className="text-blue-300">hidden on-chain</span> using
              multi-party computation.
            </p>
          </div>

          {/* What is this */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Card
              title="What is x402?"
              body={
                <>
                  A protocol by Coinbase that adds <Hl>native payments to HTTP</Hl>.
                  When a server returns{" "}
                  <code className="text-amber-300/80 bg-slate-800 px-1 rounded text-xs">
                    402 Payment Required
                  </code>
                  , the client automatically creates a signed payment, attaches it to
                  the request, and the server settles it on-chain. No invoices, no
                  billing portals &mdash; just pay-per-request.
                </>
              }
            />
            <Card
              title="What does TACEO add?"
              body={
                <>
                  Standard x402 payments are <Hl>fully transparent</Hl> &mdash;
                  anyone can see amounts on the blockchain. TACEO&apos;s confidential
                  scheme replaces raw amounts with{" "}
                  <Hl>Poseidon2 hash commitments</Hl> and encrypts the real value
                  into <Hl>3-of-3 secret shares</Hl> for MPC operators. The payment
                  settles on-chain, but the amount stays private.
                </>
              }
            />
          </div>

          {/* Why confidential payments */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Why hide payment amounts?
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="space-y-1.5">
                <h3 className="font-medium text-slate-200">Dynamic pricing</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  API providers can offer <Hl>custom pricing</Hl> to different
                  customers &mdash; volume discounts, enterprise rates, promotional
                  deals &mdash; without competitors or other users seeing the
                  negotiated price on-chain.
                </p>
              </div>
              <div className="space-y-1.5">
                <h3 className="font-medium text-slate-200">Competitive protection</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  If payments are public, a rival can monitor the blockchain to see{" "}
                  <Hl>how much each customer pays</Hl>, how often they use the
                  service, and reverse-engineer business relationships. Confidential
                  payments eliminate this surveillance.
                </p>
              </div>
              <div className="space-y-1.5">
                <h3 className="font-medium text-slate-200">Agent autonomy</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  As AI agents transact autonomously at scale, their{" "}
                  <Hl>spending patterns reveal strategy</Hl> &mdash; which data
                  sources they value, how much budget they allocate. Confidential
                  payments keep agent economics private.
                </p>
              </div>
            </div>
          </div>

          {/* How it works */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              How this demo works
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm">
              <Step n={1} title="Agent requests data">
                An AI agent calls a paid sentiment-analysis API. The server responds
                with <code className="text-amber-300/80 text-xs">402</code> and the price: $0.05 USDC.
              </Step>
              <Step n={2} title="Payment is created">
                The agent generates a Poseidon2 commitment hiding the amount, splits
                it into encrypted secret shares, and signs everything with EIP-712.
              </Step>
              <Step n={3} title="Facilitator settles">
                A facilitator verifies the signature, checks the on-chain balance
                commitment, and calls{" "}
                <code className="text-xs text-blue-300/80">transferFrom()</code> on
                the confidential token contract.
              </Step>
              <Step n={4} title="Data delivered">
                The agent gets its sentiment data. On-chain, only cryptographic
                commitments are visible &mdash; the actual $0.05 is never revealed.
              </Step>
            </div>
          </div>

          {/* Actors */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Demo components
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <Actor
                name="Resource Server"
                desc="Express API behind x402 paywall (port 4021)"
                online={status?.server.status === "online"}
              />
              <Actor
                name="Facilitator"
                desc="Verifies payments & settles on-chain (port 4022)"
                online={status?.facilitator.status === "online"}
              />
              {status?.mpc && (
                <Actor
                  name="Mock MPC"
                  desc="Processes action queue & balance checks (port 4023)"
                  online={status.mpc.status === "online"}
                />
              )}
              <Actor
                name="Blockchain"
                desc={status?.chain?.name ? `${status.chain.name} — confidential token contract` : "Confidential token contract on-chain"}
                online={!!status?.chain}
              />
              <Actor
                name="Agent (this dashboard)"
                desc="Creates and signs confidential payments (port 4020)"
                online={true}
              />
            </div>
          </div>

          {/* CTA */}
          <div className="text-center">
            <button
              onClick={onStart}
              className="px-8 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-base transition-all cursor-pointer active:scale-95 shadow-lg shadow-blue-600/25"
            >
              Enter Demo
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800 px-6 py-4 text-center text-xs text-slate-600">
        Built with x402 by Coinbase &bull; Confidential scheme by TACEO &bull;
        Poseidon2 &bull; EIP-712 &bull; BabyJubJub &bull; Groth16
      </footer>
    </div>
  );
}

// ── Shared small components ─────────────────────────────────────────────────────

function StatusDot({ label, online }: { label: string; online?: boolean }) {
  return (
    <span className={`flex items-center gap-1.5 ${online ? "text-green-400" : "text-slate-600"}`}>
      <span
        className={`w-1.5 h-1.5 rounded-full ${online ? "bg-green-400 shadow-sm shadow-green-400/50" : "bg-slate-600"}`}
      />
      {label}
    </span>
  );
}

function Card({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 space-y-2">
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      <p className="text-sm text-slate-400 leading-relaxed">{body}</p>
    </div>
  );
}

function Hl({ children }: { children: React.ReactNode }) {
  return <span className="text-slate-200">{children}</span>;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-blue-600/20 border border-blue-500/30 text-blue-400 text-xs font-bold flex items-center justify-center">
          {n}
        </span>
        <span className="font-medium text-slate-200">{title}</span>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed pl-8">{children}</p>
    </div>
  );
}

function Actor({ name, desc, online }: { name: string; desc: string; online?: boolean }) {
  return (
    <div className="flex items-center gap-3 bg-slate-800/50 rounded-lg px-4 py-3 border border-slate-700/50">
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          online ? "bg-green-400 shadow-sm shadow-green-400/50" : "bg-slate-600"
        }`}
      />
      <div>
        <p className="text-sm font-medium text-slate-300">{name}</p>
        <p className="text-xs text-slate-500">{desc}</p>
      </div>
    </div>
  );
}
