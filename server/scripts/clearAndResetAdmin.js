require('dotenv').config({ path: `${__dirname}/../.env` });
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const Mill = require('../models/Mill');
const Quality = require('../models/Quality');
const Design = require('../models/Design');
const Stock = require('../models/Stock');
const User = require('../models/User');
const Role = require('../models/Role');

const { ensureDefaultRoles } = require('../controllers/roleController');

const clearAndResetAdmin = async () => {
  try {
    await connectDB();

    console.log('⏳ Clearing ALL existing data (Mills, Qualities, Designs, Stocks, Users, Roles)...');
    await Promise.all([
      Stock.deleteMany({}),
      User.deleteMany({}),
      Role.deleteMany({}),
      Mill.deleteMany({}),
      Quality.deleteMany({}),
      Design.deleteMany({}),
    ]);
    console.log('✅ All data cleared.');

    console.log('⏳ Seeding default roles...');
    await ensureDefaultRoles();
    console.log('✅ Default roles created.');

    const superadminRole = await Role.findOne({ key: 'superadmin' });
    if (!superadminRole) {
      throw new Error('Superadmin role not found after ensureDefaultRoles()');
    }

    console.log('⏳ Creating admin user (username: admin, password: Admin@123)...');
    await User.create({
      fullName: 'Admin',
      username: 'admin',
      password: 'Admin@123',
      roleId: superadminRole._id,
      roleKey: superadminRole.key,
      roleName: superadminRole.name,
      isActive: true,
      mailStatus: 'Not queued',
      permissionOverrides: [],
    });

    console.log('');
    console.log('🎉 Done! Database has been fully reset.');
    console.log('──────────────────────────────────────────');
    console.log('  Login credentials:');
    console.log('  Username : admin');
    console.log('  Password : Admin@123');
    console.log('──────────────────────────────────────────');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error while resetting:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
};

clearAndResetAdmin();
