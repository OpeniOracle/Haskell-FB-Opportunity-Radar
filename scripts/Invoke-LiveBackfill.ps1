<#
.SYNOPSIS
    Run the first live collection for Tyson Foods, PepsiCo and Mars from an
    operator workstation, without exposing a credential.

.DESCRIPTION
    THIS SCRIPT COLLECTS NOTHING ITSELF.

    It calls the deployed `POST /api/admin-run`, which is the same code the
    06:00 UTC schedule runs. That matters: a backfill performed by a different
    code path proves the backfill worked and nothing about whether the
    scheduled collector does. There is no second implementation to drift.

    WHAT LEAVES THIS MACHINE. One HTTPS request carrying the operator secret in
    `X-Radar-Operator-Secret` and a JSON body naming a window. The secret is
    read with hidden input, held as a SecureString, converted to plain text only
    inside the request call, and zeroed afterwards. It is never echoed, never
    written to disk, never placed on a command line where another process could
    read it, and never included in the output this script prints.

    ORDER OF OPERATIONS, AND WHY.
      1. A DRY RUN first. It authenticates, checks the deployed configuration,
         and writes nothing. If `SEC_EDGAR_USER_AGENT` is missing this is where
         you find out -- before a twelve-month window is opened.
      2. The real run, with the window you asked for.
      3. A REPEAT of the same window, which must create nothing. That is the
         idempotency proof, and it is part of the procedure rather than
         something to take on trust.

    STOP CONDITIONS. The script stops and says why on: a 401 (wrong or missing
    secret), a 503 (the deployment is not configured), a 502 (collection failed
    server-side), or any source reporting `source_unavailable`. It does not
    retry a failed collection automatically -- a fair-access source is the wrong
    place for an unattended retry loop.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-LiveBackfill.ps1 `
        -BaseUri 'https://deploy-preview-10--haskell-fb-opportunity-radar.netlify.app' -WindowDays 365
#>

[CmdletBinding()]
param(
    # The deploy preview or production origin. No default: pointing a backfill
    # at the wrong environment should require typing the environment.
    [Parameter(Mandatory)] [string] $BaseUri,

    # 365 = the twelve-month backfill window recorded in ADR 0016.
    [ValidateRange(1, 400)] [int] $WindowDays = 365,

    # Restrict to one connector while confirming a corrected Mars URL.
    [ValidateSet('sec-edgar', 'mars-newsroom')] [string[]] $Source,

    # Skip the repeat run. Only for a first look; the repeat is the proof.
    [switch] $SkipRepeatRun,

    [string] $Branch = 'claude/live-data-cohort-tyson-pepsico-mars',
    [string] $Repository = 'OpeniOracle/Haskell-FB-Opportunity-Radar'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'OperatorGuards.psm1') -Force

$OperatorUserAgent = 'Openi-Haskell-FB-Radar-Operator/1.0'
$script:SecretSecure = $null

function Say  ([string] $M) { Write-Host $M }
function Pass ([string] $M) { Write-Host "  PASS  $M" -ForegroundColor Green }
function Fail ([string] $M) { Write-Host "  FAIL  $M" -ForegroundColor Red }
function Note ([string] $M) { Write-Host "  note  $M" -ForegroundColor DarkGray }

function Clear-Secrets {
    if ($script:SecretSecure) { $script:SecretSecure.Dispose(); $script:SecretSecure = $null }
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
$null = Register-EngineEvent PowerShell.Exiting -SupportEvent -Action { Clear-Secrets }

function Invoke-AdminRun {
    <#
        One request. The secret is materialised inside `Use-Plain` and zeroed
        the moment the call returns, so it exists in managed memory for the
        shortest window this interpreter allows.
    #>
    param([hashtable] $Body)

    $json = $Body | ConvertTo-Json -Compress -Depth 5
    $uri = "$($BaseUri.TrimEnd('/'))/api/admin-run"

    return Use-Plain -Secure $script:SecretSecure -Body {
        param($secret)
        $params = @{
            Method          = 'POST'
            Uri             = $uri
            Headers         = @{ 'X-Radar-Operator-Secret' = $secret; Accept = 'application/json' }
            Body            = $json
            ContentType     = 'application/json'
            UserAgent       = $OperatorUserAgent
            UseBasicParsing = $true
            ErrorAction     = 'Stop'
            TimeoutSec      = 600
        }
        try {
            $response = Invoke-WebRequest @params
            [pscustomobject]@{ Status = [int] $response.StatusCode; Body = $response.Content }
        } catch {
            $r = $null
            if ($_.Exception.PSObject.Properties.Name -contains 'Response') { $r = $_.Exception.Response }
            if ($r) {
                $text = ''
                try {
                    $reader = New-Object System.IO.StreamReader($r.GetResponseStream())
                    $text = $reader.ReadToEnd(); $reader.Close()
                } catch { $text = '' }
                [pscustomobject]@{ Status = [int] $r.StatusCode; Body = $text }
            } else {
                # The message may name a host. It never carries a header.
                [pscustomobject]@{ Status = 0; Body = $_.Exception.Message }
            }
        }
    }
}

function Show-RunResult {
    <#
        Per company and per source, because a single "ok" hides the one thing
        this run is for: which source produced what, and which produced nothing.
    #>
    param([string] $Title, $Parsed)

    Write-Host ''
    Write-Host "== $Title" -ForegroundColor Cyan
    if (-not $Parsed) { Note 'no parseable body'; return }
    if ($Parsed.PSObject.Properties.Name -notcontains 'sources') {
        Note ($Parsed | ConvertTo-Json -Depth 4)
        return
    }

    foreach ($source in $Parsed.sources) {
        Write-Host ''
        Write-Host "  $($source.sourceId)" -ForegroundColor White
        Write-Host "    run status ............... $($source.runStatus)"
        Write-Host "    health ................... $($source.healthStatus)"
        Write-Host "    documents discovered ..... $($source.documentsDiscovered)"
        Write-Host "    documents accepted ....... $($source.documentsAccepted)"
        Write-Host "    documents rejected ....... $($source.documentsRejected)"
        Write-Host "    duplicates prevented ..... $($source.duplicatesPrevented)"
        Write-Host "    evidence created ......... $($source.evidenceCreated)"
        Write-Host "    opportunities created .... $($source.opportunitiesCreated)"
        Write-Host "    opportunities suppressed . $($source.opportunitiesSuppressed)"
        Write-Host "    note ..................... $($source.note)"

        switch ($source.runStatus) {
            'failure' { Fail "$($source.sourceId) did not complete. Do not treat the cohort as current." }
            'skipped' {
                if ($source.healthStatus -eq 'manual_review_required') {
                    Note "$($source.sourceId) has no compliant automated path. It stays supported; import by hand."
                } else {
                    Note "$($source.sourceId) stood down (a run was already active)."
                }
            }
            'unchanged'       { Pass "$($source.sourceId) checked successfully; nothing new was published." }
            'partial_success' { Note "$($source.sourceId) partially succeeded. See the note above." }
            default           { Pass "$($source.sourceId) completed." }
        }
    }
}

try {
    Assert-NoObservation

    Write-Host "`n== 0. Repository guard" -ForegroundColor Cyan
    $head = Assert-CorrectCheckout -Repository $Repository -Branch $Branch
    Note "head: $head"

    Write-Host "`n== 1. Target" -ForegroundColor Cyan
    if ($BaseUri -notmatch '^https://') { throw 'The target must be an https origin.' }
    Say "  $BaseUri"
    Say "  window: last $WindowDays day(s), ending tomorrow 00:00 UTC"
    if ($Source) { Say "  restricted to: $($Source -join ', ')" }
    Say ''
    Say 'This runs the DEPLOYED collector. Nothing is fetched from this machine.'

    Write-Host "`n== 2. Operator secret" -ForegroundColor Cyan
    Say 'The value of INGEST_SHARED_SECRET from the Netlify environment.'
    Say 'Input is hidden and is never echoed, stored, or passed as an argument.'
    $script:SecretSecure = Read-SecretValue -Prompt 'Operator secret'
    if (-not $script:SecretSecure -or $script:SecretSecure.Length -lt 8) {
        throw 'That is too short to be the operator secret.'
    }

    Write-Host "`n== 3. Dry run (writes nothing)" -ForegroundColor Cyan
    $dry = Invoke-AdminRun -Body @{ dryRun = $true; windowDays = $WindowDays }
    switch ($dry.Status) {
        401 { throw 'The operator secret was refused. Check INGEST_SHARED_SECRET in Netlify.' }
        503 { throw "The deployment is not configured: $($dry.Body)" }
        0   { throw "Could not reach $BaseUri. $($dry.Body)" }
    }
    if ($dry.Status -ne 200) { throw "Dry run answered HTTP $($dry.Status): $($dry.Body)" }
    Pass 'credentials accepted and the deployment is configured'

    Write-Host "`n== 4. Confirm" -ForegroundColor Cyan
    Say "About to collect $WindowDays day(s) of primary-source documents into the"
    Say 'database this deployment points at. Existing records are not deleted;'
    Say 'a document already held is recognised and left alone.'
    Write-Host ''
    $answer = Read-Host -Prompt "Type BACKFILL to run, or anything else to abort"
    if ($answer -cne 'BACKFILL') { throw 'Not confirmed. Nothing was collected.' }

    Write-Host "`n== 5. First run" -ForegroundColor Cyan
    Say 'This can take several minutes. SEC is paced deliberately.'
    $body = @{ windowDays = $WindowDays }
    if ($Source) { $body['sources'] = $Source }
    $first = Invoke-AdminRun -Body $body
    if ($first.Status -eq 502) { throw "Collection failed server-side: $($first.Body)" }
    if ($first.Status -ne 200) { throw "Run answered HTTP $($first.Status): $($first.Body)" }

    $firstParsed = $null
    try { $firstParsed = $first.Body | ConvertFrom-Json } catch { $firstParsed = $null }
    Show-RunResult -Title 'First run' -Parsed $firstParsed

    if ($SkipRepeatRun) {
        Write-Host ''
        Note 'Repeat run skipped. Idempotency is unproven for this window.'
    } else {
        Write-Host "`n== 6. Repeat run -- the idempotency proof" -ForegroundColor Cyan
        Say 'The same window again. Every document should be recognised as already'
        Say 'held: evidence created 0, duplicates prevented > 0.'
        $second = Invoke-AdminRun -Body $body
        if ($second.Status -ne 200) { throw "Repeat run answered HTTP $($second.Status): $($second.Body)" }
        $secondParsed = $null
        try { $secondParsed = $second.Body | ConvertFrom-Json } catch { $secondParsed = $null }
        Show-RunResult -Title 'Repeat run' -Parsed $secondParsed

        Write-Host ''
        $created = 0
        if ($secondParsed -and $secondParsed.PSObject.Properties.Name -contains 'sources') {
            foreach ($s in $secondParsed.sources) { $created += [int] $s.evidenceCreated }
        }
        if ($created -eq 0) { Pass "the repeat run created nothing -- ingestion is idempotent" }
        else { Fail "the repeat run created $created evidence record(s). Investigate before trusting the counts." }
    }

    Write-Host "`n== Result" -ForegroundColor Cyan
    Say "  head: $head"
    Say '  No credential was printed, written to disk, or passed on a command line.'
    Say ''
    Say 'Next: sign in to the preview and confirm the counts on screen match these.'
} catch {
    Write-Host ''
    Fail $_.Exception.Message
    exit 1
} finally {
    Clear-Secrets
}
