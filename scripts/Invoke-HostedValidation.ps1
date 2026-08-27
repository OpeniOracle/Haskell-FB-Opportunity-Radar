<#
.SYNOPSIS
    PR #9 hosted validation. Every check that needs HTTP access to Netlify and
    Supabase, in one run, on Windows PowerShell or PowerShell 7.

.DESCRIPTION
    The automation environment's egress policy answers 403 to CONNECT for
    *.netlify.app and *.supabase.co, so these checks cannot run there. This
    script is the whole remainder.

    SECRET HANDLING. Nothing confidential is ever passed as a parameter, an
    environment variable, or a command-line argument, and nothing confidential
    is ever written to disk. Both values are prompted for with the input hidden,
    held as SecureString, and materialised into a plain string only inside the
    single function that builds a request header -- inside a try/finally that
    drops it again immediately. Console output is filtered through a redactor
    that would replace either value if it ever appeared. The script refuses to
    start under -Verbose, -Debug, an active transcript, a breakpoint or script
    tracing, because each of those would capture what the redactor protects.

    THE CANARY. This script creates its own evidence records and its own storage
    object, with identifiers unique to the run, and removes all of them in a
    finally block -- on success, on failure, and on Ctrl-C. Nothing is left
    staged in the hosted database waiting for a human.

.EXAMPLE
    cd C:\path\to\Haskell-FB-Opportunity-Radar
    git switch claude/production-foundation
    pwsh -File .\scripts\Invoke-HostedValidation.ps1

.NOTES
    Paste the entire output into PR #9.
#>

