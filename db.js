import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// ⚡ Pour accepter les certificats auto-signés (dev uniquement)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Supabase impose SSL
});

// Test de connexion
pool.query('SELECT NOW()')
  .then(res => {
    console.log('✅ Connecté à Supabase PostgreSQL:', res.rows[0]);
  })
  .catch(err => {
    console.error('❌ Erreur de connexion DB:', err);
    process.exit(1);
  });

export default pool;