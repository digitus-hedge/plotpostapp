const { z } = require("zod");
const { CONTACT_METHODS, ENQUIRY_STATUSES } = require("../models/Enquiry");

const text = (max, label) =>
  z
    .string({ error: `${label} must be text.` })
    .trim()
    .max(max, `${label} is too long (${max} characters at most).`);

const isEmail = (value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

// POST /api/enquiries (Show Interest). The post's title and seller are
// filled in by the server from the post, so anything sent for them is ignored.
const createEnquirySchema = z
  .object({
    // A MySQL post id; the app may send it as text or a number.
    postId: z.preprocess(
      (value) => (typeof value === "number" ? String(value) : value),
      z
        .string({ error: "Please choose a property." })
        .trim()
        .regex(/^[1-9]\d{0,9}$/, "Please choose a property.")
    ),
    name: text(80, "Name").min(1, "Please enter your name."),
    phone: text(20, "Phone number").refine((value) => {
      const digits = value.replace(/[^0-9]/g, "");
      return /^[0-9+()\-\s]*$/.test(value) && digits.length >= 10 && digits.length <= 13;
    }, "Please enter a valid phone number."),
    email: text(120, "Email")
      .refine((value) => value === "" || isEmail(value), "Please enter a valid email address.")
      .default(""),
    message: text(1000, "Message").min(10, "Please write a short message (at least 10 characters)."),
    contactMethod: z
      .enum(CONTACT_METHODS, { error: `Please choose ${CONTACT_METHODS.join(", ")}.` })
      .default("Phone call"),
    wantsVisit: z.boolean({ error: "wantsVisit must be true or false." }).default(false),
  })
  .refine((enquiry) => enquiry.contactMethod !== "Email" || enquiry.email !== "", {
    path: ["email"],
    message: "Please add your email to be contacted by email.",
  });

// PATCH /api/enquiries/:id (seller): mark read / unread, or change status.
const updateEnquirySchema = z
  .object({
    status: z
      .enum(ENQUIRY_STATUSES, { error: `Status must be ${ENQUIRY_STATUSES.join(", ")}.` })
      .optional(),
    read: z.boolean({ error: "read must be true or false." }).optional(),
  })
  .refine((update) => update.status !== undefined || update.read !== undefined, {
    message: "Nothing to change.",
  });

module.exports = { createEnquirySchema, updateEnquirySchema };
