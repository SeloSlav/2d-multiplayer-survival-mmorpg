# Fast production database deployment script
# Updates existing database without deleting

Write-Host "[BUILD] Building and deploying to production database..." -ForegroundColor Yellow
spacetime publish --server maincloud --project-path . broth-bullets

Write-Host "[GEN] Regenerating client bindings..." -ForegroundColor Yellow
spacetime generate --lang typescript --out-dir ../client/src/generated --project-path .

Write-Host "[GIT] Committing and pushing to trigger Vercel deployment..." -ForegroundColor Yellow
cd ..
git add .
git commit -m "Deploy: Database update with latest changes"
git push

Write-Host "[SUCCESS] Production deployment complete!" -ForegroundColor Green
Write-Host "[URL] Vercel will rebuild: https://broth-and-bullets.vercel.app" -ForegroundColor Cyan
Write-Host "[DB] Database: broth-bullets on maincloud" -ForegroundColor Cyan
Write-Host "[INFO] Database was updated (not wiped)" -ForegroundColor Blue 