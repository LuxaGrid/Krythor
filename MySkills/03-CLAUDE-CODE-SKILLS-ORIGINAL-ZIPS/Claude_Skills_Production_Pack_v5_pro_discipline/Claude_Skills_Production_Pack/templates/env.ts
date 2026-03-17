/**
 * Copy to: src/lib/env.ts
 * Purpose: enforce env vars early, prevent silent misconfig.
 *
 * Never put secrets in env.example.
 */
type Required = {
  NEXT_PUBLIC_FIREBASE_API_KEY: string;
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: string;
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: string;
  NEXT_PUBLIC_FIREBASE_APP_ID: string;
  // Add more as needed
};

function req(name: keyof Required): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env: Required = {
  NEXT_PUBLIC_FIREBASE_API_KEY: req("NEXT_PUBLIC_FIREBASE_API_KEY"),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: req("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: req("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
  NEXT_PUBLIC_FIREBASE_APP_ID: req("NEXT_PUBLIC_FIREBASE_APP_ID"),
};
