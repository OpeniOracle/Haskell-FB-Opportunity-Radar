<#
.SYNOPSIS
    Prove that every /api/* route on a deployment reaches its Netlify function
    rather than the single-page application.

.DESCRIPTION
    WHY THIS IS A SEPARATE SCRIPT, AND WHY IT NEEDS NO CREDENTIALS.

    `Invoke-HostedValidation.ps1` already asserts that an unauthenticated
    /api/status answers 401, so it would have caught this. It never ran: the
    invitation journey is earlier in the sequence and that is where the failure
    surfaced, as "This account cannot be used" on a callback page. The routing
    fault was three layers away from the message the operator was reading.

    So this is deliberately the cheapest possible check. No secret, no access
    token, no repository state -- three unauthenticated GETs against a public
    URL. It can be run before an invitation is sent, in seconds, and it answers
    the one question that was impossible to answer from the symptom: is the API
    actually wired up on this deployment?

    THE FAILURE IT DETECTS. A `_redirects` file containing only the SPA
    catch-all is processed BEFORE netlify.toml, so `/*  /index.html  200`
    matched /api/session and Netlify answered 200 with index.html. The client
    asked for JSON and got an HTML document. Nothing errored anywhere; the
    application simply reported that it could not verify the session.

    Status alone is not enough to detect that -- the SPA fallback answers 200,
    and a 200 looks like success. The decisive signal is the CONTENT TYPE.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-DeployedRoutes.ps1
#>

[CmdletBinding()]
param(
    [string] $Origin = 'https://deploy-preview-9--haskell-fb-opportunity-radar.netlify.app'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Pass = 0
$script:Fail = 0
function Ok([string] $What) { $script:Pass++; Write-Host "  PASS  $What" -ForegroundColor Green }
function No([string] $What, [string] $Why) {
    $script:Fail++
    Write-Host "  FAIL  $What" -ForegroundColor Red
    if ($Why) { Write-Host "        $Why" -ForegroundColor DarkGray }
}
function Check([string] $What, [bool] $Condition, [string] $Why = '') {
    if ($Condition) { Ok $What } else { No $What $Why }
}

$script:SupportsSkipError = (Get-Command Invoke-WebRequest).Parameters.ContainsKey('SkipHttpErrorCheck')

function Get-Route([string] $Path) {
    <#
        One unauthenticated GET. Redirects are NOT followed: a 30x to /login is
        itself a finding, and following it would hide it behind a 200.
    #>
    $params = @{
        Method             = 'GET'
        Uri                = "$Origin$Path"
        Headers            = @{ Accept = 'application/json' }
        UserAgent          = 'Openi-Haskell-FB-Radar-Operator/1.0'
        UseBasicParsing    = $true
        MaximumRedirection = 0
        ErrorAction        = 'Stop'
    }
    if ($script:SupportsSkipError) { $params['SkipHttpErrorCheck'] = $true }

    try {
        $response = Invoke-WebRequest @params
        return [pscustomobject]@{
            Status   = [int] $response.StatusCode
            Type     = [string] $response.Headers['Content-Type']
            Cache    = [string] $response.Headers['Cache-Control']
            Location = [string] $response.Headers['Location']
            Body     = [string] $response.Content
        }
    } catch {
        $r = $null
        try { $r = $_.Exception.Response } catch { $r = $null }
        if (-not $r) { return [pscustomobject]@{ Status = 0; Type = ''; Cache = ''; Location = ''; Body = "$($_.Exception.Message)" } }
        $text = ''
        try {
            $reader = New-Object System.IO.StreamReader($r.GetResponseStream())
            $text = $reader.ReadToEnd(); $reader.Close()
        } catch { $text = '' }
        return [pscustomobject]@{
            Status   = [int] $r.StatusCode
            Type     = [string] $r.Headers['Content-Type']
            Cache    = [string] $r.Headers['Cache-Control']
            Location = [string] $r.Headers['Location']
            Body     = $text
        }
    }
}

<#
    TWO VERDICTS, KEPT APART.

    An earlier version of this script accepted 401 OR 503 and reported
    "20 passed, 0 failed" while all three protected endpoints were answering
    503. That was wrong, and wrong in the most misleading direction: it told an
    operator the deployment was ready when authentication was switched off.

    503 does prove ROUTING works -- the request reached a function, because only
    a function can produce that body. It also proves the deployment is NOT
    READY. Those are different questions and they now have different answers.
    Readiness requires 401.
#>
$script:RoutingOk = $true
$script:ReadyOk = $true

function Test-ApiRoute([string] $Path) {
    Write-Host "`n$Path" -ForegroundColor Cyan
    $r = Get-Route $Path

    if ($r.Status -eq 0) {
        No "$Path is reachable" $r.Body
        $script:RoutingOk = $false
        $script:ReadyOk = $false
        return
    }

    # The status, always, whatever the verdict. A probe that hides the number it
    # judged is a probe you cannot check.
    Write-Host "        HTTP $($r.Status)   content-type: $($r.Type)" -ForegroundColor DarkGray

    # ---- Routing: did this reach a function at all? ----------------------
    $isHtml = ($r.Type -like '*text/html*') -or ($r.Body.TrimStart().StartsWith('<'))
    if ($isHtml) { $script:RoutingOk = $false }
    Check "$Path is not the single-page application" (-not $isHtml) `
        "content-type '$($r.Type)' -- the SPA fallback is winning, so this route never reaches its function"

    if (-not ($r.Type -like '*application/json*')) { $script:RoutingOk = $false }
    Check "$Path declares JSON" ($r.Type -like '*application/json*') "content-type '$($r.Type)'"

    if ($r.Location) { $script:RoutingOk = $false }
    Check "$Path does not redirect to the interface" (-not $r.Location) "Location: $($r.Location)"

    # ---- Readiness: is it actually able to serve? ------------------------
    if ($r.Status -eq 503) {
        $script:ReadyOk = $false
        # The safe message, printed because it names what is missing and
        # contains no value. It is the operator's whole diagnosis.
        $detail = ''
        try {
            $parsed = $r.Body | ConvertFrom-Json
            if ($parsed.error) { $detail = "$($parsed.error.code): $($parsed.error.message)" }
        } catch { $detail = '' }
        No "$Path is ready (expected HTTP 401)" "HTTP 503 -- the function ran but the deployment is incomplete"
        if ($detail) { Write-Host "        $detail" -ForegroundColor Yellow }
        return
    }

    if ($r.Status -ne 401) { $script:ReadyOk = $false }
    Check "$Path refuses an unauthenticated caller with HTTP 401" ($r.Status -eq 401) "got HTTP $($r.Status)"

    $parsedOk = $null
    try { $parsedOk = $r.Body | ConvertFrom-Json } catch { $parsedOk = $null }
    Check "$Path returns parseable JSON" ($null -ne $parsedOk) 'the body is not JSON'

    if ($r.Cache) {
        Check "$Path is private and not stored" (
            ($r.Cache -like '*no-store*') -and ($r.Cache -like '*private*')
        ) "cache-control: $($r.Cache)"
    }
}

Write-Host "== Deployed API route contract" -ForegroundColor Cyan
Write-Host "   origin: $Origin"
Write-Host '   No credentials are used or required. Three unauthenticated GETs.'

# Unauthenticated: each must refuse with HTTP 401, in JSON.
Test-ApiRoute '/api/session'
Test-ApiRoute '/api/status'
Test-ApiRoute '/api/evidence/00000000-0000-4000-8000-000000000000'

# A path under /api that is not a route must 404, not fall through to the SPA.
Write-Host "`n/api/not-a-route (must not be the SPA)" -ForegroundColor Cyan
$missing = Get-Route '/api/not-a-route'
Check '/api/not-a-route does not return the application' (
    $missing.Status -eq 404 -or (-not ($missing.Type -like '*text/html*'))
) "status $($missing.Status), content-type '$($missing.Type)'"

# And the control: an ordinary deep link MUST still be the application.
Write-Host "`n/opportunities (must be the SPA)" -ForegroundColor Cyan
$spa = Get-Route '/opportunities'
Check 'a deep link still serves the application' (
    $spa.Status -eq 200 -and $spa.Type -like '*text/html*'
) "status $($spa.Status), content-type '$($spa.Type)'"

Write-Host ''
Write-Host "$script:Pass passed, $script:Fail failed"
Write-Host ''

<#
    THE TWO VERDICTS, STATED SEPARATELY AND IN ORDER.

    Routing first, because a routing failure explains every readiness failure
    beneath it and fixing readiness first would be wasted work.
#>
if (-not $script:RoutingOk) {
    Write-Host 'ROUTING: FAILED' -ForegroundColor Red
    Write-Host '  An /api route is being served by the single-page application.'
    Write-Host '  Check that no _redirects file shadows the rules in netlify.toml.'
    Write-Host ''
    Write-Host 'DO NOT send an invitation. The callback cannot verify a session.'
    exit 1
}
Write-Host 'ROUTING: OK -- every /api route reaches its function.' -ForegroundColor Green

if (-not $script:ReadyOk) {
    Write-Host 'READINESS: FAILED' -ForegroundColor Red
    Write-Host '  The routes reach their functions, but a function reported that the'
    Write-Host '  deployment is incomplete (HTTP 503). The message above names what is'
    Write-Host '  missing. Set it in Netlify with Functions scope, for this deploy'
    Write-Host '  context, and redeploy.'
    Write-Host ''
    Write-Host 'DO NOT send an invitation and DO NOT delete any account yet.'
    Write-Host 'Sign-in cannot succeed while a required variable is missing.'
    exit 1
}
Write-Host 'READINESS: OK -- every protected route refuses an anonymous caller with 401.' -ForegroundColor Green
Write-Host ''
Write-Host 'This deployment is routed and ready.' -ForegroundColor Green
exit 0
