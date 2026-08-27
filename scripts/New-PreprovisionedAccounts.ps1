<#
.SYNOPSIS
    Administrator pre-provisioning: create approved accounts silently, with no
    password and no email of any kind.

.DESCRIPTION
    THE SECOND APPROVED ONBOARDING METHOD, AND HOW IT DIFFERS.

    There are exactly two ways an account comes to exist on this project, and
    self-registration is not one of them:

      INVITATION            Send-BootstrapInvitation.ps1. Supabase emails a
                            single-use link; the recipient sets a password
                            through /auth/set-password. The account does not
                            exist until they accept.

      PRE-PROVISIONING      This script. The account is created up front, with
                            NO password and NO email sent. The person activates
                            it themselves, later, through "Set or reset your
                            password" on the sign-in page -- which for them is
                            initial activation and for everyone else is
                            ordinary recovery. The two are the same flow on
                            purpose: one code path, one set of messages, and
                            nothing that reveals which case a given person is.

    WHY NO TEMPORARY PASSWORD. A password this script invented would have to
    reach the user somehow -- an email, a chat message, a spreadsheet -- and
    every one of those is a place it then lives. It would also be a credential
    the operator knows, which makes "only you could have done this" untrue for
    as long as it exists. So no password is generated, stored, displayed or
    transmitted. The account is created without one, and the only password it
    ever has is the one its owner chooses.

    WHY NOT INSERT INTO auth.users DIRECTLY. GoTrue owns that table: identities,
    audit entries and the confirmation bookkeeping are its business, and a row
    inserted behind it is a user that half-works in ways that surface much
    later. Everything here goes through the Auth Admin API.

    THE ALLOWLIST STILL COMES FIRST. Migration 0016's trigger fires
    `before insert on auth.users`, so it applies to the Admin API exactly as it
    applies to an invitation -- an address that is not on the list cannot be
    given an account by any path. This script checks first anyway, so the
    refusal is an explanation rather than a database error.

    ADDRESSES ARE NEVER COMMITTED. They are typed in, or read from a file the
    operator keeps outside this repository. Nothing in version control names an
    individual.

.EXAMPLE
    cd C:\path\to\Haskell-FB-Opportunity-Radar
    git switch claude/production-foundation
    git pull
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\New-PreprovisionedAccounts.ps1
#>

param(
    [string] $Branch = 'claude/production-foundation',
    [string] $Repository = 'OpeniOracle/Haskell-FB-Opportunity-Radar',
    [string] $ExpectedHead,

    <#
        A file of addresses, one per line, that the operator keeps OUTSIDE this
        repository. Optional; without it the addresses are typed in. A path
        inside the working tree is refused, because a list of individuals that
        lives next to the source is a list that eventually gets committed.
    #>
    [string] $AddressFile,

    # TEST ONLY, loopback-constrained. See Send-BootstrapInvitation.ps1.
    [string] $SupabaseOriginForLoopbackTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'OperatorGuards.psm1') -Force

# Not secret. Committed in netlify.toml; it grants nothing on its own.
$SupabaseUrl = 'https://dutmdlbangsthclgtkhy.supabase.co'

if ($SupabaseOriginForLoopbackTest) {
    $candidate = $null
    try { $candidate = [uri] $SupabaseOriginForLoopbackTest } catch { $candidate = $null }
    if (-not $candidate -or $candidate.Host -notin '127.0.0.1', 'localhost', '::1') {
        throw '-SupabaseOriginForLoopbackTest accepts a loopback origin only.'
    }
    $SupabaseUrl = $SupabaseOriginForLoopbackTest.TrimEnd('/')
}

$OperatorUserAgent = 'Openi-Haskell-FB-Radar-Operator/1.0'

<#
    The organizations whose people may hold an account.

    Domains, not individuals: a domain is a policy decision worth reviewing in a
    pull request, an address is personal data that does not belong in version
    control. An address outside these is refused before anything is created.
#>
$ApprovedDomains = @('haskell.com', 'openi-analytics.com')

<#
    Local parts that name a FUNCTION rather than a person.

    A shared mailbox is the wrong thing to hold an account: its readers change
    without anyone revoking anything, every action is attributed to a mailbox
    instead of a person, and a password reset sent to it is visible to everyone
    who reads it. Refused by local part, before the address is used.
