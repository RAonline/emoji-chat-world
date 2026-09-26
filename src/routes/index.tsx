import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Compass, Globe, Hash, LogOut, Pencil, Plus, Volume2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmojiPicker } from "@/components/EmojiPicker";
import { SERVER_EMOJIS, randomEmoji } from "@/lib/emoji";
import { ChatView, type ChannelRow } from "@/components/chat/ChatView";
import { VideoCall } from "@/components/chat/VideoCall";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pcord — Global chat, servers & video calls" },
      {
        name: "description",
        content:
          "Hang out in global chat, build your own servers, share GIFs and files, and jump into video calls with an emoji profile.",
      },
      { property: "og:title", content: "Pcord — Global chat, servers & video calls" },
      {
        property: "og:description",
        content: "Global chat rooms, your own servers, GIF uploads and 6-person video calls.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type ServerRow = {
  id: string;
  name: string;
  emoji: string;
  is_public: boolean;
  owner_id: string;
};

const GLOBAL_TEXT = "00000000-0000-0000-0000-000000000001";

function Index() {
  const { user, profile, loading, signOut } = useAuth();
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [directory, setDirectory] = useState<ServerRow[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [activeServer, setActiveServer] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<ChannelRow | null>(null);
  const [inCall, setInCall] = useState<ChannelRow | null>(null);
  const [showDirectory, setShowDirectory] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState(() => randomEmoji(SERVER_EMOJIS));
  const [creating, setCreating] = useState(false);
  const [addChannelOpen, setAddChannelOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelKind, setNewChannelKind] = useState<"text" | "voice">("text");
  const [savingChannel, setSavingChannel] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ChannelRow | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const loadServers = useCallback(async () => {
    if (!user) return;
    const { data: memberships } = await supabase
      .from("server_members")
      .select("server_id")
      .eq("user_id", user.id);
    const ids = (memberships ?? []).map((m) => m.server_id);
    if (ids.length === 0) {
      setServers([]);
      return;
    }
    const { data } = await supabase
      .from("servers")
      .select("id, name, emoji, is_public, owner_id")
      .in("id", ids)
      .order("created_at");
    setServers(data ?? []);
  }, [user]);

  const loadChannels = useCallback(async (serverId: string | null) => {
    const query = supabase.from("channels").select("id, name, kind, server_id").order("created_at");
    const { data } = serverId
      ? await query.eq("server_id", serverId)
      : await query.is("server_id", null);
    const rows = data ?? [];
    setChannels(rows);
    setActiveChannel(rows.find((r) => r.kind === "text") ?? rows[0] ?? null);
  }, []);

  useEffect(() => {
    if (user) void loadServers();
  }, [user, loadServers]);

  useEffect(() => {
    if (user) void loadChannels(activeServer);
  }, [user, activeServer, loadChannels]);

  const openDirectory = useCallback(async () => {
    const { data } = await supabase
      .from("servers")
      .select("id, name, emoji, is_public, owner_id")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(50);
    setDirectory(data ?? []);
    setShowDirectory(true);
  }, []);

  const joinServer = async (serverId: string) => {
    if (!user) return;
    const { error } = await supabase
      .from("server_members")
      .insert({ server_id: serverId, user_id: user.id, role: "member" });
    if (error && !error.message.includes("duplicate")) {
      toast.error(error.message);
      return;
    }
    await loadServers();
    setShowDirectory(false);
    setActiveServer(serverId);
    toast.success("Joined server");
  };

  const createServer = async () => {
    if (!user || !newName.trim()) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("servers")
      .insert({ name: newName.trim(), emoji: newEmoji, owner_id: user.id, is_public: true })
      .select("id, name, emoji, is_public, owner_id")
      .single();
    if (error || !data) {
      setCreating(false);
      toast.error(error?.message ?? "Could not create server");
      return;
    }
    await supabase
      .from("server_members")
      .insert({ server_id: data.id, user_id: user.id, role: "owner" });
    await supabase.from("channels").insert([
      { server_id: data.id, name: "general", kind: "text" },
      { server_id: data.id, name: "lounge", kind: "voice" },
    ]);
    setCreating(false);
    setCreateOpen(false);
    setNewName("");
    setNewEmoji(randomEmoji(SERVER_EMOJIS));
    await loadServers();
    setActiveServer(data.id);
    toast.success("Server created");
  };

  const isOwner = useMemo(
    () => !!user && !!activeServer && servers.find((s) => s.id === activeServer)?.owner_id === user.id,
    [user, activeServer, servers],
  );

  const addChannel = async () => {
    if (!activeServer || !newChannelName.trim()) return;
    setSavingChannel(true);
    const { error } = await supabase.from("channels").insert({
      server_id: activeServer,
      name: newChannelName.trim().toLowerCase().replace(/\s+/g, "-"),
      kind: newChannelKind,
    });
    setSavingChannel(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setAddChannelOpen(false);
    setNewChannelName("");
    setNewChannelKind("text");
    await loadChannels(activeServer);
    toast.success("Channel created");
  };

  const renameChannel = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setSavingChannel(true);
    const { error } = await supabase
      .from("channels")
      .update({ name: renameValue.trim().toLowerCase().replace(/\s+/g, "-") })
      .eq("id", renameTarget.id);
    setSavingChannel(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRenameTarget(null);
    await loadChannels(activeServer);
    toast.success("Channel renamed");
  };

  const subtitle = useMemo(() => {
    if (!activeServer) return "Global — everyone on Pcord";
    return servers.find((s) => s.id === activeServer)?.name ?? "Server";
  }, [activeServer, servers]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading…
      </main>
    );
  }

  if (!user || !profile) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
        <h1 className="text-4xl font-bold text-foreground">
          Pcord <span className="text-primary">✦</span>
        </h1>
        <p className="max-w-md text-muted-foreground">
          Global chat, your own servers, GIF and file uploads, and video calls — with an emoji as
          your face.
        </p>
        <Button asChild size="lg">
          <Link to="/auth">Get started</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="flex h-screen bg-background text-foreground">
      {/* Server rail */}
      <aside className="flex w-[76px] flex-col items-center gap-2 border-r border-border bg-card/60 py-3">
        <button
          onClick={() => setActiveServer(null)}
          title="Global chat"
          className={`flex h-12 w-12 items-center justify-center rounded-2xl text-xl transition ${
            activeServer === null
              ? "bg-primary text-primary-foreground"
              : "bg-muted hover:bg-muted/70"
          }`}
        >
          <Globe className="h-5 w-5" />
        </button>
        <div className="my-1 h-px w-8 bg-border" />
        {servers.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveServer(s.id)}
            title={s.name}
            className={`flex h-12 w-12 items-center justify-center rounded-2xl text-xl transition ${
              activeServer === s.id
                ? "bg-primary/20 ring-2 ring-primary"
                : "bg-muted hover:bg-muted/70"
            }`}
          >
            {s.emoji}
          </button>
        ))}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <button
              title="Create server"
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-primary transition hover:bg-muted/70"
            >
              <Plus className="h-5 w-5" />
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a server</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Server name</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Neon Lounge"
                />
              </div>
              <div className="space-y-2">
                <Label>Server emoji</Label>
                <EmojiPicker options={SERVER_EMOJIS} value={newEmoji} onChange={setNewEmoji} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createServer} disabled={creating || !newName.trim()}>
                {creating ? "Creating…" : "Create server"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <button
          onClick={openDirectory}
          title="Discover public servers"
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-foreground transition hover:bg-muted/70"
        >
          <Compass className="h-5 w-5" />
        </button>
      </aside>

      {/* Channel list */}
      <aside className="flex w-60 flex-col border-r border-border bg-card/40">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="truncate text-sm font-semibold">{subtitle}</p>
          {isOwner && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              title="Add channel"
              onClick={() => setAddChannelOpen(true)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {channels.map((c) => (
            <div key={c.id} className="group relative">
              <button
                onClick={() => {
                  setInCall(null);
                  if (c.kind === "voice") setInCall(c);
                  else setActiveChannel(c);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${
                  (inCall?.id ?? activeChannel?.id) === c.id
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                {c.kind === "voice" ? (
                  <Volume2 className="h-4 w-4" />
                ) : (
                  <Hash className="h-4 w-4" />
                )}
                <span className="flex-1 truncate text-left">{c.name}</span>
                {isOwner && (
                  <span
                    role="button"
                    title="Rename channel"
                    className="hidden shrink-0 rounded p-0.5 hover:bg-muted group-hover:block"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameTarget(c);
                      setRenameValue(c.name);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </span>
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-2 border-t border-border p-3">
          <span className="text-2xl">{profile.emoji}</span>
          <span className="flex-1 truncate text-sm font-medium">{profile.username}</span>
          <Button variant="ghost" size="icon" onClick={() => void signOut()} title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </aside>

      {/* Main pane */}
      <section className="flex min-w-0 flex-1 flex-col">
        {inCall ? (
          <VideoCall channelId={inCall.id} onLeave={() => setInCall(null)} />
        ) : activeChannel ? (
          <ChatView
            channel={activeChannel}
            subtitle={subtitle}
            onStartCall={() => {
              const voice = channels.find((c) => c.kind === "voice");
              if (voice) setInCall(voice);
              else setInCall({ ...activeChannel, kind: "voice" });
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            No channels yet
          </div>
        )}
      </section>

      <Dialog open={showDirectory} onOpenChange={setShowDirectory}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Public servers</DialogTitle>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {directory.length === 0 && (
              <p className="text-sm text-muted-foreground">No public servers yet.</p>
            )}
            {directory.map((s) => {
              const joined = servers.some((m) => m.id === s.id);
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-md border border-border p-2"
                >
                  <span className="text-2xl">{s.emoji}</span>
                  <span className="flex-1 truncate text-sm font-medium">{s.name}</span>
                  <Button
                    size="sm"
                    variant={joined ? "secondary" : "default"}
                    disabled={joined}
                    onClick={() => void joinServer(s.id)}
                  >
                    {joined ? "Joined" : "Join"}
                  </Button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={addChannelOpen} onOpenChange={setAddChannelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a channel</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Channel name</Label>
              <Input
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                placeholder="memes"
              />
            </div>
            <div className="space-y-2">
              <Label>Channel type</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={newChannelKind === "text" ? "default" : "secondary"}
                  onClick={() => setNewChannelKind("text")}
                >
                  <Hash className="mr-1 h-4 w-4" /> Text
                </Button>
                <Button
                  type="button"
                  variant={newChannelKind === "voice" ? "default" : "secondary"}
                  onClick={() => setNewChannelKind("voice")}
                >
                  <Volume2 className="mr-1 h-4 w-4" /> Voice
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={addChannel} disabled={savingChannel || !newChannelName.trim()}>
              {savingChannel ? "Creating…" : "Create channel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename channel</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Channel name</Label>
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
          </div>
          <DialogFooter>
            <Button onClick={renameChannel} disabled={savingChannel || !renameValue.trim()}>
              {savingChannel ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <span className="hidden" data-global-channel={GLOBAL_TEXT} />
    </main>
  );
}
