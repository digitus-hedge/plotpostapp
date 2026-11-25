// Blocks MongoDB operator injection: removes any key that starts with "$"
// or contains "." from the request body and URL params, at any depth.
// Example attack this stops: { "email": { "$ne": null }, "password": "x" }.
// (Express 5's default query parser never builds nested objects, so
// req.query values are always plain strings.)

const isUnsafeKey = (key) => key.startsWith("$") || key.includes(".");

const clean = (value, depth = 0) => {
  if (depth > 20 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = clean(value[i], depth + 1);
    return value;
  }
  for (const key of Object.keys(value)) {
    if (isUnsafeKey(key)) {
      delete value[key];
    } else {
      value[key] = clean(value[key], depth + 1);
    }
  }
  return value;
};

const sanitizeRequest = (req, res, next) => {
  if (req.body && typeof req.body === "object") clean(req.body);
  if (req.params && typeof req.params === "object") clean(req.params);
  next();
};

module.exports = { sanitizeRequest, clean };
