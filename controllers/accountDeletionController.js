// The website's Delete account page (https://<your server>/delete-account).
// Google Play requires a web page where people can delete their account
// without reinstalling the app. Two steps, no login needed:
//   1. POST /api/auth/delete-account/request-code  { email }
//      emails a 6-digit code (15 minutes, 5 tries, 60 s between codes).
//   2. POST /api/auth/delete-account/confirm       { email, code }
//      deletes the account and its data, exactly like the app's
//      Delete Account button (services/accountDeletion.js).
// The answers never say whether an email has an account.
const User = require("../models/User");
const codeService = require("../services/codeService");
const emailService = require("../services/emailService");
const { deleteAccountData } = require("../services/accountDeletion");

const SUPPORT = "WhatsApp +91 62356 49489";

const CODE_SENT =
  "If a PlotPost account uses this email, we've sent it a 6-digit code. It can take a minute to arrive; check your spam folder too.";

const requestDeletionCode = async (req, res) => {
  if (!emailService.canSend()) {
    return res.status(503).json({
      success: false,
      noEmail: true,
      message: `We can't send emails right now. To delete your account, message PlotPost support on ${SUPPORT} from the phone number or email on your account.`,
    });
  }

  const user = await User.findOne({ email: req.body.email }).select("+accountDeletion");
  if (user) {
    try {
      const code = codeService.issueDeletionCode(user);
      await user.save();
      await emailService.sendDeletionCode(user, code);
    } catch (error) {
      // A cooldown or a mail failure must not reveal that the account exists.
      if (!(error instanceof codeService.CodeError) && process.env.NODE_ENV !== "test") {
        console.warn("Account deletion email failed:", error.message);
      }
    }
  }

  return res.status(200).json({ success: true, message: CODE_SENT });
};

const confirmDeletion = async (req, res) => {
  const { email, code } = req.body;

  const user = await User.findOne({ email }).select("+accountDeletion");
  if (!user) {
    return res.status(400).json({ success: false, message: codeService.INVALID_CODE });
  }

  // Wrong or expired codes answer 400 (and count towards the 5 tries).
  await codeService.checkDeletionCode(user, code);

  try {
    await deleteAccountData(user);
  } catch (error) {
    console.error("Website account deletion failed:", error);
    return res.status(500).json({
      success: false,
      message: `Something went wrong while deleting your account. Please try again in a minute with the same code, or message PlotPost support on ${SUPPORT}.`,
    });
  }

  return res.status(200).json({
    success: true,
    message: "Your PlotPost account and its data have been deleted.",
  });
};

module.exports = { requestDeletionCode, confirmDeletion };
