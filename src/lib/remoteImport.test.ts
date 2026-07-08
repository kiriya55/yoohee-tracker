import { describe, expect, it, vi } from "vitest";
import { buildGachaRequest, defaultEndpointForServer, fetchRemoteGachaRecords, parseFiddlerRequest, parseHeaderText, REMOTE_POOL_TYPES } from "./remoteImport";

describe("remote import helpers", () => {
  it("parses decrypted URL headers text", () => {
    expect(parseHeaderText("Authorization: Bearer token\nUser-Agent: GF2\nContent-Type: text/plain")).toEqual({
      Authorization: "Bearer token",
      "User-Agent": "GF2",
      "Content-Type": "text/plain",
    });
  });

  it("builds official gacha POST requests with type and next", () => {
    const request = buildGachaRequest({
      endpoint: "https://example.test/list?game_channel_id=10001&type_id=1&next=old",
      headers: { Authorization: "token" },
      poolType: 3,
      next: "1782373017-487376",
    });

    expect(request.url).toBe("https://example.test/list?game_channel_id=10001");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toMatchObject({
      Authorization: "token",
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(request.init.body).toBe("type_id=3&next=1782373017-487376");
  });

  it("provides server-specific default endpoints", () => {
    expect(defaultEndpointForServer("dw-us")).toBe("https://gf2-gacha-record-us.sunborngame.com/list?game_channel_id=5");
    expect(defaultEndpointForServer("dw-cn")).toBe("https://gf2-gacha-record.sunborngame.com/list");
    expect(defaultEndpointForServer("haoplay-asia")).toBe("https://gf2-gacha-record-asia.haoplay.com/list?game_channel_id=10001");
    expect(defaultEndpointForServer("haoplay-intl")).toBe("https://gf2-gacha-record-intl.haoplay.com/list?game_channel_id=10001");
    expect(REMOTE_POOL_TYPES).toEqual([1, 3, 4, 6, 7]);
  });

  it("extracts URL, headers, and server from copied Fiddler request text", () => {
    const parsed = parseFiddlerRequest(`POST https://gf2-gacha-record-asia.haoplay.com/list?game_channel_id=10001&type_id=3 HTTP/1.1
Host: gf2-gacha-record-asia.haoplay.com
User-Agent: GF2
Authorization: token`);

    expect(parsed.serverId).toBe("haoplay-asia");
    expect(parsed.endpoint).toBe("https://gf2-gacha-record-asia.haoplay.com/list?game_channel_id=10001&type_id=3");
    expect(parsed.headers).toMatchObject({
      Host: "gf2-gacha-record-asia.haoplay.com",
      "User-Agent": "GF2",
      Authorization: "token",
    });
  });

  it("fetches every selected pool type and normalizes list records", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: { list: [{ pool_id: 118001, item: 1069, time: 1782373017 }], next: "" } })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: { list: [{ pool_id: 196001, item: 10713, time: 1782374017 }], next: "" } })),
      );

    const result = await fetchRemoteGachaRecords({
      uid: "123456",
      server: "haoplay",
      endpoint: "https://example.test/list",
      headersText: "Authorization: token",
      poolTypes: [3, 4],
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.format).toBe("uid-headers-fetch");
    expect(result.records).toMatchObject([
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 1069, timestamp: 1782373017 },
      { uid: "123456", server: "haoplay", poolType: 4, poolId: 196001, itemId: 10713, timestamp: 1782374017 },
    ]);
  });
});
