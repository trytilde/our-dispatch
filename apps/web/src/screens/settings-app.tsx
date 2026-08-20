import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  BackIcon,
  getThemePreference,
  SettingsIcon,
  setThemePreference,
  type ThemePreference,
} from "@tryopenbot/ui";

const sections = [{ id: "general", label: "General", icon: SettingsIcon }] as const;

const themeOptions: readonly { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const pageTransition = { duration: 0.18, ease: [0.23, 1, 0.32, 1] } as const;

export function SettingsApp() {
  const navigate = useNavigate();
  const [section, setSection] = useState<(typeof sections)[number]["id"]>("general");
  const [theme, setTheme] = useState<ThemePreference>(() => getThemePreference());
  const macDesktop = window.openbotDesktop?.platform === "mac";

  return (
    <motion.main
      animate={{ opacity: 1 }}
      className="flex h-screen w-full bg-page text-ink"
      initial={{ opacity: 0 }}
      transition={pageTransition}
    >
      <aside
        className={`flex w-[248px] shrink-0 flex-col gap-1 border-r border-line bg-surface px-3
          pb-3 ${macDesktop ? "pt-[42px]" : "pt-3"}`}
      >
        <button
          aria-label="Back to workspace"
          className="mb-2 flex h-8 w-full items-center gap-2 rounded-control px-2.5 text-left
            text-[12.5px] font-medium text-ink-2 transition-[background-color,color] duration-150
            hover:bg-hover hover:text-ink"
          onClick={() => void navigate({ to: "/" })}
          type="button"
        >
          <BackIcon className="size-4 shrink-0 fill-none stroke-current stroke-[1.3]" />
          Back
        </button>
        <h1 className="px-2.5 pb-1 text-[13px] font-semibold text-ink">Settings</h1>
        {sections.map((item) => {
          const Icon = item.icon;
          const selected = item.id === section;
          return (
            <button
              aria-current={selected ? "page" : undefined}
              className={`flex h-8 w-full items-center gap-2 rounded-control px-2.5 text-left
                text-[12.5px] font-medium transition-[background-color,color] duration-150
                hover:bg-hover hover:text-ink ${selected ? "bg-hover-2 text-ink" : "text-ink-2"}`}
              key={item.id}
              onClick={() => setSection(item.id)}
              type="button"
            >
              <Icon className="size-4 shrink-0 fill-none stroke-current stroke-[1.3]" />
              {item.label}
            </button>
          );
        })}
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-8 py-10">
          <header className="flex flex-col gap-1">
            <h2 className="text-[18px] font-semibold text-ink">General</h2>
            <p className="text-[13px] text-ink-3">
              Preferences for this browser. They apply to the OpenBot workspace on this device.
            </p>
          </header>

          <div className="flex flex-col gap-3 rounded-[12px] bg-surface p-4 shadow-hairline">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-[13px] font-medium text-ink">Appearance</h3>
              <p className="text-[12.5px] text-ink-3">
                Follow the operating system or pin a single theme.
              </p>
            </div>
            <div className="flex gap-1.5">
              {themeOptions.map((option) => (
                <button
                  aria-pressed={theme === option.value}
                  className={`h-8 rounded-control px-3 text-[12.5px] font-medium
                    transition-[background-color,color] duration-150 hover:bg-hover
                    ${theme === option.value ? "bg-hover-2 text-ink" : "text-ink-2"}`}
                  key={option.value}
                  onClick={() => {
                    setThemePreference(option.value);
                    setTheme(option.value);
                  }}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </motion.main>
  );
}
