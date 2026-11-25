const dns = require("dns");
const mongoose = require("mongoose");
const { config } = require("./env");

// Some Windows networks fail mongodb+srv lookups (querySrv ECONNREFUSED).
// Using public DNS fixes that locally; it is off in production.
const applyDnsWorkaround = () => {
  if (!config.dnsServers.length) return;
  try {
    dns.setServers(config.dnsServers);
  } catch (error) {
    console.warn("Could not apply DNS workaround:", error.message);
  }
};

const connectDB = async (uri = config.mongoUri) => {
  applyDnsWorkaround();
  const connection = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });
  if (!config.isTest) {
    console.log(`MongoDB connected: ${connection.connection.host}`);
  }
  return connection;
};

const disconnectDB = () => mongoose.disconnect();

module.exports = connectDB;
module.exports.connectDB = connectDB;
module.exports.disconnectDB = disconnectDB;
