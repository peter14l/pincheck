import { describe, expect, it } from "vitest";
import {
  GALLERY_PAGE_SIZE,
  GALLERY_QUERY_MAX_LENGTH,
  MAX_GALLERY_PAGE,
  clampGalleryPage,
  galleryHref,
  galleryPageCount,
  normalizeGalleryQuery,
  parseGalleryPage,
} from "./gallery-utils";

describe("normalizeGalleryQuery", () => {
  it("trims input and treats missing values as empty", () => {
    expect(normalizeGalleryQuery("  esp32  ")).toBe("esp32");
    expect(normalizeGalleryQuery(undefined)).toBe("");
    expect(normalizeGalleryQuery("")).toBe("");
  });

  it("uses the first value when a param is repeated", () => {
    expect(normalizeGalleryQuery(["sensor", "robot"])).toBe("sensor");
    expect(normalizeGalleryQuery([])).toBe("");
  });

  it("caps the query length", () => {
    expect(normalizeGalleryQuery("a".repeat(200))).toHaveLength(
      GALLERY_QUERY_MAX_LENGTH,
    );
  });
});

describe("parseGalleryPage", () => {
  it("defaults missing or malformed pages to 1", () => {
    expect(parseGalleryPage(undefined)).toBe(1);
    expect(parseGalleryPage("")).toBe(1);
    expect(parseGalleryPage("abc")).toBe(1);
    expect(parseGalleryPage("0")).toBe(1);
    expect(parseGalleryPage("-4")).toBe(1);
  });

  it("parses positive pages and caps very large values", () => {
    expect(parseGalleryPage("3")).toBe(3);
    expect(parseGalleryPage("2.9")).toBe(2);
    expect(parseGalleryPage("99999999999999999999")).toBe(MAX_GALLERY_PAGE);
  });
});

describe("galleryPageCount", () => {
  it("always has at least one page", () => {
    expect(galleryPageCount(0)).toBe(1);
    expect(galleryPageCount(-10)).toBe(1);
    expect(galleryPageCount(Number.NaN)).toBe(1);
  });

  it("rounds partial pages up", () => {
    expect(galleryPageCount(GALLERY_PAGE_SIZE)).toBe(1);
    expect(galleryPageCount(GALLERY_PAGE_SIZE + 1)).toBe(2);
    expect(galleryPageCount(GALLERY_PAGE_SIZE * 3)).toBe(3);
  });
});

describe("clampGalleryPage", () => {
  it("clamps to the last page that contains results", () => {
    expect(clampGalleryPage(5, GALLERY_PAGE_SIZE + 1)).toBe(2);
    expect(clampGalleryPage(1, GALLERY_PAGE_SIZE + 1)).toBe(1);
  });

  it("clamps the lower bound to 1", () => {
    expect(clampGalleryPage(0, 30)).toBe(1);
    expect(clampGalleryPage(-3, 30)).toBe(1);
  });

  it("returns page 1 when there are no results", () => {
    expect(clampGalleryPage(4, 0)).toBe(1);
  });
});

describe("galleryHref", () => {
  it("builds clean links for the default gallery", () => {
    expect(galleryHref({})).toBe("/gallery");
    expect(galleryHref({ page: 1 })).toBe("/gallery");
  });

  it("preserves the query when paginating", () => {
    expect(galleryHref({ page: 2 })).toBe("/gallery?page=2");
    expect(galleryHref({ query: "esp32" })).toBe("/gallery?q=esp32");
    expect(galleryHref({ page: 3, query: "esp32" })).toBe(
      "/gallery?q=esp32&page=3",
    );
  });

  it("encodes special characters and trims the query", () => {
    expect(galleryHref({ query: "  bme280 & oled  " })).toBe(
      "/gallery?q=bme280+%26+oled",
    );
  });
});
