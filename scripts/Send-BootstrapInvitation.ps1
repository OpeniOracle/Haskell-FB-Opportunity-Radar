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

    HEADERS. `sb_secret_...` is an OPAQUE API KEY, not a JWT. It is sent in the
    `apikey` header and in no other, because PostgREST tries to parse an
    Authorization bearer value AS A JWT and answers 401 when it is not one.
    A constant non-browser User-Agent is set explicitly, because Supabase
    refuses a secret key from something that looks like a browser and Windows
    PowerShell 5.1's default User-Agent is browser-shaped. Every request goes
    through New-SupabaseRequest so there is one construction to get right.

    WHAT IS NEVER PRINTED. The secret, any header, the invitation link, any
    token, and any response body. Supabase's reply carries a full user object;
    this script reads two fields from it and reports a sanitised outcome. A
    refusal is CLASSIFIED rather than reprinted -- see
    Get-AuthFailureExplanation.

.EXAMPLE
    cd C:\path\to\Haskell-FB-Opportunity-Radar
    git switch claude/production-foundation
    git pull
    pwsh -File .\scripts\Send-BootstrapInvitation.ps1
#>

param(
    # PR #9 merged; the production foundation now lives on main. A default
    # naming a merged branch would refuse to run for the reason that it no
    # longer matches the checkout an operator actually has.
    [string] $Branch = 'main',
    [string] $Repository = 'OpeniOracle/Haskell-FB-Opportunity-Radar',
    # Optional belt-and-braces: the head SHA shown on the PR page.
    [string] $ExpectedHead,
    <#
        TEST ONLY, and constrained to LOOPBACK.

        The Windows PowerShell 5.1 CI job points this at an HttpListener on
        127.0.0.1 so it can capture the request this script actually builds --
        which is the only way to prove the header construction rather than
        assert it from source. Anything that is not a loopback host is refused
        below, so this can never be used to aim a secret at a third party.
    #>
    [string] $SupabaseOriginForLoopbackTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'OperatorGuards.psm1') -Force

# --------------------------------------------------------------------------
# Not secret. Committed in netlify.toml; it grants nothing on its own.
$SupabaseUrl = 'https://dutmdlbangsthclgtkhy.supabase.co'

if ($SupabaseOriginForLoopbackTest) {
    $candidate = $null
    try { $candidate = [uri] $SupabaseOriginForLoopbackTest } catch { $candidate = $null }
    if (-not $candidate -or $candidate.Host -notin '127.0.0.1', 'localhost', '::1') {
        throw "-SupabaseOriginForLoopbackTest accepts a loopback origin only. The secret must never be aimed at another host."
    }
    $SupabaseUrl = $SupabaseOriginForLoopbackTest.TrimEnd('/')
}

<#
    A constant, deliberately NOT a browser.

    Supabase refuses a secret key when the request looks like it came from a
    browser, and Windows PowerShell 5.1's default User-Agent is
    "Mozilla/5.0 (Windows NT ...) WindowsPowerShell/5.1.x" -- which is exactly
    that. Nothing in the script may leave this to the default.
#>
$OperatorUserAgent = 'Openi-Haskell-FB-Radar-Operator/1.0'

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

function New-SupabaseRequest {
    <#
        THE ONE PLACE A SUPABASE REQUEST IS CONSTRUCTED.

        All three operations -- the allowlist lookup, the existing-user lookup
        and the invitation itself -- go through this, so there is a single thing
        to get right and a single thing to test.

        `sb_secret_...` IS AN OPAQUE API KEY, NOT A JWT. It belongs in the
        `apikey` header and nowhere else:

          * Sent as `Authorization: Bearer sb_secret_...`, PostgREST tries to
            parse it AS A JWT, fails, and answers 401. That is what this script
            did, and the 401 it produced looked exactly like a bad key.
          * Supabase also refuses a secret key when the request looks like it
            came from a browser. PowerShell 5.1's default User-Agent is
            browser-shaped, so the User-Agent is set explicitly and constantly.

        No Authorization header is built here at all. There is nothing for a
        future edit to "fix" by adding one back.
    #>
    param(
        [string] $Method = 'GET',
        [Parameter(Mandatory)] [string] $Path,
        [string] $Body,
        [Parameter(Mandatory)] [string] $Key
    )

    $params = @{
        Method          = $Method
        Uri             = "$SupabaseUrl$Path"
        Headers         = @{ apikey = $Key; Accept = 'application/json' }
        UserAgent       = $OperatorUserAgent
        UseBasicParsing = $true
        ErrorAction     = 'Stop'
    }
    if ($Body) {
        $params['Body'] = $Body
        $params['ContentType'] = 'application/json'
    }
    if ($script:SupportsSkipError) { $params['SkipHttpErrorCheck'] = $true }
    return $params
}

