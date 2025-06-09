# Fast production database deployment script - CLEAN VERSION
# Deletes database first for completely fresh start

Write-Host "[DELETE] Deleting production database first..." -ForegroundColor Red
spacetime delete --server maincloud broth-bullets

Write-Host "[BUILD] Building and deploying to fresh production database..." -ForegroundColor Yellow
spacetime publish --server maincloud --project-path . broth-bullets

Write-Host "[GEN] Regenerating client bindings..." -ForegroundColor Yellow
spacetime generate --lang typescript --out-dir ../client/src/generated --project-path .

Write-Host "[GIT] Committing and pushing to trigger Vercel deployment..." -ForegroundColor Yellow
cd ..
git add .
git commit -m "Deploy: Clean database rebuild with new schema"
git push

Write-Host "[SUCCESS] Clean production deployment complete!" -ForegroundColor Green
Write-Host "[URL] Vercel will rebuild: https://broth-and-bullets.vercel.app" -ForegroundColor Cyan
Write-Host "[DB] Database: broth-bullets on maincloud" -ForegroundColor Cyan
Write-Host "[CLEAN] Production database was completely wiped and recreated" -ForegroundColor Magenta 

# Return to server directory
cd server 