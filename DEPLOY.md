# Deploying to Vercel

1. Push this repo to GitHub and import it in Vercel.
2. Vercel picks up `vercel.json`, which builds with the Vercel server preset
   (`NITRO_PRESET=vercel npm run build`) and outputs to `.vercel/output`.
   Leave Framework Preset as "Other" and don't override the build command.
3. Add these Environment Variables (Production + Preview):

   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_PROJECT_ID`
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_PROJECT_ID`

   Copy the values from the local `.env` file.
4. In the backend auth settings, add your Vercel domain
   (e.g. `https://your-app.vercel.app`) to the allowed Site URL / redirect URLs
   so email confirmation and Google sign-in return to the right place.

## Camera and microphone

Video calls use `navigator.mediaDevices.getUserMedia`, which browsers only
allow on `https://` or `http://localhost`. Vercel serves HTTPS, so camera and
mic work there once the user accepts the browser permission prompt.

Inside an embedded preview iframe the browser blocks camera/mic unless the
iframe sends `allow="camera; microphone"`, so test calls on the deployed URL
(or open the preview in its own tab).
