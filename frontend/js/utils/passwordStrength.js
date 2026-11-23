/**
 * Password strength labels for the register form.
 * Empty input stays idle (neutral) so the page does not flash "Too short" red on load.
 */

export function getPasswordChecks(password = '') {
  const value = String(password);
  return {
    minLength: value.length >= 10,
  };
}

export function allPasswordChecksPass(checks) {
  return Boolean(checks && checks.minLength);
}

/**
 * @returns {{ label: string|null, color: string, idle: boolean }}
 */
export function getStrengthInfo(passwordValue = '') {
  const value = String(passwordValue);
  if (!value) {
    return { label: null, color: 'var(--text-secondary)', idle: true };
  }
  const checks = getPasswordChecks(value);
  if (!checks.minLength) {
    return { label: 'Too short', color: 'var(--danger)', idle: false };
  }
  if (value.length < 14) {
    return { label: 'Long enough', color: 'var(--accent-text)', idle: false };
  }
  return { label: 'Long', color: 'var(--green)', idle: false };
}
