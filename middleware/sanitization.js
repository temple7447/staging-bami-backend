const sanitize = require('mongo-sanitize');

const sanitizationMiddleware = (req, res, next) => {
  try {
    if (req.body) {
      req.body = sanitize(req.body);
    }
    if (req.query) {
      req.query = sanitize(req.query);
    }
    if (req.params) {
      req.params = sanitize(req.params);
    }
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = sanitizationMiddleware;
