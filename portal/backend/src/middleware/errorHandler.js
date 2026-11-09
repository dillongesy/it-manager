import { config } from '../config/index.js';

export function errorHandler(err, req, res, _next) {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, err);

  const status = err.status ?? 500;
  const body = {
    error: status < 500 ? err.message : 'An internal error occurred.',
  };

  if (config.isDev && status >= 500) {
    body.stack = err.stack;
  }

  res.status(status).json(body);
}
