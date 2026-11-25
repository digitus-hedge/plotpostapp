const { z } = require("zod");

// The choices on the Create Post screen.
const TYPES = ["Plot", "House", "Villa", "Flat", "Commercial"];
const DEALS = ["For sale", "For rent"];
// PlotPost = a direct post with your own photos; the others are pasted links.
const PLATFORMS = ["Instagram", "Facebook", "YouTube", "Other", "PlotPost"];

const MAX_PHOTOS = 8;

const text = (max, label) =>
  z
    .string({ error: `${label} must be text.` })
    .trim()
    .max(max, `${label} is too long (${max} characters at most).`);

const isWebLink = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch (error) {
    return false;
  }
};

const socialUrl = z
  .string({ error: "The post link must be text." })
  .trim()
  .max(500, "The post link is too long.")
  .refine((v) => v === "" || isWebLink(v), "Please paste a valid link starting with https://");

// Photo checks that need the saved post (old base64 photos may stay on edit)
// happen in the controller; here only the list's shape is checked.
const imageUrls = z
  .array(z.string({ error: "Each photo must be a link." }), { error: "Photos must be a list." })
  .max(MAX_PHOTOS, `Please choose up to ${MAX_PHOTOS} photos.`);

const fields = {
  price: text(40, "Price"),
  description: text(3000, "Description"),
  socialUrl,
  sellerPhone: text(20, "Phone number").regex(/^[0-9+()\-\s]*$/, "Please enter a valid phone number."),
  sellerName: text(80, "Seller name"),
  area: text(40, "Area"),
  bedrooms: text(10, "Bedrooms"),
  bathrooms: text(10, "Bathrooms"),
  video: z.boolean({ error: "Video must be true or false." }),
  imageUrls,
};

const choice = (values, label) =>
  z.enum(values, { error: `Please choose a valid ${label} (${values.join(", ")}).` });

const title = text(120, "Title").min(1, "Please enter a title.");
const location = text(120, "Location").min(1, "Please enter a location.");

// Link posts must include the link.
const requireLinkForLinkPosts = (post, ctx) => {
  if (post.platform && post.platform !== "PlotPost" && post.socialUrl === "") {
    ctx.addIssue({
      code: "custom",
      path: ["socialUrl"],
      message: "Please paste the link to your Instagram, Facebook or YouTube post.",
    });
  }
};

// POST /api/posts
const createPostSchema = z
  .object({
    title,
    location,
    type: choice(TYPES, "property type").default("Plot"),
    deal: choice(DEALS, "deal").default("For sale"),
    platform: choice(PLATFORMS, "platform").default("PlotPost"),
    price: fields.price.default(""),
    description: fields.description.default(""),
    socialUrl: fields.socialUrl.default(""),
    sellerPhone: fields.sellerPhone.default(""),
    sellerName: fields.sellerName.default(""),
    area: fields.area.default(""),
    bedrooms: fields.bedrooms.default(""),
    bathrooms: fields.bathrooms.default(""),
    video: fields.video.default(false),
    imageUrls: fields.imageUrls.default([]),
  })
  .superRefine(requireLinkForLinkPosts);

// PUT /api/posts/:id: only the fields sent are checked and changed.
const updatePostSchema = z
  .object({
    title: title.optional(),
    location: location.optional(),
    type: choice(TYPES, "property type").optional(),
    deal: choice(DEALS, "deal").optional(),
    platform: choice(PLATFORMS, "platform").optional(),
    price: fields.price.optional(),
    description: fields.description.optional(),
    socialUrl: fields.socialUrl.optional(),
    sellerPhone: fields.sellerPhone.optional(),
    sellerName: fields.sellerName.optional(),
    area: fields.area.optional(),
    bedrooms: fields.bedrooms.optional(),
    bathrooms: fields.bathrooms.optional(),
    video: fields.video.optional(),
    imageUrls: fields.imageUrls.optional(),
  })
  .superRefine(requireLinkForLinkPosts);

// GET /api/posts: search and Filter screen values (all optional, all text in
// the URL). Paging, platform, locality and the Following tab are read as
// before in the controller.
const rupees = (label) =>
  z
    .string({ error: `${label} must be a number.` })
    .trim()
    .regex(/^\d{1,12}$/, `${label} must be a whole number of rupees.`)
    .transform(Number)
    .optional();

// Size filter, in square feet (the app converts cents and acres).
const squareFeet = (label) =>
  z
    .string({ error: `${label} must be a number.` })
    .trim()
    .regex(/^\d{1,9}$/, `${label} must be a whole number of square feet.`)
    .transform(Number)
    .optional();

const feedFiltersSchema = z
  .object({
    q: z
      .string({ error: "Search must be text." })
      .trim()
      .max(80, "Search is too long (80 characters at most).")
      .optional(),
    // "Villa,House" or types=Villa&types=House
    types: z
      .union([z.string(), z.array(z.string())], { error: "Property types must be text." })
      .transform((value) =>
        (Array.isArray(value) ? value : [value])
          .flatMap((item) => item.split(","))
          .map((item) => item.trim())
          .filter(Boolean)
      )
      .pipe(z.array(choice(TYPES, "property type")).max(TYPES.length))
      .optional(),
    deal: z.enum(["Any", ...DEALS], { error: "Please choose Any, For sale or For rent." }).optional(),
    minPrice: rupees("Minimum price"),
    maxPrice: rupees("Maximum price"),
    minArea: squareFeet("Minimum size"),
    maxArea: squareFeet("Maximum size"),
    video: z.enum(["true", "false"], { error: "Video must be true or false." }).optional(),
    minBedrooms: z
      .string({ error: "Bedrooms must be a number." })
      .trim()
      .regex(/^\d{1,2}$/, "Bedrooms must be a number from 0 to 20.")
      .transform(Number)
      .pipe(z.number().max(20, "Bedrooms must be a number from 0 to 20."))
      .optional(),
  })
  .refine(
    (f) => f.minPrice === undefined || f.maxPrice === undefined || f.minPrice <= f.maxPrice,
    { path: ["minPrice"], message: "The minimum price can't be more than the maximum." }
  )
  .refine(
    (f) => f.minArea === undefined || f.maxArea === undefined || f.minArea <= f.maxArea,
    { path: ["minArea"], message: "The minimum size can't be more than the maximum." }
  );

// POST /api/posts/:id/comment
const commentSchema = z.object({
  text: z
    .string({ error: "Please write a comment." })
    .trim()
    .min(1, "Please write a comment.")
    .max(1000, "Comments can be up to 1,000 characters."),
});

// POST /api/posts/:id/report
const { REPORT_REASONS, PERSON_REPORT_REASONS } = require("../models/Report");
const reportSchema = z.object({
  reason: z.enum(REPORT_REASONS, { error: "Please choose a reason for the report." }),
  details: text(500, "Details").default(""),
});

// POST /api/posts/:id/comments/:commentId/report and POST /api/users/:id/report
const personReportSchema = z.object({
  reason: z.enum(PERSON_REPORT_REASONS, { error: "Please choose a reason for the report." }),
  details: text(500, "Details").default(""),
});

module.exports = {
  createPostSchema,
  updatePostSchema,
  feedFiltersSchema,
  commentSchema,
  reportSchema,
  personReportSchema,
  TYPES,
  DEALS,
  PLATFORMS,
  MAX_PHOTOS,
};
