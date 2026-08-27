import { describe, expect, it, vi } from "vitest";
import { claimLocalCaptureCredential, claimLocalCaptureGrant, parseCaptureCredential } from "./captureCredential";

const validCredential = {
  format: "gfl2-capture-credential" as const,
  version: 1 as const,
  serverId: "haoplay-asia" as const,
  endpoint: "https://gf2-gacha-record-asia.haoplay.com/list?game_channel_id=10001",
  authorization: "Bearer test-token",
  capturedAt: "2026-08-27T00:00:00.000Z",
};

describe("local capture credential", () => {
  it("validates a credential file without accepting unrelated hosts", () => {
    expect(parseCaptureCredential(validCredential)).toMatchObject({ serverId: "haoplay-asia" });
    expect(() => parseCaptureCredential({ ...validCredential, endpoint: "https://example.test/list" })).toThrow();
  });

  it("claims a one-time local credential", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ credential: validCredential }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(claimLocalCaptureCredential("http://127.0.0.1:17890", "pairing-code", fetchImpl))
      .resolves.toMatchObject({ serverId: "haoplay-asia" });
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:17890/v1/credential/claim", expect.objectContaining({ method: "POST" }));
  });

  it("claims a local credential with an approved grant token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ credential: validCredential }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(claimLocalCaptureGrant("http://127.0.0.1:17890", "grant-token", fetchImpl))
      .resolves.toMatchObject({ serverId: "haoplay-asia" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:17890/v1/credential/claim",
      expect.objectContaining({ body: JSON.stringify({ grantToken: "grant-token" }) }),
    );
  });

  it("never sends a pairing code to a non-loopback origin", async () => {
    await expect(claimLocalCaptureCredential("https://example.test", "pairing-code", vi.fn()))
      .rejects.toThrow("loopback");
  });
});
