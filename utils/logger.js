const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

winston.addColors(logColors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, requestId, ...metadata }) => {
    let msg = `${timestamp} [${level.toUpperCase()}]`;
    if (requestId) msg += ` [req:${requestId}]`;
    msg += `: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, requestId, ...metadata }) => {
    let msg = `${timestamp} ${level}: ${message}`;
    if (requestId) msg += ` [req:${requestId}]`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

const transports = [
  new winston.transports.Console({
    format: consoleFormat,
  }),
];

if (process.env.NODE_ENV === 'production') {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880,
      maxFiles: 5,
    })
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  levels: logLevels,
  format,
  transports,
  exitOnError: false,
});

logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

const logError = (endpoint, error, context = {}) => {
  const safeError = error || {};
  const errorDetails = {
    endpoint,
    context,
    error: {
      message: safeError.message || 'No message provided',
      code: safeError.code,
      name: safeError.name,
      path: safeError.path,
      value: safeError.value,
      kind: safeError.kind,
      status: safeError.status,
      statusCode: safeError.statusCode
    }
  };

  logger.error(safeError.message || 'No message provided', {
    endpoint,
    ...context,
    error: errorDetails.error
  });

  return errorDetails;
};

const logInfo = (message, data = {}) => {
  logger.info(message, data);
};

const logWarning = (message, data = {}) => {
  logger.warn(message, data);
};

module.exports = {
  logger,
  logError,
  logInfo,
  logWarning
};
