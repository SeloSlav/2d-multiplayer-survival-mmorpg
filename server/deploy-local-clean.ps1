# Fast local database deployment script - CLEAN VERSION
# Deletes database first for completely fresh start

Write-Host "🗑️ Deleting local database first..." -ForegroundColor Red
spacetime delete broth-bullets-local

Write-Host "🔄 Building and deploying to fresh local database..." -ForegroundColor Yellow
spacetime publish --project-path . broth-bullets-local

Write-Host "🔄 Regenerating client bindings..." -ForegroundColor Yellow
spacetime generate --lang typescript --out-dir ../client/src/generated --project-path .

Write-Host "✅ Clean local deployment complete! Database: broth-bullets-local" -ForegroundColor Green
Write-Host "💡 Run 'npm run dev' in client folder to test" -ForegroundColor Cyan
Write-Host "🧹 Database was completely wiped and recreated" -ForegroundColor Magenta 