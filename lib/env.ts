export function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return v
}

export function requireEnvAny(names: string[]): string {
  for (const name of names) {
    const v = process.env[name]
    if (v) return v
  }
  throw new Error(`Missing required env var: ${names.join(' or ')}`)
}

