import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Admin console: an OMR answer sheet. Pencil graphite on cool paper,
        // with the sheet's pink ink as the one accent.
        omr: {
          paper: "#F6F7F9",
          sheet: "#FFFFFF",
          ink: "#23262D",
          lead: "#6B7280",
          pink: "#C8326B",
          "pink-dark": "#A5265A",
          "pink-soft": "#FBEAF1",
          rule: "#E3E6EC",
          pass: "#1F7A55",
          "pass-soft": "#E7F4EE",
          fail: "#B42318",
          "fail-soft": "#FDECEA",
        },
      },
      fontFamily: {
        admin: ["var(--font-admin)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
