// Phase 2, Step 1: the offensive-word filter on its own (no database needed).
const { findOffensiveWords: find } = require("../utils/contentFilter");

describe("offensive word filter", () => {
  test("normal property text passes, including place names that contain blocked words", () => {
    expect(find("Nice 3 BHK villa near Kunnamangalam, call 98950 00000")).toEqual([]);
    expect(find("Please assess the class of this property in Assam")).toEqual([]);
    expect(find("Fire retardant doors, well-maintained, Scunthorpe style. Hi!")).toEqual([]);
    expect(find("Poori masala shop near the house")).toEqual([]);
    expect(find("")).toEqual([]);
  });

  test("whole words, any letter case", () => {
    expect(find("what the FUCK")).toEqual(["fuck"]);
    expect(find("you bitch")).toEqual(["bitch"]);
    expect(find("Total shit deal")).toEqual(["shit"]);
  });

  test("word starts marked with * also catch longer forms", () => {
    expect(find("fucking liar")).toEqual(["fuck"]);
    expect(find("chutiya seller")).toEqual(["chutiya"]);
  });

  test("common tricks are undone", () => {
    expect(find("sh1t")).toEqual(["shit"]);
    expect(find("$hit")).toEqual(["shit"]);
    expect(find("a$$hole")).toEqual(["asshole"]);
    expect(find("f*ck you")).toEqual(["fuck"]);
    expect(find("sh*t")).toEqual(["shit"]);
    expect(find("f.u.c.k")).toEqual(["fuck"]);
    expect(find("shiiiit")).toEqual(["shit"]);
    expect(find("shit!")).toEqual(["shit"]);
  });

  test("phrases and Malayalam", () => {
    expect(find("Kill   yourself")).toEqual(["kill yourself"]);
    expect(find("myre")).toEqual(["myre"]);
    expect(find("തായോളി ആണ്")).toEqual(["തായോളി"]);
  });

  test("each word is reported once", () => {
    expect(find("shit shit SHIT")).toEqual(["shit"]);
  });
});
