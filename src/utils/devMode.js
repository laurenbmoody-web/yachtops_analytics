/**
 * DEV MODE Utility
 * 
 * Provides global dev mode detection for UI review without auth/tenant requirements.
 * 
 * DEV MODE is ON when:
 * - URL query includes ?auth=0
 * - OR localStorage key cargo_dev_mode === "1"
 * 
 * When DEV MODE is ON:
 * - All pages render without auth/tenant checks
 * - No redirects to /dashboard or /login
 * - Mock session/tenant data provided
 * - Permission helpers return true
 * 
 * When DEV MODE is OFF:
 * - Normal production behavior (auth required, permissions enforced)
 */

/**
 * Check if DEV MODE is currently enabled
 * @returns {boolean} True if dev mode is active
 */
export function isDevMode() {
  // Check URL query parameter
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams?.get('auth') === '0') {
    return true;
  }
  
  // Check localStorage
  if (localStorage.getItem('cargo_dev_mode') === '1') {
    return true;
  }
  
  return false;
}

/**
 * Enable DEV MODE (sets localStorage flag)
 */
export function enableDevMode() {
  localStorage.setItem('cargo_dev_mode', '1');
  console.log('[DEV MODE] Enabled via localStorage');
}

/**
 * Disable DEV MODE (removes localStorage flag)
 */
export function disableDevMode() {
  localStorage.removeItem('cargo_dev_mode');
  console.log('[DEV MODE] Disabled');
}
