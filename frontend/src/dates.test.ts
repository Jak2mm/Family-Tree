import { describe, expect, it } from "vitest";
import { formatDate, parseDateInput } from "./dates";

describe("formatDate", () => {
  it("shows day-first by default style", () => {
    expect(formatDate("1950-03-07", "DD-MM-YYYY")).toBe("07-03-1950");
    expect(formatDate("1950-03", "DD-MM-YYYY")).toBe("03-1950");
    expect(formatDate("1950", "DD-MM-YYYY")).toBe("1950");
  });
  it("shows year-first when asked", () => {
    expect(formatDate("1950-03-07", "YYYY-MM-DD")).toBe("1950-03-07");
    expect(formatDate("1950-03", "YYYY-MM-DD")).toBe("1950-03");
  });
});

describe("parseDateInput", () => {
  it("reads day-first input as day, month, year", () => {
    expect(parseDateInput("07-03-1950", "DD-MM-YYYY")).toBe("1950-03-07");
    expect(parseDateInput("03-1950", "DD-MM-YYYY")).toBe("1950-03");
    expect(parseDateInput("1950", "DD-MM-YYYY")).toBe("1950");
  });
  it("always reads a leading four-digit year as year first", () => {
    expect(parseDateInput("1950-03-07", "DD-MM-YYYY")).toBe("1950-03-07");
    expect(parseDateInput("1950-03", "DD-MM-YYYY")).toBe("1950-03");
  });
  it("reads year-first input in the year-first format", () => {
    expect(parseDateInput("1932", "YYYY-MM-DD")).toBe("1932");
    expect(parseDateInput("1950-3-7", "YYYY-MM-DD")).toBe("1950-03-07");
  });
  it("accepts a leap day only in a leap year", () => {
    expect(parseDateInput("29-02-1952", "DD-MM-YYYY")).toBe("1952-02-29");
    expect(() => parseDateInput("29-02-1950", "DD-MM-YYYY")).toThrow(Error);
  });
  it("throws a plain message for dates that do not exist", () => {
    expect(() => parseDateInput("31-02-1950", "DD-MM-YYYY")).toThrow(/date/i);
    expect(() => parseDateInput("13-1950", "DD-MM-YYYY")).toThrow(Error);
    expect(() => parseDateInput("banana", "DD-MM-YYYY")).toThrow(Error);
    expect(() => parseDateInput("", "DD-MM-YYYY")).toThrow(Error);
    expect(() => parseDateInput("0000", "DD-MM-YYYY")).toThrow(Error);
  });
  it("does not guess when day-first text is typed in the year-first format", () => {
    expect(() => parseDateInput("07-03-1950", "YYYY-MM-DD")).toThrow(Error);
  });
});
