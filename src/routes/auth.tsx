import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";
import { AVATAR_EMOJIS, randomEmoji } from "@/lib/emoji";
import { EmojiPicker } from "@/components/EmojiPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Emojicord" },
      {
        name: "description",
        content:
          "Create your Emojicord account with an emoji avatar and join the global chat, servers and video calls.",
      },
      { property: "og:title", content: "Sign in — Emojicord" },
      {
        property: "og:description",
        content: "Emoji-only profiles, global chat, your own servers and 6-person video calls.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [emoji, setEmoji] = useState(AVATAR_EMOJIS[0]);
  const [busy, setBusy] = useState(false);

  // Randomize only after hydration so server and client markup match.
  useEffect(() => {
    setEmoji(randomEmoji(AVATAR_EMOJIS));
  }, []);

  useEffect(() => {
    if (!loading && user) void router.navigate({ to: "/" });
  }, [loading, user, router]);


  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { username: username.trim() || email.split("@")[0], emoji },
          },
        });
        if (error) throw error;
        toast.success("Account created!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      await router.navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Google sign-in failed");
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    await router.navigate({ to: "/" });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60% 40% at 20% 0%, var(--glow), transparent 70%), radial-gradient(50% 40% at 90% 100%, oklch(0.72 0.13 265 / 0.25), transparent 70%)",
        }}
      />
      <div className="neon-panel relative w-full max-w-md rounded-2xl p-7 shadow-panel">
        <div className="flex items-center gap-3">
          <img src={logo} alt="" width={40} height={40} className="h-10 w-10" />
          <div>
            <h1 className="glow-text text-2xl font-bold text-primary">Emojicord</h1>
            <p className="text-xs text-muted-foreground">
              Global chat · your own servers · video calls
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "signup" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="username">Display name</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="neonfox"
                  autoComplete="nickname"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Your profile picture is an emoji{" "}
                  <span className="ml-1 text-2xl leading-none">{emoji}</span>
                </Label>
                <EmojiPicker value={emoji} onChange={setEmoji} options={AVATAR_EMOJIS} />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </div>

          <Button type="submit" className="w-full" disabled={busy}>
            {mode === "signup" ? "Create account" : "Sign in"}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>

        <Button variant="secondary" className="w-full" onClick={google} disabled={busy}>
          Continue with Google
        </Button>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {mode === "signup" ? "Already have an account?" : "New here?"}{" "}
          <button
            type="button"
            className="font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          >
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </main>
  );
}
