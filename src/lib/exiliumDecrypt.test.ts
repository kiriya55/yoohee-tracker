import { describe, expect, it, vi } from "vitest";
import { decryptExiliumBackupText, parseRscPayload } from "./exiliumDecrypt";

function toRscPayload(value: string): string {
  return `0:["ignored"]\n10:T${value.length.toString(16)},${value}`;
}

describe("exilium decrypt helpers", () => {
  it("extracts the RSC payload using the hex length", () => {
    expect(parseRscPayload(toRscPayload(JSON.stringify("abc")))).toBe("abc");
  });

  it("decrypts an exilium backup response into JSON", async () => {
    const decrypted = {
      state: {
        profilesData: {
          main: { pulls: { "3": [] } },
        },
      },
    };
    const gzipped = "H4sIAAAAAAAACqtWKi5JLElVsqpWKijKT8vMSS12SSxJBPFzEzPzwOKlOTnFIIaxklV0bC0IAABiIiuxNgAAAA==";
    const fetchMock = vi.fn(async () => new Response(toRscPayload(JSON.stringify(gzipped))));

    await expect(decryptExiliumBackupText(JSON.stringify({ data: "encrypted-data" }), fetchMock as typeof fetch)).resolves.toEqual(decrypted);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://exilium.xyz/settings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(["encrypted-data"]),
      }),
    );
  });

  it("rejects backup files without a data field", async () => {
    await expect(decryptExiliumBackupText(JSON.stringify({ records: [] }))).rejects.toThrow("data field");
  });
});
