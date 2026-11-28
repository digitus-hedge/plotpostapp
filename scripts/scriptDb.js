// Opens PlotPost's MySQL database (the MYSQL_* settings in .env) for a
// one-off script. Unlike the server it never creates or changes tables:
// it only connects.
//
//   const db = require("./scriptDb");
//   await db.open();
//   ...
//   await db.close();
const sequelize = require("../config/db");
const { config } = require("../config/env");

// Scripts print their own results; don't also print every SQL statement.
sequelize.options.logging = false;

// "plotpost on localhost:3306" (never the password).
const describe = () => `${config.mysql.database} on ${config.mysql.host}:${config.mysql.port}`;

const open = async () => {
  try {
    await sequelize.authenticate();
  } catch (error) {
    throw new Error(`Can't connect to MySQL (${describe()}): ${error.message}. Check the MYSQL_* settings in .env.`);
  }
  return sequelize;
};

const close = () => sequelize.close().catch(() => {});

module.exports = { open, close, describe, sequelize };
