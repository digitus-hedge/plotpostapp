// Phase 3 Step 4: the unused-photo clean-up (scripts/cleanupPhotos.js).
// No database or Cloudinary needed: both are replaced by small stand-ins.
const { listFolder, usedPhotoIds, findUnused, deletePhotos } = require("../services/photoCleanup");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-24T12:00:00Z");
const ago = (days) => new Date(NOW - days * DAY).toISOString();

// A Mongoose-like model whose find().select().lean().cursor() yields docs.
const fakeModel = (docs) => ({
  find: () => ({
    select: () => ({
      lean: () => ({
        cursor: async function* cursor() {
          for (const doc of docs) yield doc;
        },
      }),
    }),
  }),
});

describe("photo clean-up", () => {
  test("lists a folder across Cloudinary's pages", async () => {
    const calls = [];
    const cloudinary = {
      api: {
        resources: async (options) => {
          calls.push(options);
          return options.next_cursor
            ? { resources: [{ public_id: "plotpost/posts/c", created_at: ago(3), bytes: 30 }] }
            : {
                resources: [
                  { public_id: "plotpost/posts/a", created_at: ago(9), bytes: 10 },
                  { public_id: "plotpost/posts/b", created_at: ago(1), bytes: 20 },
                ],
                next_cursor: "page2",
              };
        },
      },
    };
    const photos = await listFolder(cloudinary, "plotpost/posts/");
    expect(photos.map((p) => p.publicId)).toEqual(["plotpost/posts/a", "plotpost/posts/b", "plotpost/posts/c"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ type: "upload", resource_type: "image", prefix: "plotpost/posts/", max_results: 500 });
    expect(calls[1].next_cursor).toBe("page2");
  });

  test("collects every photo posts and profiles still use", async () => {
    const publicIdOf = (url) => (typeof url === "string" && url.startsWith("cdn:") ? url.slice(4) : null);
    const used = await usedPhotoIds({
      Post: fakeModel([
        { imageUrls: ["cdn:plotpost/posts/a", "cdn:plotpost/posts/b"], imageUrl: "" },
        { imageUrls: [], imageUrl: "cdn:plotpost/posts/old-single" },
        { imageUrls: ["data:image/jpeg;base64,xyz", "https://i.ytimg.com/vi/x/0.jpg"] },
      ]),
      User: fakeModel([{ profileImage: "cdn:plotpost/avatars/me" }]),
      publicIdOf,
    });
    expect([...used].sort()).toEqual([
      "plotpost/avatars/me",
      "plotpost/posts/a",
      "plotpost/posts/b",
      "plotpost/posts/old-single",
    ]);
  });

  test("only unused photos older than the limit are picked", () => {
    const photos = [
      { publicId: "plotpost/posts/used", createdAt: ago(30), bytes: 1 },
      { publicId: "plotpost/posts/orphan-old", createdAt: ago(5), bytes: 1 },
      { publicId: "plotpost/posts/orphan-new", createdAt: ago(1), bytes: 1 },
      { publicId: "plotpost/posts/no-date", createdAt: "", bytes: 1 },
    ];
    const used = new Set(["plotpost/posts/used"]);
    expect(findUnused({ photos, used, olderThanDays: 2, now: NOW }).map((p) => p.publicId)).toEqual([
      "plotpost/posts/orphan-old",
    ]);
    expect(findUnused({ photos, used, olderThanDays: 7, now: NOW })).toEqual([]);
  });

  test("deletes in groups of 100 and counts failures", async () => {
    const batches = [];
    const cloudinary = {
      api: {
        delete_resources: async (ids, options) => {
          batches.push({ size: ids.length, options });
          if (batches.length === 3) throw new Error("rate limited");
          return { deleted: Object.fromEntries(ids.map((id, i) => [id, i === 0 && batches.length === 2 ? "not_found" : "deleted"])) };
        },
      },
    };
    jest.spyOn(console, "error").mockImplementation(() => {});
    const ids = Array.from({ length: 250 }, (_, i) => `plotpost/posts/p${i}`);
    const result = await deletePhotos(cloudinary, ids);
    expect(batches.map((b) => b.size)).toEqual([100, 100, 50]);
    expect(batches[0].options).toEqual({ type: "upload", resource_type: "image" });
    expect(result).toEqual({ deleted: 199, failed: 51 });
    console.error.mockRestore();
  });
});
