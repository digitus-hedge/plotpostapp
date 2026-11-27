const { Op } = require("sequelize");
const { Report, AdminAction } = require("../models");

const RETENTION_MONTHS = 12;

const cutoffFrom = (now) => {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  return cutoff;
};

const runRetentionCleanup = async (now = new Date()) => {
  const cutoff = cutoffFrom(now);
  const reports = await Report.destroy({
    where: { status: "done", resolvedAt: { [Op.ne]: null, [Op.lt]: cutoff } },
  });
  const actions = await AdminAction.destroy({
    where: { createdAt: { [Op.lt]: cutoff } },
  });
  return { reports: reports || 0, adminActions: actions || 0 };
};

module.exports = { runRetentionCleanup, RETENTION_MONTHS };
