import { describe, it, expect } from "vitest";
import {
  buildOutcomePairs,
  buildPersonalResponseProfiles,
  type InterventionEvent,
  type IntervBiomarkerSeries,
} from "../src/lib/longitudinal-learning";

describe("buildOutcomePairs", () => {
  it("pairs an intervention with closest pre + each valid post", () => {
    const interventions: InterventionEvent[] = [
      { type: "supplement", name: "Vitamin D3", startedAt: "2025-01-01" },
    ];
    const series: IntervBiomarkerSeries[] = [
      {
        biomarkerName: "vitamin d",
        samples: [
          { testDate: "2024-12-01", value: 22 }, // pre
          { testDate: "2025-04-01", value: 38 }, // post (~90d)
          { testDate: "2025-07-01", value: 44 }, // post (~181d)
        ],
      },
    ];
    const pairs = buildOutcomePairs(interventions, series);
    expect(pairs.length).toBe(2);
    expect(pairs[0].preValue).toBe(22);
    expect(pairs[0].postValue).toBe(38);
    expect(pairs[0].direction).toBe("improved");
    expect(pairs[1].postValue).toBe(44);
  });

  it("ignores post-tests within 28 days of intervention", () => {
    const pairs = buildOutcomePairs(
      [{ type: "medication", name: "metformin", startedAt: "2025-01-01" }],
      [{
        biomarkerName: "hba1c",
        samples: [
          { testDate: "2024-12-01", value: 6.4 },
          { testDate: "2025-01-15", value: 6.3 }, // too soon (14d)
        ],
      }],
    );
    expect(pairs).toEqual([]);
  });

  it("classifies LDL drop as improved (lower-is-better)", () => {
    const pairs = buildOutcomePairs(
      [{ type: "medication", name: "atorvastatin", startedAt: "2025-01-01" }],
      [{
        biomarkerName: "ldl",
        samples: [
          { testDate: "2024-12-15", value: 160 },
          { testDate: "2025-04-15", value: 90 },
        ],
      }],
    );
    expect(pairs[0].direction).toBe("improved");
    expect(pairs[0].delta).toBe(-70);
  });

  it("classifies HDL drop as deteriorated (higher-is-better)", () => {
    const pairs = buildOutcomePairs(
      [{ type: "supplement", name: "thing", startedAt: "2025-01-01" }],
      [{
        biomarkerName: "hdl",
        samples: [
          { testDate: "2024-12-15", value: 60 },
          { testDate: "2025-04-15", value: 45 },
        ],
      }],
    );
    expect(pairs[0].direction).toBe("deteriorated");
  });

  it("classifies TSH movement TOWARD midpoint (1.5) as improved (range)", () => {
    const pairs = buildOutcomePairs(
      [{ type: "supplement", name: "selenium", startedAt: "2025-01-01" }],
      [{
        biomarkerName: "tsh",
        samples: [
          { testDate: "2024-12-15", value: 4.5 },  // far above mid
          { testDate: "2025-04-15", value: 2.5 },  // closer to mid 1.5
        ],
      }],
    );
    expect(pairs[0].direction).toBe("improved");
  });

  it("classifies ferritin moving AWAY from midpoint as deteriorated (range)", () => {
    const pairs = buildOutcomePairs(
      [{ type: "supplement", name: "iron", startedAt: "2025-01-01" }],
      [{
        biomarkerName: "ferritin",
        samples: [
          { testDate: "2024-12-15", value: 150 },  // moderately above mid 100
          { testDate: "2025-04-15", value: 280 },  // much further from mid
        ],
      }],
    );
    expect(pairs[0].direction).toBe("deteriorated");
  });

  it("treats <5% movement as stable", () => {
    const pairs = buildOutcomePairs(
      [{ type: "supplement", name: "x", startedAt: "2025-01-01" }],
      [{
        biomarkerName: "ldl",
        samples: [
          { testDate: "2024-12-15", value: 100 },
          { testDate: "2025-04-15", value: 102 },
        ],
      }],
    );
    expect(pairs[0].direction).toBe("stable");
  });
});

describe("buildPersonalResponseProfiles", () => {
  it("requires n >= 3 to emit a profile", () => {
    const interventions: InterventionEvent[] = [
      { type: "supplement", name: "Vitamin D3", startedAt: "2024-01-01" },
      { type: "supplement", name: "Vitamin D3", startedAt: "2024-06-01" },
    ];
    const series: IntervBiomarkerSeries[] = [
      {
        biomarkerName: "vitamin d",
        samples: [
          { testDate: "2023-12-01", value: 20 },
          { testDate: "2024-04-01", value: 35 },
          { testDate: "2024-05-01", value: 36 },
          { testDate: "2024-09-01", value: 50 },
        ],
      },
    ];
    const pairs = buildOutcomePairs(interventions, series);
    const profiles = buildPersonalResponseProfiles(pairs);
    if (pairs.length < 3) expect(profiles).toEqual([]);
  });

  it("classifies majority improved as responder", () => {
    const baseline = { interventionType: "supplement" as const, interventionName: "vit d3", biomarkerName: "vitamin d" };
    const pairs = [
      { ...baseline, preTestDate: "a", preValue: 20, postTestDate: "b", postValue: 35, daysElapsed: 90, delta: 15, deltaPct: 0.75, direction: "improved" as const },
      { ...baseline, preTestDate: "c", preValue: 25, postTestDate: "d", postValue: 40, daysElapsed: 120, delta: 15, deltaPct: 0.6, direction: "improved" as const },
      { ...baseline, preTestDate: "e", preValue: 30, postTestDate: "f", postValue: 45, daysElapsed: 100, delta: 15, deltaPct: 0.5, direction: "improved" as const },
    ];
    const profiles = buildPersonalResponseProfiles(pairs);
    expect(profiles.length).toBe(1);
    expect(profiles[0].classification).toBe("responder");
    expect(profiles[0].n).toBe(3);
    expect(profiles[0].narrative).toContain("vit d3");
  });
});
