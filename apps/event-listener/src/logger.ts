import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'event-listener', chain: env.LISTENER_CHAIN },
  timestamp: pino.stdTimeFunctions.isoTime,
});
