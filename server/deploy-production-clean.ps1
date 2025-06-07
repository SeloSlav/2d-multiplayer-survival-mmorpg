# Fast production database deployment script - CLEAN VERSION
# Deletes database first for completely fresh start

Write-Host "Deleting production database first..." -ForegroundColor Red
spacetime delete --server maincloud broth-bullets

Write-Host "Building and deploying to fresh production database..." -ForegroundColor Yellow
spacetime publish --server maincloud --project-path . broth-bullets

Write-Host "Regenerating client bindings..." -ForegroundColor Yellow
spacetime generate --lang typescript --out-dir ../client/src/generated --project-path .

Write-Host "Committing and pushing to trigger Vercel deployment..." -ForegroundColor Yellow
cd ..
git add .
git commit -m "Deploy: Clean database rebuild with new schema"
git push

Write-Host "Clean production deployment complete!" -ForegroundColor Green
Write-Host "Vercel will rebuild: https://broth-and-bullets.vercel.app" -ForegroundColor Cyan
Write-Host "Database: broth-bullets on maincloud" -ForegroundColor Cyan
Write-Host "Production database was completely wiped and recreated" -ForegroundColor Magenta 