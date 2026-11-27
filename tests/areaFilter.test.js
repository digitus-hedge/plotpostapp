// Size filter: the size text sellers type becomes square feet, and the feed
// accepts a size range. No database needed.

const { parseArea } = require("../utils/priceParser");
const { feedFiltersSchema } = require("../validators/postValidators");

describe("size text to square feet", () => {
  test("cents, square feet, acres and square metres", () => {
    expect(parseArea("10 cents")).toBe(4356);
    expect(parseArea("10 cent plot")).toBe(4356);
    expect(parseArea("12 Cent")).toBe(5227);
    expect(parseArea("10.5 Cents")).toBe(4574);
    expect(parseArea("1850 sq ft")).toBe(1850);
    expect(parseArea("1,850 sqft")).toBe(1850);
    expect(parseArea("1850 Sq. Ft.")).toBe(1850);
    expect(parseArea("1850 sft")).toBe(1850);
    expect(parseArea("1850 square feet")).toBe(1850);
    expect(parseArea("2 acres")).toBe(87120);
    expect(parseArea("2.5acre")).toBe(108900);
    expect(parseArea("120 sq m")).toBe(1292);
    expect(parseArea("120 square metres")).toBe(1292);
  });

  test("acres and cents together, ranges, and more than one size", () => {
    expect(parseArea("1 acre 20 cents")).toBe(52272);
    expect(parseArea("1 Acre and 50 cents")).toBe(65340);
    expect(parseArea("10-12 cents")).toBe(4356);
    expect(parseArea("10 to 12 cents")).toBe(4356);
    expect(parseArea("1850 sqft house on 10 cents")).toBe(1850);
  });

  test("no clear size gives null", () => {
    expect(parseArea("10")).toBeNull();
    expect(parseArea("big plot")).toBeNull();
    expect(parseArea("5 percent")).toBeNull();
    expect(parseArea("10 centre")).toBeNull();
    expect(parseArea("0 cents")).toBeNull();
    expect(parseArea("99999999 acres")).toBeNull();
    expect(parseArea("")).toBeNull();
    expect(parseArea(undefined)).toBeNull();
    expect(parseArea(12)).toBeNull();
  });
});

describe("size range in the feed query", () => {
  test("whole square feet are accepted", () => {
    expect(feedFiltersSchema.parse({ minArea: "4356", maxArea: "8712" })).toMatchObject({
      minArea: 4356,
      maxArea: 8712,
    });
    expect(feedFiltersSchema.parse({ minArea: " 1306 " }).minArea).toBe(1306);
    expect(feedFiltersSchema.parse({}).minArea).toBeUndefined();
  });

  test("bad values are refused with a reason", () => {
    const reason = (query) => feedFiltersSchema.safeParse(query).error?.issues[0].message;
    expect(reason({ minArea: "10 cents" })).toMatch(/whole number of square feet/);
    expect(reason({ maxArea: "4.5" })).toMatch(/whole number of square feet/);
    expect(reason({ minArea: "-1" })).toMatch(/whole number of square feet/);
    expect(reason({ minArea: "9000", maxArea: "4000" })).toMatch(/minimum size can't be more/);
  });
});
