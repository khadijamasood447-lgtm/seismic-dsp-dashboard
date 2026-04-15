// scripts/validate-env.cjs
const requiredEnvVars = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY'
];

console.log('🔍 Validating environment variables...');

const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missing.length > 0) {
  console.error('❌ Missing required environment variables:', missing.join(', '));
  console.error('Please add these to your .env.local file or Vercel environment variables.');
  process.exit(1);
} else {
  console.log('✅ All required environment variables are set');
  process.exit(0);
}
