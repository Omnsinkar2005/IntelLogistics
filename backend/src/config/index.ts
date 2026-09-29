import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parseInt(process.env.PORT ?? "3001", 10),
  databaseUrl: required("DATABASE_URL"),
  isDev: (process.env.NODE_ENV ?? "development") === "development",
} as const;
