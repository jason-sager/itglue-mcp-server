import { describe, it, expect } from "vitest";
import { probeCapabilities } from "./capabilities.js";
import { makeMockClient } from "../../test-helpers.js";

const page = {
  total_count: 1,
  page_number: 1,
  page_size: 5,
  has_more: false,
  next_page: null,
};

describe("probeCapabilities", () => {
  it("detects capabilities that are present", async () => {
    const client = makeMockClient();
    client.getManyRaw.mockImplementation(
      (_p: string, params?: Record<string, string | number>) => {
        if (params?.include === "sections") {
          return Promise.resolve({
            ...page,
            data: [{ id: "1", name: "Doc" }],
            included: [{ id: "s1", content: "x", document_id: 1 }],
          });
        }
        // sparse probe: `name` intentionally absent → sparse honored
        return Promise.resolve({
          ...page,
          data: [{ id: "1", updated_at: "t" }],
          included: [],
        });
      }
    );
    client.getMany.mockResolvedValue({ ...page, data: [] });

    const caps = await probeCapabilities(client as never, "1");
    expect(caps.sideloadSections).toBe(true);
    expect(caps.sparseFieldsets).toBe(true);
    expect(caps.globalDocumentsSweep).toBe(true);
    expect(typeof caps.probedAt).toBe("string");
  });

  it("fails safe to false when unsupported or erroring", async () => {
    const client = makeMockClient();
    client.getManyRaw.mockResolvedValue({
      ...page,
      data: [{ id: "1", name: "Doc" }], // name present → sparse not honored
      included: [], // empty → no sideload
    });
    client.getMany.mockRejectedValue(new Error("404"));

    const caps = await probeCapabilities(client as never, "1");
    expect(caps.sideloadSections).toBe(false);
    expect(caps.sparseFieldsets).toBe(false);
    expect(caps.globalDocumentsSweep).toBe(false);
  });
});