#>
$SharedMailboxNames = @(
    'admin', 'administrator', 'info', 'support', 'help', 'helpdesk', 'sales',
    'marketing', 'hr', 'team', 'group', 'office', 'contact', 'enquiries',
    'inquiries', 'billing', 'accounts', 'accounting', 'finance', 'legal',
    'security', 'it', 'ops', 'operations', 'noreply', 'no-reply', 'donotreply',
    'do-not-reply', 'postmaster', 'webmaster', 'abuse', 'oracles', 'alerts',
    'notifications', 'service', 'services', 'shared', 'general', 'all'
)

# Reserved for SEC operational notices. Migration 0017 refuses to allowlist it.
$ReservedAddress = 'oracles@openi-analytics.com'

$script:SecretSecure = $null

function Say([string] $Message) { Write-Host $Message }
function Pass([string] $What) { Write-Host "  PASS  $What" -ForegroundColor Green }
function Fail([string] $What) { Write-Host "  FAIL  $What" -ForegroundColor Red }
function Note([string] $What) { Write-Host "  note  $What" -ForegroundColor DarkGray }
function Skip([string] $What) { Write-Host "  skip  $What" -ForegroundColor DarkYellow }

function Protect-Text([string] $Text) {
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

$null = Register-EngineEvent PowerShell.Exiting -SupportEvent -Action { Clear-Secrets }

$script:SupportsSkipError = (Get-Command Invoke-WebRequest).Parameters.ContainsKey('SkipHttpErrorCheck')

function New-SupabaseRequest {
    <#
        One construction for every request, identical to the invitation
        helper's. `sb_secret_...` is an OPAQUE API KEY: it goes in `apikey` and
        nowhere else, because PostgREST parses an Authorization bearer value as
        a JWT and answers 401 when it is not one. The User-Agent is set
        explicitly because Supabase refuses a secret key from something that
        looks like a browser, and PowerShell 5.1's default does.
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
                    $text = $reader.ReadToEnd(); $reader.Close()
                } catch { $text = '' }
                [pscustomobject]@{ Status = [int] $r.StatusCode; Body = $text }
            } else {
                [pscustomobject]@{ Status = 0; Body = (Protect-Text $_.Exception.Message) }
            }
        }
    }
}

function Test-AddressAcceptable([string] $Address) {
    <#
        Everything that can be judged without contacting anything.

        Returns a refusal reason, or $null when the address is acceptable. Run
        over the WHOLE list before a single account is created, so a bad entry
        halfway down does not leave half the list provisioned.
    #>
    $normalised = $Address.ToLowerInvariant()

    if ($normalised -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { return 'not an email address' }
    if ($normalised -eq $ReservedAddress) {
        return 'reserved for SEC operational notices; migration 0017 refuses to allowlist it'
    }

    $parts = $normalised -split '@', 2
    $local = $parts[0]
    $domain = $parts[1]

    if ($ApprovedDomains -notcontains $domain) {
        return "domain '$domain' is not an approved organization domain ($($ApprovedDomains -join ', '))"
    }
    # `+` tagging and dots do not turn a shared mailbox into a person.
    $bare = ($local -split '\+', 2)[0]
    if ($SharedMailboxNames -contains $bare -or $SharedMailboxNames -contains ($bare -replace '[._-]', '')) {
        return "'$bare' names a shared mailbox, not an individual"
    }
    return $null
}

function Read-Addresses {
    <#
        Typed in, or read from a file kept outside this repository.

        Never a parameter and never committed. A refusal for a path inside the
        working tree is not pedantry: a list of individuals stored beside the
        source is a list that eventually gets added in a hurry.
    #>
    if ($AddressFile) {
        $resolved = (Resolve-Path -LiteralPath $AddressFile).Path
        $repoRoot = (Invoke-OperatorGit rev-parse --show-toplevel).Text
        if ($repoRoot) {
            $full = [System.IO.Path]::GetFullPath($repoRoot)
            if ($resolved.StartsWith($full, [StringComparison]::OrdinalIgnoreCase)) {
                throw "The address file is inside the repository ($resolved). Keep it elsewhere: these are individuals' addresses and they must never be committed."
            }
        }
        return @(Get-Content -LiteralPath $resolved |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ -and -not $_.StartsWith('#') })
    }

    Say 'Enter one approved address per line. A blank line ends the list.'
    Say 'These are not stored anywhere by this script.'
    Write-Host ''
    $collected = New-Object System.Collections.Generic.List[string]
    while ($true) {
        $line = Read-Host -Prompt ('  address {0}' -f ($collected.Count + 1))
        if (-not $line -or -not $line.Trim()) { break }
        [void] $collected.Add($line.Trim())
    }
    return @($collected)
}

