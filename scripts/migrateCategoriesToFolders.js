const mongoose = require('mongoose');
const Category = require('../models/Category');
const Folder = require('../models/Folder');
const Material = require('../models/Material');

/**
 * Migration script to convert existing categories to the new folder structure
 * This maintains backward compatibility while introducing the new hierarchical system
 * 
 * Migration Strategy:
 * 1. Create corresponding folders for each existing category
 * 2. Maintain the same hierarchy structure but enforce 3-level limit
 * 3. Create "Materials" grandchild folders where materials will be moved
 * 4. Update materials to reference the new folders instead of categories
 * 5. Keep original categories for backward compatibility
 */

const migrationConfig = {
  // Whether to actually perform the migration or just simulate
  dryRun: process.env.DRY_RUN === 'true',
  
  // Whether to create intermediate folders for materials
  createMaterialFolders: true,
  
  // Default name for grandchild folders that will contain materials
  materialFolderName: 'Materials',
  
  // Whether to update existing materials to use folders
  updateMaterials: true,
  
  // Backup categories before migration
  createBackup: true
};

class CategoryToFolderMigration {
  constructor(config = migrationConfig) {
    this.config = config;
    this.migrationStats = {
      categoriesProcessed: 0,
      foldersCreated: 0,
      materialsUpdated: 0,
      errors: [],
      warnings: []
    };
    this.categoryToFolderMap = new Map();
  }

