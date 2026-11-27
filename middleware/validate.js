// Checks the request against a zod schema before the controller runs. On
// success the parsed (trimmed, typed, with defaults) values replace the
// originals, so controllers can trust them. On failure the error handler
// sends a 400 with the first problem as the message.
//
//   validate(schema)                   checks req.body (how every route uses it)
//   validate({ body: a, params: b })   checks req.body and/or req.params
//
// (Before this fix only the second form worked, so routes passing a schema
// directly were not checked at all.)
const isSchema = (value) => Boolean(value) && typeof value.parse === "function";

const validate = (schemas) => {
  const { body, params } = isSchema(schemas) ? { body: schemas } : schemas || {};
  return (req, res, next) => {
    if (body) req.body = body.parse(req.body ?? {});
    if (params) req.params = params.parse(req.params ?? {});
    next();
  };
};

module.exports = validate;
