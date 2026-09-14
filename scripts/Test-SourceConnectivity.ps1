<#
.SYNOPSIS
    Credential-free reachability check for the primary sources, from Windows.

.DESCRIPTION
    The PowerShell counterpart to scripts/test-source-connectivity.sh, for the
    machine the operator actually runs the backfill from.

    NO CREDENTIAL IS INVOLVED. Every endpoint is public. Nothing is sent but a
    declared User-Agent, nothing is written, no challenge is followed and
    nothing is retried. A refusal is recorded, not routed around.

    A CANDIDATE HAS A ROLE, AND THE ROLE DECIDES THE WEIGHT.

    This script used to count every probe the same way: any non-200 incremented
    a failure counter and it exited 1. So Mars answering 200 on robots.txt, 200
    on the newsroom index and 200 on the sitemap, but 404 on one GUESSED rss
    path, was reported as a failure -- on a source that is entirely viable.

    The connector never had that bug. discoverMars walks feed -> sitemap ->
    index, records each miss, and continues; it reports a problem only when
    nothing was discovered by any path. A pre-flight stricter than the thing it
    predicts is wrong in the worst direction: it argues for disabling a source
    that works.

        required   every one must answer  (SEC's documented APIs; Mars robots)
        discovery  optional, tried in order, ONE is enough; each miss is a WARNING

    WHY IT REPORTS WHOSE REFUSAL IT WAS. A corporate proxy denying CONNECT and
    a source returning 403 are the same "it did not work" from the operator's
    chair and completely different problems. If nothing answered at all, the
    verdict is INCONCLUSIVE rather than a judgement about the source.

    The rules live in scripts/lib/connectivity-rules.mjs and are asserted by
    app/src/test/sourceConnectivity.test.ts. Keep the tables below in step with
    that module -- a test fails if they drift.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-SourceConnectivity.ps1
#>

[CmdletBinding()]
param(
    [string] $UserAgent = 'Openi-Haskell-FB-Radar-Operator/1.0 (oracles@openi-analytics.com)'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:Exit = 0
$script:Source = $null

function Say  ([string] $M) { Write-Host $M }
function Pass ([string] $M) { Write-Host "  PASS  $M" -ForegroundColor Green }
function Fail ([string] $M) { Write-Host "  FAIL  $M" -ForegroundColor Red }
function Warn ([string] $M) { Write-Host "  warn  $M" -ForegroundColor Yellow }
function Note ([string] $M) { Write-Host "  note  $M" -ForegroundColor DarkGray }

$CHALLENGE = 'captcha|verify you are human|checking your browser|incapsula|attention required'

function Start-Source {
    param([string] $Title)
    Write-Host ''
    Write-Host "== $Title" -ForegroundColor Cyan
    $script:Source = @{
        RequiredBad = 0; DiscoveryOk = 0; DiscoveryBad = 0; DiscoveryTotal = 0
        LocalFailures = 0; Answered = 0; Challenges = 0
    }
}

function Test-Endpoint {
    param(
        [ValidateSet('required', 'discovery')] [string] $Role,
        [string] $Label,
        [string] $Uri,
        [string] $Expect = ''
    )

    if ($Role -eq 'discovery') { $script:Source.DiscoveryTotal++ }

    $status = 0
    $body = ''
    $transportError = $null

    try {
        $response = Invoke-WebRequest -Uri $Uri -Method GET -UserAgent $UserAgent `
            -UseBasicParsing -TimeoutSec 25 -ErrorAction Stop
        $status = [int] $response.StatusCode
        $body = [string] $response.Content
    }
    catch {
        $r = $null
        if ($_.Exception.PSObject.Properties.Name -contains 'Response') { $r = $_.Exception.Response }
        if ($r) {
            $status = [int] $r.StatusCode
            try {
                $reader = New-Object System.IO.StreamReader($r.GetResponseStream())
                $body = $reader.ReadToEnd(); $reader.Close()
            }
            catch { $body = '' }
        }
        else { $transportError = $_.Exception.Message }
    }

    # Every branch breaks. A PowerShell switch without `break` keeps evaluating
    # later conditions, and two matches would make $outcome an ARRAY rather than
    # a string -- which would then silently fail every comparison below.
    $outcome = switch ($status) {
        0 {
            if ($transportError -match 'proxy|tunnel|407|firewall|forbidden by') { 'local_network' }
            else { 'unreachable' }
            break
        }
        200 {
            if ($Expect -and $body -notmatch [regex]::Escape($Expect)) { 'unexpected' } else { 'ok' }
            break
        }
        404 { 'absent'; break }
        429 { 'rate_limited'; break }
        { $_ -in 301, 302, 307, 308 } { 'redirect'; break }
        { $_ -in 403, 503 } {
            if ($body -match $CHALLENGE) { 'challenge' } else { 'refused' }
            break
        }
        default { 'unexpected' }
    }

    '  {0,-46} HTTP {1,-4} {2}' -f $Label, $status, $outcome | Write-Host

    if ($outcome -in 'local_network', 'unreachable') { $script:Source.LocalFailures++ }
    else { $script:Source.Answered++ }
    if ($outcome -eq 'challenge') { $script:Source.Challenges++ }

    if ($outcome -eq 'ok') {
        if ($Role -eq 'discovery') { $script:Source.DiscoveryOk++ }
        Pass $Label
        return
    }

    # A miss on an OPTIONAL candidate is information about a guess, not a fault.
    if ($Role -eq 'discovery') {
        $script:Source.DiscoveryBad++
        switch ($outcome) {
            'absent'        { Warn "$Label -- 404. A guessed path that does not exist; retire it from connector_config." }
            'challenge'     { Warn "$Label -- interstitial challenge. Do NOT work around it; prefer an official feed." }
            'refused'       { Warn "$Label -- refused. Record the status and URL; do not retry in a loop." }
            'rate_limited'  { Warn "$Label -- rate limited. The connector honours Retry-After; so should you." }
            'redirect'      { Note "$Label -- redirected; the connector follows and re-checks the allowlist per hop." }
            'local_network' { Warn "$Label -- this machine's network refused the connection, NOT the source." }
            'unreachable'   { Warn "$Label -- no response (DNS, TLS or timeout)." }
            default         { Warn "$Label -- unexpected answer." }
        }
        return
    }

    $script:Source.RequiredBad++
    switch ($outcome) {
        'local_network' { Fail "$Label -- this machine's network refused the connection, NOT the source." }
        'unreachable'   { Fail "$Label -- no response (DNS, TLS or timeout)." }
        'challenge'     { Fail "$Label -- interstitial challenge on a REQUIRED endpoint." }
        'absent'        { Fail "$Label -- 404 on a REQUIRED endpoint. The source changed shape." }
        default         { Fail "$Label -- $outcome on a REQUIRED endpoint." }
    }
}

function Complete-Source {
    param([string] $Name)

    $s = $script:Source
    Write-Host ''

    # If every failure was this machine, the run says nothing about the source.
    if ($s.LocalFailures -gt 0 -and $s.Answered -eq 0) {
        Note "${Name}: INCONCLUSIVE -- nothing answered from this machine."
        Note '  That is a statement about this network, not about the source.'
        Note '  Re-run from a machine with direct egress before concluding anything.'
        return
    }

    if ($s.RequiredBad -gt 0) {
        Fail "${Name}: NOT VIABLE -- $($s.RequiredBad) required endpoint(s) did not answer."
        $script:Exit = 1
        return
    }

    if ($s.DiscoveryTotal -gt 0 -and $s.DiscoveryOk -eq 0) {
        Fail "${Name}: NOT VIABLE -- no discovery path answered."
        $script:Exit = 1
        return
    }

    if ($s.DiscoveryBad -gt 0) {
        Pass "${Name}: VIABLE -- $($s.DiscoveryOk) of $($s.DiscoveryTotal) discovery path(s) usable, $($s.DiscoveryBad) warning(s)."
        Note '  A failed optional candidate does not disable a source. Retire it from'
        Note '  connector_config so it stops being requested; see the command below.'
    }
    else {
        Pass "${Name}: VIABLE -- every endpoint answered."
    }

    if ($s.Challenges -gt 0) {
        Note "  $($s.Challenges) candidate(s) returned an interstitial challenge. That is the one"
        Note '  warning class to act on: find an official feed rather than defeating it.'
    }
}

Write-Host ''
Write-Host '== User-Agent' -ForegroundColor Cyan
Say "  $UserAgent"
if ($UserAgent -notmatch '@') {
    Fail 'SEC fair access asks for a contact address in the User-Agent'
    $script:Exit = 1
}
else {
    Pass 'names a contact address'
}

Start-Source 'SEC EDGAR (documented JSON APIs)'
Test-Endpoint -Role required -Label 'company_tickers.json' -Uri 'https://www.sec.gov/files/company_tickers.json' -Expect 'cik_str'
Test-Endpoint -Role required -Label 'submissions API' -Uri 'https://data.sec.gov/submissions/CIK0000100493.json' -Expect 'filings'
Test-Endpoint -Role required -Label 'archive folder index' -Uri 'https://www.sec.gov/Archives/edgar/data/100493/'
Complete-Source 'sec-edgar'

Start-Source 'Mars (official corporate sources)'
Test-Endpoint -Role required -Label 'robots.txt' -Uri 'https://www.mars.com/robots.txt'
# Discovery candidates, in the connector's own order: feed, sitemap, index.
# https://www.mars.com/rss.xml is NOT here: observed 404 on 2026-09-13 and
# retired. See RETIRED_CANDIDATES in scripts/lib/connectivity-rules.mjs.
Test-Endpoint -Role discovery -Label 'feed candidate (news-and-stories/rss)' -Uri 'https://www.mars.com/news-and-stories/rss'
Test-Endpoint -Role discovery -Label 'feed candidate (feed)' -Uri 'https://www.mars.com/feed'
Test-Endpoint -Role discovery -Label 'sitemap candidate' -Uri 'https://www.mars.com/sitemap.xml'
Test-Endpoint -Role discovery -Label 'newsroom index' -Uri 'https://www.mars.com/news-and-stories'
Test-Endpoint -Role discovery -Label 'index candidate (news)' -Uri 'https://www.mars.com/news'
Test-Endpoint -Role discovery -Label 'index candidate (press-releases)' -Uri 'https://www.mars.com/press-releases'
Complete-Source 'mars-newsroom'

Write-Host ''
Write-Host '== Retiring a dead candidate' -ForegroundColor Cyan
Say '  Candidate URLs are configuration, not code. Remove one WITHOUT replacing'
Say '  the rest of the object:'
Say ''
Say "    update sources"
Say "       set connector_config = jsonb_set("
Say "             connector_config, '{feedCandidates}',"
Say "             coalesce((select jsonb_agg(value order by ordinality)"
Say "                         from jsonb_array_elements_text(connector_config->'feedCandidates')"
Say "                              with ordinality as c(value, ordinality)"
Say "                        where value <> 'https://www.mars.com/rss.xml'), '[]'::jsonb)),"
Say "           updated_at = now()"
Say "     where id = 'mars-newsroom';"
Say ''
Say '  Do NOT use the `connector_config || ...` form unless you are supplying the'
Say '  COMPLETE remaining array: that form replaces the whole key.'
Say ''

exit $script:Exit
