import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(4000),
  FRONTEND_URL: Joi.string().uri().required(),
  BACKEND_URL: Joi.string().uri().required(),

  POSTGRES_HOST: Joi.string().required(),
  POSTGRES_PORT: Joi.number().default(5432),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  POSTGRES_DB: Joi.string().required(),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),

  MINIO_ENDPOINT: Joi.string().required(),
  MINIO_PORT: Joi.number().default(9000),
  MINIO_ACCESS_KEY: Joi.string().required(),
  MINIO_SECRET_KEY: Joi.string().required(),
  MINIO_BUCKET: Joi.string().required(),
  MINIO_USE_SSL: Joi.boolean().default(false),

  // Consumed starting Stage 2 (JWT auth). Optional (and allowed blank) so
  // Stage 1 can start without them, but the architecture already reserves
  // the shape.
  JWT_ACCESS_SECRET: Joi.string().allow('').optional(),
  JWT_REFRESH_SECRET: Joi.string().allow('').optional(),
});
