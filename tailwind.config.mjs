/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      borderRadius: {
        xl: "0.9rem",
        "2xl": "1.1rem",
      },
      ringColor: {
        DEFAULT: "#1E4D2B",
      },
      colors: {
        csuGreen: "#1E4D2B",
        csuGold: "#C8C372",
      },
    },
  },
  plugins: [],
};

export default config;
