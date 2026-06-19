import pool from './database';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

async function seed(): Promise<void> {
  console.log('🌱  Seeding database...\n');

  // Demo users
  const users = [
    { id: uuid(), username: 'john_smith',  email: 'john@example.com',  full_name: 'John Smith',  phone: '+44751234567', talent_type: 'Dancer' },
    { id: uuid(), username: 'dance89',     email: 'dance89@example.com', full_name: 'Dance89',   phone: null,          talent_type: 'Dancer' },
    { id: uuid(), username: 'bbc_news',    email: 'bbc@example.com',   full_name: 'BBC News',   phone: null,          talent_type: 'Viewer' },
    { id: uuid(), username: 'star_voice',  email: 'star@example.com',  full_name: 'Star Voice', phone: null,          talent_type: 'Singer' },
    { id: uuid(), username: 'jazz_master', email: 'jazz@example.com',  full_name: 'Jazz Master',phone: null,          talent_type: 'Musician' },
  ];

  const passwordHash = await bcrypt.hash('Password123!', 12);

  for (const u of users) {
    await pool.query(
      `INSERT IGNORE INTO users (id, username, email, password_hash, full_name, phone, talent_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [u.id, u.username, u.email, passwordHash, u.full_name, u.phone, u.talent_type]
    );
  }
  console.log(`✅  ${users.length} users seeded`);

  // Demo follows
  const john = users[0];
  const others = users.slice(1);
  for (const other of others) {
    await pool.query(
      `INSERT IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)`,
      [john.id, other.id]
    );
  }
  console.log('✅  Follows seeded');

  console.log('\n✨  Seed complete!\n');
  console.log('   Demo credentials  →  john@example.com  /  Password123!\n');
  await pool.end();
}

seed().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
