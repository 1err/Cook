type CredentialResponse = { credential: string };
export type GoogleIdentity = {
  initialize: (options: {
    client_id: string;
    nonce: string;
    callback: (response: CredentialResponse) => void;
    ux_mode: "popup" | "redirect";
    login_uri?: string;
    auto_select: false;
    use_fedcm_for_button: boolean;
    button_auto_select: false;
  }) => void;
  renderButton: (parent: HTMLElement, options: {
    type: "standard";
    theme: "outline";
    size: "large";
    text: "continue_with";
    shape: "pill";
    locale: string;
    width: number;
  }) => void;
};
type GoogleWindow = Window & { google?: { accounts?: { id?: GoogleIdentity } } };
const GOOGLE_SCRIPT_URL = "https://accounts.google.com/gsi/client";
let sdkLoading: Promise<GoogleIdentity> | null = null;

function currentGoogleIdentity(): GoogleIdentity | undefined {
  return (window as GoogleWindow).google?.accounts?.id;
}

function loadScriptAttempt(): Promise<GoogleIdentity> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      const identity = currentGoogleIdentity();
      if (identity) resolve(identity);
      else {
        script.remove();
        reject(new Error("Google Identity Services could not load"));
      }
    };
    const timeout = window.setTimeout(finish, 30000);
    script.src = GOOGLE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = finish;
    script.onerror = finish;
    document.head.appendChild(script);
  });
}

async function loadWithRetry(): Promise<GoogleIdentity> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const identity = currentGoogleIdentity();
    if (identity) return identity;
    try {
      return await loadScriptAttempt();
    } catch (error) {
      if (attempt === 1) throw error;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    }
  }
  throw new Error("Google Identity Services could not load");
}

export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  const identity = currentGoogleIdentity();
  if (identity) return Promise.resolve(identity);
  if (sdkLoading) return sdkLoading;
  const pending = loadWithRetry();
  sdkLoading = pending;
  const reset = () => { if (sdkLoading === pending) sdkLoading = null; };
  void pending.then(reset, reset);
  return pending;
}
