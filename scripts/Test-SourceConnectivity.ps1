<#
.SYNOPSIS
    Credential-free reachability check for the primary sources, from Windows.

.DESCRIPTION
    The PowerShell counterpart to scripts/test-source-connectivity.sh, for the
    machine the operator actually runs the backfill from.

    NO CREDENTIAL IS INVOLVED. Every endpoint is public. Nothing is sent but a
    declared User-Agent, nothing is written, no challenge is followed and
    nothing is retried. A refusal is recorded, not routed around.

    WHY IT REPORTS WHOSE REFUSAL IT WAS. A corporate proxy denying CONNECT and
    a source returning 403 are the same "it did not work" from the operator's
    chair and completely different problems. This names which one happened, so
    nobody disables a working source because of a firewall.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-SourceConnectivity.ps1
#>

[CmdletBinding()]
param(
    [string] $UserAgent = 'Openi-Haskell-FB-Radar-Operator/1.0 (oracles@openi-analytics.com)',
    # Correct these here when the first live run shows the real Mars paths.
    [string[]] $MarsCandidates = @(
        'https://www.mars.com/robots.txt',
        'https://www.mars.com/news-and-stories',
        'https://www.mars.com/rss.xml',
        'https://www.mars.com/sitemap.xml'
    )
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Failed = 0
$script:Checked = 0

function Say  ([string] $M) { Write-Host $M }
function Pass ([string] $M) { Write-Host "  PASS  $M" -ForegroundColor Green }
function Fail ([string] $M) { Write-Host "  FAIL  $M" -ForegroundColor Red; $script:Failed++ }
function Note ([string] $M) { Write-Host "  note  $M" -ForegroundColor DarkGray }

$CHALLENGE = 'captcha|verify you are human|checking your browser|incapsula|attention required'

function Probe {
    param([string] $Label, [string] $Uri, [string] $Expect)

    $script:Checked++
    $status = 0
    $body = ''
    $transportError = $null

    try {
        $response = Invoke-WebRequest -Uri $Uri -Method GET -UserAgent $UserAgent `
            -UseBasicParsing -TimeoutSec 25 -ErrorAction Stop
        $status = [int] $response.StatusCode
        $body = [string] $response.Content
    } catch {
        $r = $null
        if ($_.Exception.PSObject.Properties.Name -contains 'Response') { $r = $_.Exception.Response }
        if ($r) {
            $status = [int] $r.StatusCode
            try {
                $reader = New-Object System.IO.StreamReader($r.GetResponseStream())
                $body = $reader.ReadToEnd(); $reader.Close()
            } catch { $body = '' }
        } else {
            $transportError = $_.Exception.Message
        }
    }

    '  {0,-52} HTTP {1}' -f $Label, $status | Write-Host

    if ($status -eq 0) {
        # Name the culprit. A proxy denial is not a statement about the source.
        if ($transportError -match 'proxy|tunnel|407|firewall|forbidden by') {
            Fail "$Label -- this machine's network refused the connection, NOT the source"
        } else {
            Fail "$Label -- no response (DNS, TLS or timeout)"
        }
        return
    }

    switch ($status) {
        200 {
            if ($Expect -and $body -notmatch [regex]::Escape($Expect)) {
                Fail "$Label -- answered 200 but the body did not contain '$Expect'"
            } else { Pass $Label }
        }
        { $_ -in 301, 302, 307, 308 } { Note "$Label -- redirected; the connector re-checks the allowlist per hop" }
        { $_ -in 403, 503 } {
            if ($body -match $CHALLENGE) {
                Fail "$Label -- an interstitial challenge. Do not work around it; find the official feed."
            } else {
                Fail "$Label -- refused. Record the status and URL; do not retry in a loop."
            }
        }
        429 { Fail "$Label -- rate limited. The connector honours Retry-After; slow down." }
        404 { Fail "$Label -- not found. If this is a configured candidate, correct connector_config." }
        default { Fail "$Label -- unexpected status" }
    }
}

Write-Host "`n== User-Agent" -ForegroundColor Cyan
Say "  $UserAgent"
if ($UserAgent -notmatch '@') {
    Fail 'SEC fair access asks for a contact address in the User-Agent'
} else {
    Pass 'names a contact address'
}

Write-Host "`n== SEC EDGAR (documented JSON APIs)" -ForegroundColor Cyan
Probe -Label 'company_tickers.json' -Uri 'https://www.sec.gov/files/company_tickers.json' -Expect 'cik_str'
Probe -Label 'submissions API responds' -Uri 'https://data.sec.gov/submissions/CIK0000100493.json' -Expect 'filings'
Probe -Label 'archive folder index' -Uri 'https://www.sec.gov/Archives/edgar/data/100493/' -Expect ''

Write-Host "`n== Mars (official corporate sources)" -ForegroundColor Cyan
foreach ($candidate in $MarsCandidates) {
    Probe -Label ([uri]$candidate).AbsolutePath -Uri $candidate -Expect ''
}

Write-Host "`n== Result" -ForegroundColor Cyan
Say "  $script:Checked endpoint(s) checked, $script:Failed did not answer as expected"
Say ''
Say '  A failure here is NOT a reason to disable a source. Establish whose'
Say '  refusal it was first: this network, or the source.'
Say ''
Say '  Mars candidate URLs are configuration, not code:'
Say "    update sources set connector_config = connector_config || '{\`"feedCandidates\`":[\`"<url>\`"]}'::jsonb"
Say "     where id = 'mars-newsroom';"

if ($script:Failed -gt 0) { exit 1 }
exit 0
