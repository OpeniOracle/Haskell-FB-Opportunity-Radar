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

function Test-ApiRoute([string] $Path, [int[]] $AcceptableStatus) {
    Write-Host "`n$Path" -ForegroundColor Cyan
    $r = Get-Route $Path

    if ($r.Status -eq 0) { No "$Path is reachable" $r.Body; return }

    # THE DECISIVE ONE. The SPA fallback answers 200 with text/html, which looks
    # like success everywhere except here.
    $isHtml = ($r.Type -like '*text/html*') -or ($r.Body.TrimStart().StartsWith('<'))
    Check "$Path is not the single-page application" (-not $isHtml) `
        "content-type '$($r.Type)' -- the SPA fallback is winning, so this route never reaches its function"

    Check "$Path declares JSON" ($r.Type -like '*application/json*') "content-type '$($r.Type)'"
    Check "$Path does not redirect to the interface" (-not $r.Location) "Location: $($r.Location)"
    Check "$Path answers $($AcceptableStatus -join ' or ')" ($AcceptableStatus -contains $r.Status) `
        "got $($r.Status)"

    if (-not $isHtml -and $r.Body) {
        $parsed = $null
        try { $parsed = $r.Body | ConvertFrom-Json } catch { $parsed = $null }
        Check "$Path returns parseable JSON" ($null -ne $parsed) 'the body is not JSON'
    }

    # Per-caller answers must not be held by a shared cache.
    if ($r.Cache) {
        Check "$Path is private and not stored" (
            ($r.Cache -like '*no-store*') -and ($r.Cache -like '*private*')
        ) "cache-control: $($r.Cache)"
    }
}

Write-Host "== Deployed API route contract" -ForegroundColor Cyan
Write-Host "   origin: $Origin"
Write-Host '   No credentials are used or required. Three unauthenticated GETs.'

# Unauthenticated: each must REFUSE in JSON. A 503 is an acceptable refusal --
# it means the function ran and found the deployment incomplete, which is still
# proof the route reached a function rather than the SPA.
Test-ApiRoute '/api/session' @(401, 503)
Test-ApiRoute '/api/status'  @(401, 503)
Test-ApiRoute '/api/evidence/00000000-0000-4000-8000-000000000000' @(401, 503)

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
if ($script:Fail -gt 0) {
    Write-Host ''
    Write-Host 'The API is not correctly routed on this deployment.' -ForegroundColor Red
    Write-Host 'Do not send an invitation until this passes: the callback will fail'
    Write-Host 'with a session-verification error that looks like an account problem.'
    exit 1
}
Write-Host 'The API is correctly routed on this deployment.' -ForegroundColor Green
exit 0
