const { z } = require("zod");

const text = (max, label) =>
  z
    .string({ error: `${label} must be text.` })
    .trim()
    .max(max, `${label} is too long (${max} characters at most).`);

// PUT /api/users/profile — only the fields sent are changed. Email can't be
// changed here (it's the login). Whether profileImage is one of our own
// uploaded photos is checked in the controller.
const updateProfileSchema = z.object({
  name: text(60, "Name").min(2, "Please enter your name.").optional(),
  phone: text(20, "Phone number")
    .refine((value) => {
      if (value === "") return true;
      const digits = value.replace(/[^0-9]/g, "");
      return /^[0-9+()\-\s]*$/.test(value) && digits.length >= 10 && digits.length <= 13;
    }, "Please enter a valid phone number.")
    .optional(),
  bio: text(300, "Bio").optional(),
  agency: text(80, "Agency").optional(),
  profession: text(60, "Role").optional(),
  location: text(80, "Location").optional(),
  profileImage: text(500, "Photo link").optional(),
  settings: z
    .object(
      {
        pushNotifications: z.boolean({ error: "Settings must be true or false." }).optional(),
        emailInquiries: z.boolean({ error: "Settings must be true or false." }).optional(),
      },
      { error: "Settings must be a list of on/off choices." }
    )
    .optional(),
});

module.exports = { updateProfileSchema };
