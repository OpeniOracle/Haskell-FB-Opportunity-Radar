<#
.SYNOPSIS
    Send the PR #9 bootstrap invitation to the preview deployment.

.DESCRIPTION
    WHY THIS EXISTS RATHER THAN THE DASHBOARD BUTTON.

    Supabase's *Invite user* action in the dashboard offers no way to name a
    redirect. It always sends the invitation to the project's **Site URL**,
    which is the production origin -- and PR #9 is unmerged, so production does
    not yet contain `/auth/callback` or any of the other authentication routes.
    An invitation sent that way lands on an application that cannot read it,
    which is exactly the failure this milestone was opened to fix.

    So the invitation is sent server-side, through the Auth Admin endpoint, with
    the preview callback named explicitly and checked before it is used.

    SECRET HANDLING. The `sb_secret_...` key is prompted for with the input
    hidden, held as a SecureString, and materialised into a plain string only
    inside `Use-Plain` -- for the duration of one request, inside a try/finally
    that drops it again. It is never a parameter, never an environment variable,
    never written to disk, and never printed. The script refuses to start under
    a transcript, verbose or debug output, script tracing, or a debugger,
    because each of those would capture what the redactor protects.

    WHAT IS NEVER PRINTED. The secret, the invitation link, any token, and any
    response body. Supabase's reply carries a full user object; this script
    reads two fields from it and reports a sanitised outcome.

.EXAMPLE
    cd C:\path\to\Haskell-FB-Opportunity-Radar
    git switch claude/production-foundation
    git pull
    pwsh -File .\scripts\Send-BootstrapInvitation.ps1
#>

param(
    [string] $Branch = 'claude/production-foundation',
    [string] $Repository = 'OpeniOracle/Haskell-FB-Opportunity-Radar',
    # Optional belt-and-braces: the head SHA shown on the PR page.
    [string] $ExpectedHead
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'OperatorGuards.psm1') -Force

# --------------------------------------------------------------------------
# Not secret. Committed in netlify.toml; it grants nothing on its own.
$SupabaseUrl = 'https://dutmdlbangsthclgtkhy.supabase.co'

<#
    The one address this invitation may point at.

    A constant, not a parameter. The whole purpose of the script is that the
    invitation reaches the PREVIEW, and a redirect that can be overridden on the
    command line is a redirect that will eventually be overridden by accident --
    back to the production Site URL, which is the bug being fixed. It must also
    be byte-identical to an entry in Supabase's Redirect URL allowlist, because
    Supabase silently falls back to the Site URL for a value that is not on it.
#>
$RedirectTo = 'https://deploy-preview-9--haskell-fb-opportunity-radar.netlify.app/auth/callback'

<#
    Reserved for SEC operational notices. Migration 0017 refuses to allowlist it
    and 0016 then refuses to create the account, so this would fail anyway -- but
    it fails here, before a secret has been typed, with an explanation.
#>
$ReservedAddress = 'oracles@openi-analytics.com'

$script:SecretSecure = $null

function Say([string] $Message) { Write-Host $Message }
function Pass([string] $What) { Write-Host "  PASS  $What" -ForegroundColor Green }
function Fail([string] $What) { Write-Host "  FAIL  $What" -ForegroundColor Red }
function Note([string] $What) { Write-Host "  note  $What" -ForegroundColor DarkGray }

function Protect-Text([string] $Text) {
    # Last line of defence. Nothing this script prints is expected to contain
    # the key; if Supabase ever echoed it inside an error, this is what stops it
    # reaching the console and then a pull request.
    if (-not $Text) { return $Text }
    if (-not $script:SecretSecure) { return $Text }
    $result = $Text
    $result = Use-Plain -Secure $script:SecretSecure -Body { param($p) $result.Replace($p, '<SECRET>') }
    return $result
}

