require("dotenv").config();
const { connectDB, disconnectDB } = require("../config/db");
const { User } = require("../models");

const run = async () => {
  const args = process.argv.slice(2);
  const list = args.includes("--list");
  const remove = args.includes("--remove");
  const email = (args.find((arg) => !arg.startsWith("--")) || "").trim().toLowerCase();

  if (!list && !email) {
    console.error("Usage: node scripts/make-admin.js <email> [--remove]   or   --list");
    process.exit(1);
  }

  await connectDB();

  if (list) {
    const admins = await User.findAll({ where: { role: "admin" } });
    console.log(admins.length ? admins.map((a) => `${a.name} <${a.email}>`).join("\n") : "No admins yet.");
  } else {
    const user = await User.findOne({ where: { email } });
    if (user) {
      user.role = remove ? "user" : "admin";
      await user.save();
      console.log(`${user.email} is now: ${user.role}`);
    } else {
      console.log(`No account found with email ${email}`);
    }
  }
  await disconnectDB();
};

run().catch(async (error) => {
  console.error("Failed:", error.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
