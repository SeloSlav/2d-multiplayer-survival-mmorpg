#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get all blog post files
const blogPostsDir = path.join(__dirname, '../client/src/blog/data/posts');
const sitemapPath = path.join(__dirname, '../public/sitemap.xml');

async function updateSitemap() {
  try {
    console.log('🔄 Updating sitemap.xml...');
    
    // Read all blog post files
    const files = fs.readdirSync(blogPostsDir).filter(file => 
      file.endsWith('.js') && file !== 'template.js'
    );
    
    const blogPosts = [];
    
    // Extract slug and date from each post
    for (const file of files) {
      const filePath = path.join(blogPostsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Extract slug
      const slugMatch = content.match(/slug:\s*["']([^"']+)["']/);
      
      // Extract date
      const dateMatch = content.match(/date:\s*["']([^"']+)["']/);
      
      if (slugMatch && dateMatch) {
        blogPosts.push({
          slug: slugMatch[1],
          date: dateMatch[1]
        });
      }
    }
    
    // Sort by date (newest first)
    blogPosts.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Generate sitemap XML
    const sitemapContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  
  <!-- Main Game Page -->
  <url>
    <loc>https://brothandbullets.com/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  
  <!-- Blog Main Page -->
  <url>
    <loc>https://brothandbullets.com/blog</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  
  <!-- Blog Posts -->
${blogPosts.map(post => `  <url>
    <loc>https://brothandbullets.com/blog/${post.slug}</loc>
    <lastmod>${post.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n')}
  
</urlset>`;
    
    // Write the sitemap
    fs.writeFileSync(sitemapPath, sitemapContent);
    
    console.log(`✅ Sitemap updated with ${blogPosts.length} blog posts`);
    console.log('📝 Blog posts included:');
    blogPosts.forEach(post => {
      console.log(`   - ${post.slug} (${post.date})`);
    });
    
  } catch (error) {
    console.error('❌ Error updating sitemap:', error);
    process.exit(1);
  }
}

// Run the script
updateSitemap(); 