# Fast local database deployment script - CLEAN VERSION
# Deletes database first for completely fresh start

Write-Host "[DELETE] Deleting local database first..." -ForegroundColor Red
spacetime delete broth-bullets-local

Write-Host "[BUILD] Building and deploying to fresh local database..." -ForegroundColor Yellow
spacetime publish --project-path . broth-bullets-local

Write-Host "[GEN] Regenerating client bindings..." -ForegroundColor Yellow
spacetime generate --lang typescript --out-dir ../client/src/generated --project-path .

Write-Host "[SUCCESS] Clean local deployment complete! Database: broth-bullets-local" -ForegroundColor Green
Write-Host "[INFO] Run 'npm run dev' in client folder to test" -ForegroundColor Cyan
Write-Host "[CLEAN] Database was completely wiped and recreated" -ForegroundColor Magenta 