import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadJson } from "./download";

describe("downloadJson", () => {
  const originalDocument = globalThis.document;
  const originalUrl = globalThis.URL;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, "URL", { configurable: true, value: originalUrl });
  });

  it("mounts the link for the click and cleans it up after the download starts", async () => {
    const body = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };
    const link = {
      href: "",
      download: "",
      click: vi.fn(),
    };
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { body, createElement: vi.fn(() => link) },
    });
    Object.defineProperty(globalThis, "URL", {
      configurable: true,
      value: { createObjectURL, revokeObjectURL },
    });

    downloadJson("records.json", { records: [1] });

    expect(link.download).toBe("records.json");
    expect(link.href).toBe("blob:test");
    expect(body.appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(body.removeChild).toHaveBeenCalledWith(link);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
