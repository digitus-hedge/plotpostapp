// Gives an account the admin role (or takes it away), or lists the admins.
//
//   npm run make-admin -- someone@example.com
//   npm run make-admin -- someone@example.com --remove
//   npm run make-admin -- --list
const db = require("./scriptDb");
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

  await db.open();

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
  await db.close();
};

run().catch(async (error) => {
  console.error("Failed:", error.message);
  await db.close();
  process.exit(1);
});
