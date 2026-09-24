/** Bounds concurrent preview downloads shared by uploads and Figma screenshots. */
export class ImageDownloads {
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(download: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) {
      await new Promise<void>((resume) => this.waiting.push(resume));
    } else {
      this.running++;
    }
    try {
      return await download();
    } finally {
      const resume = this.waiting.shift();
      if (resume) resume(); // transfer the reserved slot
      else this.running--;
    }
  }
}