function Invoke-Supabase {
    <#
        One request, built by New-SupabaseRequest inside Use-Plain so the key
        never reaches the process table.

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
        $params = New-SupabaseRequest -Method $Method -Path $Path -Body $Body -Key $key

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

function Get-AuthFailureExplanation {
    <#
        Say what a 401 or 403 actually means, WITHOUT blaming the key first.

        "Check the secret key" was the old message and it was the wrong first
        suggestion: the key was fine, and the request was malformed. Three
        different faults produce a refusal here and they need different fixes,
        so the explanation lists them in the order they are worth checking --
        and the response body is classified rather than reprinted, because it
        can quote the request.
    #>
    param([int] $Status, [string] $Body)

    $text = ("$Body").ToLowerInvariant()
    $lines = New-Object System.Collections.Generic.List[string]

    if ($text -match 'jws|jwt|jose|pgrst301|invalid claim|invalid signature') {
        $lines.Add('The service read the key as a JSON Web Token and could not parse it.')
        $lines.Add('That happens when an opaque sb_secret_... key is placed in the Authorization')
        $lines.Add('header. This script sends it only as `apikey`; if you see this, something')
        $lines.Add('is adding an Authorization header -- a proxy, or a modified copy of the script.')
    } elseif ($text -match 'user agent|user-agent|browser') {
        $lines.Add('The service rejected the request because it looked like it came from a browser.')
        $lines.Add("This script sends User-Agent: $OperatorUserAgent, so check for a proxy rewriting it.")
    } elseif ($text -match 'invalid api key|no api key|api key') {
        $lines.Add('The service did not accept the key itself.')
        $lines.Add('Confirm it is the SECRET key (sb_secret_...) for project dutmdlbangsthclgtkhy,')
        $lines.Add('copied whole, and that it has not been rotated since you copied it.')
    } else {
        $lines.Add('The service refused the request without saying which of these it was:')
        $lines.Add('  1. the key was sent in the wrong header and read as a JWT;')
        $lines.Add('  2. the request looked like it came from a browser;')
        $lines.Add('  3. the key itself is wrong, rotated, or for another project.')
        $lines.Add('This script sends the key only as `apikey` and sets a non-browser User-Agent,')
        $lines.Add('so 1 and 2 should not be possible from here -- check for a proxy in between')
        $lines.Add('before assuming the key is at fault.')
    }
    return ($lines -join "`n")
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
        if ($allow.Status -eq 401 -or $allow.Status -eq 403) {
            throw @"
The allowlist lookup was refused (HTTP $($allow.Status)).
$(Get-AuthFailureExplanation -Status $allow.Status -Body $allow.Body)
"@
        }
        throw "Could not read the invitation allowlist (HTTP $($allow.Status))."
    }
    $allowRows = @()
    $allowRows = ConvertFrom-JsonRows $allow.Body
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
        if ($users.Status -eq 401 -or $users.Status -eq 403) {
            throw @"
The account lookup was refused (HTTP $($users.Status)).
$(Get-AuthFailureExplanation -Status $users.Status -Body $users.Body)
"@
        }
        throw "Could not list existing accounts (HTTP $($users.Status))."
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
    Say '  Sent as the redirect_to QUERY PARAMETER, which is where the raw GoTrue'
    Say '  endpoint reads it. It must also be byte-identical to an entry in'
    Say '  Supabase > Authentication > URL Configuration > Redirect URLs:'
    Say '  Supabase silently falls back to the Site URL for a value that is not on'
    Say '  the allowlist, which looks exactly like the bug this script exists to avoid.'

    <#
        REDIRECT_TO IS A QUERY PARAMETER, NOT A BODY FIELD.

        This is the defect that sent the second live invitation to production.
        The Supabase JavaScript SDK takes `redirectTo` as an option and puts it
        on the URL for you; the RAW GoTrue endpoint has no such field. An
        `options.redirectTo` object in the JSON body is simply IGNORED -- not
        rejected, ignored -- and GoTrue then falls back to the project's Site
        URL, which is production. Nothing fails, nothing warns, and the
        invitation arrives pointing at an origin that does not have the
        authentication routes yet.

        So the destination goes where GoTrue actually reads it:

            POST /auth/v1/invite?redirect_to=<URL-encoded absolute URL>

        `EscapeDataString` and not string concatenation: the value contains `:`
        and `/`, and an unencoded one is a different URL than the allowlist
        entry Supabase compares against -- which would put us straight back in
        the silent Site-URL fallback.

        The body carries the address and nothing else. Putting the callback in
        both places would be worse than useless: it would look correct in
        review while still relying on the query parameter to do the work.
    #>
    $encodedRedirect = [uri]::EscapeDataString($RedirectTo)
    $payload = @{ email = $email } | ConvertTo-Json -Compress
    $invite = Invoke-Supabase -Method POST -Path "/auth/v1/invite?redirect_to=$encodedRedirect" -Body $payload

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
        if ($invite.Status -eq 401 -or $invite.Status -eq 403) {
            foreach ($line in (Get-AuthFailureExplanation -Status $invite.Status -Body $invite.Body) -split "`n") {
                Note $line
            }
        }
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
