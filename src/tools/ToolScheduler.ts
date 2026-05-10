export class ToolScheduler {
  private serialQueue: Promise<unknown> = Promise.resolve();

  async schedule<T>(concurrencySafe: boolean, work: () => Promise<T>): Promise<T> {
    if (concurrencySafe) {
      return work();
    }

    const run = this.serialQueue.then(work, work);
    this.serialQueue = run.catch(() => undefined);
    return run;
  }
}

