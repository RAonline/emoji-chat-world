import { useCallback, useEffect, useRef, useState } from "react";
import { Hash, Image as ImageIcon, Loader2, Send, Trash2, Video } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth, type Profile } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ChannelRow = {
  id: string;
  name: string;
  kind: string;
  server_id: string | null;
};

type Message = {
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  attachment_url: string | null;
  attachment_type: string | null;
  attachment_name: string | null;
  created_at: string;
};

const YEARS_10 = 60 * 60 * 24 * 365 * 10;

export function ChatView({
  channel,
  subtitle,
  onStartCall,
}: {
  channel: ChannelRow;
  subtitle: string;
  onStartCall: () => void;
}) {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [authors, setAuthors] = useState<Record<string, Profile>>({});
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const loadAuthors = useCallback(async (ids: string[]) => {
    const unknown = [...new Set(ids)];
    if (unknown.length === 0) return;
    const { data } = await supabase
      .from("profiles")
      .select("id, username, emoji")
      .in("id", unknown);
    if (data) {
      setAuthors((prev) => {
        const next = { ...prev };
        for (const row of data) next[row.id] = row;
        return next;
      });
    }
  }, []);

  useEffect(() => {
    let active = true;
    setMessages([]);

    void (async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("channel_id", channel.id)
        .order("created_at", { ascending: true })
        .limit(300);
      if (!active) return;
      if (error) {
        toast.error("Could not load messages");
        return;
      }
      setMessages(data ?? []);
      await loadAuthors((data ?? []).map((m) => m.author_id));
    })();

    const ch = supabase
      .channel(`messages:${channel.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channel.id}`,
        },
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
          void loadAuthors([row.author_id]);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channel.id}`,
        },
        (payload) => {
          const row = payload.old as { id: string };
          setMessages((prev) => prev.filter((m) => m.id !== row.id));
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(ch);
    };
  }, [channel.id, loadAuthors]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || !user) return;
    setSending(true);
    const { error } = await supabase
      .from("messages")
      .insert({ channel_id: channel.id, author_id: user.id, content: body });
    setSending(false);
    if (error) {
      toast.error("Message failed to send");
      return;
    }
    setText("");
  };

  const upload = async (file: File) => {
    if (!user) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error("Files must be under 25MB");
      return;
    }
    setUploading(true);
    const path = `${user.id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error } = await supabase.storage.from("uploads").upload(path, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (error) {
      setUploading(false);
      toast.error("Upload failed");
      return;
    }
    const { data: signed } = await supabase.storage.from("uploads").createSignedUrl(path, YEARS_10);
    const { error: insertError } = await supabase.from("messages").insert({
      channel_id: channel.id,
      author_id: user.id,
      content: text.trim(),
      attachment_url: signed?.signedUrl ?? null,
      attachment_type: file.type,
      attachment_name: file.name,
    });
    setUploading(false);
    if (insertError) {
      toast.error("Could not post attachment");
      return;
    }
    setText("");
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("messages").delete().eq("id", id);
    if (error) toast.error("Could not delete");
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Hash className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <h2 className="truncate font-display text-sm font-semibold">{channel.name}</h2>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={onStartCall}>
          <Video className="mr-1.5 h-4 w-4" /> Video call
        </Button>
      </header>

      <div className="scroll-slim flex-1 space-y-4 overflow-y-auto px-4 py-5">
        {messages.length === 0 && (
          <p className="pt-10 text-center text-sm text-muted-foreground">
            Nothing here yet — say hi {profile?.emoji ?? "👋"}
          </p>
        )}
        {messages.map((message) => {
          const author = authors[message.author_id];
          const isImage = message.attachment_type?.startsWith("image/");
          const isVideo = message.attachment_type?.startsWith("video/");
          return (
            <article key={message.id} className="group flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-xl">
                {author?.emoji ?? "🙂"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{author?.username ?? "someone"}</span>
                  <time className="text-[11px] text-muted-foreground">
                    {new Date(message.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  {message.author_id === user?.id && (
                    <button
                      onClick={() => void remove(message.id)}
                      className="ml-auto opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Delete message"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  )}
                </div>
                {message.content && (
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground/90">
                    {message.content}
                  </p>
                )}
                {message.attachment_url && (
                  <div className="mt-2">
                    {isImage ? (
                      <img
                        src={message.attachment_url}
                        alt={message.attachment_name ?? "attachment"}
                        loading="lazy"
                        className="max-h-80 rounded-xl border border-border"
                      />
                    ) : isVideo ? (
                      <video
                        src={message.attachment_url}
                        controls
                        className="max-h-80 rounded-xl border border-border"
                      />
                    ) : (
                      <a
                        href={message.attachment_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-primary"
                      >
                        📎 {message.attachment_name ?? "file"}
                      </a>
                    )}
                  </div>
                )}
              </div>
            </article>
          );
        })}
        <div ref={bottom} />
      </div>

      <form onSubmit={send} className="flex items-center gap-2 border-t border-border p-3">
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          accept="image/*,video/*,.gif,.pdf,.zip,.txt"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          aria-label="Attach image, GIF or file"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
        </Button>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Message #${channel.name}`}
        />
        <Button type="submit" size="icon" disabled={sending || !text.trim()} aria-label="Send message">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </section>
  );
}
