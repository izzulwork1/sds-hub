/*
 * Password reset page. Reached only via the Supabase recovery link emailed to the user.
 * The recovery token in the URL establishes a short-lived session (detectSessionInUrl),
 * which authorizes a single updateUser({ password }) call. No secrets live here.
 */
const config = window.SDS_CONFIG || {};
const elements = {
  form: document.getElementById("resetForm"),
  newPassword: document.getElementById("newPasswordInput"),
  confirmPassword: document.getElementById("confirmPasswordInput"),
  button: document.getElementById("resetButton"),
  error: document.getElementById("resetError"),
  notice: document.getElementById("resetNotice")
};
let supabaseClient = null;
let hasRecoverySession = false;

function showError(message) { elements.notice.hidden = true; elements.error.textContent = message; elements.error.hidden = false; }
function showNotice(message) { elements.error.hidden = true; elements.notice.textContent = message; elements.notice.hidden = false; }

async function initialize() {
  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) {
    elements.button.disabled = true;
    return showError("Password reset is unavailable: the public configuration is incomplete.");
  }
  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session && ["PASSWORD_RECOVERY", "SIGNED_IN", "INITIAL_SESSION"].includes(event)) hasRecoverySession = true;
  });
  elements.form.addEventListener("submit", handleSubmit);
  const { data } = await supabaseClient.auth.getSession();
  hasRecoverySession = hasRecoverySession || Boolean(data.session);
  if (!hasRecoverySession) showNotice("Open this page using the password-reset link from your email.");
}

async function handleSubmit(event) {
  event.preventDefault();
  const password = elements.newPassword.value;
  const confirmValue = elements.confirmPassword.value;
  if (!password) return showError("Enter a new password.");
  if (password.length < 8) return showError("Use at least 8 characters.");
  if (password !== confirmValue) return showError("The two passwords do not match.");
  elements.button.disabled = true;
  elements.button.textContent = "Updating…";
  try {
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;
    showNotice("Password updated. Redirecting you to the login page…");
    setTimeout(() => { window.location.href = "./admin.html"; }, 1500);
  } catch (error) {
    console.warn("Password update failed:", error?.message || error);
    showError("This reset link is invalid or has expired. Return to login and request a new reset email.");
    elements.button.disabled = false;
    elements.button.textContent = "Update password";
  }
}

initialize().catch((error) => {
  console.warn("Reset page init failed:", error?.message || error);
  showError("Password reset could not start. Return to login and try again.");
});
