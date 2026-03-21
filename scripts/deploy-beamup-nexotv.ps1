# deploy-beamup-nexotv.ps1
# Deploy do nexotv para o beamup usando git worktree isolado.
# Na primeira execucao roda 'beamup init nexotv' automaticamente.
# Preencha o CONFIG_SECRET em tmp/beamup-config/beamup-nexotv-env.ts antes de rodar.

$ErrorActionPreference = "Stop"

# Helper: roda comando externo e para se falhar
function Invoke-Checked {
    param([string]$Cmd, [string[]]$CmdArgs)
    & $Cmd @CmdArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Comando falhou com codigo ${LASTEXITCODE}: $Cmd $CmdArgs"
    }
}

$ProjectRoot  = Split-Path -Parent $PSScriptRoot
$WorktreePath = Join-Path (Split-Path -Parent $ProjectRoot) "nexotv-beamup-deploy"
$EnvSource    = Join-Path $ProjectRoot "tmp\beamup-config\beamup-nexotv-env.ts"
$EnvTarget    = Join-Path $WorktreePath "packages\backend\src\config\env.ts"

Write-Host "==> Iniciando deploy do nexotv no beamup..." -ForegroundColor Cyan
Write-Host "    Raiz do projeto : $ProjectRoot"
Write-Host "    Worktree        : $WorktreePath"

# Validar que CONFIG_SECRET foi preenchido
$envContent = Get-Content $EnvSource -Raw
if ($envContent -match "PREENCHA_AQUI") {
    Write-Host "`n[ERRO] Preencha o CONFIG_SECRET em tmp/beamup-config/beamup-nexotv-env.ts antes de fazer deploy." -ForegroundColor Red
    exit 1
}

Set-Location $ProjectRoot

# 1. Garantir que o remote 'beamup' existe (cria o app na primeira vez)
Write-Host "`n==> [1/6] Verificando remote beamup..." -ForegroundColor Yellow
$remoteExists = git remote | Select-String -Pattern "^beamup$" -Quiet
if (-not $remoteExists) {
    Write-Host "    Remote nao encontrado. Rodando 'beamup init nexotv'..." -ForegroundColor Yellow
    Invoke-Checked beamup @("init", "nexotv")
    # beamup init cria beamup.json — remover para nao commitar no repo principal
    if (Test-Path "beamup.json") { Remove-Item "beamup.json" }
} else {
    Write-Host "    Remote beamup ja configurado." -ForegroundColor Green
}

# 2. Criar worktree isolado a partir do HEAD atual
Write-Host "`n==> [2/6] Criando worktree isolado..." -ForegroundColor Yellow
if (Test-Path $WorktreePath) {
    Invoke-Checked git @("worktree", "remove", $WorktreePath, "--force")
}
Invoke-Checked git @("worktree", "add", "--detach", $WorktreePath, "HEAD")

# 3. Remover Dockerfile, substituir env.ts e injetar public-playlists.json
Write-Host "`n==> [3/6] Removendo Dockerfile e injetando env hardcoded..." -ForegroundColor Yellow
Set-Location $WorktreePath
Invoke-Checked git @("rm", "Dockerfile")
Copy-Item -Path $EnvSource -Destination $EnvTarget -Force

$PlaylistSource = Join-Path $ProjectRoot "tmp\beamup-config\public-playlists.json"
$PlaylistTarget = Join-Path $WorktreePath "config\public-playlists.json"
if (Test-Path $PlaylistSource) {
    Copy-Item -Path $PlaylistSource -Destination $PlaylistTarget -Force
    Write-Host "    public-playlists.json copiado para config/" -ForegroundColor Green
} else {
    Write-Host "    [AVISO] tmp/public-playlists.json nao encontrado, ignorando." -ForegroundColor Yellow
}

# 4. Fixar versao do pnpm no package.json para evitar falha de keyid do corepack
#    Beamup usa herokuish/buildpack que tenta instalar pnpm@latest via corepack,
#    mas versoes recentes falham por incompatibilidade de chave de assinatura.
Write-Host "`n==> [4/6] Fixando versao do pnpm no package.json..." -ForegroundColor Yellow
$PkgPath = Join-Path $WorktreePath "package.json"
$pkgContent = Get-Content $PkgPath -Raw
# Injeta "engines" logo apos a abertura do objeto JSON.
# engines.pnpm: diz ao buildpack herokuish qual versao instalar.
# Nao usa "packageManager": corepack rejeita o campo sem hash de integridade.
$inject = '  "engines": { "node": "22.x", "pnpm": "9.15.4" },'
$pkgContent = $pkgContent -replace '^\{', "{`n$inject"
# Escreve sem BOM — parsers JSON do buildpack/corepack falham com UTF-8 BOM
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($PkgPath, $pkgContent, $utf8NoBom)
Write-Host "    engines.node=22.x, engines.pnpm=9.15.4 injetados." -ForegroundColor Green

# 5. Commitar no worktree
Write-Host "`n==> [5/6] Commitando no worktree..." -ForegroundColor Yellow
Invoke-Checked git @("add", ".")
Invoke-Checked git @("commit", "-m", "beamup deploy")

# 6. Push para o beamup e cleanup
Write-Host "`n==> [6/6] Fazendo push e limpando worktree..." -ForegroundColor Yellow
Invoke-Checked git @("push", "beamup", "HEAD:refs/heads/master", "--force")
Set-Location $ProjectRoot
Invoke-Checked git @("worktree", "remove", $WorktreePath, "--force")

Write-Host "`n==> Deploy concluido com sucesso!" -ForegroundColor Green
