import Head from "next/head";

// Impeesa: the look of the client forms (/f/<token> and its strategic form):
// impeesamarketing.com's dark background with gold accents, one card per
// question.

export const C = {
  bg: "#090a0f",
  card: "#11131a",
  line: "rgba(255,255,255,0.1)",
  line2: "rgba(255,255,255,0.18)",
  fg: "#edeef2",
  muted: "#9ba1ae",
  dim: "#858b99",
  gold: "#ab8b48",
  gold2: "#d1be93",
};

export function Shell({
  children,
  title,
  label,
}: {
  children: React.ReactNode;
  title: string;
  label: string;
}) {
  return (
    <div
      className="relative flex min-h-[100dvh] flex-col overflow-hidden px-4 py-6 sm:py-10"
      style={{ background: C.bg, color: C.fg, colorScheme: "dark" }}
    >
      <Head>
        <title>{`${title} · Impeesa Marketing`}</title>
        <meta name="robots" content="noindex" />
        <meta name="theme-color" content={C.bg} />
      </Head>
      <style>{`
        .imp-grid{background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:44px 44px;-webkit-mask-image:radial-gradient(ellipse 70% 60% at 50% 30%,#000 30%,transparent 75%);mask-image:radial-gradient(ellipse 70% 60% at 50% 30%,#000 30%,transparent 75%)}
        .imp-glow{background:radial-gradient(circle,rgba(171,139,72,.16),transparent 65%)}
        .imp-glow-navy{background:radial-gradient(circle,rgba(44,82,106,.25),transparent 65%)}
        @keyframes imp-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
        @keyframes imp-back{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}
        .imp-in{animation:imp-in .35s cubic-bezier(.2,.7,.2,1) both}
        .imp-back{animation:imp-back .35s cubic-bezier(.2,.7,.2,1) both}
        .imp-input::placeholder{color:#5b606c}
        @media (prefers-reduced-motion:reduce){.imp-in,.imp-back{animation:none}}
      `}</style>
      <div className="imp-grid pointer-events-none absolute inset-0" />
      <div className="imp-glow pointer-events-none absolute -right-48 -top-48 h-[520px] w-[520px] rounded-full" />
      <div className="imp-glow-navy pointer-events-none absolute -bottom-56 -left-56 h-[560px] w-[560px] rounded-full" />

      <header className="relative mx-auto mb-8 flex w-full max-w-[600px] items-center justify-between">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/impeesa-logo-blanco.webp"
          alt="Impeesa Marketing"
          className="h-9 w-auto"
        />
        <span
          className="font-mono text-[11px] uppercase tracking-[0.14em]"
          style={{ color: C.gold2 }}
        >
          {label}
        </span>
      </header>
      <main className="relative mx-auto flex w-full max-w-[600px] flex-1 flex-col justify-center pb-10">
        {children}
      </main>
    </div>
  );
}

export function Card({
  children,
  direction = "in",
}: {
  children: React.ReactNode;
  direction?: "in" | "back";
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-3xl border p-6 sm:p-9 ${direction === "back" ? "imp-back" : "imp-in"}`}
      style={{ background: C.card, borderColor: C.line }}
    >
      <div className="imp-glow pointer-events-none absolute -right-40 -top-40 h-[380px] w-[380px] rounded-full" />
      <div className="relative">{children}</div>
    </div>
  );
}

export function GoldButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="inline-flex h-[46px] items-center justify-center gap-2 whitespace-nowrap rounded-full px-6 text-[15px] font-semibold text-[#14110a] transition-[transform,background-color] duration-200 hover:-translate-y-px hover:!bg-[#e0cfa8] disabled:pointer-events-none disabled:opacity-40"
      style={{ background: C.gold2 }}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="inline-flex h-[46px] items-center justify-center gap-2 whitespace-nowrap rounded-full border bg-white/[0.02] px-5 text-[15px] font-semibold transition-[transform,border-color] duration-200 hover:-translate-y-px disabled:pointer-events-none disabled:opacity-30"
      style={{ borderColor: C.line2, color: C.fg }}
    >
      {children}
    </button>
  );
}