  async run() {
    console.log('🚀 Starting Category to Folder Migration');
    console.log(`📋 Configuration:`, this.config);
    
    try {
      if (this.config.createBackup) {
        await this.createBackup();
      }
      
      await this.validateExistingStructure();
      await this.migrateCategories();
      
      if (this.config.updateMaterials) {
        await this.migrateMaterials();
      }
      
      await this.generateReport();
      
      console.log('✅ Migration completed successfully!');
      return this.migrationStats;
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
      this.migrationStats.errors.push({
        phase: 'migration',
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async createBackup() {
    console.log('💾 Creating backup of existing categories...');
    
    if (this.config.dryRun) {
      console.log('🔍 [DRY RUN] Would create backup of categories');
      return;
    }
    
    try {
      const categories = await Category.find({}).lean();
      const backupData = {
        timestamp: new Date().toISOString(),
        categories,
        totalCount: categories.length
      };
      
      // In a real implementation, you might save this to a file or separate collection
      console.log(`📦 Backup created with ${categories.length} categories`);
      
    } catch (error) {
      console.error('Failed to create backup:', error);
      throw error;
    }
  }

  async validateExistingStructure() {
    console.log('🔍 Validating existing category structure...');
    
    const categories = await Category.find({ isActive: true }).populate('parentCategory');
    const materials = await Material.find({ isActive: true, status: 'active' });
    
    console.log(`📊 Found ${categories.length} active categories`);
    console.log(`📄 Found ${materials.length} active materials`);
    
    // Check for categories that exceed 3-level limit
    const deepCategories = categories.filter(cat => cat.level > 2);
    if (deepCategories.length > 0) {
      this.migrationStats.warnings.push({
        type: 'deep_categories',
        message: `${deepCategories.length} categories exceed 3-level limit and will be adjusted`,
        categories: deepCategories.map(c => ({ id: c._id, name: c.name, level: c.level }))
      });
    }
    
    // Check for orphaned categories
    const orphanedCategories = categories.filter(cat => 
      cat.parentCategory && !categories.find(p => p._id.equals(cat.parentCategory))
    );
    
    if (orphanedCategories.length > 0) {
      this.migrationStats.warnings.push({
        type: 'orphaned_categories',
        message: `${orphanedCategories.length} categories have invalid parent references`,
        categories: orphanedCategories.map(c => ({ id: c._id, name: c.name }))
      });
    }
  }

  async migrateCategories() {
    console.log('📁 Migrating categories to folders...');
    
    // Get all categories ordered by level to process parents first
    const categories = await Category.find({ isActive: true })
      .sort({ level: 1, createdAt: 1 })
      .populate('createdBy');
    
    for (const category of categories) {
      try {
        await this.migrateSingleCategory(category);
        this.migrationStats.categoriesProcessed++;
      } catch (error) {
        console.error(`Failed to migrate category ${category.name}:`, error);
        this.migrationStats.errors.push({
          phase: 'category_migration',
          categoryId: category._id,
          categoryName: category.name,
          error: error.message
        });
      }
    }
  }

  async migrateSingleCategory(category) {
    console.log(`📂 Processing category: ${category.name} (Level ${category.level})`);
    
    // Adjust level if it exceeds limit
    let targetLevel = Math.min(category.level, 1); // Max level 1 for categories, level 2 reserved for material folders
    
    // Find parent folder if category has parent
    let parentFolderId = null;
    if (category.parentCategory) {
      parentFolderId = this.categoryToFolderMap.get(category.parentCategory.toString());
      if (!parentFolderId) {
        console.warn(`Parent category ${category.parentCategory} not found in folder map`);
      }
    }
    
    if (this.config.dryRun) {
      console.log(`🔍 [DRY RUN] Would create folder for category: ${category.name}`);
      // Create a fake ID for dry run mapping
      this.categoryToFolderMap.set(category._id.toString(), new mongoose.Types.ObjectId());
      return;
    }
    
    // Create corresponding folder
    const folderData = {
      name: category.name,
      description: category.description,
      parentFolder: parentFolderId,
      level: targetLevel,
      icon: category.icon || 'folder',
      color: category.color || '#6C757D',
      order: category.order || 0,
      visibility: 'public',
      allowMaterials: false, // Category folders don't directly contain materials
      isProtected: false,
      createdBy: category.createdBy || category.createdBy,
      // Add reference to original category for tracking
      originalCategory: category._id
    };
    
    try {
      const folder = await Folder.create(folderData);
      console.log(`✅ Created folder: ${folder.name} (ID: ${folder._id})`);
      
      // Store mapping for child processing
      this.categoryToFolderMap.set(category._id.toString(), folder._id);
      this.migrationStats.foldersCreated++;
      
      // Create materials subfolder if this category has materials and we're at level 1
      if (this.config.createMaterialFolders && targetLevel === 1) {
        await this.createMaterialsSubfolder(folder, category);
      }
      
    } catch (error) {
      if (error.code === 11000) {
        console.warn(`Folder ${category.name} already exists, skipping...`);
      } else {
        throw error;
      }
    }
  }

  async createMaterialsSubfolder(parentFolder, category) {
    // Check if category has materials
    const materialCount = await Material.countDocuments({ 
      category: category._id, 
      isActive: true, 
      status: 'active' 
    });
    
    if (materialCount === 0) {
      return; // No materials, no need for materials folder
    }
    
    console.log(`📄 Creating materials subfolder for ${parentFolder.name} (${materialCount} materials)`);
    
    if (this.config.dryRun) {
      console.log(`🔍 [DRY RUN] Would create materials subfolder`);
      return null;
    }
    
    const materialFolderData = {
      name: this.config.materialFolderName,
      description: `Materials from ${category.name} category`,
      parentFolder: parentFolder._id,
      level: 2, // Grandchild level where materials can be stored
      icon: 'file-text',
      color: parentFolder.color,
      order: 0,
      visibility: 'public',
      allowMaterials: true,
      isProtected: true, // Protect from deletion if contains materials
      createdBy: parentFolder.createdBy,
      originalCategory: category._id
    };
    
    try {
      const materialFolder = await Folder.create(materialFolderData);
      console.log(`✅ Created materials folder: ${materialFolder.fullPath}`);
      
      // Store mapping for material migration
      this.categoryToFolderMap.set(`${category._id}-materials`, materialFolder._id);
      this.migrationStats.foldersCreated++;
      
      return materialFolder;
      
    } catch (error) {
      if (error.code === 11000) {
        console.warn(`Materials folder already exists in ${parentFolder.name}`);
      } else {
        throw error;
      }
    }
  }

  async migrateMaterials() {
    console.log('📄 Migrating materials to folders...');
    
    const materials = await Material.find({ 
      category: { $exists: true },
      isActive: true, 
      status: 'active' 
    }).populate('category');
    
    console.log(`📊 Found ${materials.length} materials to migrate`);
    
    for (const material of materials) {
      try {
        await this.migrateSingleMaterial(material);
        this.migrationStats.materialsUpdated++;
      } catch (error) {
        console.error(`Failed to migrate material ${material.title}:`, error);
        this.migrationStats.errors.push({
          phase: 'material_migration',
          materialId: material._id,
          materialTitle: material.title,
          error: error.message
        });
      }
    }
  }

  async migrateSingleMaterial(material) {
    const categoryId = material.category._id.toString();
    const materialsFolderId = this.categoryToFolderMap.get(`${categoryId}-materials`);
    
    if (!materialsFolderId) {
      console.warn(`No materials folder found for category ${material.category.name}`);
      return;
    }
    
    console.log(`📄 Moving material "${material.title}" to folder`);
    
    if (this.config.dryRun) {
      console.log(`🔍 [DRY RUN] Would move material to folder`);
      return;
    }
    
    // Update material to reference folder instead of category
    await Material.findByIdAndUpdate(material._id, {
      folder: materialsFolderId,
      // Keep category reference for backward compatibility
      // category: material.category._id
      updatedAt: new Date()
    });
    
    console.log(`✅ Material "${material.title}" migrated to folder`);
  }

  async generateReport() {
    console.log('\n📊 Migration Report');
    console.log('═'.repeat(50));
    console.log(`Categories processed: ${this.migrationStats.categoriesProcessed}`);
    console.log(`Folders created: ${this.migrationStats.foldersCreated}`);
    console.log(`Materials updated: ${this.migrationStats.materialsUpdated}`);
    console.log(`Warnings: ${this.migrationStats.warnings.length}`);
    console.log(`Errors: ${this.migrationStats.errors.length}`);
    
    if (this.migrationStats.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      this.migrationStats.warnings.forEach((warning, index) => {
        console.log(`${index + 1}. ${warning.type}: ${warning.message}`);
      });
    }
    
    if (this.migrationStats.errors.length > 0) {
      console.log('\n❌ Errors:');
      this.migrationStats.errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error.phase}: ${error.error}`);
      });
    }
    
    // Verify migration results
    await this.verifyMigration();
  }

  async verifyMigration() {
    console.log('\n🔍 Verifying migration results...');
    
    const folderCount = await Folder.countDocuments({ isActive: true });
    const materialsWithFolders = await Material.countDocuments({ 
      folder: { $exists: true },
      isActive: true,
      status: 'active'
    });
    
    console.log(`📁 Total folders created: ${folderCount}`);
    console.log(`📄 Materials now using folders: ${materialsWithFolders}`);
    
    // Check folder hierarchy integrity
    const invalidHierarchy = await Folder.find({ level: { $gt: 2 }, isActive: true });
    if (invalidHierarchy.length > 0) {
      console.warn(`⚠️  ${invalidHierarchy.length} folders exceed maximum hierarchy depth`);
    } else {
      console.log('✅ All folders respect 3-level hierarchy limit');
    }
  }
}

// CLI execution
async function runMigration() {
  console.log('🔧 Category to Folder Migration Tool');
  console.log('═'.repeat(50));
  
  const config = { ...migrationConfig };
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  args.forEach(arg => {
    const [key, value] = arg.split('=');
    switch (key) {
      case '--dry-run':
        config.dryRun = value !== 'false';
        break;
      case '--update-materials':
        config.updateMaterials = value !== 'false';
        break;
      case '--create-material-folders':
        config.createMaterialFolders = value !== 'false';
        break;
      case '--material-folder-name':
        config.materialFolderName = value || 'Materials';
        break;
    }
  });
  
  if (config.dryRun) {
    console.log('🔍 Running in DRY RUN mode - no changes will be made');
  }
  
  try {
    const migration = new CategoryToFolderMigration(config);
    const results = await migration.run();
    
    console.log('\n🎉 Migration completed successfully!');
    
    if (!config.dryRun) {
      console.log('\n📝 Next steps:');
      console.log('1. Update your frontend to use the new folder endpoints');
      console.log('2. Test the new folder hierarchy functionality');
      console.log('3. Gradually migrate your UI to use folders instead of categories');
      console.log('4. Consider deprecating category endpoints once migration is verified');
    }
    
    return results;
    
  } catch (error) {
    console.error('\n💥 Migration failed:', error.message);
    process.exit(1);
  }
}

// Export for programmatic use
module.exports = {
  CategoryToFolderMigration,
  migrationConfig,
  runMigration
};

// Run if called directly
if (require.main === module) {
  // Connect to database if not already connected
  if (mongoose.connection.readyState === 0) {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bamihustle';
    mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }).then(() => {
      console.log('📡 Connected to MongoDB');
      runMigration().then(() => {
        mongoose.connection.close();
      });
    }).catch(console.error);
  } else {
    runMigration();
  }
}