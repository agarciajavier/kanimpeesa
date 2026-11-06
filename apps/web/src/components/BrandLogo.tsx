import { twMerge } from "tailwind-merge";

// Impeesa: brand logo; the dark-mode file swaps the navy for white.
export default function BrandLogo({ className }: { className?: string }) {
  return (
    <>
      <img
        src="/impeesa-logo.svg"
        alt="Impeesa Marketing"
        className={twMerge("block w-auto dark:hidden", className)}
      />
      <img
        src="/impeesa-logo-dark.svg"
        alt="Impeesa Marketing"
        className={twMerge("hidden w-auto dark:block", className)}
      />
    </>
  );
}