param(
    [string] $Preview = 'https://deploy-preview-9--haskell-fb-opportunity-radar.netlify.app',
    [string] $Branch  = 'claude/production-foundation',
    [string] $Repository = 'OpeniOracle/Haskell-FB-Opportunity-Radar',
    # Optional belt-and-braces: the head SHA shown on the PR page. When supplied
    # the checkout must match it exactly.
    [string] $ExpectedHead
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The repository, clean-tree, branch and remote-head checks, and the refusals
# that keep a secret off a recorded console, live in one module so this script
# and Send-BootstrapInvitation.ps1 run the SAME guards rather than two copies
# that drift apart.
Import-Module (Join-Path $PSScriptRoot 'OperatorGuards.psm1') -Force

# --------------------------------------------------------------------------
# Not secret. Committed in netlify.toml; it grants nothing on its own, and RLS
# is what protects the data.
$SupabaseUrl  = 'https://dutmdlbangsthclgtkhy.supabase.co'
$Publishable  = 'sb_publishable_kE97uOb8HCo51uT_e0mxqg_So2Z0dwH'
$Bucket       = 'evidence-raw'

<#
    A constant, deliberately NOT a browser. Supabase refuses a secret key when
    the request looks like it came from a browser, and Windows PowerShell 5.1's
    default User-Agent is browser-shaped.
#>
$OperatorUserAgent = 'Openi-Haskell-FB-Radar-Operator/1.0'

$script:TokenSecure  = $null
$script:SecretSecure = $null

$script:Pass = 0
$script:Fail = 0
$script:Info = @()
$script:SignedOut = $false

function Write-Section([string] $Title) { Write-Host "`n== $Title" -ForegroundColor Cyan }
function Pass([string] $What) { $script:Pass++; Write-Host "  PASS  $What" -ForegroundColor Green }
function Fail([string] $What, [string] $Why) {
    $script:Fail++
    Write-Host "  FAIL  $What -- $(Protect-Text $Why)" -ForegroundColor Red
}
function Note([string] $What) { Write-Host "  note  $What" -ForegroundColor DarkGray }
function Check([string] $What, [bool] $Ok, [string] $Why = '') {
    if ($Ok) { Pass $What } else { Fail $What $Why }
}

# --------------------------------------------------------------------------
# --------------------------------------------------------------------------
# Secret handling.

function Protect-Text([string] $Text) {
    # Last line of defence. Nothing printed by this script is expected to
    # contain either value; if a server ever echoed one back inside an error,
    # this is what stops it reaching the console and then the pull request.
    if (-not $Text) { return $Text }
    $result = $Text
    foreach ($pair in @(
        @{ Secure = $script:TokenSecure;  Mask = '<TOKEN>' },
        @{ Secure = $script:SecretSecure; Mask = '<SECRET>' }
    )) {
        if ($pair.Secure) {
            $mask = $pair.Mask
            $result = Use-Plain -Secure $pair.Secure -Body { param($p) $result.Replace($p, $mask) }
        }
    }
    return $result
}

function Clear-Secrets {
    if ($script:TokenSecure)  { $script:TokenSecure.Dispose();  $script:TokenSecure  = $null }
    if ($script:SecretSecure) { $script:SecretSecure.Dispose(); $script:SecretSecure = $null }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

# Ctrl-C and an abrupt host exit both land here as well as in the finally block.
$null = Register-EngineEvent PowerShell.Exiting -SupportEvent -Action { Clear-Secrets }

# --------------------------------------------------------------------------
# HTTP.

$script:SupportsSkipError = (Get-Command Invoke-WebRequest).Parameters.ContainsKey('SkipHttpErrorCheck')

function Invoke-Http {
    <#
        Returns Status/Body/Headers and never throws on an HTTP error status --
        a 401 is an ANSWER here, not an exception.

        `Auth` and `ApiKey` name WHICH credential to use, never the credential
        itself. The plain value exists only inside Use-Plain, for the moment it
        takes to build one header.
    #>
    param(
        [string] $Method = 'GET',
        [Parameter(Mandatory)] [string] $Uri,
        [ValidateSet('none', 'token', 'secret')] [string] $Auth = 'none',
        [ValidateSet('none', 'publishable', 'secret')] [string] $ApiKey = 'none',
        [hashtable] $Headers = @{},
        [string] $Body = '',
        [string] $ContentType = 'application/json'
    )

    $run = {
        param($plainAuth, $plainKey)
        $h = @{}
        foreach ($k in $Headers.Keys) { $h[$k] = $Headers[$k] }
        # A USER's access token is a JWT and belongs in Authorization, paired
        # with the publishable key as `apikey` -- exactly what a browser sends.
        #
        # The SECRET key is an OPAQUE key, not a JWT. It goes in `apikey` and
        # nowhere else: sent as a bearer value, PostgREST tries to parse it as a
        # JWT, fails, and answers 401 -- which reads as a bad key and is not.
        if ($plainAuth) { $h['Authorization'] = "Bearer $plainAuth" }
        if ($plainKey)  { $h['apikey'] = $plainKey }

        $params = @{
            Method          = $Method
            Uri             = $Uri
            Headers         = $h
            UserAgent       = $OperatorUserAgent
            UseBasicParsing = $true
            ErrorAction     = 'Stop'
        }
        if ($Body) {
            $params['Body'] = $Body
            $params['ContentType'] = $ContentType
        }
        if ($script:SupportsSkipError) { $params['SkipHttpErrorCheck'] = $true }

        try {
            $response = Invoke-WebRequest @params
            [pscustomobject]@{
                Status  = [int] $response.StatusCode
                Body    = [string] $response.Content
                Headers = $response.Headers
                Error   = $null
            }
        } catch {
            # Windows PowerShell 5.1 has no -SkipHttpErrorCheck, so a non-2xx
            # arrives as an exception carrying the real response.
            $r = $null
            try { $r = $_.Exception.Response } catch { $r = $null }
            if ($r) {
                $text = ''
                try {
                    $reader = New-Object System.IO.StreamReader($r.GetResponseStream())
                    $text = $reader.ReadToEnd()
                    $reader.Close()
                } catch { $text = '' }
                [pscustomobject]@{
                    Status = [int] $r.StatusCode; Body = $text; Headers = $r.Headers; Error = $null
                }
            } else {
                [pscustomobject]@{
                    Status = 0; Body = ''; Headers = $null; Error = $_.Exception.Message
                }
            }
        }
    }

    # `secret` is no longer selectable as a BEARER credential. Asking for it
    # routes the key to `apikey` and leaves Authorization unset, because an
    # opaque key in a bearer header is read as a JWT and refused.
    $authSecure = if ($Auth -eq 'token') { $script:TokenSecure } else { $null }
    $keySecure  = if ($ApiKey -eq 'secret' -or $Auth -eq 'secret') { $script:SecretSecure } else { $null }
    # The publishable key is not confidential and needs no protection.
    $keyLiteral = if ($ApiKey -eq 'publishable') { $Publishable } else { $null }

    if ($authSecure) {
        return Use-Plain -Secure $authSecure -Body {
            param($a)
            if ($keySecure) { Use-Plain -Secure $keySecure -Body { param($k) & $run $a $k } }
            else { & $run $a $keyLiteral }
        }
    }
    if ($keySecure) { return Use-Plain -Secure $keySecure -Body { param($k) & $run $null $k } }
    return & $run $null $keyLiteral
}

function Get-HeaderValue($Response, [string] $Name) {
    if (-not $Response.Headers) { return '' }
    foreach ($k in $Response.Headers.Keys) {
        if ($k -ieq $Name) { return (($Response.Headers[$k]) -join ', ') }
    }
    return ''
}

function Field($Object, [string] $Path) {
    # Set-StrictMode turns a missing property into a terminating error, which
    # would abort the run rather than report a missing field. This reports it.
    $current = $Object
    foreach ($segment in $Path.Split('.')) {
        if ($null -eq $current) { return $null }
        $property = $current.PSObject.Properties[$segment]
        if (-not $property) { return $null }
        $current = $property.Value
    }
    return $current
}

function Get-Json($Response) {
    if (-not $Response.Body) { return $null }
    try { return $Response.Body | ConvertFrom-Json } catch { return $null }
}

# The caller's own token, decoded WITHOUT verifying it -- used only to read the
# `exp` claim so the revocation check can prove the token had not merely expired.
function Get-TokenExpiry {
    Use-Plain -Secure $script:TokenSecure -Body {
        param($plain)
        $parts = $plain.Split('.')
        if ($parts.Count -ne 3) { return $null }
        $payload = $parts[1].Replace('-', '+').Replace('_', '/')
        switch ($payload.Length % 4) { 2 { $payload += '==' } 3 { $payload += '=' } }
        try {
            $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
            return [int] $json.exp
        } catch { return $null }
    }
}

# ==========================================================================

$canary = $null
$head = $null

try {
    Assert-NoObservation

    Write-Section '0. Repository guard'
    $head = Assert-CorrectCheckout -Repository $Repository -Branch $Branch -ExpectedHead $ExpectedHead

    Write-Host ''
    Write-Host 'Two values are needed. Neither is echoed, stored, or written to disk.'
    Write-Host '  1. The bootstrap administrator access token. In the browser console on the'
    Write-Host '     deploy preview, signed in:'
    Write-Host '       JSON.parse(localStorage.getItem(Object.keys(localStorage)'
    Write-Host '         .find(k => k.startsWith("sb-") && k.endsWith("-auth-token")))).access_token'
    Write-Host '  2. The Supabase secret key (sb_secret_...), from Project Settings > API keys.'
    Write-Host ''

    $script:TokenSecure  = Read-SecretValue -Prompt 'Administrator access token'
    $script:SecretSecure = Read-SecretValue -Prompt 'Supabase secret key'

    # A run-unique canary. Nothing here collides with another run, and nothing
    # here is left behind -- see the finally block.
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    $canary = [pscustomobject]@{
        RunId      = [guid]::NewGuid().ToString()
        SourceRun  = [guid]::NewGuid().ToString()
        Archived   = [guid]::NewGuid().ToString()
        Reference  = [guid]::NewGuid().ToString()
        Path       = "canary/$stamp-$([guid]::NewGuid().ToString('N')).txt"
        Text       = "evidence-proxy-canary $stamp"
        Created    = @()
    }
    Write-Host "  canary run id: $($canary.RunId)"

    # ---------------------------------------------------------------------
    Write-Section '1-2. /api/status as the invited administrator'

    $status = Invoke-Http -Uri "$Preview/api/status" -Auth token
    Check 'status responds 200' ($status.Status -eq 200) "got $($status.Status) $(Protect-Text $status.Body)"
    $s = Get-Json $status
    if ($s) {
        Write-Host ($status.Body | ConvertFrom-Json | ConvertTo-Json -Depth 6)
        Check 'foundation ok'                    ((Field $s 'ok') -eq $true)
        Check 'database reachable as the caller' ((Field $s 'database.reachable') -eq $true)
        Check 'schema version is 0018'           ((Field $s 'schema.version') -eq '0018') "got '$(Field $s 'schema.version')'"
        Check 'evidence bucket is private'       ((Field $s 'storage.private') -eq $true)
        Check 'model credential configured'      ((Field $s 'modelConfigured') -eq $true)
        Check 'SEC contact confirmed'            ((Field $s 'sec.contactConfirmed') -eq $true)
        Check 'invite-only enforced'             ((Field $s 'auth.inviteOnlyEnforced') -eq $true)
        Check 'session guard installed (0018)'   ((Field $s 'auth.evidenceSessionCheckInstalled') -eq $true) 'migration 0018 is not applied to this project'
        Check 'this session passes the guard'    ((Field $s 'auth.evidenceAccessAuthorized') -eq $true)
        Note  "JWT verification mode: $(Field $s 'auth.jwtVerification')"
        Check 'caller is invited'                ((Field $s 'caller.invited') -eq $true)
        Check 'response leaks no key'            ($status.Body -notmatch 'sb_secret_|sb_publishable_|eyJ[A-Za-z0-9_-]{10,}\.')
    }

    # ---------------------------------------------------------------------
    Write-Section '3. Unauthenticated access is refused'

    $anon = Invoke-Http -Uri "$Preview/api/status"
    Check 'unauthenticated /api/status is 401' ($anon.Status -eq 401) "got $($anon.Status)"

    $anonEvidence = Invoke-Http -Uri "$Preview/api/evidence/$($canary.Archived)"
    Check 'unauthenticated /api/evidence is 401' ($anonEvidence.Status -eq 401) "got $($anonEvidence.Status)"

    $garbage = Invoke-Http -Uri "$Preview/api/status" -Headers @{ Authorization = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJub25lIn0.bm90LWEtc2lnbmF0dXJl' }
    Check 'a well-formed but invalid token is 401' ($garbage.Status -eq 401) "got $($garbage.Status)"

    $unknown = Invoke-Http -Uri "$Preview/api/evidence/00000000-0000-4000-8000-000000000000" -Auth token
    Check 'an unknown evidence id is 404' ($unknown.Status -eq 404) "got $($unknown.Status)"

    # ---------------------------------------------------------------------
    Write-Section '5. Evidence canary -- create, retrieve, verify'

    $runBody = @{
        id = $canary.SourceRun; source_id = 'sec-edgar'; status = 'success'
        run_status = 'success'; items_seen = 1; items_stored = 1
    } | ConvertTo-Json -Compress
    $mk = Invoke-Http -Method POST -Uri "$SupabaseUrl/rest/v1/source_runs" -Auth secret -ApiKey secret `
        -Headers @{ Prefer = 'return=minimal' } -Body $runBody
    Check 'canary collection run created' ($mk.Status -in 200, 201, 204) "got $($mk.Status) $(Protect-Text $mk.Body)"
    if ($mk.Status -in 200, 201, 204) { $canary.Created += 'source_run' }

    $up = Invoke-Http -Method POST -Uri "$SupabaseUrl/storage/v1/object/$Bucket/$($canary.Path)" `
        -Auth secret -ApiKey secret -Body $canary.Text -ContentType 'text/plain'
    Check 'canary object uploaded to the private bucket' ($up.Status -in 200, 201) "got $($up.Status) $(Protect-Text $up.Body)"
    if ($up.Status -in 200, 201) { $canary.Created += 'object' }

    $hash = '1' * 64
    $evidenceRows = @(
        @{
            id = $canary.Archived; source_id = 'sec-edgar'; source_run_id = $canary.SourceRun
            original_url = 'https://www.sec.gov/canary'; resolved_url = 'https://www.sec.gov/canary'
            title = "Evidence proxy canary $stamp"; retrieved_at = (Get-Date).ToUniversalTime().ToString('o')
            content_hash = $hash; mime_type = 'text/plain'; extraction_status = 'success'
            access_mode = 'archived_full_text'; raw_storage_uri = $canary.Path
        },
        @{
            id = $canary.Reference; source_id = 'sec-edgar'; source_run_id = $canary.SourceRun
            original_url = 'https://example.invalid/newsroom'; resolved_url = 'https://example.invalid/newsroom'
            title = "Reference-only canary $stamp"; retrieved_at = (Get-Date).ToUniversalTime().ToString('o')
            content_hash = ('2' * 64); mime_type = 'text/html'; extraction_status = 'success'
            access_mode = 'reference_only'
        }
    )
    $ev = Invoke-Http -Method POST -Uri "$SupabaseUrl/rest/v1/evidence" -Auth secret -ApiKey secret `
        -Headers @{ Prefer = 'return=minimal' } -Body ($evidenceRows | ConvertTo-Json -Compress -Depth 4)
    Check 'canary evidence rows created' ($ev.Status -in 200, 201, 204) "got $($ev.Status) $(Protect-Text $ev.Body)"
    if ($ev.Status -in 200, 201, 204) { $canary.Created += 'evidence' }

    $fetched = Invoke-Http -Uri "$Preview/api/evidence/$($canary.Archived)" -Auth token
    Check 'the proxy serves the preserved copy' ($fetched.Status -eq 200) "got $($fetched.Status) $(Protect-Text $fetched.Body)"
    Check 'the bytes are the bytes that were stored' ($fetched.Body.Trim() -eq $canary.Text) "got '$(Protect-Text $fetched.Body)'"

    # --- 7. Cache headers, on the response that carried content.
    Write-Section '7. Cache and disclosure headers'
    $cache = Get-HeaderValue $fetched 'cache-control'
    Check "cache-control is 'private, no-store'" ($cache -match 'private' -and $cache -match 'no-store') "got '$cache'"
    Check 'pragma: no-cache'         ((Get-HeaderValue $fetched 'pragma') -match 'no-cache')
    Check 'content-disposition: attachment' ((Get-HeaderValue $fetched 'content-disposition') -match 'attachment')
    Check 'x-content-type-options: nosniff'  ((Get-HeaderValue $fetched 'x-content-type-options') -match 'nosniff')
    Check 'referrer-policy: no-referrer'     ((Get-HeaderValue $fetched 'referrer-policy') -match 'no-referrer')

    $allHeaders = ''
    if ($fetched.Headers) { foreach ($k in $fetched.Headers.Keys) { $allHeaders += "$k=$(($fetched.Headers[$k]) -join ',')`n" } }
    $leakSurface = "$allHeaders`n$($fetched.Body)"
    Check 'no storage path in the response'  ($leakSurface -notmatch [regex]::Escape($canary.Path))
    Check 'no signed URL in the response'    ($leakSurface -notmatch 'token=|/object/sign/|X-Amz-Signature')
    Check 'no bucket name in the response'   ($leakSurface -notmatch [regex]::Escape($Bucket))

    # --- ADR 0014: reference-only has no retained body, by design.
    Write-Section '5b. Reference-only evidence (ADR 0014)'
    $refOnly = Invoke-Http -Uri "$Preview/api/evidence/$($canary.Reference)" -Auth token
    Check 'reference-only evidence answers 409' ($refOnly.Status -eq 409) "got $($refOnly.Status)"
    Check 'and names no_retained_content'       ($refOnly.Body -match 'no_retained_content')

    # ---------------------------------------------------------------------
    Write-Section '6. Direct Storage access is refused'

    $publicUrl = Invoke-Http -Uri "$SupabaseUrl/storage/v1/object/public/$Bucket/$($canary.Path)"
    Check 'anonymous public-object URL is refused' ($publicUrl.Status -ne 200) "got $($publicUrl.Status)"

    $anonObject = Invoke-Http -Uri "$SupabaseUrl/storage/v1/object/$Bucket/$($canary.Path)" -ApiKey publishable
    Check 'anonymous authenticated-path URL is refused' ($anonObject.Status -ne 200) "got $($anonObject.Status)"

    $userObject = Invoke-Http -Uri "$SupabaseUrl/storage/v1/object/$Bucket/$($canary.Path)" -Auth token -ApiKey publishable
    Check 'a signed-in browser session cannot fetch the object directly' ($userObject.Status -ne 200) "got $($userObject.Status)"

    $bucketMeta = Invoke-Http -Uri "$SupabaseUrl/storage/v1/bucket/$Bucket" -Auth token -ApiKey publishable
    Check 'a signed-in session cannot read bucket metadata' ($bucketMeta.Status -ne 200) "got $($bucketMeta.Status)"

    $pathRead = Invoke-Http -Uri "$SupabaseUrl/rest/v1/evidence?select=raw_storage_uri&limit=1" -Auth token -ApiKey publishable
    Check 'a signed-in session cannot select raw_storage_uri' `
        (($pathRead.Status -ne 200) -or ($pathRead.Body -notmatch 'canary/')) "got $($pathRead.Status) $(Protect-Text $pathRead.Body)"

    $licence = Invoke-Http -Uri "$SupabaseUrl/rest/v1/licence_authorizations?select=*" -Auth token -ApiKey publishable
    Check 'the D14-L licence gate is unreadable' `
        (($licence.Status -ne 200) -or ($licence.Body.Trim() -eq '[]')) "got $($licence.Status) $(Protect-Text $licence.Body)"

    $anonTable = Invoke-Http -Uri "$SupabaseUrl/rest/v1/organizations?select=id&limit=1" -ApiKey publishable
    Check 'an anonymous table read returns nothing' `
        (($anonTable.Status -ne 200) -or ($anonTable.Body.Trim() -eq '[]')) "got $($anonTable.Status) $(Protect-Text $anonTable.Body)"

    # A positive control. Without one, every refusal above could be explained by
    # a broken URL rather than by a policy.
    $control = Invoke-Http -Uri "$SupabaseUrl/rest/v1/organizations?select=id&limit=1" -Auth token -ApiKey publishable
    Check 'positive control: the dashboard read DOES work' `
        (($control.Status -eq 200) -and ($control.Body.Trim() -ne '[]')) "got $($control.Status) $(Protect-Text $control.Body)"

    # ---------------------------------------------------------------------
    Write-Section '3b. Self-registration is refused'

    $signup = Invoke-Http -Method POST -Uri "$SupabaseUrl/auth/v1/signup" -ApiKey publishable `
        -Body (@{ email = "uninvited-$stamp@example.invalid"; password = [guid]::NewGuid().ToString() } | ConvertTo-Json -Compress)
    Check 'signup is refused' ($signup.Status -ne 200) "got $($signup.Status) $(Protect-Text $signup.Body)"
    if ($signup.Status -eq 200) { Note 'If a user was created, delete it in the dashboard and re-check the Auth settings.' }

    # ---------------------------------------------------------------------
    # 8. LAST, because it ends the session.
    Write-Section '8. Sign-out revokes evidence access immediately'

    $expiry = Get-TokenExpiry
    $secondsLeft = if ($expiry) { $expiry - [int] [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() } else { 0 }

    $before = Invoke-Http -Uri "$Preview/api/evidence/$($canary.Archived)" -Auth token
    Check 'evidence retrievable immediately before sign-out' ($before.Status -eq 200) "got $($before.Status)"

    $logout = Invoke-Http -Method POST -Uri "$SupabaseUrl/auth/v1/logout?scope=global" -Auth token -ApiKey publishable
    Check 'sign-out accepted' ($logout.Status -in 200, 204) "got $($logout.Status) $(Protect-Text $logout.Body)"
    $script:SignedOut = $true

    $after = Invoke-Http -Uri "$Preview/api/evidence/$($canary.Archived)" -Auth token
    Check 'the SAME token is refused by the evidence proxy after sign-out' ($after.Status -eq 401) "got $($after.Status)"
    Check 'and the token had not merely expired' ($secondsLeft -gt 60) "only ${secondsLeft}s of life remained; re-run with a fresh token"
    Note "the token still had ${secondsLeft}s before its own exp"

    # INFORMATIONAL, deliberately not a pass/fail. Ordinary reads keep
    # Supabase's documented behaviour: an issued access token remains valid
    # until it expires. Only the evidence proxy checks the session table.
    $statusAfter = Invoke-Http -Uri "$Preview/api/status" -Auth token
    Note "informational -- /api/status after sign-out answered $($statusAfter.Status)."
    Note 'That endpoint does NOT perform the session-table check, and this run does not'
    Note 'assert a value for it. Immediate revocation is a property of /api/evidence only.'
    $script:Info += "api/status after sign-out: $($statusAfter.Status)"
}
catch {
    Write-Host "`nABORTED: $(Protect-Text $_.Exception.Message)" -ForegroundColor Red
    $script:Fail++
}
finally {
    # ---------------------------------------------------------------------
    # 9. Cleanup -- always. Success, failure, or Ctrl-C.
    if ($canary -and $canary.Created.Count -gt 0) {
        Write-Section '9. Canary cleanup'
        try {
            if ($canary.Created -contains 'object') {
                $del = Invoke-Http -Method DELETE -Uri "$SupabaseUrl/storage/v1/object/$Bucket/$($canary.Path)" -Auth secret -ApiKey secret
                Check 'canary object deleted' ($del.Status -in 200, 204) "got $($del.Status)"
                $gone = Invoke-Http -Uri "$SupabaseUrl/storage/v1/object/$Bucket/$($canary.Path)" -Auth secret -ApiKey secret
                Check 'and it is gone' ($gone.Status -ne 200) "got $($gone.Status)"
            }
            if ($canary.Created -contains 'evidence') {
                foreach ($id in @($canary.Archived, $canary.Reference)) {
                    $d = Invoke-Http -Method DELETE -Uri "$SupabaseUrl/rest/v1/evidence?id=eq.$id" -Auth secret -ApiKey secret
                    Check "canary evidence $($id.Substring(0,8)) deleted" ($d.Status -in 200, 204) "got $($d.Status)"
                }
            }
            if ($canary.Created -contains 'source_run') {
                $d = Invoke-Http -Method DELETE -Uri "$SupabaseUrl/rest/v1/source_runs?id=eq.$($canary.SourceRun)" -Auth secret -ApiKey secret
                Check 'canary collection run deleted' ($d.Status -in 200, 204) "got $($d.Status)"
            }
            $left = Invoke-Http -Uri "$SupabaseUrl/rest/v1/evidence?select=id" -Auth secret -ApiKey secret
            Check 'no evidence rows remain' ($left.Body.Trim() -eq '[]') "remaining: $(Protect-Text $left.Body)"
            $runsLeft = Invoke-Http -Uri "$SupabaseUrl/rest/v1/source_runs?select=id" -Auth secret -ApiKey secret
            Check 'no collection runs remain' ($runsLeft.Body.Trim() -eq '[]') "remaining: $(Protect-Text $runsLeft.Body)"
        } catch {
            Write-Host "  FAIL  cleanup -- $(Protect-Text $_.Exception.Message)" -ForegroundColor Red
            Write-Host "  Canary identifiers, for manual removal:" -ForegroundColor Yellow
            Write-Host "    evidence: $($canary.Archived), $($canary.Reference)"
            Write-Host "    source_run: $($canary.SourceRun)"
            Write-Host "    object: $($canary.Path)"
            $script:Fail++
        }
    }

    Clear-Secrets

    Write-Host ''
    Write-Host "head $head"
    Write-Host "$script:Pass passed, $script:Fail failed"
    if ($script:Fail -eq 0) {
        Write-Host 'HOSTED VALIDATION PASSED. Paste this whole output into PR #9.' -ForegroundColor Green
    } else {
        Write-Host 'HOSTED VALIDATION FAILED. Paste this whole output into PR #9 without editing it.' -ForegroundColor Red
    }
    if ($script:SignedOut) {
        Write-Host 'The administrator session was signed out by check 8. Sign back in before using the preview.'
    }
}

if ($script:Fail -ne 0) { exit 1 }
