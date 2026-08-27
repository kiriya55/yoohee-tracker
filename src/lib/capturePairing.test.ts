import { describe, expect, it, vi } from "vitest";
import { parseCapturePairingMessage, requestLocalPairing } from "./capturePairing";

describe("local capture pairing", () => {
  it("accepts only a grant message for the active state", () => {
    expect(parseCapturePairingMessage({
      type: "gfl2-capture-pairing-approved",
      state: "state-1",
      grantToken: "grant-1",
    }, "state-1")).toBe("grant-1");
    expect(parseCapturePairingMessage({
      type: "gfl2-capture-pairing-approved",
      state: "other-state",
      grantToken: "grant-2",
    }, "state-1")).toBeUndefined();
    expect(parseCapturePairingMessage({
      type: "gfl2-capture-pairing-approved",
      state: "state-1",
      grantToken: "grant-3",
    }, "state-1", "http://127.0.0.1:17890", "http://127.0.0.1:17890")).toBe("grant-3");
    expect(parseCapturePairingMessage({
      type: "gfl2-capture-pairing-approved",
      state: "state-1",
      grantToken: "grant-4",
    }, "state-1", "http://localhost:17890", "http://127.0.0.1:17890")).toBeUndefined();
  });

  it("requests an approval page from the loopback agent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: "request-1",
      state: "state-1",
      origin: "https://yoohee-tracker.kiriya55.cn",
      approvalUrl: "http://127.0.0.1:17890/pairing/approve?requestId=request-1",
    }), { status: 200 }));

    await expect(requestLocalPairing("http://127.0.0.1:17890", "state-1", fetchImpl)).resolves.toMatchObject({
      requestId: "request-1",
      state: "state-1",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:17890/v1/pairing/request?state=state-1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("rejects an approval response for another state", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: "request-1",
      state: "other-state",
      origin: "https://yoohee-tracker.kiriya55.cn",
      approvalUrl: "http://127.0.0.1:17890/pairing/approve?requestId=request-1",
    }), { status: 200 }));

    await expect(requestLocalPairing("http://127.0.0.1:17890", "state-1", fetchImpl))
      .rejects.toThrow("invalid pairing response");
  });
});
