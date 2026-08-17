/** Compose a provider call's cancellation signal into Tilde HTTP requests. */
export function tildeFetch(signal: AbortSignal): typeof fetch {
  return (input, init) => {
    const requestSignal = resolveRequestSignal(input, init);
    return fetch(input, {
      ...init,
      signal: combineSignals(requestSignal, signal),
    });
  };
}

function resolveRequestSignal(
  input: Request | string | URL,
  init: RequestInit | undefined,
): AbortSignal | null | undefined {
  if (init?.signal) return init.signal;
  switch (input instanceof Request) {
    case true:
      return (input as Request).signal;
    case false:
      return undefined;
  }
}

function combineSignals(
  requestSignal: AbortSignal | null | undefined,
  providerSignal: AbortSignal,
): AbortSignal {
  switch (requestSignal) {
    case null:
    case undefined:
      return providerSignal;
    default:
      return AbortSignal.any([requestSignal, providerSignal]);
  }
}