function Clear-Secrets {
    if ($script:SecretSecure) { $script:SecretSecure.Dispose(); $script:SecretSecure = $null }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

# Ctrl-C and an abrupt host exit land here as well as in the finally block.
$null = Register-EngineEvent PowerShell.Exiting -SupportEvent -Action { Clear-Secrets }

$script:SupportsSkipError = (Get-Command Invoke-WebRequest).Parameters.ContainsKey('SkipHttpErrorCheck')

function Invoke-Supabase {
    <#
        One request, with the secret key as both `apikey` and bearer token,
        built inside Use-Plain so it never reaches the process table.

        Returns Status and Body. THE CALLER MUST NOT PRINT THE BODY -- every
        response here carries user records.
    #>
    param(
        [string] $Method = 'GET',
        [Parameter(Mandatory)] [string] $Path,
        [string] $Body
    )

    return Use-Plain -Secure $script:SecretSecure -Body {
        param($key)
        $params = @{
            Method          = $Method
            Uri             = "$SupabaseUrl$Path"
            Headers         = @{ apikey = $key; Authorization = "Bearer $key" }
            UseBasicParsing = $true
            ErrorAction     = 'Stop'
        }
        if ($Body) {
            $params['Body'] = $Body
            $params['ContentType'] = 'application/json'
        }
        if ($script:SupportsSkipError) { $params['SkipHttpErrorCheck'] = $true }

        try {
            $response = Invoke-WebRequest @params
            [pscustomobject]@{ Status = [int] $response.StatusCode; Body = [string] $response.Content }
        } catch {
            $r = $null
            try { $r = $_.Exception.Response } catch { $r = $null }
            if ($r) {
                $text = ''
                try {
                    $reader = New-Object System.IO.StreamReader($r.GetResponseStream())
                    $text = $reader.ReadToEnd()
                    $reader.Close()
                } catch { $text = '' }
                [pscustomobject]@{ Status = [int] $r.StatusCode; Body = $text }
            } else {
                [pscustomobject]@{ Status = 0; Body = '' }
            }
        }
    }
}

# ==========================================================================

$ok = $false

try {
    Assert-NoObservation

    Write-Host "`n== 0. Repository guard" -ForegroundColor Cyan
    $head = Assert-CorrectCheckout -Repository $Repository -Branch $Branch -ExpectedHead $ExpectedHead

    # ---------------------------------------------------------------------
    Write-Host "`n== 1. Who is being invited" -ForegroundColor Cyan
    Say 'A NAMED INDIVIDUAL''s Openi address. Not a shared mailbox: its readers'
    Say 'change without anyone revoking anything, every action would be attributed'
    Say 'to a mailbox rather than a person, and a password reset sent to it is'
    Say 'visible to everyone who reads it.'
    Write-Host ''

    # Visible on purpose. This is not a credential, and the operator must be
    # able to see that they typed it correctly before an email is sent.
    $email = (Read-Host -Prompt 'Openi email address to invite').Trim()
    if (-not $email) { throw 'No address entered.' }

    $normalised = $email.ToLowerInvariant()
    if ($normalised -eq $ReservedAddress) {
        throw "$ReservedAddress is reserved for SEC automated-source identification and operational notices. It must not hold an application account. Use a named individual's address."
    }
    if ($normalised -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
        throw "'$email' is not an email address."
    }
    Pass "address accepted: $email"

    # ---------------------------------------------------------------------
    Write-Host "`n== 2. Supabase secret key" -ForegroundColor Cyan
    Say 'From Project Settings > API keys. Input is hidden and is never echoed,'
    Say 'stored, written to disk, or passed as an argument.'
    $script:SecretSecure = Read-SecretValue -Prompt 'Supabase secret key (sb_secret_...)'

    # Shape check without ever printing the value.
    $shapeOk = Use-Plain -Secure $script:SecretSecure -Body { param($k) $k.StartsWith('sb_secret_') }
    if (-not $shapeOk) {
        throw 'That is not an sb_secret_... key. This project does not use the legacy service_role JWT; see docs/ENVIRONMENT.md.'
    }
    Pass 'key has the expected shape'

    # ---------------------------------------------------------------------
    Write-Host "`n== 3. Preconditions" -ForegroundColor Cyan

    # 3a. The allowlist row must ALREADY exist. Migration 0016's trigger fires
    #     `before insert on auth.users`, so inviting first fails at the moment
    #     Supabase tries to create the row and no email is ever sent. Checking
    #     here turns that into an explanation instead of a Supabase error.
    $encoded = [uri]::EscapeDataString($normalised)
    $allow = Invoke-Supabase -Path "/rest/v1/auth_invite_allowlist?select=email_normalized&email_normalized=eq.$encoded"
    if ($allow.Status -ne 200) {
        throw "Could not read the invitation allowlist (HTTP $($allow.Status)). Check the secret key."
    }
    $allowRows = @()
    try { $allowRows = @($allow.Body | ConvertFrom-Json) } catch { $allowRows = @() }
    if ($allowRows.Count -lt 1) {
        throw @"
$email is not on auth_invite_allowlist, so the invitation would fail and no email would be sent.
Add it first, in the Supabase SQL Editor:

insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by, note)
values (lower(trim('$email')), '$email', '$email', 'Bootstrap Openi administrator, PR #9');
"@
    }
    Pass 'the address is on auth_invite_allowlist'

    # 3b. Refuse if a CONFIRMED account already occupies the address. Re-inviting
    #     someone who has already set a password does not help them and may
    #     invalidate the credential they are using; an unconfirmed invitation,
    #     by contrast, is exactly the thing worth resending.
    $users = Invoke-Supabase -Path '/auth/v1/admin/users?page=1&per_page=200'
    if ($users.Status -ne 200) {
        throw "Could not list existing accounts (HTTP $($users.Status)). The secret key must be an sb_secret_... key with admin rights."
    }
    $existing = $null
    try {
        $parsed = $users.Body | ConvertFrom-Json
        $list = if ($parsed.PSObject.Properties['users']) { $parsed.users } else { $parsed }
        $existing = @($list) | Where-Object {
            $_.email -and $_.email.ToLowerInvariant() -eq $normalised
        } | Select-Object -First 1
    } catch {
        throw 'Could not read the account list.'
    }

    if ($existing) {
        $confirmed = $false
        foreach ($field in 'email_confirmed_at', 'confirmed_at') {
            if ($existing.PSObject.Properties[$field] -and $existing.$field) { $confirmed = $true }
        }
        if ($confirmed) {
            throw @"
An account for $email already exists and has been confirmed.
Re-inviting a confirmed account does not help and can disturb the credential in use.
If the password is the problem, use Forgot password on the sign-in page instead.
"@
        }
        Note 'an unconfirmed invitation already exists for this address; sending a fresh one'
    } else {
        Pass 'no account occupies this address yet'
    }

    # ---------------------------------------------------------------------
    Write-Host "`n== 4. Send" -ForegroundColor Cyan
    Note "redirect: $RedirectTo"
    Say '  This must be byte-identical to an entry in Supabase > Authentication >'
    Say '  URL Configuration > Redirect URLs. Supabase silently falls back to the'
    Say '  Site URL for a value that is not on the allowlist, which looks exactly'
    Say '  like the bug this script exists to avoid.'

    $payload = @{ email = $email; options = @{ redirectTo = $RedirectTo } } | ConvertTo-Json -Compress
    $invite = Invoke-Supabase -Method POST -Path '/auth/v1/invite' -Body $payload

    if ($invite.Status -in 200, 201) {
        # Two fields, read and discarded. The body carries a full user record and
        # is never printed.
        $createdAddress = $null
        try { $createdAddress = ($invite.Body | ConvertFrom-Json).email } catch { $createdAddress = $null }
        Pass "invitation sent to $email"
        if ($createdAddress -and $createdAddress.ToLowerInvariant() -ne $normalised) {
            Fail 'Supabase reported a different address than the one requested. Do not use the link; investigate.'
            $ok = $false
        } else {
            $ok = $true
        }
    } else {
        # Supabase's error text can quote the request. Redacted, and truncated,
        # so a long body cannot smuggle something past a skim.
        $reason = Protect-Text $invite.Body
        if ($reason.Length -gt 300) { $reason = $reason.Substring(0, 300) + '...' }
        Fail "Supabase refused the invitation (HTTP $($invite.Status))."
        if ($invite.Status -eq 422 -or $invite.Status -eq 400) {
            Note 'A 400/422 here usually means the redirect is not on the Redirect URL allowlist,'
            Note 'or the address is already registered. Check section A of the runbook.'
        }
        Note "detail: $reason"
    }
}
catch {
    Write-Host "`nABORTED: $(Protect-Text $_.Exception.Message)" -ForegroundColor Red
}
finally {
    Clear-Secrets

    Write-Host ''
    if ($ok) {
        Write-Host 'Invitation sent. Nothing about it was printed, by design.' -ForegroundColor Green
        Write-Host ''
        Write-Host 'What must happen when you open the emailed link:'
        Write-Host '  1. /auth/callback -- briefly, "Checking your session..."'
        Write-Host '  2. /auth/set-password -- "Choose a password", addressed to you'
        Write-Host '  3. / -- the Daily Pulse, with your address and a Sign out control'
        Write-Host ''
        Write-Host 'The address bar must carry NO token by step 2, and Back must not reach one.'
        Write-Host 'If you land on the production origin instead, the Invite user email template'
        Write-Host 'is overriding the redirect -- see docs/HOSTED_VALIDATION_RUNBOOK.md section A.'
    } else {
        Write-Host 'No invitation was sent.' -ForegroundColor Yellow
    }
}

if (-not $ok) { exit 1 }
