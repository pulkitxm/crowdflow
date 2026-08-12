import { Directory, File, Paths } from 'expo-file-system';

export interface BufferedBatch { createdAt: number; body: string }

/** Short-lived app-private outage buffer; this is not a movement-history database. */
export class OutageBuffer {
  private readonly directory = new Directory(Paths.cache, 'crowdflow');
  private readonly file = new File(this.directory, 'telemetry-outbox.json');

  constructor(private readonly maxBatches = 60, private readonly maxAgeSeconds = 15 * 60) {}

  add(body: string, now = epochSeconds()): void {
    const entries = this.read(now); entries.push({ createdAt: now, body });
    this.write(entries.slice(-this.maxBatches));
  }

  peek(now = epochSeconds()): BufferedBatch | undefined { return this.read(now)[0]; }
  removeFirst(now = epochSeconds()): void { this.write(this.read(now).slice(1)); }
  size(now = epochSeconds()): number { return this.read(now).length; }
  clear(): void { if (this.file.exists) this.file.delete(); }

  private read(now: number): BufferedBatch[] {
    try {
      if (!this.file.exists) return [];
      const entries = JSON.parse(this.file.textSync()) as BufferedBatch[];
      const fresh = entries.filter((entry) => entry.createdAt <= now && now - entry.createdAt <= this.maxAgeSeconds)
        .slice(-this.maxBatches);
      if (fresh.length !== entries.length) this.write(fresh);
      return fresh;
    } catch {
      if (this.file.exists) this.file.delete(); return [];
    }
  }

  private write(entries: BufferedBatch[]): void {
    if (entries.length === 0) { if (this.file.exists) this.file.delete(); return; }
    if (!this.directory.exists) this.directory.create({ intermediates: true, idempotent: true });
    if (!this.file.exists) this.file.create({ intermediates: true });
    this.file.write(JSON.stringify(entries));
  }
}

function epochSeconds(): number { return Math.floor(Date.now() / 1000); }
