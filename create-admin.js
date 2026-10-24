/**
 * Script to create an admin user
 * 
 * Usage: node create-admin.js <name> <email> <password>
 * Example: node create-admin.js "Admin User" admin@example.com admin123
 */

const { hashPassword, passwordPolicyError } = require('./utils/password');
const { pool, closePool } = require('./config/database');

async function createAdmin() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.error('Usage: node create-admin.js <name> <email> <password>');
    console.error('Example: node create-admin.js "Admin User" admin@example.com admin123');
    process.exit(1);
  }

  const [name, email, password] = args;
  const normalizedEmail = String(email).trim().toLowerCase();
  const policyError = await passwordPolicyError(password);
  if (policyError) {
    console.error(policyError);
    await closePool();
    process.exit(1);
  }

  try {
    const [existing] = await pool.execute(
      'SELECT user_id FROM users WHERE lower(email) = lower(?)',
      [normalizedEmail]
    );

    if (existing.length > 0) {
      console.error(`User with email ${normalizedEmail} already exists!`);
      process.exitCode = 1;
      return;
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    const [result] = await pool.execute(
      "INSERT INTO users (name, email, password, role, created_at) VALUES (?, ?, ?, 'admin', NOW())",
      [name, normalizedEmail, passwordHash]
    );

    console.log('✓ Admin user created successfully!');
    console.log(`  Name: ${name}`);
    console.log(`  Email: ${normalizedEmail}`);
    console.log(`  Role: admin`);
    console.log(`  User ID: ${result.insertId}`);
    console.log('\nYou can now login with these credentials.');
  } catch (error) {
    console.error('Error creating admin user:', error.message);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

createAdmin();
