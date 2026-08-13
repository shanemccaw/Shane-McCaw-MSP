import { Response } from 'express';

export class PccStreamingServer {
  private static instance: PccStreamingServer | null = null;
  private clients: Set<Response> = new Set();

  private constructor() {}

  public static getInstance(): PccStreamingServer {
    if (!PccStreamingServer.instance) {
      PccStreamingServer.instance = new PccStreamingServer();
    }
    return PccStreamingServer.instance;
  }

  public registerClient(res: Response) {
    this.clients.add(res);
    res.write('retry: 10000\n\n');
  }

  public unregisterClient(res: Response) {
    this.clients.delete(res);
  }

  public broadcast(event: string, data: Record<string, any>) {
    const payload = JSON.stringify({ event, ...data });
    for (const client of this.clients) {
      try {
        client.write(`event: ${event}\n`);
        client.write(`data: ${payload}\n\n`);
      } catch (err) {
        // Handle broken connection silently, it will be cleaned up in the route handler
      }
    }
  }

  public getConnectedClientsCount(): number {
    return this.clients.size;
  }
}
