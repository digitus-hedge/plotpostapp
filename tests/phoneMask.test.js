// Phase 3 Step 1: phone numbers written in post text are hidden from guests.
// No database needed.
const { maskPhoneNumbers, hasPhoneNumber, HIDDEN } = require("../utils/phoneMask");

describe("hiding phone numbers in text", () => {
  test.each([
    ["Call 98950 12345 now", `Call ${HIDDEN} now`],
    ["+91-98950-12345", HIDDEN],
    ["+91 9895012345", HIDDEN],
    ["919895012345", HIDDEN],
    ["09895012345", HIDDEN],
    ["Mob9895012345", `Mob${HIDDEN}`],
    ["Ph: 98.950.12345", `Ph: ${HIDDEN}`],
    ["Landline 0495 2721234", `Landline ${HIDDEN}`],
    ["0484-2345678", HIDDEN],
    ["WhatsApp 7012345678 or 8089123456", `WhatsApp ${HIDDEN} or ${HIDDEN}`],
    ["₹ 85,00,000 9895 012 345", `₹ 85,00,000 ${HIDDEN}`],
  ])("hides %s", (text, expected) => {
    expect(maskPhoneNumbers(text)).toBe(expected);
    expect(hasPhoneNumber(text)).toBe(true);
  });

  test.each([
    "Price ₹1,20,00,000",
    "Rs 50,00,000/-",
    "45 lakhs, 2400 sqft, PIN 673001",
    "Date 24.11.2026",
    "12 cents 5 BHK 3000",
    "Survey no 123/45",
    "1234567890",
    "98950 1234",
    "https://instagram.com/p/9895012345/",
    "year 2026 2025 2024",
  ])("leaves %s alone", (text) => {
    expect(maskPhoneNumbers(text)).toBe(text);
    expect(hasPhoneNumber(text)).toBe(false);
  });

  test("empty and missing text stay as they are", () => {
    expect(maskPhoneNumbers("")).toBe("");
    expect(maskPhoneNumbers(undefined)).toBe(undefined);
    expect(maskPhoneNumbers(null)).toBe(null);
  });
});
