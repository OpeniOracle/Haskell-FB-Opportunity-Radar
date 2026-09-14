<#
.SYNOPSIS
    Is this deployment's Functions runtime actually configured?

.DESCRIPTION
    A Netlify deploy whose status is `ready` tells you the functions were built,
    uploaded and registered. It tells you NOTHING about whether they can run:
    every variable they need is read at REQUEST time, so a deploy with none of
    them configured is equally `ready`. The only evidence that settles it is a
    response from the deployed function.

    STAGE 1 NEEDS NO CREDENTIAL. /api/status validates its environment BEFORE it
    reads the Authorization header, so an unauthenticated request already
    separates the two cases:

        503 + "Deployment is incomplete. Missing: X, Y"
             the named variables are not visible to the running function
        401  the function RAN; SUPABASE_URL, SUPABASE_SECRET_KEY and
             SUPABASE_PUBLISHABLE_KEY are all present at Functions scope

    A 401 is the PASS. Nothing secret is sent, so nothing secret can leak.

    STAGE 2 IS OPTIONAL and returns the full report, which needs a signed-in
    user's access token.

    WHERE THE TOKEN NEVER GOES: not a parameter (PowerShell records bound
    parameters in history), not an environment variable, not a file, not this
    repository. It is read through Read-SecretValue and materialised through
    Use-Plain from OperatorGuards.psm1 -- the same two primitives the hosted
    validator uses, rather than a second hand-rolled version of them -- so the
    characters never reach the console buffer or PSReadLine's history, and the
    BSTR is zeroed on the way out.

    Assert-NoObservation refuses to run at all under a transcript, verbose or
    debug output, script tracing, or a debugger breakpoint. Each of those would
    capture the header this script sends.

    The token is a bearer credential valid until its own expiry -- close the
    window when you are done.

.PARAMETER BaseUri
    The deployment to check. Not secret.

.EXAMPLE
    .\Test-DeploymentReadiness.ps1 -BaseUri 'https://deploy-preview-10--haskell-fb-opportunity-radar.netlify.app'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $BaseUri
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'OperatorGuards.psm1') -Force

# Before anything else, and before any credential is asked for.
Assert-NoObservation

$BaseUri = $BaseUri.TrimEnd('/')
if ($BaseUri -notmatch '^https://') {
    Write-Host 'Refusing a non-https base URI.' -ForegroundColor Red
    exit 2
}

function Invoke-Status {
    param([hashtable] $Headers)
    try {
        $response = Invoke-WebRequest -Uri "$BaseUri/api/status" -Method Get `
            -Headers $Headers -UseBasicParsing -TimeoutSec 30
        return @{ Code = [int] $response.StatusCode; Body = $response.Content }
    }
    catch [System.Net.WebException] {
        $r = $_.Exception.Response
        if ($null -eq $r) { return @{ Code = 0; Body = $_.Exception.Message } }
        $reader = New-Object System.IO.StreamReader($r.GetResponseStream())
        $body = $reader.ReadToEnd()
        $reader.Close()
        return @{ Code = [int] $r.StatusCode; Body = $body }
    }
}

Write-Host ''
Write-Host '== Stage 1: can the function run at all? (no credential is sent) ==' -ForegroundColor Cyan
Write-Host ''
Write-Host "GET $BaseUri/api/status" -ForegroundColor DarkGray

$result = Invoke-Status -Headers @{}

switch ($result.Code) {
    401 {
        Write-Host 'PASS  HTTP 401 -- the function ran.' -ForegroundColor Green
        Write-Host '      SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY are'
        Write-Host '      all present at Functions scope in this deployment.'
    }
    503 {
        Write-Host 'FAIL  HTTP 503 -- the function ran and refused.' -ForegroundColor Red
        Write-Host "      $($result.Body)"
        Write-Host ''
        Write-Host '      Those variables are not visible to the running function. Set them in'
        Write-Host '      Netlify -> Site configuration -> Environment variables with the'
        Write-Host '      *Functions* scope, then REDEPLOY this context: a deploy is frozen at'
        Write-Host '      the values it was built with. netlify.toml cannot supply them.'
        exit 1
    }
    200 {
        Write-Host 'UNEXPECTED  HTTP 200 without a credential.' -ForegroundColor Red
        Write-Host '      /api/status must never answer without authentication. Stop and report this.'
        exit 1
    }
    404 {
        Write-Host 'FAIL  HTTP 404 -- /api/status did not reach a function.' -ForegroundColor Red
        Write-Host '      A _redirects file may be shadowing netlify.toml, or this deploy has no functions.'
        exit 1
    }
    0 {
        Write-Host 'FAIL  the request did not complete.' -ForegroundColor Red
        Write-Host "      $($result.Body)"
        Write-Host '      This is about the network between you and Netlify, not about the deployment.'
        exit 1
    }
    default {
        Write-Host "FAIL  HTTP $($result.Code)" -ForegroundColor Red
        Write-Host "      $($result.Body)"
        exit 1
    }
}

Write-Host ''
Write-Host '== Stage 2: the full report (optional) ==' -ForegroundColor Cyan
Write-Host ''
Write-Host "Stage 2 needs a signed-in user's access token. Sign in to the deployment,"
Write-Host 'then take the access token from the Supabase session in browser storage.'
Write-Host ''
Write-Host 'Press Enter alone to skip.'

$secure = $null
try {
    $secure = Read-SecretValue -Prompt 'Access token'
}
catch {
    Write-Host 'Skipped. Stage 1 already answered the configuration question.' -ForegroundColor DarkGray
    exit 0
}

# Materialised for exactly one request. Use-Plain zeroes the BSTR on the way
# out; the .NET string the runtime makes cannot be zeroed, so its lifetime is
# kept to this one call instead.
$result = Use-Plain -Secure $secure -Body {
    param($plain)
    Invoke-Status -Headers @{ Authorization = "Bearer $plain" }
}

if ($result.Code -ne 200) {
    Write-Host "FAIL  HTTP $($result.Code)" -ForegroundColor Red
    Write-Host "      $($result.Body)"
    if ($result.Code -eq 401) {
        Write-Host '      The token was rejected. It may have expired -- sign in again.'
    }
    exit 1
}

Write-Host 'PASS  HTTP 200' -ForegroundColor Green
try {
    $result.Body | ConvertFrom-Json | ConvertTo-Json -Depth 6
}
catch {
    Write-Host $result.Body
}

Write-Host ''
Write-Host 'Read: ok, schema.version, database.reachable, storage.private, auth.*,' -ForegroundColor DarkGray
Write-Host 'sec.contactConfirmed, egressAllowlistSize. A model reported as unconfigured' -ForegroundColor DarkGray
Write-Host 'is expected and affects nothing. The response names variables, never values.' -ForegroundColor DarkGray
Write-Host 'Close this window when you are done.' -ForegroundColor DarkGray
