import { Response } from 'express';

interface SseClient {
  id: string;
  userId: number;
  spaceId: number;
  res: Response;
}

const clientsBySpace = new Map<number, Set<SseClient>>();

export function subscribeSpaceStream(spaceId: number, userId: number, res: Response): () => void {
  const client: SseClient = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userId,
    spaceId,
    res,
  };

  let set = clientsBySpace.get(spaceId);
  if (!set) {
    set = new Set();
    clientsBySpace.set(spaceId, set);
  }
  set.add(client);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      cleanup();
    }
  }, 25_000);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    const group = clientsBySpace.get(spaceId);
    if (group) {
      group.delete(client);
      if (group.size === 0) {
        clientsBySpace.delete(spaceId);
      }
    }
  };

  return cleanup;
}

export function broadcastSpaceUpdate(
  spaceId: number,
  eventType: string,
  payload: Record<string, unknown> = {}
) {
  const group = clientsBySpace.get(spaceId);
  if (!group || group.size === 0) return;

  const data = JSON.stringify({
    type: eventType,
    spaceId,
    at: Date.now(),
    ...payload,
  });

  for (const client of Array.from(group)) {
    try {
      client.res.write(`event: space_update\ndata: ${data}\n\n`);
    } catch {
      group.delete(client);
    }
  }
}
