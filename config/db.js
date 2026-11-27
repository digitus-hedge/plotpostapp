const { Sequelize } = require("sequelize");
const { config } = require("./env");

let sequelize;

if (config.isTest) {
  sequelize = new Sequelize("sqlite::memory:", { logging: false });
} else {
  sequelize = new Sequelize(
    config.mysql.database,
    config.mysql.user,
    config.mysql.password,
    {
      host: config.mysql.host,
      port: config.mysql.port,
      dialect: "mysql",
      logging: !config.isProduction ? console.log : false,
      pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000,
      },
      dialectOptions: {
        connectTimeout: 15000,
      },
    }
  );
}

const connectDB = async () => {
  await sequelize.authenticate();
  if (!config.isTest) {
    console.log(`✅ MySQL connected to ${config.mysql.host}/${config.mysql.database}`);
  }
  await sequelize.sync({ alter: !config.isProduction });
  return sequelize;
};

const disconnectDB = async () => {
  if (sequelize) {
    await sequelize.close();
  }
};

module.exports = sequelize;
module.exports.sequelize = sequelize;
module.exports.connectDB = connectDB;
module.exports.disconnectDB = disconnectDB;
