import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { tildeErrorMessage, tildeErrorStatus, tildeHttpErrorMessage } from "./errors.js";
import { tildeFetch } from "./fetch.js";
import { omitUndefinedProperties, undefinedWhenFalsy } from "./request.js";

afterEach(() => vi.unstubAllGlobals());

describe("Tilde platform helpers", () => {
  it("omits undefined request properties without converting them to null", () => {
    expect(
      omitUndefinedProperties({ present: "value", missing: undefined, disabled: false }),
    ).toEqual({ present: "value", disabled: false });
    expect(undefinedWhenFalsy("")).toBeUndefined();
    expect(undefinedWhenFalsy("query")).toBe("query");
  });

  it("normalizes generated-client and SDK errors", () => {
    expect(tildeErrorStatus({ status: 429 })).toBe(429);
    expect(tildeErrorStatus({ response: new Response(null, { status: 503 }) })).toBe(503);
    expect(tildeErrorMessage({ msg: "rate limited" })).toBe("rate limited");
    expect(tildeErrorMessage({ detail: [{ msg: "team is unavailable" }] })).toBe(
      "team is unavailable",
    );
    expect(
      tildeHttpErrorMessage(
        { detail: "organization does not own this team" },
        new Response(null, { status: 403 }),
      ),
    ).toBe("organization does not own this team (HTTP 403)");
    expect(tildeErrorMessage({}, "fallback")).toBe("fallback");
  });

  it("composes provider cancellation into Tilde fetches", async () => {
    const provider = new AbortController();
    const request = new AbortController();
    let receivedInit: RequestInit | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      receivedInit = init;
      return new Response("ok");
    });
    vi.stubGlobal("fetch", fetchMock);

    await tildeFetch(provider.signal)("https://tilde.test", { signal: request.signal });

    const signal = receivedInit?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    provider.abort();
    expect(signal?.aborted).toBe(true);
  });
});
