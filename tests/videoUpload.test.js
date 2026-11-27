// Uploaded videos: the upload ticket, and the checks before a video goes on
// a post (whose it is, 60 seconds at most, 100 MB at most). Cloudinary is
// replaced by fakes, so nothing is uploaded or deleted. No database needed.
process.env.NODE_ENV = "test";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";

const cloudinary = require("../config/cloudinary");
const { config } = require("../config/env");
const videoService = require("../services/videoService");
const { createPostSchema, updatePostSchema } = require("../validators/postValidators");

const ME = "64b7f0c2a1b2c3d4e5f60718";
const SOMEONE_ELSE = "64b7f0c2a1b2c3d4e5f60799";
const MY_VIDEO = `plotpost/videos/${ME}_0123456789abcdef`;

afterEach(() => jest.restoreAllMocks());

describe("upload ticket", () => {
  test("is signed for one video in our folder, named after the account", () => {
    const ticket = videoService.uploadTicket(ME, Date.UTC(2026, 10, 26, 6, 0, 0));
    expect(ticket.uploadUrl).toBe("https://api.cloudinary.com/v1_1/test-cloud/video/upload");
    expect(ticket.publicId).toMatch(new RegExp(`^plotpost/videos/${ME}_[a-f0-9]{16}$`));
    expect(ticket.fields.public_id).toBe(ticket.publicId);
    expect(ticket.fields.timestamp).toBe(String(Date.UTC(2026, 10, 26, 6, 0, 0) / 1000));
    expect(ticket.fields.api_key).toBe("test-key");
    expect(ticket.fields.eager).toBe(videoService.EAGER);
    expect(ticket.maxSeconds).toBe(60);
    expect(ticket.maxBytes).toBe(100 * 1024 * 1024);

    // Every field is text, and the signature covers exactly those fields.
    expect(Object.values(ticket.fields).every((value) => typeof value === "string")).toBe(true);
    const { api_key: apiKey, signature, ...signed } = ticket.fields;
    expect(apiKey).toBeTruthy();
    expect(signature).toBe(cloudinary.utils.api_sign_request(signed, "test-secret"));
  });

  test("two tickets never share a name", () => {
    expect(videoService.uploadTicket(ME).publicId).not.toBe(videoService.uploadTicket(ME).publicId);
  });

  test("without Cloudinary set up, says so (503)", () => {
    jest.replaceProperty(config.cloudinary, "configured", false);
    expect(() => videoService.uploadTicket(ME)).toThrow(expect.objectContaining({ statusCode: 503 }));
  });
});

describe("checking an uploaded video", () => {
  test("a 42-second video of yours gets its playback link and cover picture", async () => {
    const resource = jest
      .spyOn(cloudinary.api, "resource")
      .mockResolvedValue({ duration: 42.34, bytes: 18 * 1024 * 1024, format: "mp4" });

    const fields = await videoService.videoFieldsFor(MY_VIDEO, ME);

    expect(resource).toHaveBeenCalledWith(MY_VIDEO, { resource_type: "video" });
    expect(fields).toEqual({
      videoPublicId: MY_VIDEO,
      videoUrl: `https://res.cloudinary.com/test-cloud/video/upload/c_limit,w_720,q_auto,vc_h264/${MY_VIDEO}.mp4`,
      videoPoster: `https://res.cloudinary.com/test-cloud/video/upload/so_1,c_limit,w_1080,q_auto/${MY_VIDEO}.jpg`,
      videoDuration: 42.3,
      video: true,
    });
    // The links match what Cloudinary prepares right after the upload.
    expect(videoService.EAGER.split("|")).toEqual(["c_limit,w_720,q_auto,vc_h264/mp4", "so_1,c_limit,w_1080,q_auto/jpg"]);
  });

  test("someone else's video, or a made-up name, is refused without asking Cloudinary", async () => {
    const resource = jest.spyOn(cloudinary.api, "resource");
    for (const id of [
      `plotpost/videos/${SOMEONE_ELSE}_0123456789abcdef`,
      "plotpost/posts/abc",
      `plotpost/videos/${ME}_../../posts/x`,
      `plotpost/videos/${ME}_short`,
      "",
    ]) {
      await expect(videoService.videoFieldsFor(id, ME)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringMatching(/wasn't uploaded from your account/),
      });
    }
    expect(resource).not.toHaveBeenCalled();
  });

  test("over 60 seconds: refused and deleted from Cloudinary", async () => {
    jest.spyOn(cloudinary.api, "resource").mockResolvedValue({ duration: 75.2, bytes: 1000 });
    const destroy = jest.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({ result: "ok" });

    await expect(videoService.videoFieldsFor(MY_VIDEO, ME)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/up to 60 seconds\. This one is 75 seconds/),
    });
    expect(destroy).toHaveBeenCalledWith(MY_VIDEO, { resource_type: "video", invalidate: true });
  });

  test("60.4 seconds still counts as a minute (phones round)", async () => {
    jest.spyOn(cloudinary.api, "resource").mockResolvedValue({ duration: 60.4, bytes: 1000 });
    await expect(videoService.videoFieldsFor(MY_VIDEO, ME)).resolves.toMatchObject({ videoDuration: 60.4 });
  });

  test("over 100 MB: refused and deleted", async () => {
    jest.spyOn(cloudinary.api, "resource").mockResolvedValue({ duration: 30, bytes: 101 * 1024 * 1024 });
    const destroy = jest.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({ result: "ok" });
    await expect(videoService.videoFieldsFor(MY_VIDEO, ME)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/over 100 MB/),
    });
    expect(destroy).toHaveBeenCalled();
  });

  test("an upload that never arrived, and Cloudinary being down, get clear answers", async () => {
    const resource = jest.spyOn(cloudinary.api, "resource");
    resource.mockRejectedValueOnce({ error: { message: "Resource not found", http_code: 404 } });
    await expect(videoService.videoFieldsFor(MY_VIDEO, ME)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/didn't finish/),
    });

    resource.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(videoService.videoFieldsFor(MY_VIDEO, ME)).rejects.toMatchObject({ statusCode: 503 });
  });

  test("a failed delete is only logged, never thrown", async () => {
    jest.spyOn(cloudinary.uploader, "destroy").mockRejectedValue(new Error("down"));
    await expect(videoService.destroyVideo(MY_VIDEO)).resolves.toBeUndefined();
    await expect(videoService.destroyVideo("")).resolves.toBeUndefined();
  });
});

describe("the video id on a post", () => {
  const post = { title: "Plot", location: "Chevayur, Kozhikode" };

  test("is optional, and a new post without one has none", () => {
    expect(createPostSchema.parse(post).videoPublicId).toBe("");
    expect(createPostSchema.parse({ ...post, videoPublicId: MY_VIDEO }).videoPublicId).toBe(MY_VIDEO);
    expect(updatePostSchema.parse({}).videoPublicId).toBeUndefined();
    expect(updatePostSchema.parse({ videoPublicId: "" }).videoPublicId).toBe("");
  });

  test("odd characters are refused", () => {
    const result = createPostSchema.safeParse({ ...post, videoPublicId: "plotpost/videos/x?y=1" });
    expect(result.error.issues[0].message).toBe("Please add the video again.");
  });
});
