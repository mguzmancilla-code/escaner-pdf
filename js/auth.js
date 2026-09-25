// Cuenta de usuario: conexión con Supabase e inicio de sesión con correo y contraseña.
// La librería de Supabase se carga desde js/vendor/supabase.js (incluida en la app
// para que funcione sin conexión) y queda disponible como window.supabase.

import { SUPABASE_KEY, SUPABASE_URL } from './config.js';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true, // la sesión se guarda en el iPhone y no hay que volver a entrar
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

let currentUser = null;
const listeners = new Set();

export const getUser = () => currentUser;

/** Avisa cada vez que se inicia o se cierra la sesión. */
export function onUserChange(listener) {
  listeners.add(listener);
  listener(currentUser);
  return () => listeners.delete(listener);
}

supabase.auth.onAuthStateChange((_event, session) => {
  const user = session?.user ?? null;
  if (user?.id === currentUser?.id) return;
  currentUser = user;
  listeners.forEach((listener) => listener(currentUser));
});

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(explain(error));
}

/** Devuelve true si la cuenta quedó lista para usar (sin confirmación por correo). */
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(explain(error));
  return Boolean(data.session);
}

export async function signOut() {
  // scope 'local': cierra la sesión en este iPhone aunque no haya conexión.
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw new Error(explain(error));
}

/** Traduce los errores de Supabase a mensajes claros en español. */
function explain(error) {
  const messages = {
    invalid_credentials: 'Correo o contraseña incorrectos.',
    user_already_exists: 'Ya existe una cuenta con ese correo. Usa «Entrar».',
    email_exists: 'Ya existe una cuenta con ese correo. Usa «Entrar».',
    weak_password: 'La contraseña es muy débil. Usa al menos 8 caracteres, con letras y números.',
    email_address_invalid: 'El correo no es válido.',
    validation_failed: 'Revisa el correo y la contraseña.',
    signup_disabled: 'La creación de cuentas está desactivada.',
    email_not_confirmed: 'Falta confirmar el correo de esta cuenta.',
    over_request_rate_limit: 'Demasiados intentos. Espera un momento y vuelve a probar.',
    over_email_send_rate_limit: 'Demasiados intentos. Espera un momento y vuelve a probar.',
  };
  if (messages[error.code]) return messages[error.code];
  if (error.name === 'AuthRetryableFetchError' || error.status === 0 || !navigator.onLine) {
    return 'Sin conexión a internet. Inténtalo de nuevo cuando tengas conexión.';
  }
  return error.message || 'No se pudo completar la operación.';
}
