import { describe, it, expect } from "vitest";
import { stripAnsi } from "../pm3-output-parser.js";

describe("stripAnsi", () => {
  it("should strip basic ANSI color codes", () => {
    expect(stripAnsi("\x1b[31mred text\x1b[0m")).toBe("red text");
  });

  it("should strip nested ANSI codes", () => {
    expect(stripAnsi("\x1b[1m\x1b[32mbold green\x1b[0m\x1b[0m")).toBe(
      "bold green",
    );
  });

  it("should strip OSC sequences", () => {
    expect(stripAnsi("\x1b]0;title\x07some text")).toBe("some text");
  });

  it("should return empty string for empty input", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("should pass through plain text unchanged", () => {
    const text = "hello world 123 !@#$%";
    expect(stripAnsi(text)).toBe(text);
  });

  it("should handle multiple ANSI codes in sequence", () => {
    expect(
      stripAnsi("\x1b[31m\x1b[42m\x1b[1mformatted\x1b[0m plain"),
    ).toBe("formatted plain");
  });
});
