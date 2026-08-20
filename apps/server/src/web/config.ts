export function hasTurnstileConfiguration(env: {
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
}): boolean {
  return Boolean(env.TURNSTILE_SITE_KEY?.trim() && env.TURNSTILE_SECRET?.trim());
}
