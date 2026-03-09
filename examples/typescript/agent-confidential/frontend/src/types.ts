export interface DemoEvent {
  step?: number;
  type: string;
  timestamp: number;
  ticker?: string;
  url?: string;
  message?: string;
  payload?: {
    scheme?: string;
    amountCommitment?: string;
    sender?: string;
    receiver?: string;
    nonce?: string;
    deadline?: string;
    hasCiphertext?: boolean;
    hasSignature?: boolean;
  };
  transaction?: string;
  network?: string;
  data?: {
    ticker?: string;
    sentiment?: number;
    signal?: string;
    confidence?: string;
    sources?: number;
    timestamp?: string;
  };
}

export interface ServiceStatus {
  agent: { address: string };
  server: { status: string; url: string };
  facilitator: { status: string };
  chain: { id: number; rpc: string };
}
