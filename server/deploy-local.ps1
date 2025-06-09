# Fast local database deployment script
# Updates existing database without deleting

Write-Host "🔄 Building and deploying to local database..." -ForegroundColor Yellow
spacetime publish --project-path . broth-bullets-local

Write-Host "🔄 Regenerating client bindings..." -ForegroundColor Yellow
spacetime generate --lang typescript --out-dir ../client/src/generated --project-path .

Write-Host "✅ Local deployment complete! Database: broth-bullets-local" -ForegroundColor Green
Write-Host "💡 Run 'npm run dev' in client folder to test" -ForegroundColor Cyan
Write-Host "📝 Database was updated (not wiped)" -ForegroundColor Blue 