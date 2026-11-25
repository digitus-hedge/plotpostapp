// The user object the app receives. Keeps both `id` and `_id` because the
// existing Flutter code reads either. Never includes password, codes or googleId.
const serializeUser = (user) => {
  if (!user) return null;
  const settings = user.settings || {};
  return {
    id: user._id,
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    profileImage: user.profileImage || "",
    bio: user.bio || "",
    agency: user.agency || "",
    designation: user.designation || "",
    location: user.location || "",
    role: user.role || "user",
    isEmailVerified: Boolean(user.isEmailVerified),
    googleLinked: Boolean(user.googleId),
    settings: {
      pushNotifications: settings.pushNotifications !== false,
      emailInquiries: settings.emailInquiries !== false,
      showPhoneNumber: settings.showPhoneNumber !== false,
    },
    createdAt: user.createdAt,
  };
};

// What other people can see about a user.
const serializePublicUser = (user) => {
  if (!user) return null;
  const showPhone = user.settings?.showPhoneNumber !== false;
  return {
    id: user._id,
    _id: user._id,
    name: user.name,
    profileImage: user.profileImage || "",
    bio: user.bio || "",
    agency: user.agency || "",
    designation: user.designation || "",
    location: user.location || "",
    phone: showPhone ? user.phone || "" : "",
    createdAt: user.createdAt,
  };
};

module.exports = { serializeUser, serializePublicUser };
