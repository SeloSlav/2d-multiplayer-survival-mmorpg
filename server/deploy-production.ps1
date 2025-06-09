# Fast production database deployment script
# Updates existing database without deleting

Write-Host "🔄 Building and deploying to production database..." -ForegroundColor Yellow
spacetime publish --server maincloud --project-path . broth-bullets

Write-Host "🔄 Regenerating client bindings..." -ForegroundColor Yellow
spacetime generate --lang typescript --out-dir ../client/src/generated --project-path .

Write-Host "🔄 Committing and pushing to trigger Vercel deployment..." -ForegroundColor Yellow
cd ..
git add .
git commit -m "Deploy: Database update with latest changes"
git push

Write-Host "✅ Production deployment complete!" -ForegroundColor Green
Write-Host "🌐 Vercel will rebuild: https://broth-and-bullets.vercel.app" -ForegroundColor Cyan
Write-Host "🎯 Database: broth-bullets on maincloud" -ForegroundColor Cyan
Write-Host "📝 Database was updated (not wiped)" -ForegroundColor Blue 