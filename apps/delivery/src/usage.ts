export interface UsageEventRow {
  orgId: string;
  kind: "request" | "transform" | "bandwidth";
  quantity: number;
  occurredAt: Date;
}

let buffer: UsageEventRow[] = [];

export function recordUsage(event: Omit<UsageEventRow, "occurredAt">): void {
  buffer.push({ ...event, occurredAt: new Date() });
}

export function recordRequestUsage(
  orgId: string,
  opts: { transformed: boolean; bytes: number },
): void {
  recordUsage({ orgId, kind: "request", quantity: 1 });
  if (opts.transformed) {
    recordUsage({ orgId, kind: "transform", quantity: 1 });
  }
  recordUsage({ orgId, kind: "bandwidth", quantity: opts.bytes });
}

export function drainUsageBuffer(): UsageEventRow[] {
  const drained = buffer;
  buffer = [];
  return drained;
}

export function startUsageFlush(
  sendBatch: (events: UsageEventRow[]) => Promise<void>,
  opts?: { intervalMs?: number },
): () => Promise<void> {
  const intervalMs = opts?.intervalMs ?? 5000;

  async function flushOnce(): Promise<void> {
    const events = drainUsageBuffer();
    if (events.length === 0) return;
    try {
      await sendBatch(events);
    } catch (err) {
      console.error(`delivery: usage flush failed, dropping ${events.length} events`, err);
    }
  }

  const timer = setInterval(() => {
    void flushOnce();
  }, intervalMs);

  return async () => {
    clearInterval(timer);
    await flushOnce();
  };
}
