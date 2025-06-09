# Fast local database deployment script
# Updates existing database without deleting

Write-Host "[BUILD] Building and deploying to local database..." -ForegroundColor Yellow
spacetime publish --project-path . broth-bullets-local

Write-Host "[GEN] Regenerating client bindings..." -ForegroundColor Yellow
spacetime generate --lang typescript --out-dir ../client/src/generated --project-path .

Write-Host "[SUCCESS] Local deployment complete! Database: broth-bullets-local" -ForegroundColor Green
Write-Host "[INFO] Run 'npm run dev' in client folder to test" -ForegroundColor Cyan
Write-Host "[INFO] Database was updated (not wiped)" -ForegroundColor Blue 