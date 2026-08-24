/** Map independent remote operations without exceeding the provider request budget. */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("Concurrency must be a positive integer");
  if (values.length === 0) return [];

  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await operation(values[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Share one request ceiling across independently parallel Tilde reconcilers. */
export function fetchWithConcurrency(fetcher: typeof fetch, concurrency: number): typeof fetch {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("Concurrency must be a positive integer");
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = async (): Promise<void> => {
    if (active < concurrency) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async (input, init) => {
    await acquire();
    try {
      return await fetcher(input, init);
    } finally {
      release();
    }
  };
}
