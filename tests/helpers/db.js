const mongoose = require("mongoose");

let memoryServer;

// Each test file gets its own empty database, dropped at the end.
const connect = async (name) => {
  let baseUri = process.env.TEST_MONGODB_URI;
  if (!baseUri) {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    memoryServer = await MongoMemoryServer.create();
    baseUri = memoryServer.getUri();
  }
  const url = new URL(baseUri);
  url.pathname = `/plotpost_test_${name}`;
  await mongoose.connect(url.toString(), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.db.dropDatabase();
  // Build indexes (unique email etc.) before the tests rely on them.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
};

const clear = async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
};

const close = async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
};

module.exports = { connect, clear, close };