# ==========================================================================

$created = 0
$existing = 0
$refused = 0

try {
    Assert-NoObservation

    Write-Host "`n== 0. Repository guard" -ForegroundColor Cyan
    $head = Assert-CorrectCheckout -Repository $Repository -Branch $Branch -ExpectedHead $ExpectedHead

    Write-Host "`n== 1. Who is being provisioned" -ForegroundColor Cyan
    Say 'ADMINISTRATOR PRE-PROVISIONING. These accounts are created with no'
    Say 'password and receive NO email. Each person activates their own account'
    Say 'later using "Set or reset your password" on the sign-in page.'
    Write-Host ''

    $addresses = Read-Addresses
    if ($addresses.Count -lt 1) { throw 'No addresses supplied. Nothing to do.' }

    # Normalised for every comparison from here on. The original spelling is
    # never used to decide anything.
    $normalised = @($addresses | ForEach-Object { $_.ToLowerInvariant() } | Sort-Object -Unique)
    if ($normalised.Count -ne $addresses.Count) {
        Note "$($addresses.Count) entered, $($normalised.Count) distinct after lowercasing"
    }

    Write-Host "`n== 2. Shape, domain and mailbox checks" -ForegroundColor Cyan
    $acceptable = New-Object System.Collections.Generic.List[string]
    foreach ($address in $normalised) {
        $reason = Test-AddressAcceptable $address
        if ($reason) { Fail "$address -- $reason"; $refused++ }
        else { Pass $address; [void] $acceptable.Add($address) }
    }
    if ($refused -gt 0) {
        throw "$refused address(es) refused. Nothing has been created. Correct the list and run again."
    }

    # ---------------------------------------------------------------------
    Write-Host "`n== 3. Confirm the complete list" -ForegroundColor Cyan
    Say 'The following accounts will be CREATED on project dutmdlbangsthclgtkhy,'
    Say 'confirmed, with no password and with no email sent to anyone:'
    Write-Host ''
    foreach ($address in $acceptable) { Write-Host "    $address" }
    Write-Host ''
    Say 'Each person will be able to sign in only after they set their own'
    Say 'password. Until then the account exists and cannot be used.'
    Write-Host ''
    $answer = Read-Host -Prompt "Type CREATE to provision these $($acceptable.Count) account(s), or anything else to abort"
    if ($answer -cne 'CREATE') { throw 'Not confirmed. Nothing has been created.' }

    # ---------------------------------------------------------------------
    Write-Host "`n== 4. Supabase secret key" -ForegroundColor Cyan
    Say 'From Project Settings > API keys. Input is hidden and is never echoed,'
    Say 'stored, written to disk, or passed as an argument.'
    $script:SecretSecure = Read-SecretValue -Prompt 'Supabase secret key (sb_secret_...)'

    $shapeOk = Use-Plain -Secure $script:SecretSecure -Body { param($k) $k.StartsWith('sb_secret_') }
    if (-not $shapeOk) {
        throw 'That is not an sb_secret_... key. See docs/ENVIRONMENT.md.'
    }
    Pass 'key has the expected shape'

    # ---------------------------------------------------------------------
    Write-Host "`n== 5. Allowlist must already contain every address" -ForegroundColor Cyan
    Say 'Migration 0016 refuses to create an account for an address that is not'
    Say 'on auth_invite_allowlist. Checking first turns that into an'
    Say 'explanation rather than a database error halfway through the list.'
    Write-Host ''

    $missing = New-Object System.Collections.Generic.List[string]
    foreach ($address in $acceptable) {
        $encoded = [uri]::EscapeDataString($address)
        $row = Invoke-Supabase -Path "/rest/v1/auth_invite_allowlist?select=email_normalized&email_normalized=eq.$encoded"
        if ($row.Status -ne 200) {
            throw @"
The allowlist lookup was refused (HTTP $($row.Status)).
The key is sent only as ``apikey`` and the User-Agent is not browser-shaped, so
check for a proxy in between before assuming the key is at fault.
"@
        }
        $rows = @(ConvertFrom-JsonRows $row.Body)
        if ($rows.Count -lt 1) { Fail "$address is not on auth_invite_allowlist"; [void] $missing.Add($address) }
        else { Pass "$address is allowlisted" }
    }
    if ($missing.Count -gt 0) {
        throw @"
$($missing.Count) address(es) are not allowlisted. NOTHING has been created.
Add them to auth_invite_allowlist first -- see docs/HOSTED_VALIDATION_RUNBOOK.md
section B, step 1 -- then run this again.
"@
    }

    # ---------------------------------------------------------------------
    Write-Host "`n== 6. Create" -ForegroundColor Cyan
    Say 'email_confirm: true, no password, and no email of any kind. This is the'
    Say 'Auth Admin create-user endpoint, which does not send mail; the'
    Say 'invitation, magic-link and recovery endpoints are not called anywhere'
    Say 'in this script.'
    Write-Host ''

    foreach ($address in $acceptable) {
        # Idempotent: an account that already exists is reported and left alone.
        # Not "created again" and not "updated" -- someone may already have set
        # a password, and overwriting that would lock them out silently.
        $encoded = [uri]::EscapeDataString($address)
        $lookup = Invoke-Supabase -Path "/auth/v1/admin/users?filter=$encoded"
        if ($lookup.Status -ne 200) {
            Fail "$address -- could not check for an existing account (HTTP $($lookup.Status))"
            continue
        }
        $found = $null
        try {
            $parsed = $lookup.Body | ConvertFrom-Json
            $users = @()
            if ($parsed.PSObject.Properties.Name -contains 'users') { $users = @($parsed.users) }
            $found = $users | Where-Object { $_.email -and $_.email.ToLowerInvariant() -eq $address } | Select-Object -First 1
        } catch { $found = $null }

        if ($found) {
            $existing++
            Skip "$address already has an account -- left exactly as it is"
            continue
        }

        <#
            The body, in full, so there is nothing to wonder about:
            an address, and an instruction not to require confirmation.

            NO `password` field. NO `email_confirm: false`. No `data`, no
            `app_metadata`, no role. A role granted here on the strength of an
            email domain would be an authorization decision made by a script,
            and authorization on this project is the allowlist plus row-level
            security, never a domain.
        #>
        $payload = @{ email = $address; email_confirm = $true } | ConvertTo-Json -Compress
        $result = Invoke-Supabase -Method POST -Path '/auth/v1/admin/users' -Body $payload

        if ($result.Status -in 200, 201) {
            # Two fields are read from the response and the rest is discarded.
            # It carries a full user record and is never printed.
            $createdAddress = $null
            try { $createdAddress = ($result.Body | ConvertFrom-Json).email } catch { $createdAddress = $null }
            if ($createdAddress -and $createdAddress.ToLowerInvariant() -ne $address) {
                Fail "$address -- Supabase reported a different address. Investigate before anyone signs in."
            } else {
                $created++
                Pass "$address created, confirmed, with no password"
            }
        } else {
            $reason = Protect-Text $result.Body
            if ($reason.Length -gt 200) { $reason = $reason.Substring(0, 200) + '...' }
            Fail "$address -- Supabase refused (HTTP $($result.Status))"
            if ($result.Status -eq 500 -or $result.Status -eq 422) {
                Note 'A 500 here is usually migration 0016 refusing an address that is not allowlisted.'
            }
            Note "detail: $reason"
        }
    }

    # ---------------------------------------------------------------------
    Write-Host "`n== Result" -ForegroundColor Cyan
    Write-Host "  created:  $created"
    Write-Host "  existing: $existing (unmodified)"
    Write-Host "  head:     $head"
    Write-Host ''
    Say 'No email was sent. No password was generated.'
    Write-Host ''
    Say 'Tell each person, through whatever channel you normally use:'
    Say '  1. Go to the Radar sign-in page.'
    Say '  2. Choose "Set or reset your password".'
    Say '  3. Enter this exact address.'
    Say '  4. Open the emailed link and choose a password.'
    Say '  5. Sign in with it.'
    Write-Host ''
    Say 'There is nothing to send them from here and nothing for them to be given.'
}
catch {
    Write-Host ''
    Write-Host "ABORTED: $(Protect-Text $_.Exception.Message)" -ForegroundColor Red
    Write-Host ''
    Write-Host "Accounts created before this point: $created"
    exit 1
}
finally {
    Clear-Secrets
}

exit 0
