/**
 * Script to create an admin user
 * 
 * Usage: node create-admin.js <name> <email> <password>
 * Example: node create-admin.js "Admin User" admin@example.com admin123
 */

const bcrypt = require('bcrypt');
const { pool } = require('./config/database');

async function createAdmin() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.error('Usage: node create-admin.js <name> <email> <password>');
    console.error('Example: node create-admin.js "Admin User" admin@example.com admin123');
    process.exit(1);
  }

  const [name, email, password] = args;

  try {
    // Check if user already exists
    const [existing] = await pool.execute(
      'SELECT user_id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      console.error(`User with email ${email} already exists!`);
      process.exit(1);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create admin user
    const [result] = await pool.execute(
      "INSERT INTO users (name, email, password, role, created_at) VALUES (?, ?, ?, 'admin', NOW())",
      [name, email, passwordHash]
    );

    console.log('✓ Admin user created successfully!');
    console.log(`  Name: ${name}`);
    console.log(`  Email: ${email}`);
    console.log(`  Role: admin`);
    console.log(`  User ID: ${result.insertId}`);
    console.log('\nYou can now login with these credentials.');

    process.exit(0);
  } catch (error) {
    console.error('Error creating admin user:', error.message);
    process.exit(1);
  }
}

createAdmin();
