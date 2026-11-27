const { z } = require("zod");

const email = z
  .string({ error: "Please enter your email address." })
  .trim()
  .toLowerCase()
  .max(254)
  .email("Please enter a valid email address.");

// New passwords: 8-72 characters with a letter and a number.
// (bcrypt only reads the first 72 bytes, hence the upper limit.)
const newPassword = z
  .string({ error: "Please enter a password." })
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be at most 72 characters.")
  .regex(/[A-Za-z]/, "Password must include at least one letter.")
  .regex(/[0-9]/, "Password must include at least one number.");

const registerSchema = z.object({
  name: z
    .string({ error: "Please enter your full name." })
    .trim()
    .min(2, "Please enter your full name.")
    .max(80, "Name is too long."),
  email,
  password: newPassword,
  // The sign-up checkbox "I agree to the Terms of Use".
  acceptTerms: z.boolean({ error: "acceptTerms must be true or false." }).optional(),
});

// Login accepts any existing password: older accounts were allowed 6 characters.
const loginSchema = z.object({
  email,
  password: z.string({ error: "Please enter your password." }).min(1, "Please enter your password.").max(200),
});

const googleSchema = z.object({
  idToken: z.string({ error: "Google sign-in failed. Please try again." }).min(20).max(5000),
});

const forgotPasswordSchema = z.object({ email });

const resetPasswordSchema = z.object({
  email,
  code: z
    .string({ error: "Please enter the 6-digit code." })
    .trim()
    .regex(/^\d{6}$/, "Please enter the 6-digit code."),
  newPassword,
});

// Change Password (logged in).
// POST /api/auth/verify-email — the 6-digit code from the email.
const verifyEmailSchema = z.object({
  code: z
    .string({ error: "Please enter the 6-digit code." })
    .trim()
    .regex(/^\d{6}$/, "Please enter the 6-digit code."),
});

// Website Delete account page: ask for a code, then confirm with it.
const deletionCodeSchema = z.object({ email });
const confirmDeletionSchema = z.object({
  email,
  code: z
    .string({ error: "Please enter the 6-digit code." })
    .trim()
    .regex(/^\d{6}$/, "Please enter the 6-digit code."),
});

const changePasswordSchema = z.object({
  currentPassword: z
    .string({ error: "Please enter your current password." })
    .min(1, "Please enter your current password.")
    .max(200),
  newPassword,
});

// Delete account: password accounts send their password; Google-only accounts
// type DELETE. Which one is needed is checked in the controller.
const deleteAccountSchema = z.object({
  password: z.string().max(200).optional(),
  confirm: z.string().trim().max(20).optional(),
});

module.exports = {
  changePasswordSchema,
  deleteAccountSchema,
  newPassword,
  registerSchema,
  loginSchema,
  googleSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  deletionCodeSchema,
  confirmDeletionSchema,
};
