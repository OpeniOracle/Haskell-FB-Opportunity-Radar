/**
 * The password policy, stated once.
 *
 * Length carries the weight. A twelve-character minimum with no composition
 * rules beats an eight-character minimum with four character-class
 * requirements, which is what produces `Password1!` on every account in the
 * building. The one composition rule kept exists to refuse `aaaaaaaaaaaa`, not
 * to shape the password.
 *
 * The requirements are rendered BEFORE submission, so nobody discovers them by
 * failing. `PASSWORD_REQUIREMENTS` is that list and `checkPassword` is what the
 * form enforces — one module, so the two cannot drift apart.
 */

export const MIN_PASSWORD_LENGTH = 12
/** bcrypt truncates beyond this. Say so rather than silently cutting. */
export const MAX_PASSWORD_LENGTH = 72

export interface PasswordProblem {
  readonly code: 'empty' | 'too_short' | 'too_long' | 'too_simple' | 'mismatch'
  readonly message: string
}

export const PASSWORD_REQUIREMENTS: readonly string[] = [
  `At least ${MIN_PASSWORD_LENGTH} characters`,
  'More than one kind of character, and not the same one repeated',
  'Both entries must match',
]

function characterClasses(value: string): number {
  let count = 0
  if (/[a-z]/.test(value)) count += 1
  if (/[A-Z]/.test(value)) count += 1
  if (/[0-9]/.test(value)) count += 1
  if (/[^A-Za-z0-9]/.test(value)) count += 1
  return count
}

/**
 * Every problem, in the order a person would fix them. An empty array means the
 * password is acceptable.
 *
 * All problems are returned rather than the first, because a form that reveals
 * its rules one failure at a time is a form people give up on.
 */
export function checkPassword(password: string, confirmation: string): PasswordProblem[] {
  if (password.length === 0) {
    return [{ code: 'empty', message: 'Enter a password.' }]
  }

  const problems: PasswordProblem[] = []
  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push({
      code: 'too_short',
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters. This one has ${password.length}.`,
    })
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    problems.push({
      code: 'too_long',
      message: `Use at most ${MAX_PASSWORD_LENGTH} characters.`,
    })
  }
  // A single repeated character reaches any length and is not a password.
  if (characterClasses(password) < 2 || new Set(password).size < 4) {
    problems.push({
      code: 'too_simple',
      message: 'Mix in more than one kind of character.',
    })
  }
  if (confirmation !== password) {
    problems.push({ code: 'mismatch', message: 'The two entries do not match.' })
  }
  return problems
}
