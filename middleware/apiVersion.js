const apiVersion = 'v1';

const versioningMiddleware = (req, res, next) => {
  req.apiVersion = apiVersion;
  res.setHeader('API-Version', apiVersion);
  next();
};

const versionedRoutes = (app) => {
  return (routePath, handler) => {
    app.use(`/api/v1${routePath}`, handler);
  };
};

module.exports = { versioningMiddleware, versionedRoutes, apiVersion };
