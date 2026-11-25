// Gives an existing account the admin role (or takes it away). Admins can
// open the admin panel at /admin (log in there with the account's email and
// password; Google-only accounts set a password with Forgot Password first).
//
//   node scripts/make-admin.js someone@example.com
//   node scripts/make-admin.js someone@example.com --remove
//   node scripts/make-admin.js --list          shows all admins
//
// Uses MONGODB_URI from .env. Changes only that one account's role.
require("dotenv").config();
const dns = require("dns");
const mongoose = require("mongoose");
const User = require("../models/User");

const run = async () => {
  const args = process.argv.slice(2);
  const list = args.includes("--list");
  const remove = args.includes("--remove");
  const email = (args.find((arg) => !arg.startsWith("--")) || "").trim().toLowerCase();
  if (!list && !email) {
    console.error("Usage: node scripts/make-admin.js <email> [--remove]   or   --list");
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is not set in .env");
    process.exit(1);
  }
  // Same Windows DNS fix as server.js (mongodb+srv lookups).
  try {
    dns.setServers(["1.1.1.1", "8.8.8.8"]);
  } catch (error) {
    // ignore
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

  if (list) {
    const admins = await User.find({ role: "admin" }).select("name email").lean();
    console.log(admins.length ? admins.map((a) => `${a.name} <${a.email}>`).join("\n") : "No admins yet.");
  } else {
    const user = await User.findOneAndUpdate(
      { email },
      { $set: { role: remove ? "user" : "admin" } },
      { new: true }
    );
    console.log(user ? `${user.email} is now: ${user.role}` : `No account found with email ${email}`);
  }
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
