const { ValidationError, UniqueConstraintError, ForeignKeyConstraintError } = require("sequelize");
const multer = require("multer");
const { ZodError } = require("zod");
const AppError = require("../utils/AppError");
const { config } = require("../config/env");
const errorAlerts = require("../services/errorAlerts");

const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

const zodDetails = (error) =>
  error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));

// Turns any error into { success: false, message } with the right status.
// Internal details are logged, never sent to the app.
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let status = 500;
  let message = "Something went wrong. Please try again.";
  let errors;

  if (err instanceof AppError) {
    status = err.statusCode;
    message = err.message;
    errors = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    errors = zodDetails(err);
    message = errors[0]?.message || "Invalid request.";
  } else if (err instanceof UniqueConstraintError) {
    // Checked before ValidationError: Sequelize's unique error extends it.
    status = 409;
    const field = err.errors?.[0]?.path || Object.keys(err.fields || {})[0] || "";
    message = /email/i.test(field) ? "An account with this email already exists." : "This already exists.";
  } else if (err instanceof ValidationError) {
    status = 400;
    errors = (err.errors || []).map((e) => ({ field: e.path, message: e.message }));
    message = errors[0]?.message || "Invalid data.";
  } else if (err instanceof ForeignKeyConstraintError) {
    status = 400;
    message = "That item doesn't exist.";
  } else if (err?.type === "entity.parse.failed") {
    status = 400;
    message = "The request body is not valid JSON.";
  } else if (err?.type === "entity.too.large") {
    status = 413;
    message = "The request is too large.";
  } else if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === "LIMIT_FILE_SIZE" ? "That file is too large." : err.message;
  } else if (err?.name === "JsonWebTokenError" || err?.name === "TokenExpiredError") {
    status = 401;
    message = "Your session has expired. Please log in again.";
  }

  if (status >= 500 && !config.isTest) {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
    // The route's pattern (e.g. /api/posts/:id), not the real ids or search words.
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || req.path;
    errorAlerts.report(err, { where: `${req.method} ${route}` });
  }

  const body = { success: false, message };
  if (errors) body.errors = errors;
  res.status(status).json(body);
};

module.exports = { notFound, errorHandler };
