# Firebase development client

The browser client targets the isolated Zetema development Firebase project through Vite environment variables. Anonymous Authentication must be enabled before deployed sync can work. Because the callable Functions enforce App Check, deployed browser builds also require a reCAPTCHA v3 App Check site key. Local development can use the App Check debug provider; debug tokens must never be committed.
