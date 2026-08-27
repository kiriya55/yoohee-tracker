import { describe, expect, it, vi } from "vitest";
import { fetchCaptureAgentStatus, parseCaptureAgentStatus } from "./captureAgent";

const capturedStatus = {
  phase: "captured" as const,
  proxyPort: 19001,
  credential: {
    available: true,
    serverId: "haoplay-asia" as const,
    capturedAt: "2026-08-28T00:00:00.000Z",
    uidAvailable: true,
  },
  pairingCodeSet: true,
};

describe("local capture agent status", () => {
  it("parses a redacted captured status including UID availability", () => {
    expect(parseCaptureAgentStatus(capturedStatus)).toEqual(capturedStatus);
  });

  it("fetches status from a loopback agent endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(capturedStatus), { status: 200 }));

    await expect(fetchCaptureAgentStatus("http://127.0.0.1:17890", fetchImpl)).resolves.toEqual(capturedStatus);
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:17890/v1/status", expect.objectContaining({ method: "GET" }));
  });

  it("rejects an invalid status without accepting a remote endpoint", async () => {
    await expect(fetchCaptureAgentStatus("https://tracker.example", vi.fn())).rejects.toThrow("loopback");
    expect(() => parseCaptureAgentStatus({ phase: "unknown" })).toThrow("capture agent status");
  });
});
