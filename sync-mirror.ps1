<#
  Sync the school-gateway mirror.

  PyWebLib serves play.pyweblib.org. A freshly registered domain is exactly what
  a school web filter (Zscaler here) blocks by default, so the same site is also
  served from pyweb.qmarkapp.com out of a second repo. GitHub Pages matches the
  incoming Host against ONE value in a repo's CNAME file, so a second hostname
  needs a second repo; there is no way to attach two domains to one Pages site.

  The mirror is generated, never edited by hand. This script exports a ref of
  this repo into it, swaps in the mirror's own CNAME and robots.txt, and pushes.

  Usage:
    .\sync-mirror.ps1                # mirror origin/main (what is deployed)
    .\sync-mirror.ps1 -Ref HEAD      # mirror your local commits instead
    .\sync-mirror.ps1 -WhatIf        # show what would change, push nothing

  -WhatIf still writes the files into the mirror working tree, because that is
  the only way to show you a real diff. It stops before committing or pushing,
  so nothing reaches the live site. The prep steps below pass -WhatIf:$false
  deliberately: without it PowerShell propagates -WhatIf into every cmdlet in
  the script and the export silently produces nothing.

  Run it after every push to PyWebLib, or the two sites drift.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Ref           = "origin/main",
  [string]$MirrorDir     = "C:\Code\pyweblib-school",
  [string]$Domain        = "pyweb.qmarkapp.com",
  [string]$CanonicalBase = "https://play.pyweblib.org",
  # A Cloudflare Web Analytics token counts ONE hostname. Shipping the app's
  # token here would file every school visit under play.pyweblib.org and
  # quietly corrupt both numbers, so the default is to strip the beacon and
  # count nothing. Add pyweb.qmarkapp.com as its own site in Cloudflare and
  # pass its token here to start counting the traffic that actually matters.
  [string]$AnalyticsToken = ""
)

$ErrorActionPreference = "Stop"
$source = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path $MirrorDir)) { throw "Mirror not found at $MirrorDir" }

# Files the mirror owns and the export must not clobber.
$keep = @("CNAME", "robots.txt", "README.md", ".git")

Write-Host "Exporting $Ref from $source ..."
$tmp = Join-Path $env:TEMP ("pwl-mirror-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $tmp -WhatIf:$false | Out-Null
try {
  $zip = Join-Path $tmp "site.zip"
  git -C $source archive $Ref --format=zip -o $zip
  if (-not (Test-Path $zip)) { throw "git archive produced nothing for ref '$Ref'" }
  Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp "site") -Force -WhatIf:$false

  # Clear the mirror except for the files it owns, so deletions propagate.
  Get-ChildItem $MirrorDir -Force | Where-Object { $keep -notcontains $_.Name } |
    Remove-Item -Recurse -Force -WhatIf:$false

  # Hold the mirror's own README aside: excluding it from the wipe is not
  # enough, because the copy below would overwrite it with PyWebLib's.
  $readme = Join-Path $MirrorDir "README.md"
  $readmeText = if (Test-Path $readme) { Get-Content $readme -Raw } else { $null }

  Copy-Item (Join-Path $tmp "site\*") $MirrorDir -Recurse -Force -WhatIf:$false

  if ($readmeText) { Set-Content -Path $readme -Value $readmeText -NoNewline -WhatIf:$false }

  # The mirror's own identity, written after the copy so the export cannot win.
  Set-Content -Path (Join-Path $MirrorDir "CNAME") -Value $Domain -WhatIf:$false

  # Crawling is deliberately ALLOWED. "Disallow: /" looks like the way to keep a
  # duplicate out of search, but it only blocks crawling: anything Google has
  # already indexed for this hostname stays indexed, and because the crawler can
  # no longer fetch the page it can never see a de-index signal either. Blocking
  # prevents the very cleanup you wanted. The canonical tags below are what
  # actually consolidate this mirror onto the real site.
  @"
User-agent: *
Allow: /
"@ | Set-Content -Path (Join-Path $MirrorDir "robots.txt") -WhatIf:$false

  # Point every page at its twin on the canonical host, so Google indexes that
  # one and credits it with this mirror's signals instead of treating the two as
  # competing duplicates.
  $pages = Get-ChildItem $MirrorDir -Recurse -Filter "*.html" -File |
           Where-Object { $_.FullName -notlike "*\.git\*" }
  $beacon = '<script type="module" src="https://static\.cloudflareinsights\.com/beacon\.min\.js"[^>]*></script>'
  $swapped = 0
  foreach ($p in $pages) {
    $rel = $p.FullName.Substring($MirrorDir.TrimEnd('\').Length + 1) -replace '\\', '/'
    $rel = $rel -replace 'index\.html$', ''          # /docs/index.html -> /docs/
    $canonical = "$CanonicalBase/$rel"
    $html = Get-Content $p.FullName -Raw
    $before = $html

    # The analytics token, before anything else: it must be dealt with on every
    # page, including any that the canonical step below would skip.
    if ($html -match $beacon) {
      if ($AnalyticsToken) {
        $tag = "<script type=`"module`" src=`"https://static.cloudflareinsights.com/beacon.min.js`"" +
               "`n          data-cf-beacon='{""token"": ""$AnalyticsToken""}'></script>"
        $html = $html -replace $beacon, $tag
      } else {
        # Drop the tag and the blank line it sat on, so the page ends tidily.
        $html = $html -replace ("\r?\n\s*" + $beacon), ""
      }
      $swapped++
    }

    if ($html -match '<link\s+rel="canonical"') {
      $html = $html -replace '<link\s+rel="canonical"[^>]*>', "<link rel=`"canonical`" href=`"$canonical`" />"
    } elseif ($html -match '(?i)</head>') {
      $html = $html -replace '(?i)</head>', "  <link rel=`"canonical`" href=`"$canonical`" />`n</head>"
    }

    if ($html -ne $before) { Set-Content -Path $p.FullName -Value $html -NoNewline -WhatIf:$false }
  }
  Write-Host "Canonicalised $($pages.Count) pages to $CanonicalBase"
  if ($AnalyticsToken) { Write-Host "Repointed analytics on $swapped pages to this mirror's token" }
  else { Write-Host "Stripped the analytics beacon from $swapped pages (no -AnalyticsToken given)" }

  $status = git -C $MirrorDir status --porcelain
  if (-not $status) { Write-Host "Already in sync, nothing to do."; return }

  Write-Host "Changes:"; $status | ForEach-Object { "  $_" }

  if ($PSCmdlet.ShouldProcess($MirrorDir, "commit and push")) {
    $sha = (git -C $source rev-parse --short $Ref).Trim()
    git -C $MirrorDir add -A
    git -C $MirrorDir commit -q -m "Sync from PyWebLib $sha"
    git -C $MirrorDir push -q origin main
    Write-Host "Pushed. https://$Domain will update in a minute or two."
  }
}
finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
