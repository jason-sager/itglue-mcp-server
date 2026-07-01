import { describe, it, expect } from "vitest";
import { buildServerFilters, sparseFieldset, type FilterSpec } from "./params.js";

describe("buildServerFilters", () => {
  const specs: FilterSpec[] = [
    { param: "filter_id", wireKey: "id" },
    { param: "filter_configuration_type_id", wireKey: "configuration_type_id" },
    { param: "filter_name", wireKey: "name", clientSubstring: true },
    { param: "filter_updated_since", wireKey: "updated_at", operator: "gt" },
  ];

  it("emits eq filters as filter[kebab-key] via buildFilterParams", () => {
    expect(buildServerFilters(specs, { filter_id: 7 })).toEqual({
      "filter[id]": 7,
    });
    expect(
      buildServerFilters(specs, { filter_configuration_type_id: 12 })
    ).toEqual({ "filter[configuration-type-id]": 12 });
  });

  it("emits operator filters as filter[kebab-key][op]", () => {
    expect(
      buildServerFilters(specs, { filter_updated_since: "2024-01-01" })
    ).toEqual({ "filter[updated-at][gt]": "2024-01-01" });
  });

  it("never sends clientSubstring filters on the wire", () => {
    expect(buildServerFilters(specs, { filter_name: "acme" })).toEqual({});
  });

  it("skips undefined/null values and combines the rest", () => {
    expect(
      buildServerFilters(specs, {
        filter_id: 7,
        filter_configuration_type_id: undefined,
        filter_name: "acme",
        filter_updated_since: "2024-01-01",
      })
    ).toEqual({
      "filter[id]": 7,
      "filter[updated-at][gt]": "2024-01-01",
    });
  });

  it("returns an empty object when nothing is set", () => {
    expect(buildServerFilters(specs, {})).toEqual({});
  });
});

describe("sparseFieldset", () => {
  it("builds fields[type]=comma,separated", () => {
    expect(sparseFieldset("configurations", "name,primary-ip")).toEqual({
      "fields[configurations]": "name,primary-ip",
    });
  });
});
